/**
 * ChatEngine — 对话引擎（V2，支持工具调用）
 *
 * 职责：
 * 1. 接收用户消息 + 附件，调用 image-cache 压缩落盘为 imageRef，构造 ChatMessage
 * 2. 运行时把 ChatMessage[] 转换为 LLMMessageParam[]（K=1 历史淡出 + 还原 base64）
 * 3. 通过 Provider.streamMessage 流式调用 LLM（支持 tools），Agent 循环处理 tool_use
 * 4. 持久化 user/assistant/tool 消息
 * 5. 支持 abort 抢占：同 sessionId 新请求先 abort 旧请求
 * 6. 错误恢复：context_length 错误时从最后一条 user 消息中剥离图片引用
 *
 * Agent 循环（最多 MAX_TOOL_ITERATIONS 轮）：
 * - LLM 返回 stop_reason='tool_use' → 执行工具 → 把 tool_result 回注 → 继续
 * - LLM 返回 stop_reason='end_turn' → 输出最终文本 → 结束
 * - 最后一轮不传 tools，强制 LLM 给出文本回复
 */
import { randomUUID } from 'crypto';
import type {
  LLMMessageParam,
  LLMContentBlock,
  LLMTextBlock,
  LLMImageBlock,
  LLMToolUseBlock,
  LLMToolResultBlock,
  LLMToolDef,
  LLMSystemBlock,
  LLMSystemParam,
} from '../llm/types';
import { getSharedLLMRouter } from '../llm/llm-ipc';
import type {
  ChatAttachmentInput,
  ChatEvent,
  ChatMessage,
  ChatMode,
  PersistedContentBlock,
  PersistedToolResultBlock,
} from './types';
import * as store from './session-store';
import {
  storeImage,
  loadImageBase64,
  type LLMImageRefBlock,
} from './image-cache';
import type { SkillRegistry } from '../skill/skill-registry';
import { addTrustedTool as addTrustedToolConfig } from '../skill/skill-config';
import { createLogger } from '../logger';

const log = createLogger('ChatEngine');

/** 周期性 stall 日志：长时间无响应时提示 */
const STALL_WARN_INTERVAL_MS = 15_000;
/**
 * Agent 循环最大工具迭代次数。
 *
 * 之所以是 8 而不是 5：
 * - "总结网页"这类典型场景在 web_search → web_fetch 之后通常 2-3 轮就能完成
 * - 复杂任务（搜索 → 抓取多源 → 计算 → 汇总）大概 4-6 轮
 * - 留 2 轮余量给模型自我纠错（如某次抓取失败重试）
 *
 * 之所以不是 10：
 * - 过大的上限会鼓励模型走"先搜几次再抓再读再总结"的废 token 链路
 * - 实测 v2 dump 用了 8 轮恰好完成总结，再放宽收益不明显
 *
 * 最后一轮不再禁用 tools，而是注入一段"工具次数已用尽"的提示，
 * 让模型基于已有信息直接给出最终回复。强制 disable tools 在某些情况下
 * 会让模型"想再调一次但被截断"，输出空 content（旧 bug 即由此触发）。
 */
const MAX_TOOL_ITERATIONS = 8;

/**
 * 最后一轮注入的 system 提示前缀。
 *
 * 与 stableParts 拼接为一个 system 块，告知模型已无更多工具调用机会，
 * 必须基于现有 user/assistant/tool_result 上下文直接给出最终文本回复。
 *
 * 为什么不放到独立 system 块：
 *  - Claude 单 system 数组中的多块各自计费/缓存，独立块会破坏前缀缓存
 *  - 直接拼到 stable 块尾部更简单，且最后一轮 cache miss 是可以接受的
 */
const LAST_ITERATION_SYSTEM_HINT =
  '\n\n[系统提示] 你已用完工具调用次数，本轮起不能再调用任何工具。请基于上方已有的 user 消息、tool_result 和你的中间分析，**直接用文字给出最终回复**。如果信息不足以完成原始问题，也请明确告诉用户当前能给出的部分结论或为什么无法完成。';
/**
 * 最近 K 条含图消息保留 base64，更早降级为占位文本。
 *
 * 设定为 1 的理由：
 * - 多张图同时送给 LLM 会导致视觉注意力串扰（cross-image attention leakage），
 *   模型容易把最新问题回答成历史图片的内容
 * - 工具箱 AI 助手以"逐图问答"为主，"多图对比"场景占比低
 * - 保持 K=1 让最后一条 user 消息只含本次上传的图，LLM 定位明确
 *
 * 若日后需要支持多图对比，建议引入"钉住参考图"机制（给 imageRef 加 pinned 标记），
 * 而不是盲目放大 K。
 */
