/**
 * useChat — Chat 状态与 IPC 封装
 *
 * 提供给 ChatView 使用的响应式状态：
 * - sessions: 会话列表（轻量索引）
 * - activeSessionId / activeSession / messages
 * - streamingText / isStreaming / currentRequestId
 *
 * 订阅主进程 chat:event 事件流，在 stream-chunk 时累积 streamingText，
 * 在 stream-end 时把 assistant 消息 push 进 messages 并清空 buffer。
 *
 * 另包含 V1.2 新增的"多选导出"状态：
 * - selectionMode / selectedIds / selectedCount
 * - enterSelection(preselectId?) / exitSelection / toggleSelect / selectAll / isSelected
 *
 * 单例模式（整个 Shell 共享一份状态），避免多个 ChatView 实例造成冲突。
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import type {
  ChatEvent,
  ChatMessage,
  ChatSession,
  SessionIndexEntry,
  ChatAttachmentInput,
} from '@toolbox/bridge';

// ─── 全局单例状态（整个 Shell 生命周期只存一份） ──────────

const sessions = ref<SessionIndexEntry[]>([]);
const activeSession = ref<ChatSession | null>(null);
const streamingText = ref<string>('');
const currentRequestId = ref<string | null>(null);
const lastError = ref<string | null>(null);

/** 当前正在执行的工具信息（用于 UI 展示工具调用气泡） */
const toolExecuting = ref<{
  toolName: string;
  toolDisplayName: string;
  toolInput: unknown;
} | null>(null);

/** 工具执行完成的结果列表（当前请求周期内累积） */
const toolResults = ref<Array<{
  toolName: string;
  toolDisplayName: string;
  success: boolean;
  summary: string;
}>>([]);

/** 等待用户响应的工具确认请求（同一时间最多一个） */
const pendingConfirm = ref<{
  confirmId: string;
  toolName: string;
  toolDisplayName: string;
  toolInput: unknown;
  confirmHint?: string;
} | null>(null);

// 选择态
const selectionMode = ref<boolean>(false);
const selectedIds = ref<Set<string>>(new Set());

// 编辑态
const editingMessageId = ref<string | null>(null);

let eventDisposer: (() => void) | null = null;
let initialized = false;

// ─── 事件处理 ──────────────────────────────────────────────

function handleChatEvent(event: ChatEvent): void {
  // 只处理当前活动 requestId 的事件
  if (event.requestId !== currentRequestId.value) return;

  switch (event.kind) {
    case 'stream-chunk':
      streamingText.value += event.text;
      break;

    case 'stream-reset':
      // 工具调用开始前清空正在显示的中间文本
      streamingText.value = '';
      break;

    case 'tool-executing':
      toolExecuting.value = {
        toolName: event.toolName,
        toolDisplayName: event.toolDisplayName,
        toolInput: event.toolInput,
      };
      break;

    case 'tool-done':
      toolExecuting.value = null;
      toolResults.value = [
        ...toolResults.value,
        {
          toolName: event.toolName,
          toolDisplayName: event.toolDisplayName,
          success: event.success,
          summary: event.summary,
        },
      ];
      break;

    case 'tool-confirm-request':
      pendingConfirm.value = {
        confirmId: event.confirmId,
        toolName: event.toolName,
        toolDisplayName: event.toolDisplayName,
        toolInput: event.toolInput,
        confirmHint: event.confirmHint,
      };
      break;

    case 'stream-end': {
      streamingText.value = '';
      currentRequestId.value = null;
      lastError.value = null;
      toolExecuting.value = null;
      toolResults.value = [];
      pendingConfirm.value = null;
      // 从主进程重新加载会话：把乐观版本的 image 块替换为已落盘的 image_ref
      // 同时追加刚生成的 assistant 消息（主进程已持久化）
      if (activeSession.value) {
        const id = activeSession.value.id;
        void window.electronAPI.chatLoadSession(id).then((fresh) => {
          if (fresh && activeSession.value?.id === id) {
            activeSession.value = fresh;
          }
        });
      }
      // 刷新会话列表（更新时间 / 标题自动命名）
      void refreshSessions();
      break;
    }

    case 'error':
      lastError.value = event.message;
      streamingText.value = '';
      currentRequestId.value = null;
      toolExecuting.value = null;
      toolResults.value = [];
      pendingConfirm.value = null;
      // 错误后也重新加载一次：主进程可能已剥离图片引用
      if (activeSession.value) {
        const id = activeSession.value.id;
        void window.electronAPI.chatLoadSession(id).then((fresh) => {
          if (fresh && activeSession.value?.id === id) {
            activeSession.value = fresh;
          }
        });
      }
      break;

    case 'aborted':
      streamingText.value = '';
      currentRequestId.value = null;
      toolExecuting.value = null;
      toolResults.value = [];
      pendingConfirm.value = null;
      break;
  }
}

