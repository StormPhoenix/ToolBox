/**
 * ChatEngine — 纯对话引擎（V1，无工具）
 *
 * 职责：
 * 1. 接收用户消息 + 附件，拼装为 LLMMessageParam 送入 Provider.streamMessage
 * 2. 把流式增量通过 onEvent 回调推送给 IPC 层
 * 3. 持久化 user/assistant 消息到 session-store
 * 4. 支持 abort 抢占：新请求发来先 abort 旧的
 *
 * 设计要点：
 * - 引擎本身是单例，通过 sessionId 隔离并发请求（不同会话可并行）
 * - 同一会话的新请求会 abort 该会话的旧请求
 * - 每次请求都从 LLMRouter 拿最新 Provider（不缓存），保证 Settings 改动立即生效
 * - 错误分类参考外部项目的 toUserFriendlyError，但不做二次 LLM 恢复（V1 裁剪）
 */
import { randomUUID } from 'crypto';
import type {
  LLMMessageParam,
  LLMContentBlock,
  LLMTextBlock,
  LLMImageBlock,
} from '../llm/types';
import { getSharedLLMRouter } from '../llm/llm-ipc';
import type {
  ChatAttachmentInput,
  ChatEvent,
  ChatMessage,
} from './types';
import { toLLMMessages } from './types';
import * as store from './session-store';
import { createLogger } from '../logger';

const log = createLogger('ChatEngine');

/** 周期性 stall 日志：长时间无响应时提示 */
const STALL_WARN_INTERVAL_MS = 15_000;

function startStallWarning(phase: string, requestId: string): () => void {
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += STALL_WARN_INTERVAL_MS;
    log.warn(
      `[ChatTiming] ${phase} 已等待 ${(elapsed / 1000).toFixed(0)}s 仍未完成, requestId=${requestId}`
    );
  }, STALL_WARN_INTERVAL_MS);
  return () => clearInterval(timer);
}

export type ChatEventEmitter = (event: ChatEvent) => void;

// ─── 活动请求管理 ──────────────────────────────────────────

interface ActiveRequest {
  requestId: string;
  sessionId: string;
  abort: AbortController;
}

/** sessionId → ActiveRequest */
const activeRequests = new Map<string, ActiveRequest>();

/** 外部查询：某 requestId 是否仍活跃 */
export function isRequestActive(requestId: string): boolean {
  for (const req of activeRequests.values()) {
    if (req.requestId === requestId) return true;
  }
  return false;
}

/** 中止指定 requestId 对应的请求；找不到则忽略 */
export function abortRequest(requestId: string): void {
  for (const [sid, req] of activeRequests.entries()) {
    if (req.requestId === requestId) {
      req.abort.abort();
      activeRequests.delete(sid);
      log.info(`中止请求: requestId=${requestId}, sessionId=${sid}`);
      return;
    }
  }
}

// ─── 消息构造 ──────────────────────────────────────────────

/**
 * 将用户文本 + 附件构造成 ChatMessage。
 * 无附件 → content 是纯字符串；有附件 → content 是 [text, image, image, ...] 数组。
 */
function buildUserMessage(
  userText: string,
  attachments?: ChatAttachmentInput[]
): ChatMessage {
  const hasAttachments = attachments && attachments.length > 0;
  let content: string | LLMContentBlock[];

  if (!hasAttachments) {
    content = userText;
  } else {
    const blocks: LLMContentBlock[] = [];
    if (userText.trim()) {
      blocks.push({ type: 'text', text: userText } satisfies LLMTextBlock);
    }
    for (const att of attachments!) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.base64,
        },
      } satisfies LLMImageBlock);
    }
    content = blocks;
  }

  return {
    id: randomUUID(),
    role: 'user',
    content,
    timestamp: Date.now(),
    attachments: hasAttachments
      ? attachments!.map((a) => ({ name: a.name, mediaType: a.mediaType }))
      : undefined,
  };
}

// ─── 错误映射 ──────────────────────────────────────────────

function toFriendlyError(err: Error): { message: string; recoverable: boolean } {
  const msg = err.message || '';
  if (msg.includes('401') || /authentication|unauthori[sz]ed/i.test(msg)) {
    return { message: 'API Key 无效或已过期，请在设置中重新填写。', recoverable: false };
  }
  if (/timeout|ECONNREFUSED|ENOTFOUND|ENETUNREACH/i.test(msg)) {
    return { message: '网络连接失败，请稍后重试。', recoverable: true };
  }
  if (msg.includes('429') || /rate[_-]?limit/i.test(msg)) {
    return { message: '请求过于频繁，请稍后再试。', recoverable: true };
  }
  if (/overloaded|529|500|502|503|504/i.test(msg)) {
    return { message: '服务端暂时繁忙，请稍后再试。', recoverable: true };
  }
  if (/context.*length|too.*long|413/i.test(msg)) {
    return {
      message: '对话已超出模型上下文长度，请清空上下文或新建会话。',
      recoverable: false,
    };
  }
  if (/abort/i.test(msg)) {
    return { message: '请求已中止。', recoverable: true };
  }
  return { message: `对话失败：${msg || '未知错误'}`, recoverable: true };
}

