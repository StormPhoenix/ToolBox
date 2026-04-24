/**
 * Chat 模块类型定义
 *
 * 职责边界：
 * - 存储层使用的 ChatMessage / ChatSession 结构
 * - IPC 层使用的事件类型 ChatEvent
 * - 与 LLM 层的 LLMMessageParam 相互转换由 chat-engine 负责
 */
import type { LLMContentBlock, LLMMessageParam, LLMToolUseBlock, ProviderType } from '../llm/types';
import type { LLMImageRefBlock } from './image-cache';

// ─── 持久化 tool_result 块 ─────────────────────────────────

/**
 * 持久化专用的 tool_result 块。
 * content 统一为 string（JSON 序列化的工具返回值），便于磁盘存储。
 */
export interface PersistedToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ─── 会话与消息 ────────────────────────────────────────────

/**
 * 持久化层的消息 content 联合类型。
 *
 * - 运行时（发送 LLM）用 LLMContentBlock（含 image 的 base64）
 * - 持久化到磁盘时，image 块会被替换为 image_ref 块（仅含 cachePath + hash）
 * - tool_use 块由 assistant 消息产生，tool_result 块由工具执行结果产生
 * - 加载回内存后，chat-engine 按 K=1 规则按需还原 base64
 *
 * 两种形态共用一个联合以避免双份 ChatMessage 类型。
 */
export type PersistedContentBlock =
  | LLMContentBlock
  | LLMImageRefBlock
  | LLMToolUseBlock
  | PersistedToolResultBlock;

/**
 * 单条消息（持久化结构）。
 *
 * - role=user：content 可能是纯字符串，或 text + image_ref + image + tool_result 的 block 数组
 * - role=assistant：可能是纯字符串，或 text + tool_use 的 block 数组
 *
 * 不存 error 气泡（error 只走事件流显示，不入历史）。
 */
export interface ChatMessage {
  /** UI 使用的消息 ID（uuid） */
  id: string;
  role: 'user' | 'assistant';
  content: string | PersistedContentBlock[];
  /** 创建时间 ms */
  timestamp: number;
  /** 附件展示元数据（真实图片在 content.image_ref 块中） */
  attachments?: Array<{ name: string; mediaType: string }>;
  /** 本条消息产生时使用的模型快照，便于日后追溯 */
  model?: { provider: ProviderType; model: string };
  /**
   * 标记此消息是否为 tool 交互的中间步骤。
   * regenerate 时据此回溯到完整对话轮次的起点。
   */
  toolRoundtrip?: boolean;
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
 * 包含流式对话事件 + 工具调用事件。
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
      /** 清空前端正在显示的中间文本（工具调用开始前触发） */
      kind: 'stream-reset';
      requestId: string;
    }
  | {
      /** 工具开始执行 */
      kind: 'tool-executing';
      requestId: string;
      toolName: string;
      toolDisplayName: string;
      toolInput: unknown;
    }
  | {
      /** 工具执行完成 */
      kind: 'tool-done';
      requestId: string;
      toolName: string;
      toolDisplayName: string;
      success: boolean;
      summary: string;
    }
  | {
      /**
       * 工具执行前请求用户确认（MODERATE 级别且未永久信任）。
       * 渲染进程收到后弹出确认对话框，用户响应通过 chat:confirm-response IPC 回传。
       */
      kind: 'tool-confirm-request';
      requestId: string;
      /** 唯一确认 ID（用于匹配响应） */
      confirmId: string;
      toolName: string;
      toolDisplayName: string;
      toolInput: unknown;
      /** 渲染后的确认提示文本（已替换 {paramName}），未设置时前端用 displayName 兜底 */
      confirmHint?: string;
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
// （历史遗留的 toLLMMessages 已移除：运行时转换由 chat-engine.prepareLLMMessages
//  完成，因为它还要负责 image_ref → image 还原与 K=3 历史淡出。）
export type { LLMMessageParam };