const IMAGE_HISTORY_K = 1;

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

// ─── SkillRegistry 共享引用 ────────────────────────────────

let sharedSkillRegistry: SkillRegistry | null = null;

/** 由 main.ts 初始化时注入 */
export function setSharedSkillRegistry(registry: SkillRegistry): void {
  sharedSkillRegistry = registry;
}

/** 获取共享 SkillRegistry */
export function getSharedSkillRegistry(): SkillRegistry | null {
  return sharedSkillRegistry;
}

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

// ─── 工具确认请求管理 ────────────────────────────────────

/** 用户对单次确认的响应类型 */
export type ConfirmDecision = 'approved' | 'approved-all' | 'trusted' | 'rejected';

interface PendingConfirmation {
  resolve: (decision: ConfirmDecision) => void;
  /** 用于在 abort / 窗口关闭时统一取消 */
  signal: AbortSignal;
  onAbort: () => void;
}

/** confirmId → PendingConfirmation */
const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * 由 chat-ipc 在收到 chat:confirm-response 时调用，
 * 唤醒被阻塞的 agent 循环。
 */
export function resolveConfirmation(
  confirmId: string,
  decision: ConfirmDecision
): void {
  const pending = pendingConfirmations.get(confirmId);
  if (!pending) {
    log.warn(`resolveConfirmation: confirmId=${confirmId} 不存在（可能已超时/被 abort）`);
    return;
  }
  pendingConfirmations.delete(confirmId);
  pending.signal.removeEventListener('abort', pending.onAbort);
  pending.resolve(decision);
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

/**
 * 在 system 参数末尾追加一段提示文本，返回新对象（不修改原 systemParam）。
 *
 * 兼容两种形态：
 *  - 字符串 system：直接拼接
 *  - 块数组 system：追加一个不带 cache_control 的新文本块（避免破坏前面块的缓存）
 */
function appendSystemHint(
  systemParam: LLMSystemParam,
  hint: string
): LLMSystemParam {
  if (!hint) return systemParam;
  if (typeof systemParam === 'string') {
    return systemParam ? systemParam + hint : hint.trimStart();
  }
  return [
    ...systemParam,
    { type: 'text', text: hint.trimStart() },
  ];
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
 *  - toolRoundtrip 消息：deep 模式保留；chat / agent 模式全部跳过
 *
 * 返回值可直接送入 Provider.streamMessage。
 */
async function prepareLLMMessages(
  history: ChatMessage[],
  mode: ChatMode
): Promise<LLMMessageParam[]> {
  // 第一轮：定位"最近 K 条含图消息"的索引集合
  const imageMsgIndices: number[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.toolRoundtrip && mode !== 'deep') continue; // 跳过后不计入图片索引
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

    // chat / agent 模式：跳过所有 toolRoundtrip 中间消息
    // deep 模式：保留全部（原始 tool_use / tool_result 块一并送入 LLM）
    if (m.toolRoundtrip && mode !== 'deep') continue;
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
              text: `[历史图片: ${b.fileName}（缓存已丢失）]`,
            });
          }
        } else {
          outBlocks.push({
            type: 'text',
            text: `[历史图片: ${b.fileName}]`,
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
          text: `[历史图片: ${b.fileName}（因上下文超限已移除）]`,
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
  /** 对话模式，决定 tools 是否启用及 toolRoundtrip 历史的处理方式 */
  mode?: ChatMode;
}): Promise<{ requestId: string; userMessage: ChatMessage }> {
  const { sessionId, userText, attachments, onEvent, mode } = params;

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
    mode: mode ?? 'agent',
  });

  return { requestId, userMessage };
}

// ─── 重新生成 ──────────────────────────────────────────────

/**
 * 重新生成某条 assistant 消息：
 * 1. 从目标消息往前回溯，跳过所有 toolRoundtrip=true 的中间步骤
 * 2. 截断到回溯起点
 * 3. 基于截断后的上下文重新调用 LLM 流式生成
 */