// ─── 核心：运行一次对话 ────────────────────────────────────

/**
 * 发送用户消息并启动流式回复。
 *
 * 立即：
 *  - 持久化 user 消息
 *  - 返回 { requestId, userMessageId, userMessage }
 *
 * 异步：
 *  - 通过 onEvent 推送 stream-chunk / stream-end / error / aborted
 *  - 回复完成后持久化 assistant 消息
 */
export async function sendMessage(params: {
  sessionId: string;
  userText: string;
  attachments?: ChatAttachmentInput[];
  onEvent: ChatEventEmitter;
}): Promise<{ requestId: string; userMessage: ChatMessage }> {
  const { sessionId, userText, attachments, onEvent } = params;

  // 抢占同会话旧请求
  const existing = activeRequests.get(sessionId);
  if (existing) {
    log.info(`抢占旧请求: sessionId=${sessionId}, oldRequestId=${existing.requestId}`);
    existing.abort.abort();
    activeRequests.delete(sessionId);
  }

  // 加载会话 + 持久化 user 消息
  const session = await store.loadSession(sessionId);
  if (!session) throw new Error(`会话不存在: ${sessionId}`);

  const userMessage = buildUserMessage(userText, attachments);
  await store.appendMessages(sessionId, [userMessage]);

  const requestId = randomUUID();
  const abort = new AbortController();
  activeRequests.set(sessionId, { requestId, sessionId, abort });

  // 异步启动流式请求，不阻塞调用方
  void runStream({
    requestId,
    sessionId,
    history: [...session.messages, userMessage],
    systemPrompt: session.systemPrompt,
    abort,
    onEvent,
  });

  return { requestId, userMessage };
}

async function runStream(params: {
  requestId: string;
  sessionId: string;
  history: ChatMessage[];
  systemPrompt?: string;
  abort: AbortController;
  onEvent: ChatEventEmitter;
}): Promise<void> {
  const { requestId, sessionId, history, systemPrompt, abort, onEvent } = params;
  const runStartMs = Date.now();

  const router = await getSharedLLMRouter();
  const provider = router.getProvider();

  if (!provider) {
    onEvent({
      kind: 'error',
      requestId,
      message: '未配置 LLM Provider，请先在设置中填写 API Key 和模型。',
      recoverable: false,
    });
    activeRequests.delete(sessionId);
    return;
  }

  const llmMessages: LLMMessageParam[] = toLLMMessages(history);
  const sysParam = systemPrompt?.trim() ? systemPrompt : '';

  let firstTokenMs = 0;
  const cancelStallWarn = startStallWarning('LLM 流式', requestId);

  try {
    log.info(
      `streamMessage 开始: sessionId=${sessionId}, requestId=${requestId}, ` +
        `provider=${router.getProviderName()}, messages=${llmMessages.length}`
    );

    const response = await provider.streamMessage(
      sysParam,
      llmMessages,
      (delta) => {
        if (!firstTokenMs) {
          firstTokenMs = Date.now();
          log.info(
            `[ChatTiming] TTFT=${firstTokenMs - runStartMs}ms, requestId=${requestId}`
          );
        }
        // requestId 可能已被抢占；此时直接丢弃 chunk（调用 abort 后通常不会再到这里）
        if (abort.signal.aborted) return;
        onEvent({ kind: 'stream-chunk', requestId, text: delta });
      },
      abort.signal
    );

    cancelStallWarn();

    if (abort.signal.aborted) {
      onEvent({ kind: 'aborted', requestId });
      log.info(`请求被中止: requestId=${requestId}`);
      return;
    }

    // 汇总文本
    const finalText = response.content
      .filter((b): b is LLMTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: finalText,
      timestamp: Date.now(),
    };

    // 持久化
    await store.appendMessages(sessionId, [assistantMessage]);

    const usage = response.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        }
      : undefined;

    onEvent({
      kind: 'stream-end',
      requestId,
      text: finalText,
      assistantMessageId: assistantMessage.id,
      usage,
    });

    const duration = Date.now() - runStartMs;
    log.info(
      `streamMessage 完成: requestId=${requestId}, 耗时=${duration}ms, ` +
        `text=${finalText.length} chars, usage=${usage ? `in=${usage.input_tokens},out=${usage.output_tokens}` : 'N/A'}`
    );
  } catch (err) {
    cancelStallWarn();

    if (abort.signal.aborted) {
      onEvent({ kind: 'aborted', requestId });
      log.info(`请求被中止（catch）: requestId=${requestId}`);
      return;
    }

    const friendly = toFriendlyError(err as Error);
    log.warn(`streamMessage 失败: requestId=${requestId}, ${friendly.message}`);
    onEvent({
      kind: 'error',
      requestId,
      message: friendly.message,
      recoverable: friendly.recoverable,
    });
  } finally {
    // 只清理仍属于自己的活动记录
    const curr = activeRequests.get(sessionId);
    if (curr?.requestId === requestId) {
      activeRequests.delete(sessionId);
    }
  }
}
