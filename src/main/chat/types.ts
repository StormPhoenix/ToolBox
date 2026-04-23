/**
 * Chat 模块类型定义
 *
 * 职责边界：
 * - 存储层使用的 ChatMessage / ChatSession 结构
 * - IPC 层使用的事件类型 ChatEvent
 * - 与 LLM 层的 LLMMessageParam 相互转换由 chat-engine 负责
 */
import type { LLMContentBlock, LLMMessageParam, ProviderType } from '../llm/types';

// ─── 会话与消息 ────────────────────────────────────────────

/**
 * 单条消息（持久化结构）。
 *
 * - role=user：content 可能是纯字符串，也可能是 text+image 的 block 数组
 * - role=assistant：V1 只会是纯字符串（无 tool_use）
 *
 * V1 不存 error 气泡（error 只走事件流显示，不入历史）。
 */
export interface ChatMessage {
  /** UI 使用的消息 ID（uuid） */
  id: string;
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
  /** 创建时间 ms */
  timestamp: number;
  /** 附件展示元数据（真实 base64 已在 content image block 中） */
  attachments?: Array<{ name: string; mediaType: string }>;
  /** 本条消息产生时使用的模型快照，便于日后追溯 */
  model?: { provider: ProviderType; model: string };
}

/** 单会话完整数据（持久化到 userData/chat-sessions/<id>.json） */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 可选 system prompt，V1 为空字符串或未定义 */
  systemPrompt?: string;
  messages: ChatMessage[];
}

/**
 * 轻量索引条目（持久化到 userData/chat-sessions/index.json）。
 * 启动时只读索引，点击某会话再加载完整数据，避免一次性读全部 messages。
 */
export interface SessionIndexEntry {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

// ─── 事件流 ────────────────────────────────────────────────

/**
 * 主进程推送给渲染进程的 Chat 事件（通过 webContents.send('chat:event', ...)）。
 *
 * V1 只含流式对话相关事件；V2 引入工具时再扩 tool-executing / tool-done。
 */
export type ChatEvent =
  | {
      kind: 'stream-chunk';
      requestId: string;
      /** 本次增量文本（非累积） */
      text: string;
    }
  | {
      kind: 'stream-end';
      requestId: string;
      /** 完整回复文本 */
      text: string;
      /** 新生成的 assistant 消息 ID，渲染进程据此入列 */
      assistantMessageId: string;
      usage?: { input_tokens: number; output_tokens: number };
    }
  | {
      kind: 'error';
      requestId: string;
      message: string;
      /** 是否可恢复（可重试） */
      recoverable: boolean;
    }
  | {
      kind: 'aborted';
      requestId: string;
    };

// ─── IPC 入参/出参 ─────────────────────────────────────────

/** 用户附件（发送时） */
export interface ChatAttachmentInput {
  /** 文件名（仅展示用，非路径） */
  name: string;
  /** image/jpeg | image/png | image/gif | image/webp */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** base64 编码（不含 data URL 前缀） */
  base64: string;
}

/** chat:send 入参 */
export interface ChatSendInput {
  sessionId: string;
  userText: string;
  attachments?: ChatAttachmentInput[];
}

/** chat:send 出参：立即返回 requestId，真实内容通过 chat:event 推送 */
export interface ChatSendResult {
  requestId: string;
  /** 服务端已持久化的 user 消息 ID，供 UI 立即入列 */
  userMessageId: string;
}

// ─── 内部工具函数 ──────────────────────────────────────────

/** 将 ChatMessage[] 转换为 LLMMessageParam[]（去掉 UI 字段） */
export function toLLMMessages(messages: ChatMessage[]): LLMMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