export async function regenerateMessage(params: {
  sessionId: string;
  assistantMessageId: string;
  onEvent: ChatEventEmitter;
  mode?: ChatMode;
}): Promise<{ requestId: string; discardedCount: number }> {
  const { sessionId, assistantMessageId, onEvent, mode } = params;

  // 抢占同会话旧请求
  const existing = activeRequests.get(sessionId);
  if (existing) {
    log.info(`regenerate 抢占旧请求: sessionId=${sessionId}, oldRequestId=${existing.requestId}`);
    existing.abort.abort();
    activeRequests.delete(sessionId);
  }

  const session = await store.loadSession(sessionId);
  if (!session) throw new Error(`会话不存在: ${sessionId}`);

  const idx = session.messages.findIndex((m) => m.id === assistantMessageId);
  if (idx < 0) throw new Error(`消息不存在: ${assistantMessageId}`);
  if (idx === 0) throw new Error('不能重新生成会话的第一条消息');

  // 回溯：从 idx 往前跳过所有 toolRoundtrip 中间步骤，找到完整对话轮次的起点
  let truncateIdx = idx;
  while (truncateIdx > 0 && session.messages[truncateIdx - 1]?.toolRoundtrip) {
    truncateIdx--;
  }

  const discardedCount = session.messages.length - truncateIdx;
  session.messages = session.messages.slice(0, truncateIdx);
  await store.saveSession(session);

  log.info(
    `regenerate 截断: sessionId=${sessionId}, targetId=${assistantMessageId}, ` +
      `truncateIdx=${truncateIdx}, discarded=${discardedCount}, remaining=${session.messages.length}`
  );

  const requestId = randomUUID();
  const abort = new AbortController();
  activeRequests.set(sessionId, { requestId, sessionId, abort });

  void runStream({
    requestId,
    sessionId,
    history: session.messages,
    systemPrompt: session.systemPrompt,
    abort,
    onEvent,
    mode: mode ?? 'agent',
  });

  return { requestId, discardedCount };
}

// ─── 编辑并重发 ────────────────────────────────────────────

/**
 * 编辑某条 user 消息并重发：
 * 1. 截断从 M（含）到会话末尾的所有消息
 * 2. 用修改后的文本 + 原 imageRef 构造新 user 消息并持久化
 * 3. 基于截断后上下文 + 新 user 消息启动流式生成
 *
 * imageRef 块直接复用已有缓存，不走压缩管线。
 */
export async function editAndResend(params: {
  sessionId: string;
  targetMessageId: string;
  newText: string;
  imageRefs?: LLMImageRefBlock[];
  onEvent: ChatEventEmitter;
  mode?: ChatMode;
}): Promise<{ requestId: string; userMessageId: string; discardedCount: number }> {
  const { sessionId, targetMessageId, newText, imageRefs, onEvent, mode } = params;

  // 抢占同会话旧请求
  const existing = activeRequests.get(sessionId);
  if (existing) {
    log.info(`editAndResend 抢占旧请求: sessionId=${sessionId}, oldRequestId=${existing.requestId}`);
    existing.abort.abort();
    activeRequests.delete(sessionId);
  }

  const session = await store.loadSession(sessionId);
  if (!session) throw new Error(`会话不存在: ${sessionId}`);

  const idx = session.messages.findIndex((m) => m.id === targetMessageId);
  if (idx < 0) throw new Error(`消息不存在: ${targetMessageId}`);

  const discardedCount = session.messages.length - idx;
  // 截断：只保留 idx 之前的消息
  session.messages = session.messages.slice(0, idx);
  await store.saveSession(session);

  // 构造新 user 消息（直接拼 text + imageRef，不走 storeImage 压缩）
  const hasImages = imageRefs && imageRefs.length > 0;
  let content: string | PersistedContentBlock[];
  if (!hasImages) {
    content = newText;
  } else {
    const blocks: PersistedContentBlock[] = [];
    if (newText.trim()) {
      blocks.push({ type: 'text', text: newText } as LLMTextBlock);
    }
    for (const ref of imageRefs!) {
      blocks.push(ref);
    }
    content = blocks;
  }

  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content,
    timestamp: Date.now(),
    attachments: hasImages
      ? imageRefs!.map((r) => ({ name: r.fileName, mediaType: r.mediaType }))
      : undefined,
  };

  await store.appendMessages(sessionId, [userMessage]);

  log.info(
    `editAndResend: sessionId=${sessionId}, targetId=${targetMessageId}, ` +
      `discarded=${discardedCount}, newText=${newText.length} chars, images=${imageRefs?.length ?? 0}`
  );

  const requestId = randomUUID();
  const abort = new AbortController();
  activeRequests.set(sessionId, { requestId, sessionId, abort });

  void runStream({
    requestId,
    sessionId,
    history: [...session.messages, userMessage],
    systemPrompt: session.systemPrompt,
    abort,
    onEvent,
    mode: mode ?? 'agent',
  });

  return { requestId, userMessageId: userMessage.id, discardedCount };
}

