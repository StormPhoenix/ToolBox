/**
 * DumpingProvider — LLM Provider 的透明代理
 *
 * 职责：包装真实 Provider，在 createMessage / streamMessage / generateImage
 * 前后自动调用 PromptDumper 记录 request + response。
 *
 * 设计要点：
 *   1. 完全实现 LLMProvider 接口，调用方无感知
 *   2. 通过 scene 上下文（构造时绑定）区分调用来源，每次调用隔离，天然并发安全
 *   3. dump 写盘 fire-and-forget，不影响主流程时序
 */
import type {
  LLMProvider,
  LLMSystemParam,
  LLMMessageParam,
  LLMToolDef,
  LLMToolChoice,
  LLMResponse,
  LLMImageGenOptions,
  LLMImageGenResult,
} from './types';
import { dumpCall, type DumpRecord } from './prompt-dumper';

/**
 * 调用场景上下文，在 Router.getProvider(scene, opts) 时绑定到实例。
 */
export interface CallSceneContext {
  scene: string;
  requestId?: string;
  sessionId?: string;
  iteration?: number;
}

/**
 * Provider 代理。
 *
 * scene 上下文在构造时绑定，每次 Router.getProvider() 调用返回独立实例，
 * 并发调用之间互不干扰。
 */
export class DumpingProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly getProviderName: () => string,
    private readonly ctx: CallSceneContext = { scene: 'unknown' }
  ) {}

  get model(): string {
    return this.inner.model;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  async createMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    tools?: LLMToolDef[],
    toolChoice?: LLMToolChoice,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const ctx = this.ctx;
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    try {
      const response = await this.inner.createMessage(
        system,
        messages,
        tools,
        toolChoice,
        signal
      );
      void dumpCall(
        this.buildChatRecord(
          ctx,
          timestamp,
          Date.now() - startedAt,
          { system, messages, tools },
          response
        )
      );
      return response;
    } catch (err) {
      void dumpCall(
        this.buildChatRecord(
          ctx,
          timestamp,
          Date.now() - startedAt,
          { system, messages, tools },
          { content: [], stop_reason: 'end_turn' },
          err as Error
        )
      );
      throw err;
    }
  }

  async streamMessage(
    system: LLMSystemParam,
    messages: LLMMessageParam[],
    onText: (delta: string) => void,
    signal?: AbortSignal,
    tools?: LLMToolDef[],
    toolChoice?: LLMToolChoice
  ): Promise<LLMResponse> {
    const ctx = this.ctx;
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    try {
      const response = await this.inner.streamMessage(
        system,
        messages,
        onText,
        signal,
        tools,
        toolChoice
      );
      void dumpCall(
        this.buildChatRecord(
          ctx,
          timestamp,
          Date.now() - startedAt,
          { system, messages, tools },
          response
        )
      );
      return response;
    } catch (err) {
      void dumpCall(
        this.buildChatRecord(
          ctx,
          timestamp,
          Date.now() - startedAt,
          { system, messages, tools },
          { content: [], stop_reason: 'end_turn' },
          err as Error
        )
      );
      throw err;
    }
  }

  async generateImage(
    options: LLMImageGenOptions
  ): Promise<LLMImageGenResult> {
    if (!this.inner.generateImage) {
      throw new Error('Provider 未实现图像生成');
    }
    const ctx = this.ctx;
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    try {
      const result = await this.inner.generateImage(options);
      void dumpCall(
        this.buildImageGenRecord(
          ctx,
          timestamp,
          Date.now() - startedAt,
          options,
          result
        )
      );
      return result;
    } catch (err) {
      void dumpCall(
        this.buildImageGenRecord(
          ctx,
          timestamp,
          Date.now() - startedAt,
          options,
          { images: [] },
          err as Error
        )
      );
      throw err;
    }
  }

  // ─── 辅助：构造 DumpRecord ──────────────────────────

  private buildChatRecord(
    ctx: CallSceneContext,
    timestamp: string,
    durationMs: number,
    request: {
      system: LLMSystemParam;
      messages: LLMMessageParam[];
      tools?: LLMToolDef[];
    },
    response: LLMResponse,
    error?: Error
  ): DumpRecord {
    const record: DumpRecord = {
      timestamp,
      scene: ctx.scene,
      requestId: ctx.requestId,
      sessionId: ctx.sessionId,
      iteration: ctx.iteration,
      provider: {
        name: this.getProviderName(),
        model: this.model,
      },
      durationMs,
      callType: 'chat',
      request,
      response,
      requestMeta: {}, // dumpCall 内部会填充
    };
    if (error) {
      record.error = { message: error.message, stack: error.stack };
    }
    return record;
  }

  private buildImageGenRecord(
    ctx: CallSceneContext,
    timestamp: string,
    durationMs: number,
    options: LLMImageGenOptions,
    result: LLMImageGenResult,
    error?: Error
  ): DumpRecord {
    const record: DumpRecord = {
      timestamp,
      scene: ctx.scene,
      requestId: ctx.requestId,
      provider: {
        name: this.getProviderName(),
        model: this.model,
      },
      durationMs,
      callType: 'image-gen',
      request: { options },
      // 去掉 images 的 base64 字符串避免把几 MB 原图写进 JSON（保留 revised_prompt）
      response: {
        images: result.images.map((_, i) => `<base64 image #${i + 1}>`),
        revised_prompt: result.revised_prompt,
      },
      requestMeta: {},
    };
    if (error) {
      record.error = { message: error.message, stack: error.stack };
    }
    return record;
  }
}
