/**
 * OpenAI Provider — OpenAI SDK 封装
 * 实现统一 LLMProvider 接口，兼容所有 OpenAI API 兼容的第三方服务。
 */
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionContentPart,
} from 'openai/resources/chat/completions';
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
  LLMToolResultBlock,
  LLMImageBlock,
  LLMSystemParam,
  LLMImageGenOptions,
  LLMImageGenResult,
} from '../types';
import { createLogger } from '../../logger';

const log = createLogger('OpenAIProvider');

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  public readonly model: string;
  private maxTokens: number;

  constructor(config: LLMProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
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
    const openaiMessages = toOpenAIMessages(flattenSystem(system), messages);
    const openaiTools = tools?.length ? tools.map(toOpenAITool) : undefined;

    const resp = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: this.maxTokens,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice:
        openaiTools && toolChoice ? toOpenAIToolChoice(toolChoice) : undefined,
    });

    log.info(`createMessage 完成: finish_reason=${resp.choices[0]?.finish_reason}, model=${this.model}`);
    return toUnifiedResponse(resp);
  }

  /**
   * 流式对话。
   *
   * 迭代 chat.completions 的 SSE chunk 流：
   *   - choices[0].delta.content 为本次增量文本，调用 onText
   *   - choices[0].finish_reason 在最后一个 chunk 出现
   *   - usage 需配置 stream_options.include_usage 才会在末尾 chunk 出现
   *
   * AbortSignal 直接透传给 SDK（OpenAI SDK 支持 signal 参数）。
   */
  async streamMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    onText: (delta: string) => void,
    signal?: AbortSignal,
    tools?: LLMToolDef[],
    toolChoice?: LLMToolChoice,
  ): Promise<LLMResponse> {
    const openaiMessages = toOpenAIMessages(flattenSystem(system), messages);
    const openaiTools = tools?.length ? tools.map(toOpenAITool) : undefined;

    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        max_completion_tokens: this.maxTokens,
        messages: openaiMessages,
        stream: true,
        stream_options: { include_usage: true },
        tools: openaiTools,
        tool_choice:
          openaiTools && toolChoice ? toOpenAIToolChoice(toolChoice) : undefined,
      },
      { signal }
    );

    let fullText = '';
    let finishReason: string | null = null;
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    // 流式 tool_calls fragment 累积（OpenAI 分多个 chunk 发送 tool_calls 的各部分）
    const toolCallFragments = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice) {
        const delta = choice.delta?.content;
        if (delta) {
          fullText += delta;
          onText(delta);
        }

        // tool_calls delta（流式片段）
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const existing = toolCallFragments.get(tc.index) ?? {
              id: '',
              name: '',
              arguments: '',
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments)
              existing.arguments += tc.function.arguments;
            toolCallFragments.set(tc.index, existing);
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
      // 末尾 chunk 带 usage（choices 通常为空数组）
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens,
          output_tokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }

    // 组装 content blocks
    const content: LLMContentBlock[] = [];
    if (fullText) {
      content.push({ type: 'text', text: fullText });
    }
    for (const [, tc] of toolCallFragments) {
      let parsedInput: unknown = {};
      try {
        parsedInput = JSON.parse(tc.arguments);
      } catch {
        /* keep empty */
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: parsedInput,
      });
    }

    let stopReason: LLMResponse['stop_reason'] = 'end_turn';
    if (finishReason === 'tool_calls') stopReason = 'tool_use';
    else if (finishReason === 'length') stopReason = 'max_tokens';

    log.info(
      `streamMessage 完成: finish_reason=${finishReason}, ` +
        `text=${fullText.length} chars, toolCalls=${toolCallFragments.size}, model=${this.model}`
    );

    return {
      content,
      stop_reason: stopReason,
      usage,
    };
  }

  get capabilities() {
    return {
      toolUse: true,
      streaming: true,
      vision: true,
      maxContext: 128000,
      imageGeneration: true,
    };
  }

  async generateImage(options: LLMImageGenOptions): Promise<LLMImageGenResult> {
    // DALL-E 3 仅支持特定尺寸，不匹配时回退到默认值
    const SUPPORTED_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;
    type DallESize = typeof SUPPORTED_SIZES[number];
    const size: DallESize = SUPPORTED_SIZES.includes(options.size as DallESize)
      ? (options.size as DallESize)
      : '1024x1024';

    log.info(
      `generateImage: prompt="${options.prompt.slice(0, 60)}...", ` +
        `size=${size}, quality=${options.quality ?? 'standard'}, style=${options.style ?? 'vivid'}`
    );

    const resp = await this.client.images.generate({
      model: 'dall-e-3',
      prompt: options.prompt,
      size,
      quality: options.quality ?? 'standard',
      style: options.style ?? 'vivid',
      response_format: 'b64_json',
      n: 1, // DALL-E 3 固定只支持 n=1
    });

    const images: string[] = [];
    let revised_prompt: string | undefined;

    for (const item of resp.data) {
      if (item.b64_json) {
        images.push(item.b64_json);
      }
      if (item.revised_prompt) {
        revised_prompt = item.revised_prompt;
      }
    }

    log.info(`generateImage 完成: ${images.length} 张, revised_prompt=${!!revised_prompt}`);
    return { images, revised_prompt };
  }
}

