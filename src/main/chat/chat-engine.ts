/**
 * ChatEngine — 纯对话引擎（V1，无工具）
 *
 * 职责：
 * 1. 接收用户消息 + 附件，调用 image-cache 压缩落盘为 imageRef，构造 ChatMessage
 * 2. 运行时把 ChatMessage[] 转换为 LLMMessageParam[]（K=3 历史淡出 + 还原 base64）
 * 3. 通过 Provider.streamMessage 流式调用 LLM，onEvent 推送事件给 IPC 层
 * 4. 持久化 user/assistant 消息
 * 5. 支持 abort 抢占：同 sessionId 新请求先 abort 旧请求
 * 6. 错误恢复：context_length 错误时从最后一条 user 消息中剥离图片引用
 *
 * K=3 历史淡出规则：
 * - 从消息数组尾部往前扫，最近 3 条"含图消息"的 image_ref 还原为 LLMImageBlock
 * - 更早的 image_ref 降级为文本占位：`[图片: <fileName>（已超出本轮上下文）]`
 * - 一条消息里的多张图作为一个整体（要么全还原、要么全降级）
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
  PersistedContentBlock,
} from './types';
import * as store from './session-store';
import {
  storeImage,
  loadImageBase64,
  type LLMImageRefBlock,
} from './image-cache';
import { createLogger } from '../logger';

const log = createLogger('ChatEngine');

/** 周期性 stall 日志：长时间无响应时提示 */
const STALL_WARN_INTERVAL_MS = 15_000;
/** 最近 K 条含图消息保留 base64，更早降级为占位文本 */
const IMAGE_HISTORY_K = 3;

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

// ─── 类型辅助 ──────────────────────────────────────────────

function isImageRef(b: unknown): b is LLMImageRefBlock {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type: string }).type === 'image_ref'
  );
}

function isTextBlock(b: unknown): b is LLMTextBlock {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type: string }).type === 'text'
  );
}

// ─── 构造 user 消息：图片压缩落盘 → imageRef ─────────────

async function buildUserMessage(
  userText: string,
  attachments?: ChatAttachmentInput[]
): Promise<ChatMessage> {
  const hasAttachments = attachments && attachments.length > 0;
  let content: string | PersistedContentBlock[];

  if (!hasAttachments) {
    content = userText;
  } else {
    const blocks: PersistedContentBlock[] = [];
    if (userText.trim()) {
      blocks.push({ type: 'text', text: userText } satisfies LLMTextBlock);
    }
    for (const att of attachments!) {
      const ref = await storeImage({
        fileName: att.name,
        mediaType: att.mediaType,
        base64: att.base64,
      });
      blocks.push(ref);
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

// ─── 运行时：持久化消息 → LLM 消息（K=3 淡出 + base64 还原） ──

/**
 * 把 ChatMessage[] 转换为 LLMMessageParam[]：
 *  - text / image 块原样保留
 *  - image_ref 块：最近 K 条含图消息还原 base64；更早的替换为占位文本
 *  - 纯字符串 content 原样返回
 *
 * 返回值可直接送入 Provider.streamMessage。
 */
async function prepareLLMMessages(
  history: ChatMessage[]
): Promise<LLMMessageParam[]> {
  // 第一轮：定位"最近 K 条含图消息"的索引集合
  const imageMsgIndices: number[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (typeof m.content === 'string') continue;
    if (m.content.some(isImageRef)) {
      imageMsgIndices.push(i);
      if (imageMsgIndices.length >= IMAGE_HISTORY_K) break;
    }
  }
  const keepSet = new Set(imageMsgIndices);

  // 第二轮：转换
  const result: LLMMessageParam[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
      continue;
    }

    const outBlocks: LLMContentBlock[] = [];
    const keepImages = keepSet.has(i);

    for (const b of m.content) {
      if (isImageRef(b)) {
        if (keepImages) {
          const base64 = await loadImageBase64(b);
          if (base64) {
            outBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: b.mediaType,
                data: base64,
              },
            } satisfies LLMImageBlock);
          } else {
            // 文件丢失 → 降级
            outBlocks.push({
              type: 'text',
              text: `[图片: ${b.fileName}（文件已丢失）]`,
            });
          }
        } else {
          outBlocks.push({
            type: 'text',
            text: `[图片: ${b.fileName}（已超出本轮上下文）]`,
          });
        }
      } else if (b.type === 'image') {
        // 运行时可能遗留（理论上 storeImage 后都是 image_ref，但防御性保留）
        outBlocks.push(b);
      } else {
        // text / tool_use / tool_result（V1 不会出现 tool 块）
        outBlocks.push(b as LLMContentBlock);
      }
    }

    result.push({ role: m.role, content: outBlocks });
  }

  return result;
}

