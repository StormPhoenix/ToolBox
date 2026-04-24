/**
 * Gemini Provider — Google Gen AI SDK 封装
 * 实现统一 LLMProvider 接口，内部使用 @google/genai
 */
import { GoogleGenAI } from '@google/genai';
import type { Content, FunctionDeclaration, Part } from '@google/genai';
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
  LLMSystemParam,
} from '../types';
import { createLogger } from '../../logger';

const log = createLogger('GeminiProvider');

// Gemini tool_use block 需要一个 id，用递增计数器生成
let _toolIdCounter = 0;
function genToolId(): string {
  return `gemini-tool-${++_toolIdCounter}`;
}

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  public readonly model: string;
  private maxTokens: number;

  constructor(config: LLMProviderConfig) {
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
      ...(config.baseURL && { httpOptions: { baseUrl: config.baseURL } }),
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async createMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    tools?: LLMToolDef[],
    _toolChoice?: LLMToolChoice
  ): Promise<LLMResponse> {
    const contents = toGeminiContents(messages);
    const toolDecls = tools?.length ? tools.map(toGeminiFunctionDecl) : undefined;
    const systemStr = flattenSystem(system);

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: systemStr || undefined,
        maxOutputTokens: this.maxTokens,
        ...(toolDecls && { tools: [{ functionDeclarations: toolDecls }] }),
      },
    });

    log.info(`createMessage 完成: model=${this.model}`);
    return toUnifiedResponse(response);
  }

  /**
   * 流式对话。
   *
   * 使用 @google/genai 的 generateContentStream，返回异步迭代器；
   * 每个 chunk 通过 `chunk.text` 访问本次的增量文本（SDK 自动累积并返回最新 delta 之前全部，
   * 但本 SDK 在流式场景下 chunk.text 表示"本 chunk 的增量"），usage 在最后一个 chunk 才有。
   *
   * AbortSignal 支持：Gemini SDK 的 RequestOptions 允许传 abortSignal。
   */
  async streamMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    onText: (delta: string) => void,
    signal?: AbortSignal,
    tools?: LLMToolDef[],
    _toolChoice?: LLMToolChoice,
  ): Promise<LLMResponse> {
    const contents = toGeminiContents(messages);
    const systemStr = flattenSystem(system);
    const toolDecls = tools?.length ? tools.map(toGeminiFunctionDecl) : undefined;

    const iter = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction: systemStr || undefined,
        maxOutputTokens: this.maxTokens,
        ...(signal && { abortSignal: signal }),
        ...(toolDecls && { tools: [{ functionDeclarations: toolDecls }] }),
      },
    });

    let fullText = '';
    let usage:
      | { input_tokens: number; output_tokens: number }
      | undefined;
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    for await (const chunk of iter) {
      if (signal?.aborted) {
        throw new Error('AbortError');
      }
      const delta = typeof chunk.text === 'string' ? chunk.text : undefined;
      if (delta) {
        fullText += delta;
        onText(delta);
      }

      // functionCall 在某些 chunk 中出现
      if (chunk.candidates?.[0]?.content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          if (part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name ?? '',
              args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            });
          }
        }
      }

      if (chunk.usageMetadata) {
        usage = {
          input_tokens: chunk.usageMetadata.promptTokenCount ?? 0,
          output_tokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
        };
      }
    }

    // 组装 content blocks
    const content: LLMContentBlock[] = [];
    if (fullText) {
      content.push({ type: 'text', text: fullText });
    }
    for (const fc of functionCalls) {
      content.push({
        type: 'tool_use',
        id: genToolId(),
        name: fc.name,
        input: fc.args,
      });
    }

    log.info(
      `streamMessage 完成: text=${fullText.length} chars, functionCalls=${functionCalls.length}, model=${this.model}`
    );

    return {
      content,
      stop_reason: functionCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage,
    };
  }

  get capabilities() {
    return {
      toolUse: true,
      streaming: true,
      vision: true,
      maxContext: 1000000,
      imageGeneration: false,
    };
  }
}

// ─── 内部转换函数 ──────────────────────────────────────────

function flattenSystem(system: LLMSystemParam): string {
  if (typeof system === 'string') return system;
  return system.map((b) => b.text).join('\n\n');
}

function toGeminiContents(messages: LLMMessageParam[]): Content[] {
  const contents: Content[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      contents.push({ role, parts: [{ text: msg.content }] });
      continue;
    }

    const parts: Part[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ text: (block as LLMTextBlock).text });
      } else if (block.type === 'tool_use') {
        const tc = block as LLMToolUseBlock;
        parts.push({
          functionCall: {
            name: tc.name,
            args: (tc.input ?? {}) as Record<string, unknown>,
          },
        });
      } else if (block.type === 'tool_result') {
        const tr = block as LLMToolResultBlock;
        const textContent = Array.isArray(tr.content)
          ? tr.content
              .filter((b): b is LLMTextBlock => b.type === 'text')
              .map((b) => b.text)
              .join('\n') || '(工具执行完成)'
          : tr.content;
        parts.push({
          functionResponse: {
            name: findToolNameForResult(messages, tr.tool_use_id),
            response: { result: textContent },
          },
        });
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return contents;
}

function findToolNameForResult(
  messages: LLMMessageParam[],
  toolUseId: string
): string {
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (
        block.type === 'tool_use' &&
        (block as LLMToolUseBlock).id === toolUseId
      ) {
        return (block as LLMToolUseBlock).name;
      }
    }
  }
  return 'unknown_tool';
}

function toGeminiFunctionDecl(tool: LLMToolDef): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.input_schema,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUnifiedResponse(response: any): LLMResponse {
  const content: LLMContentBlock[] = [];

  if (response.text) {
    content.push({ type: 'text', text: response.text });
  }

  if (response.functionCalls && response.functionCalls.length > 0) {
    for (const fc of response.functionCalls) {
      content.push({
        type: 'tool_use',
        id: genToolId(),
        name: fc.name ?? '',
        input: fc.args ?? {},
      });
    }
  }

  const hasFunctionCalls =
    response.functionCalls && response.functionCalls.length > 0;

  return {
    content,
    stop_reason: hasFunctionCalls ? 'tool_use' : 'end_turn',
    usage: response.usageMetadata
      ? {
          input_tokens: response.usageMetadata.promptTokenCount ?? 0,
          output_tokens: response.usageMetadata.candidatesTokenCount ?? 0,
        }
      : undefined,
  };
}