// ─── 初始化（只执行一次） ──────────────────────────────────

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  eventDisposer = window.electronAPI.onChatEvent(handleChatEvent);

  // 会话切换 / 开始流式生成 时自动退出选择态 / 编辑态
  watch(
    () => activeSession.value?.id ?? null,
    (_next, prev) => {
      if (prev !== undefined) {
        exitSelection();
        exitEditing();
      }
    }
  );
  watch(
    () => currentRequestId.value,
    (reqId) => {
      if (reqId) {
        if (selectionMode.value) exitSelection();
        if (editingMessageId.value) exitEditing();
      }
    }
  );
}

// ─── API 方法 ─────────────────────────────────────────────

async function refreshSessions(): Promise<void> {
  sessions.value = await window.electronAPI.chatListSessions();
}

async function selectSession(id: string): Promise<void> {
  const session = await window.electronAPI.chatLoadSession(id);
  if (!session) {
    lastError.value = '会话不存在或已被删除';
    return;
  }
  activeSession.value = session;
  streamingText.value = '';
  currentRequestId.value = null;
  lastError.value = null;
}

async function createSession(): Promise<ChatSession> {
  const session = await window.electronAPI.chatCreateSession();
  activeSession.value = session;
  streamingText.value = '';
  currentRequestId.value = null;
  lastError.value = null;
  await refreshSessions();
  return session;
}

async function deleteSession(id: string): Promise<void> {
  await window.electronAPI.chatDeleteSession(id);
  if (activeSession.value?.id === id) {
    activeSession.value = null;
  }
  await refreshSessions();
}

async function renameSession(id: string, title: string): Promise<void> {
  await window.electronAPI.chatRenameSession(id, title);
  if (activeSession.value?.id === id) {
    activeSession.value.title = title;
  }
  await refreshSessions();
}

async function clearContext(): Promise<void> {
  if (!activeSession.value) return;
  await window.electronAPI.chatClearContext(activeSession.value.id);
  activeSession.value.messages = [];
  streamingText.value = '';
  currentRequestId.value = null;
  await refreshSessions();
}

async function sendMessage(
  userText: string,
  attachments?: ChatAttachmentInput[]
): Promise<void> {
  if (!activeSession.value) {
    // 无会话则自动创建
    await createSession();
  }
  if (!activeSession.value) return;

  const sessionId = activeSession.value.id;

  // 乐观更新：先追加一条本地 user 消息（id 由主进程返回后替换）
  const optimisticUserMsg: ChatMessage = {
    id: 'pending-' + Date.now(),
    role: 'user',
    content:
      attachments && attachments.length > 0
        ? [
            ...(userText.trim() ? [{ type: 'text' as const, text: userText }] : []),
            ...attachments.map((a) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: a.mediaType,
                data: a.base64,
              },
            })),
          ]
        : userText,
    timestamp: Date.now(),
    attachments: attachments?.map((a) => ({
      name: a.name,
      mediaType: a.mediaType,
    })),
  };
  activeSession.value.messages.push(optimisticUserMsg);

  try {
    // 关键：Electron IPC 通过 structured clone 序列化参数，
    // 不能直接传 Vue 响应式代理对象（会抛 "An object could not be cloned."）。
    // 因此把 attachments 转为纯 POJO 数组再发送。
    const plainAttachments = attachments?.map((a) => ({
      name: a.name,
      mediaType: a.mediaType,
      base64: a.base64,
    }));

    const result = await window.electronAPI.chatSend({
      sessionId,
      userText,
      attachments: plainAttachments,
    });
    // 用主进程返回的真实 id 替换乐观 id
    optimisticUserMsg.id = result.userMessageId;
    currentRequestId.value = result.requestId;
    lastError.value = null;
  } catch (err) {
    // 发送失败（如 session 不存在、配置缺失），回滚乐观消息
    const idx = activeSession.value.messages.indexOf(optimisticUserMsg);
    if (idx >= 0) activeSession.value.messages.splice(idx, 1);
    lastError.value = (err as Error).message;
  }
}

