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
 * 单例模式（整个 Shell 共享一份状态），避免多个 ChatView 实例造成冲突。
 */
import { ref, computed, onUnmounted } from 'vue';
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

    case 'stream-end': {
      streamingText.value = '';
      currentRequestId.value = null;
      lastError.value = null;
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
      // 若已有部分文本，将其作为 assistant 消息保留（主进程此时不入库，
      // 因此这里仅用于 UI：清空正在生成，不 push 到 messages）
      streamingText.value = '';
      currentRequestId.value = null;
      break;
  }
}

// ─── 初始化（只执行一次） ──────────────────────────────────

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  eventDisposer = window.electronAPI.onChatEvent(handleChatEvent);
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

function dismissError(): void {
  lastError.value = null;
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
    messages: computed(() => activeSession.value?.messages ?? []),
    streamingText,
    isStreaming: computed(() => currentRequestId.value !== null),
    lastError,

    // actions
    refreshSessions,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    clearContext,
    sendMessage,
    abort,
    dismissError,
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
