/**
 * LLM Router — 多 Provider 路由 + 降级逻辑
 *
 * 根据当前配置的 provider 字段选择 ClaudeProvider / OpenAIProvider / GeminiProvider。
 * 无可用 Provider 时 isAvailable() 返回 false，调用方应拒绝请求。
 *
 * 调试 Dump 集成：
 *   Router 对外暴露的 Provider 是 DumpingProvider 代理，
 *   每次 LLM 调用会根据调用方传入的 scene 上下文 dump 到磁盘。
 *
 * 使用示例：
 *   // 方式 1：一次性设置上下文 + 立即调用（推荐）
 *   const provider = router.withScene('main-chat', { requestId, sessionId, iteration }).getProvider();
 *   await provider!.streamMessage(...);
 *
 *   // 方式 2：匿名调用（scene 默认为 'unknown'）
 *   const provider = router.getProvider();
 *   await provider!.createMessage(...);
 *
 * 注意：
 *   withScene() 设置的上下文在下次调用 getProvider().xxx() 时被"消费"清空，
 *   下一次调用若未再次 withScene()，则回退到 'unknown'。
 *   这种"单次有效"语义避免了异步串扰问题。
 */
import type { LLMProvider } from './types';
import { resolveProviderType } from './types';
import type { LLMConfig } from './types';
import { ClaudeProvider } from './providers/claude';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import { DumpingProvider, type CallSceneContext } from './dumping-provider';
import { createLogger } from '../logger';

const log = createLogger('LLMRouter');

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT = 120000;

function clampTokens(v: number): number {
  return Math.max(256, Math.min(65536, v));
}

/** withScene 的可选上下文字段（scene 除外） */
export interface SceneOptions {
  requestId?: string;
  sessionId?: string;
  iteration?: number;
}

export class LLMRouter {
  /** 原始 Provider（三家 SDK 的封装，无 dump 能力） */
  private rawProvider: LLMProvider | null = null;
  /** 对外暴露的 Provider（DumpingProvider 代理） */
  private wrappedProvider: DumpingProvider | null = null;

  /**
   * 待消费的 scene 上下文。
   * withScene() 写入，consumeScene() 读取后清空。
   * 若未设置，consumeScene() 返回 'unknown' 兜底。
   */
  private pendingScene: CallSceneContext | null = null;

  constructor(config: LLMConfig) {
    this.rebuildProvider(config);
  }

  /** 获取当前 Provider（已用 DumpingProvider 包装）；未配置时返回 null */
  getProvider(): LLMProvider | null {
    return this.wrappedProvider;
  }

  /** 当前是否可用 */
  isAvailable(): boolean {
    return this.wrappedProvider !== null;
  }

  /** 当前 Provider 描述（用于日志/UI） */
  getProviderName(): string {
    if (!this.rawProvider) return '未配置';
    const type = resolveProviderType(this.rawProvider.model);
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return `${label} (${this.rawProvider.model})`;
  }

  /**
   * 为下一次 Provider 调用设置 scene 上下文。
   *
   * 返回 this 以便链式调用：
   *   router.withScene('main-chat', { requestId }).getProvider()!.streamMessage(...)
   *
   * 每次调用 Provider 方法后上下文被消费清空；未设置时 DumpingProvider
   * 会用 'unknown' 作为 scene 兜底。
   */
  withScene(scene: string, opts?: SceneOptions): this {
    this.pendingScene = {
      scene,
      requestId: opts?.requestId,
      sessionId: opts?.sessionId,
      iteration: opts?.iteration,
    };
    return this;
  }

  /** 更新配置，重建 Provider */
  updateConfig(config: LLMConfig): void {
    this.rebuildProvider(config);
  }

  // ─── 私有方法 ──────────────────────────────────────────

  private rebuildProvider(config: LLMConfig): void {
    this.rawProvider = this.createProvider(config);
    if (this.rawProvider) {
      log.info(
        `Provider 初始化: ${config.provider} (${this.rawProvider.model})`
      );
      this.wrappedProvider = new DumpingProvider(
        this.rawProvider,
        () => this.getProviderName(),
        () => this.consumeScene()
      );
    } else {
      log.warn('无可用 Provider，LLM 功能不可用');
      this.wrappedProvider = null;
    }
  }

  /** 消费 pendingScene（读取后清空），无则返回 'unknown' 兜底 */
  private consumeScene(): CallSceneContext {
    const ctx = this.pendingScene ?? { scene: 'unknown' };
    this.pendingScene = null;
    return ctx;
  }

  private createProvider(config: LLMConfig): LLMProvider | null {
    const maxTokens = clampTokens(config.maxTokens ?? DEFAULT_MAX_TOKENS);

    switch (config.provider) {
      case 'claude': {
        const c = config.claude;
        if (!c?.apiKey || !c?.model) return null;
        return new ClaudeProvider({
          apiKey: c.apiKey,
          baseURL: c.baseURL,
          model: c.model,
          maxTokens,
          timeout: DEFAULT_TIMEOUT,
        });
      }
      case 'openai': {
        const o = config.openai;
        if (!o?.apiKey || !o?.model) return null;
        return new OpenAIProvider({
          apiKey: o.apiKey,
          baseURL: o.baseURL,
          model: o.model,
          maxTokens,
          timeout: DEFAULT_TIMEOUT,
        });
      }
      case 'gemini': {
        const g = config.gemini;
        if (!g?.apiKey || !g?.model) return null;
        return new GeminiProvider({
          apiKey: g.apiKey,
          baseURL: g.baseURL,
          model: g.model,
          maxTokens,
        });
      }
      default:
        return null;
    }
  }
}
