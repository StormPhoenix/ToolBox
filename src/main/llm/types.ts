/**
 * 统一 LLM 类型定义
 * 所有 Provider（Claude / OpenAI / Gemini）共享的消息、工具、响应类型。
 * 内部以 Anthropic 格式为标准，各 Provider 负责转换。
 */

// ─── System Prompt ─────────────────────────────────────────

export interface LLMSystemBlock {
  type: 'text';
  text: string;
  /** 缓存控制标记（Claude Prompt Caching 用） */
  cache_control?: { type: 'ephemeral' };
}

/** string | LLMSystemBlock[] */
export type LLMSystemParam = string | LLMSystemBlock[];

// ─── 消息内容块 ────────────────────────────────────────────

export interface LLMTextBlock {
  type: 'text';
  text: string;
}

export interface LLMToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface LLMToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | (LLMTextBlock | LLMImageBlock)[];
  is_error?: boolean;
}

/**
 * 图片内容块 — 用于多模态视觉消息
 * 插件侧自行将文件读为 base64 后传入。
 */
export interface LLMImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type LLMContentBlock =
  | LLMTextBlock
  | LLMToolUseBlock
  | LLMToolResultBlock
  | LLMImageBlock;

// ─── 消息参数 ──────────────────────────────────────────────

export interface LLMMessageParam {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
}

// ─── 工具定义（预留，当前不对外暴露） ──────────────────────

export interface LLMToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMToolChoice {
  type: 'auto' | 'any' | 'tool';
  name?: string;
}

// ─── 响应 ──────────────────────────────────────────────────

export interface LLMResponse {
  content: LLMContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// ─── Provider 接口 ─────────────────────────────────────────

export interface LLMProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  maxTokens: number;
  timeout?: number;
}

export interface LLMProvider {
  readonly model: string;

  createMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    tools?: LLMToolDef[],
    toolChoice?: LLMToolChoice
  ): Promise<LLMResponse>;

  get capabilities(): {
    toolUse: boolean;
    streaming: boolean;
    vision: boolean;
    maxContext: number;
  };
}

// ─── Provider 类型 ─────────────────────────────────────────

export type ProviderType = 'claude' | 'openai' | 'gemini';

export function resolveProviderType(model: string): ProviderType {
  const m = model.toLowerCase();
  if (m.includes('claude')) return 'claude';
  if (m.includes('gemini')) return 'gemini';
  return 'openai';
}

// ─── LLM 配置（存储在 userData/llm-config.json） ──────────

export interface LLMConfig {
  provider: ProviderType;
  claude?: { apiKey: string; baseURL?: string; model: string };
  openai?: { apiKey: string; baseURL?: string; model: string };
  gemini?: { apiKey: string; baseURL?: string; model: string };
  /** 全局 maxTokens，默认 4096 */
  maxTokens?: number;
}

/** getLLMConfig 返回的脱敏版本（apiKey 替换为掩码） */
export interface LLMConfigPublic {
  provider: ProviderType;
  claude?: { apiKeyMasked: string; hasApiKey: boolean; baseURL?: string; model: string };
  openai?: { apiKeyMasked: string; hasApiKey: boolean; baseURL?: string; model: string };
  gemini?: { apiKeyMasked: string; hasApiKey: boolean; baseURL?: string; model: string };
  maxTokens?: number;
  /** 当前 provider 是否已配置可用 */
  available: boolean;
}

/** setLLMConfig 接收的输入（可部分更新） */
export interface LLMConfigInput {
  provider?: ProviderType;
  claude?: { apiKey?: string; baseURL?: string; model?: string };
  openai?: { apiKey?: string; baseURL?: string; model?: string };
  gemini?: { apiKey?: string; baseURL?: string; model?: string };
  maxTokens?: number;
}

// ─── IPC 调用类型 ──────────────────────────────────────────

/** llm:chat 出参 */
export interface LLMChatResult {
  text: string;
  usage?: { input_tokens: number; output_tokens: number };
}