async function abort(): Promise<void> {
  if (!currentRequestId.value) return;
  await window.electronAPI.chatAbort(currentRequestId.value);
  // 具体状态清理由 aborted 事件处理
}

/**
 * 响应工具确认请求。
 * decision:
 *   - 'approved': 本次批准
 *   - 'approved-all': 本次请求内全部批准
 *   - 'trusted': 永久信任
 *   - 'rejected': 拒绝
 */
async function respondConfirm(
  decision: 'approved' | 'approved-all' | 'trusted' | 'rejected'
): Promise<void> {
  const current = pendingConfirm.value;
  if (!current) return;
  // 立即清空本地状态（关闭弹窗），主进程收到后会继续 agent 循环
  pendingConfirm.value = null;
  try {
    await window.electronAPI.chatConfirmResponse({
      confirmId: current.confirmId,
      decision,
    });
  } catch (err) {
    lastError.value = (err as Error).message;
  }
}

function dismissError(): void {
  lastError.value = null;
}

// ─── 选择态 API（V1.2 多选导出） ──────────────────────────

/**
 * 进入选择模式。
 *
 * @param preselectId  可选：触发进入的消息 id，自动预选中
 *
 * 进入条件（调用方应自行保证）：
 *  - 存在 activeSession
 *  - 非流式状态
 */
function enterSelection(preselectId?: string): void {
  if (currentRequestId.value) return; // 流式中禁入
  if (!activeSession.value) return;
  selectionMode.value = true;
  selectedIds.value = preselectId ? new Set([preselectId]) : new Set();
}

/** 退出选择模式并清空选中集合。 */
function exitSelection(): void {
  selectionMode.value = false;
  selectedIds.value = new Set();
}

function isSelected(id: string): boolean {
  return selectedIds.value.has(id);
}