// ─── 错误映射 ──────────────────────────────────────────────

function toFriendlyError(err: Error): {
  message: string;
  recoverable: boolean;
  /** 若为 true，chat-engine 会剥离最后一条 user 消息的 image_ref 重试提示 */
  stripImages: boolean;
} {
  const msg = err.message || '';
  if (msg.includes('401') || /authentication|unauthori[sz]ed/i.test(msg)) {
    return {
      message: 'API Key 无效或已过期，请在设置中重新填写。',
      recoverable: false,
      stripImages: false,
    };
  }
  if (/timeout|ECONNREFUSED|ENOTFOUND|ENETUNREACH/i.test(msg)) {
    return { message: '网络连接失败，请稍后重试。', recoverable: true, stripImages: false };
  }
  if (msg.includes('429') || /rate[_-]?limit/i.test(msg)) {
    return { message: '请求过于频繁，请稍后再试。', recoverable: true, stripImages: false };
  }
  if (/overloaded|529|500|502|503|504/i.test(msg)) {
    return { message: '服务端暂时繁忙，请稍后再试。', recoverable: true, stripImages: false };
  }
  if (/context.*length|too.*long|413|payload.*large/i.test(msg)) {
    return {
      message:
        '对话过长或图片过大，已自动清除最近消息中的图片引用。若问题仍在，请清空上下文或新建会话。',
      recoverable: false,
      stripImages: true,
    };
  }
  if (/abort/i.test(msg)) {
    return { message: '请求已中止。', recoverable: true, stripImages: false };
  }
  return { message: `对话失败：${msg || '未知错误'}`, recoverable: true, stripImages: false };
}

/**
 * 错误恢复：移除指定会话"最后一条 user 消息"中的 image_ref 块。
 * 调用时机：当 LLM 因 context_length / payload 大小报错时，避免坏图反复触发同一错误。
 */
async function stripLastUserImages(sessionId: string): Promise<boolean> {
  const session = await store.loadSession(sessionId);
  if (!session) return false;

  // 从后向前找最后一条 user 消息
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return false;

    const hadImages = m.content.some(isImageRef);
    if (!hadImages) return false;

    // 把 image_ref 转为占位文本，保留 text 块原样
    const newBlocks: PersistedContentBlock[] = m.content.map((b) => {
      if (isImageRef(b)) {
        return {
          type: 'text',
          text: `[图片: ${b.fileName}（因上下文超限已移除）]`,
        } satisfies LLMTextBlock;
      }
      return b;
    });

    // 合并连续 text 块，content 简化
    m.content = newBlocks;
    m.attachments = undefined;
    await store.saveSession(session);
    log.info(
      `stripLastUserImages 已剥离 sessionId=${sessionId}, messageId=${m.id}`
    );
    return true;
  }
  return false;
}

// ─── 核心：运行一次对话 ────────────────────────────────────

/**
 * 发送用户消息并启动流式回复。
 *
 * 立即：
 *  - 压缩附件 + 落盘 + 持久化 user 消息
 *  - 返回 { requestId, userMessage }
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

  const userMessage = await buildUserMessage(userText, attachments);
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

  let llmMessages: LLMMessageParam[];
  try {
    llmMessages = await prepareLLMMessages(history);
  } catch (err) {
    onEvent({
      kind: 'error',
      requestId,
      message: `准备消息失败：${(err as Error).message}`,
      recoverable: true,
    });
    activeRequests.delete(sessionId);
    return;
  }
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
      .filter(isTextBlock)
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

    // context_length 错误 → 剥离最后一条 user 消息的 image_ref，方便用户直接重发文本
    if (friendly.stripImages) {
      try {
        await stripLastUserImages(sessionId);
      } catch (e) {
        log.warn(`stripLastUserImages 失败: ${(e as Error).message}`);
      }
    }

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