// ─── 内部转换函数 ──────────────────────────────────────────

function flattenSystem(system: LLMSystemParam): string {
  if (typeof system === 'string') return system;
  return system.map((b) => b.text).join('\n\n');
}

function toOpenAIMessages(
  system: string,
  messages: LLMMessageParam[]
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
      continue;
    }

    if (msg.role === 'user') {
      const toolResults = msg.content.filter(
        (b): b is LLMToolResultBlock => b.type === 'tool_result'
      );
      const textBlocks = msg.content.filter(
        (b): b is LLMTextBlock => b.type === 'text'
      );
      const imageBlocks = msg.content.filter(
        (b): b is LLMImageBlock => b.type === 'image'
      );

      for (const tr of toolResults) {
        if (Array.isArray(tr.content)) {
          const textParts = tr.content
            .filter((b): b is LLMTextBlock => b.type === 'text')
            .map((b) => b.text);
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: textParts.join('\n') || '(工具执行完成)',
          });
          const imgParts = tr.content.filter(
            (b): b is LLMImageBlock => b.type === 'image'
          );
          if (imgParts.length > 0) {
            const parts: ChatCompletionContentPart[] = imgParts.map((img) => ({
              type: 'image_url' as const,
              image_url: {
                url: `data:${img.source.media_type};base64,${img.source.data}`,
                detail: 'auto' as const,
              },
            }));
            result.push({ role: 'user', content: parts });
          }
        } else {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          });
        }
      }

      if (imageBlocks.length > 0) {
        const parts: ChatCompletionContentPart[] = [];
        if (textBlocks.length > 0) {
          parts.push({
            type: 'text',
            text: textBlocks.map((b) => b.text).join('\n'),
          });
        }
        for (const img of imageBlocks) {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${img.source.media_type};base64,${img.source.data}`,
              detail: 'auto',
            },
          });
        }
        result.push({ role: 'user', content: parts });
      } else if (textBlocks.length > 0) {
        result.push({
          role: 'user',
          content: textBlocks.map((b) => b.text).join('\n'),
        });
      }
    } else {
      const textBlocks = msg.content.filter(
        (b): b is LLMTextBlock => b.type === 'text'
      );
      const toolUseBlocks = msg.content.filter(
        (b): b is LLMToolUseBlock => b.type === 'tool_use'
      );

      const assistantMsg: ChatCompletionMessageParam = {
        role: 'assistant',
        content:
          textBlocks.length > 0 ? textBlocks.map((b) => b.text).join('') : null,
        ...(toolUseBlocks.length > 0 && {
          tool_calls: toolUseBlocks.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.input === 'string'
                  ? tc.input
                  : JSON.stringify(tc.input),
            },
          })),
        }),
      };
      result.push(assistantMsg);
    }
  }

  return result;
}

function toOpenAITool(tool: LLMToolDef): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function toOpenAIToolChoice(
  tc: LLMToolChoice
):
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'function'; function: { name: string } } {
  if (tc.type === 'auto') return 'auto';
  if (tc.type === 'any') return 'required';
  if (tc.type === 'tool' && tc.name) {
    return { type: 'function', function: { name: tc.name } };
  }
  return 'auto';
}

function toUnifiedResponse(resp: OpenAI.ChatCompletion): LLMResponse {
  const choice = resp.choices[0];
  if (!choice) return { content: [], stop_reason: 'end_turn' };

  const content: LLMContentBlock[] = [];
  const msg = choice.message;

  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      if (tc.type !== 'function') continue;
      let parsedInput: unknown = {};
      try {
        parsedInput = JSON.parse(tc.function.arguments);
      } catch { /* keep empty */ }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      });
    }
  }

  let stopReason: LLMResponse['stop_reason'] = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
  else if (choice.finish_reason === 'length') stopReason = 'max_tokens';

  return {
    content,
    stop_reason: stopReason,
    usage: resp.usage
      ? {
          input_tokens: resp.usage.prompt_tokens,
          output_tokens: resp.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}