function toggleSelect(id: string): void {
  if (!selectionMode.value) return;
  // Set 是响应式对象，需要克隆替换以触发视图更新
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

/** 全选当前会话的全部已落库消息（排除 pending 乐观消息） */
function selectAll(): void {
  if (!selectionMode.value || !activeSession.value) return;
  const next = new Set<string>();
  for (const m of activeSession.value.messages) {
    if (!m.id.startsWith('pending-')) next.add(m.id);
  }
  selectedIds.value = next;
}

// ─── 重新生成（V1.2） ─────────────────────────────────────

/**
 * 重新生成指定 assistant 消息。
 *
 * 行为：
 * 1. 截断该消息（含）及之后所有消息
 * 2. 基于截断后的上下文调用 LLM 流式生成
 * 3. 流式事件复用 chat:event，与 send 完全一致
 *
 * 确认策略（Q2-b）：
 * - 如果 M 是最后一条 assistant → 直接执行
 * - 如果 M 之后还有消息 → confirm 提示用户
 *
 * 前置条件：
 * - 非流式状态（isStreaming === false）
 * - activeSession 存在
 */
async function regenerateMessage(assistantMessageId: string): Promise<void> {
  if (!activeSession.value) return;
  if (currentRequestId.value) return; // 流式中禁止

  const msgs = activeSession.value.messages;
  const idx = msgs.findIndex((m) => m.id === assistantMessageId);
  if (idx < 0) return;

  const tailCount = msgs.length - idx - 1;
  if (
    tailCount > 0 &&
    !confirm(
      `将丢弃后续 ${tailCount} 条消息并重新生成此回答，无法撤销。继续？`
    )
  ) {
    return;
  }

  // 乐观截断前端数组（UX 即时反馈）
  activeSession.value.messages = msgs.slice(0, idx);
  lastError.value = null;

  try {
    const result = await window.electronAPI.chatRegenerate({
      sessionId: activeSession.value.id,
      assistantMessageId,
    });
    currentRequestId.value = result.requestId;
  } catch (err) {
    // 截断已持久化（主进程先写盘再返回），但流式启动失败时仍需重载
    lastError.value = (err as Error).message;
    if (activeSession.value) {
      const id = activeSession.value.id;
      const fresh = await window.electronAPI.chatLoadSession(id);
      if (fresh && activeSession.value?.id === id) {
        activeSession.value = fresh;
      }
    }
  }
}

// ─── 编辑并重发（V1.2） ───────────────────────────────────

/**
 * 进入编辑态：标记 editingMessageId，UI 层据此把气泡内容替换为 textarea。
 *
 * 同一时间只允许编辑一条（Q4-a）：如果正在编辑另一条，自动退出再切换。
 */
function enterEditing(messageId: string): void {
  if (currentRequestId.value) return; // 流式中禁止
  if (!activeSession.value) return;
  if (selectionMode.value) exitSelection();
  editingMessageId.value = messageId;
}

function exitEditing(): void {
  editingMessageId.value = null;
}

/**
 * 提交编辑后的文本 + 原图 imageRef，截断并重发。
 *
 * 无二次确认（Q7 用户要求直接丢弃）。
 */
async function submitEdit(
  targetMessageId: string,
  newText: string,
  imageRefs?: Array<{
    type: 'image_ref';
    cachePath: string;
    hash: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    fileName: string;
    byteSize: number;
    width?: number;
    height?: number;
  }>
): Promise<void> {
  if (!activeSession.value) return;
  if (currentRequestId.value) return;

  const msgs = activeSession.value.messages;
  const idx = msgs.findIndex((m) => m.id === targetMessageId);
  if (idx < 0) return;

  // 乐观截断
  activeSession.value.messages = msgs.slice(0, idx);
  editingMessageId.value = null;
  lastError.value = null;

  try {
    // 解包为纯 POJO（避免 Vue Proxy structured clone 问题）
    const plainRefs = imageRefs?.map((r) => ({
      type: r.type as 'image_ref',
      cachePath: r.cachePath,
      hash: r.hash,
      mediaType: r.mediaType,
      fileName: r.fileName,
      byteSize: r.byteSize,
      width: r.width,
      height: r.height,
    }));

    const result = await window.electronAPI.chatEditAndResend({
      sessionId: activeSession.value.id,
      targetMessageId,
      newText,
      imageRefs: plainRefs,
    });

    // 乐观追加新 user 消息（含 imageRef，保证图片立即可见）
    const hasImages = plainRefs && plainRefs.length > 0;
    const optimisticContent = hasImages
      ? [
          ...(newText.trim()
            ? [{ type: 'text' as const, text: newText }]
            : []),
          ...plainRefs!,
        ]
      : newText;

    const optimisticMsg: ChatMessage = {
      id: result.userMessageId,
      role: 'user',
      content: optimisticContent,
      timestamp: Date.now(),
    };
    activeSession.value.messages.push(optimisticMsg);
    currentRequestId.value = result.requestId;
  } catch (err) {
    lastError.value = (err as Error).message;
    if (activeSession.value) {
      const id = activeSession.value.id;
      const fresh = await window.electronAPI.chatLoadSession(id);
      if (fresh && activeSession.value?.id === id) {
        activeSession.value = fresh;
      }
    }
  }
}

// ─── 导出 composable ──────────────────────────────────────

export function useChat() {
  ensureInitialized();

  onUnmounted(() => {
    // 注：单例模式下不真的 dispose；若整个 Shell 卸载才调用
    // 这里保留钩子以防未来改为按视图订阅
  });

  return {
    // state (readonly refs)
    sessions,
    activeSession,
    messages: computed(() =>
      (activeSession.value?.messages ?? []).filter((m) => !m.toolRoundtrip)
    ),
    streamingText,
    isStreaming: computed(() => currentRequestId.value !== null),
    lastError,

    // tool call state
    toolExecuting,
    toolResults,
    pendingConfirm,

    // selection state
    selectionMode,
    selectedIds,
    selectedCount: computed(() => selectedIds.value.size),

    // actions
    refreshSessions,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    clearContext,
    sendMessage,
    abort,
    respondConfirm,
    dismissError,

    // selection actions
    enterSelection,
    exitSelection,
    toggleSelect,
    selectAll,
    isSelected,

    // regenerate
    regenerateMessage,

    // editing
    editingMessageId,
    enterEditing,
    exitEditing,
    submitEdit,
  };
}

/** Shell 整体卸载时调用，清理全局事件订阅 */
export function disposeChatSubscription(): void {
  if (eventDisposer) {
    eventDisposer();
    eventDisposer = null;
    initialized = false;
  }
}
