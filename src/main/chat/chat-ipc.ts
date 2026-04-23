/**
 * Chat IPC Handlers
 *
 * 注册以下 IPC 通道：
 *   chat:list-sessions    — 列出所有会话（轻量索引）
 *   chat:load-session     — 加载单个会话完整数据
 *   chat:create-session   — 新建空会话
 *   chat:delete-session   — 删除会话
 *   chat:rename-session   — 重命名会话
 *   chat:clear-context    — 清空会话消息（保留会话）
 *   chat:send             — 发送用户消息，流式回复
 *   chat:abort            — 中止进行中的请求
 *
 * 事件推送（向所有渲染进程）：
 *   chat:event            — ChatEvent 联合类型（stream-chunk / stream-end / error / aborted）
 */
import { ipcMain, webContents } from 'electron';
import type {
  ChatAttachmentInput,
  ChatEvent,
  ChatSendInput,
  ChatSendResult,
  ChatSession,
  SessionIndexEntry,
} from './types';
import * as store from './session-store';
import * as engine from './chat-engine';
import { createLogger } from '../logger';

const log = createLogger('Chat-IPC');

/** 广播事件到所有渲染进程（Shell 当前只有一个主窗口，但保守广播） */
function broadcastEvent(event: ChatEvent): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send('chat:event', event);
  }
}

export function registerChatHandlers(): void {
  // ── chat:list-sessions ──────────────────────────────────
  ipcMain.handle('chat:list-sessions', async (): Promise<SessionIndexEntry[]> => {
    return store.listSessions();
  });

  // ── chat:load-session ───────────────────────────────────
  ipcMain.handle(
    'chat:load-session',
    async (_e, id: string): Promise<ChatSession | null> => {
      return store.loadSession(id);
    }
  );

  // ── chat:create-session ─────────────────────────────────
  ipcMain.handle(
    'chat:create-session',
    async (_e, title?: string): Promise<ChatSession> => {
      return store.createSession(title);
    }
  );

  // ── chat:delete-session ─────────────────────────────────
  ipcMain.handle('chat:delete-session', async (_e, id: string): Promise<void> => {
    await store.deleteSession(id);
  });

  // ── chat:rename-session ─────────────────────────────────
  ipcMain.handle(
    'chat:rename-session',
    async (_e, id: string, title: string): Promise<void> => {
      await store.renameSession(id, title);
    }
  );

  // ── chat:clear-context ──────────────────────────────────
  ipcMain.handle('chat:clear-context', async (_e, id: string): Promise<void> => {
    await store.clearSessionContext(id);
  });

  // ── chat:send ───────────────────────────────────────────
  ipcMain.handle(
    'chat:send',
    async (_e, input: ChatSendInput): Promise<ChatSendResult> => {
      if (!input.sessionId) throw new Error('缺少 sessionId');
      if (!input.userText?.trim() && !(input.attachments?.length)) {
        throw new Error('消息内容不能为空');
      }

      log.info(
        `chat:send sessionId=${input.sessionId}, text=${input.userText.length} chars, ` +
          `attachments=${input.attachments?.length ?? 0}`
      );

      const { requestId, userMessage } = await engine.sendMessage({
        sessionId: input.sessionId,
        userText: input.userText,
        attachments: input.attachments as ChatAttachmentInput[] | undefined,
        onEvent: broadcastEvent,
      });

      return { requestId, userMessageId: userMessage.id };
    }
  );

  // ── chat:abort ──────────────────────────────────────────
  ipcMain.handle('chat:abort', async (_e, requestId: string): Promise<void> => {
    engine.abortRequest(requestId);
  });

  log.info('Chat IPC handlers 已注册');
}