async function runStream(params: {
  requestId: string;
  sessionId: string;
  history: ChatMessage[];
  systemPrompt?: string;
  abort: AbortController;
  onEvent: ChatEventEmitter;
  mode: ChatMode;
}): Promise<void> {
  const { requestId, sessionId, history, systemPrompt, abort, onEvent, mode } = params;
  // chat 模式不启用工具；agent / deep 均启用
  const enableTools = mode !== 'chat';
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
    llmMessages = await prepareLLMMessages(history, mode);
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

  // 构建 system prompt：分块 + 对 stable 部分标记 cache_control
  //
  // 缓存策略（仅 Claude 生效，其他 Provider 的 cache_control 会被忽略并 flatten 为纯字符串）：
  // - session.systemPrompt（用户/会话级设定，通常不变）
  // - Skill instructions（启用的 Skill 列表稳定时也不变）
  // 合并为一个 stable 块，标记 ephemeral（5 分钟 TTL）。
  // 对话轮次多时，这部分 token 从 $3/M 降为 $0.30/M（约 1/10 价格）。
  //
  // cache miss 的场景：
  // - 用户启用/禁用 Skill（低频）
  // - 永久信任列表变化（低频）
  // - 跨应用会话首次请求（无 cache 可用）
  const registry = sharedSkillRegistry;
  const tools: LLMToolDef[] | undefined =
    enableTools && registry ? registry.getLLMTools() : undefined;
  const hasTools = tools && tools.length > 0;

  const stableParts: string[] = [];
  const sessionSys = systemPrompt?.trim();
  if (sessionSys) stableParts.push(sessionSys);

  if (hasTools && registry) {
    const skillInstructions = registry.buildSystemInstructions();
    if (skillInstructions) stableParts.push(skillInstructions);
  }

  const systemBlocks: LLMSystemBlock[] = [];
  if (stableParts.length > 0) {
    systemBlocks.push({
      type: 'text',
      text: stableParts.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    });
  }
  // LLMSystemParam：空数组也是合法的（Claude 会正常处理，其他 Provider 会 flatten 为 ''）
  const systemParam: LLMSystemParam = systemBlocks;

  // 中间步骤消息，最终一次性持久化
  const pendingMessages: ChatMessage[] = [];
  // 本次请求中用户已"全部批准"的工具集合（限本次请求周期）
  const approvedAllTools = new Set<string>();
  let iter = 0;

  const cancelStallWarn = startStallWarning('LLM 流式', requestId);

  try {
    while (iter < MAX_TOOL_ITERATIONS && !abort.signal.aborted) {
      iter++;
      const isLastIter = iter === MAX_TOOL_ITERATIONS;

      // 最后一轮：保留 tools 让模型理解能力边界，但在 system 中追加"次数用尽"
      // 提示，引导其直接用文字回复。这样比强制 disable tools 更稳定，
      // 避免模型"想再调一次但被截断"返回空 content（参见 LAST_ITERATION_SYSTEM_HINT 注释）。
      const currentSystemParam: LLMSystemParam = isLastIter
        ? appendSystemHint(systemParam, LAST_ITERATION_SYSTEM_HINT)
        : systemParam;
      const currentTools = tools;

      let firstTokenMs = 0;

      log.info(
        `streamMessage 开始: sessionId=${sessionId}, requestId=${requestId}, ` +
          `iter=${iter}/${MAX_TOOL_ITERATIONS}, provider=${router.getProviderName()}, ` +
          `messages=${llmMessages.length}, tools=${currentTools?.length ?? 0}` +
          (isLastIter ? ' [last-iter:hint-injected]' : '')
      );

      // 为本次调用设置 scene 上下文（Router 代理会自动 dump 请求/响应到磁盘）
      router.withScene('main-chat', { requestId, sessionId, iteration: iter });

      const response = await provider.streamMessage(
        currentSystemParam,
        llmMessages,
        (delta) => {
          if (!firstTokenMs) {
            firstTokenMs = Date.now();
            log.info(
              `[ChatTiming] TTFT=${firstTokenMs - runStartMs}ms, iter=${iter}, requestId=${requestId}`
            );
          }
          if (abort.signal.aborted) return;
          onEvent({ kind: 'stream-chunk', requestId, text: delta });
        },
        abort.signal,
        currentTools,
        currentTools ? { type: 'auto' } : undefined,
      );

      if (abort.signal.aborted) {
        onEvent({ kind: 'aborted', requestId });
        log.info(`请求被中止: requestId=${requestId}, iter=${iter}`);
        return;
      }

      // ── stop_reason: end_turn / max_tokens ──
      if (
        response.stop_reason === 'end_turn' ||
        response.stop_reason === 'max_tokens'
      ) {
        const rawText = response.content
          .filter(isTextBlock)
          .map((b) => b.text)
          .join('');

        // 空内容兜底：模型偶尔会在 end_turn 时返回 content=[]（典型场景：
        // 多轮工具调用后被强制收尾、或工具结果信息冗余导致模型迷失）。
        // 此时如果直接持久化空字符串，UI 会出现"空气泡"，且关闭重开后
        // user 消息成为孤儿，无法解释发生了什么。
        // 因此用兜底文案占位，并打 fallback 标记供 UI 区分渲染。
        const isEmpty = rawText.trim().length === 0;
        const finalText = isEmpty
          ? '本次未能生成最终回复。可能模型已用完工具调用次数或被现有信息困住，请点击重新生成或换一种方式提问。'
          : rawText;

        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: finalText,
          timestamp: Date.now(),
          ...(isEmpty ? { fallback: true } : {}),
        };

        // 一次性持久化所有中间消息 + 最终消息
        await store.appendMessages(sessionId, [
          ...pendingMessages,
          assistantMessage,
        ]);

        const usage = response.usage
          ? {
              input_tokens: response.usage.input_tokens,
              output_tokens: response.usage.output_tokens,
            }
          : undefined;

        cancelStallWarn();

        onEvent({
          kind: 'stream-end',
          requestId,
          text: finalText,
          assistantMessageId: assistantMessage.id,
          usage,
        });

        const duration = Date.now() - runStartMs;
        const cacheInfo = response.usage
          ? ` cache_read=${response.usage.cache_read_input_tokens ?? 0}, cache_create=${response.usage.cache_creation_input_tokens ?? 0}`
          : '';
        log.info(
          `streamMessage 完成: requestId=${requestId}, 耗时=${duration}ms, iters=${iter}, ` +
            `text=${finalText.length} chars${isEmpty ? ' [fallback]' : ''}, usage=${usage ? `in=${usage.input_tokens},out=${usage.output_tokens}` : 'N/A'}${cacheInfo}`
        );
        return;
      }

      // ── stop_reason: tool_use ──
      if (response.stop_reason === 'tool_use' && registry) {
        const toolUseBlocks = response.content.filter(
          (b): b is LLMToolUseBlock => b.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) break;

        // 清前端正在显示的中间文本
        onEvent({ kind: 'stream-reset', requestId });

        // 持久化 assistant 中间消息（保留完整 content blocks）
        const assistantMid: ChatMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: response.content as PersistedContentBlock[],
          timestamp: Date.now(),
          toolRoundtrip: true,
        };
        pendingMessages.push(assistantMid);

        // 追加到 LLM messages
        llmMessages.push({ role: 'assistant', content: response.content });

        // 逐个执行工具
        const toolResults: LLMToolResultBlock[] = [];

        for (const toolCall of toolUseBlocks) {
          const displayName = registry.getToolDisplayName(toolCall.name);

          // ── 确认拦截：MODERATE 工具且未被信任、未被本轮"全部批准"覆盖 ──
          if (
            registry.requiresConfirmation(toolCall.name) &&
            !approvedAllTools.has(toolCall.name)
          ) {
            const confirmId = randomUUID();
            const confirmHint = registry.getToolConfirmHint(
              toolCall.name,
              toolCall.input as Record<string, unknown>
            );

            onEvent({
              kind: 'tool-confirm-request',
              requestId,
              confirmId,
              toolName: toolCall.name,
              toolDisplayName: displayName,
              toolInput: toolCall.input,
              confirmHint,
            });

            // 等待用户响应（可被 abort 打断）
            const decision = await new Promise<ConfirmDecision>((resolve) => {
              const onAbort = () => {
                pendingConfirmations.delete(confirmId);
                resolve('rejected');
              };
              pendingConfirmations.set(confirmId, {
                resolve,
                signal: abort.signal,
                onAbort,
              });
              if (abort.signal.aborted) {
                onAbort();
              } else {
                abort.signal.addEventListener('abort', onAbort, { once: true });
              }
            });

            if (abort.signal.aborted) {
              // abort 后不再继续，外层循环会检测
              return;
            }

            if (decision === 'rejected') {
              // 回注拒绝结果，让 LLM 知道用户没同意
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: '用户拒绝了此操作',
                is_error: true,
              });
              onEvent({
                kind: 'tool-done',
                requestId,
                toolName: toolCall.name,
                toolDisplayName: displayName,
                success: false,
                summary: '用户拒绝了此操作',
              });
              continue;
            }

            if (decision === 'approved-all') {
              // 本次请求内同名工具免确认
              approvedAllTools.add(toolCall.name);
              // 同时把当前已注册的其他 MODERATE 工具也加入（像外部项目那样）
              for (const tn of registry.getToolNames()) {
                if (registry.requiresConfirmation(tn)) {
                  approvedAllTools.add(tn);
                }
              }
            } else if (decision === 'trusted') {
              // 永久信任：写入 Registry + 持久化
              registry.addTrustedTool(toolCall.name);
              void addTrustedToolConfig(toolCall.name);
            }
            // 'approved' 继续执行，本次放行
          }

          onEvent({
            kind: 'tool-executing',
            requestId,
            toolName: toolCall.name,
            toolDisplayName: displayName,
            toolInput: toolCall.input,
          });

          try {
            const result = await registry.execute(
              toolCall.name,
              toolCall.input as Record<string, unknown>
            );
            const resultStr =
              typeof result === 'string' ? result : JSON.stringify(result);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: resultStr,
            });
            onEvent({
              kind: 'tool-done',
              requestId,
              toolName: toolCall.name,
              toolDisplayName: displayName,
              success: true,
              summary:
                resultStr.length > 200
                  ? resultStr.slice(0, 200) + '...'
                  : resultStr,
            });
          } catch (err) {
            const errMsg = (err as Error).message;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `工具执行失败: ${errMsg}`,
              is_error: true,
            });
            onEvent({
              kind: 'tool-done',
              requestId,
              toolName: toolCall.name,
              toolDisplayName: displayName,
              success: false,
              summary: errMsg,
            });
          }
        }

        // 持久化 user(tool_result) 中间消息
        const userToolMsg: ChatMessage = {
          id: randomUUID(),
          role: 'user',
          content: toolResults.map(
            (tr): PersistedToolResultBlock => ({
              type: 'tool_result',
              tool_use_id: tr.tool_use_id,
              content:
                typeof tr.content === 'string'
                  ? tr.content
                  : JSON.stringify(tr.content),
              is_error: tr.is_error,
            })
          ),
          timestamp: Date.now(),
          toolRoundtrip: true,
        };
        pendingMessages.push(userToolMsg);

        // 追加到 LLM messages
        llmMessages.push({ role: 'user', content: toolResults });

        continue;
      }

      // 其他 stop_reason → 退出循环
      break;
    }

    cancelStallWarn();

    // 超出 MAX_TOOL_ITERATIONS fallback
    const fallbackText = '多次尝试后仍无结果，请换种方式提问。';
    const fallbackMsg: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: fallbackText,
      timestamp: Date.now(),
      fallback: true,
    };
    await store.appendMessages(sessionId, [...pendingMessages, fallbackMsg]);
    onEvent({
      kind: 'stream-end',
      requestId,
      text: fallbackText,
      assistantMessageId: fallbackMsg.id,
    });
  } catch (err) {
    cancelStallWarn();

    if (abort.signal.aborted) {
      onEvent({ kind: 'aborted', requestId });
      log.info(`请求被中止（catch）: requestId=${requestId}`);
      return;
    }

    const friendly = toFriendlyError(err as Error);
    log.warn(`streamMessage 失败: requestId=${requestId}, ${friendly.message}`);

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
    const curr = activeRequests.get(sessionId);
    if (curr?.requestId === requestId) {
      activeRequests.delete(sessionId);
    }
  }
}
