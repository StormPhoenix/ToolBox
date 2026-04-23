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

// ─── 图像生成 ───────────────────────────────────────────────

/**
 * 图像生成请求参数
 *
 * 各参数对不同 Provider 的生效情况：
 * | 参数    | OpenAI DALL-E 3 | Gemini（本期不实现） |
 * |---------|-----------------|----------------------|
 * | size    | ✅              | —                    |
 * | quality | ✅              | —                    |
 * | style   | ✅              | —                    |
 * | n       | ✅（固定 1）    | —                    |
 */
export interface LLMImageGenOptions {
  /** 生成图像的文字描述 */
  prompt: string;
  /**
   * 图像尺寸，格式 'WxH'。
   * OpenAI DALL-E 3 支持: '1024x1024'（默认）、'1792x1024'、'1024x1792'。
   * 传入不支持的值时 Provider 使用默认尺寸。
   */
  size?: string;
  /**
   * 图像质量。仅 OpenAI 生效。
   * 'standard'（默认）：速度更快；'hd'：细节更丰富。
   */
  quality?: 'standard' | 'hd';
  /**
   * 图像风格。仅 OpenAI 生效。
   * 'vivid'（默认）：超现实鲜艳；'natural'：更自然写实。
   */
  style?: 'vivid' | 'natural';
  /**
   * 生成张数。
   * OpenAI DALL-E 3 固定只能生成 1 张，传入 n > 1 时忽略。
   */
  n?: number;
}

/** 图像生成返回结果 */
export interface LLMImageGenResult {
  /** base64 编码的图像字符串数组（不含 data URL 前缀） */
  images: string[];
  /**
   * OpenAI 对 prompt 的修订版本（DALL-E 3 会自动优化 prompt）。
   * 其他 Provider 不返回此字段。
   */
  revised_prompt?: string;
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

  /**
   * 流式文本生成（纯对话，不含 tools）。
   *
   * 每收到一段增量文本会调用 onText(delta)；
   * 完成后返回完整的 LLMResponse（含汇总 text + usage）。
   *
   * 设计说明：
   * - V1 只用于 ChatEngine 纯对话场景，因此不接受 tools / toolChoice 参数。
   *   未来如需工具 Agent，再单独扩展或新增 streamAgentMessage。
   * - 传入的 AbortSignal 用于用户中止；中止时应抛出 AbortError。
   */
  streamMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    onText: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<LLMResponse>;

  /**
   * 图像生成（可选）。
   * 不支持此能力的 Provider 不实现此方法，
   * 调用方需先检查 capabilities.imageGeneration。
   */
  generateImage?(options: LLMImageGenOptions): Promise<LLMImageGenResult>;

  get capabilities(): {
    toolUse: boolean;
    streaming: boolean;
    vision: boolean;
    maxContext: number;
    /** 是否支持图像生成 */
    imageGeneration: boolean;
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

// llm:generate-image 入参/出参直接复用 LLMImageGenOptions / LLMImageGenResult（见上方定义）
