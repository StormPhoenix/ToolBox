/**
 * Chat IPC Handlers
 *
 * 注册以下 IPC 通道：
 *   chat:list-sessions      — 列出所有会话（轻量索引）
 *   chat:load-session       — 加载单个会话完整数据
 *   chat:create-session     — 新建空会话
 *   chat:delete-session     — 删除会话
 *   chat:rename-session     — 重命名会话
 *   chat:clear-context      — 清空会话消息（保留会话）
 *   chat:send               — 发送用户消息，流式回复
 *   chat:abort              — 中止进行中的请求
 *   chat:resend-image-ref   — 从历史 imageRef 读取 base64，供 Composer 再次使用
 *
 * 事件推送（向所有渲染进程）：
 *   chat:event              — ChatEvent 联合类型（stream-chunk / stream-end / error / aborted）
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
import {
  loadImageBase64,
  type LLMImageRefBlock,
  type SupportedMediaType,
} from './image-cache';
import {
  exportSelectedMessages,
  type ChatExportInput,
  type ChatExportResult,
} from './exporter';
import { createLogger } from '../logger';

const log = createLogger('Chat-IPC');

/** UI 传入的 imageRef 载荷（部分字段即可） */
interface ResendImageRefInput {
  cachePath: string;
  hash: string;
  mediaType: SupportedMediaType;
  fileName: string;
}

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

  // ── chat:resend-image-ref ───────────────────────────────
  // UI 点击历史气泡"重新发送此图" → 读取 cachePath → 返回 base64 给 Composer
  ipcMain.handle(
    'chat:resend-image-ref',
    async (_e, ref: ResendImageRefInput): Promise<ChatAttachmentInput | null> => {
      const pseudoRef: LLMImageRefBlock = {
        type: 'image_ref',
        cachePath: ref.cachePath,
        hash: ref.hash,
        mediaType: ref.mediaType,
        fileName: ref.fileName,
        byteSize: 0,
      };
      const base64 = await loadImageBase64(pseudoRef);
      if (!base64) return null;
      return {
        name: ref.fileName,
        mediaType: ref.mediaType,
        base64,
      };
    }
  );

  // ── chat:export-selected ────────────────────────────────
  // 把选中的消息合并写成 Markdown（+ 同级 images/ 子目录）
  ipcMain.handle(
    'chat:export-selected',
    async (_e, input: ChatExportInput): Promise<ChatExportResult> => {
      if (!input?.sessionId) throw new Error('缺少 sessionId');
      if (!Array.isArray(input.messageIds) || input.messageIds.length === 0) {
        throw new Error('未选中任何消息');
      }
      if (!input.targetPath) throw new Error('缺少目标保存路径');

      log.info(
        `chat:export-selected sessionId=${input.sessionId}, ids=${input.messageIds.length}, target=${input.targetPath}`
      );
      return exportSelectedMessages(input);
    }
  );

  log.info('Chat IPC handlers 已注册');
}

