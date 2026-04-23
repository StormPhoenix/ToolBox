/**
 * Claude Provider — Anthropic SDK 封装
 * 实现统一 LLMProvider 接口，内部使用 @anthropic-ai/sdk
 *
 * 容错：流式调用遇到 "request ended without sending any chunks" 时
 * 自动回退到非流式 createMessage。
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMMessageParam,
  LLMToolDef,
  LLMToolChoice,
  LLMResponse,
  LLMContentBlock,
  LLMTextBlock,
  LLMToolUseBlock,
  LLMSystemParam,
} from '../types';
import { createLogger } from '../../logger';

const log = createLogger('ClaudeProvider');

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  public readonly model: string;
  private maxTokens: number;

  constructor(config: LLMProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout ?? 120000,
      maxRetries: 2,
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async createMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    tools?: LLMToolDef[],
    toolChoice?: LLMToolChoice
  ): Promise<LLMResponse> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: toAnthropicSystem(system),
      messages: messages as MessageParam[],
      tools: tools?.length ? tools.map(toAnthropicTool) : undefined,
      tool_choice:
        tools?.length && toolChoice
          ? toAnthropicToolChoice(toolChoice)
          : undefined,
    });
    log.info(`createMessage 完成: stop_reason=${resp.stop_reason}, model=${this.model}`);
    return toUnifiedResponse(resp);
  }

  get capabilities() {
    return {
      toolUse: true,
      streaming: true,
      vision: true,
      maxContext: 200000,
      imageGeneration: false,
    };
  }
}

// ─── 内部转换函数 ──────────────────────────────────────────

function toAnthropicSystem(
  system: LLMSystemParam
): string | Anthropic.TextBlockParam[] {
  if (typeof system === 'string') return system;
  return system.map((block) => {
    const result: Anthropic.TextBlockParam & {
      cache_control?: { type: 'ephemeral' };
    } = { type: 'text' as const, text: block.text };
    if (block.cache_control) result.cache_control = block.cache_control;
    return result;
  });
}

function toAnthropicTool(tool: LLMToolDef): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Tool['input_schema'],
  };
}

function toAnthropicToolChoice(
  tc: LLMToolChoice
): Anthropic.Messages.ToolChoiceAuto | Anthropic.Messages.ToolChoiceAny | Anthropic.Messages.ToolChoiceTool {
  if (tc.type === 'tool' && tc.name) return { type: 'tool', name: tc.name };
  if (tc.type === 'any') return { type: 'any' };
  return { type: 'auto' };
}

function toUnifiedResponse(resp: Anthropic.Message): LLMResponse {
  const content: LLMContentBlock[] = resp.content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text } as LLMTextBlock;
    }
    if (block.type === 'tool_use') {
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      } as LLMToolUseBlock;
    }
    return { type: 'text', text: '' } as LLMTextBlock;
  });

  let stopReason: LLMResponse['stop_reason'] = 'end_turn';
  if (resp.stop_reason === 'tool_use') stopReason = 'tool_use';
  else if (resp.stop_reason === 'max_tokens') stopReason = 'max_tokens';

  const usage = resp.usage
    ? {
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
        cache_creation_input_tokens:
          resp.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens:
          resp.usage.cache_read_input_tokens ?? undefined,
      }
    : undefined;

  return { content, stop_reason: stopReason, usage };
}
