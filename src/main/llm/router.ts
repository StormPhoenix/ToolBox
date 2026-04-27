/**
 * LLM Router — 多 Provider 路由 + 降级逻辑
 *
 * 根据当前配置的 provider 字段选择 ClaudeProvider / OpenAIProvider / GeminiProvider。
 * 无可用 Provider 时 isAvailable() 返回 false，调用方应拒绝请求。
 *
 * 调试 Dump 集成：
 *   getProvider(scene?, opts?) 每次返回一个新的 DumpingProvider 实例，
 *   scene 上下文在构造时绑定，并发调用之间互不干扰，天然并发安全。
 *
 * 使用示例：
 *   // 带 scene 调用（推荐）
 *   const provider = router.getProvider('main-chat', { requestId, sessionId, iteration });
 *   await provider!.streamMessage(...);
 *
 *   // 匿名调用（scene 默认为 'unknown'）
 *   const provider = router.getProvider();
 *   await provider!.createMessage(...);
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

/** getProvider 的可选 scene 上下文字段（scene 除外） */
export interface SceneOptions {
  requestId?: string;
  sessionId?: string;
  iteration?: number;
}

export class LLMRouter {
  /** 原始 Provider（三家 SDK 的封装，无 dump 能力），配置变更时重建 */
  private rawProvider: LLMProvider | null = null;

  constructor(config: LLMConfig) {
    this.rebuildProvider(config);
  }

  /**
   * 获取绑定了 scene 上下文的 DumpingProvider 实例。
   *
   * 每次调用返回一个新的轻量代理实例，scene 上下文在构造时固定，
   * 并发调用之间互不干扰。未传 scene 时默认为 'unknown'。
   */
  getProvider(scene?: string, opts?: SceneOptions): LLMProvider | null {
    if (!this.rawProvider) return null;
    const ctx: CallSceneContext = {
      scene: scene ?? 'unknown',
      requestId: opts?.requestId,
      sessionId: opts?.sessionId,
      iteration: opts?.iteration,
    };
    return new DumpingProvider(this.rawProvider, () => this.getProviderName(), ctx);
  }

  /** 当前是否可用 */
  isAvailable(): boolean {
    return this.rawProvider !== null;
  }

  /** 当前 Provider 描述（用于日志/UI） */
  getProviderName(): string {
    if (!this.rawProvider) return '未配置';
    const type = resolveProviderType(this.rawProvider.model);
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return `${label} (${this.rawProvider.model})`;
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
    } else {
      log.warn('无可用 Provider，LLM 功能不可用');
    }
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
