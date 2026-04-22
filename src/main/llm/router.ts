/**
 * LLM Router — 多 Provider 路由 + 降级逻辑
 * 根据当前配置的 provider 字段选择 ClaudeProvider / OpenAIProvider / GeminiProvider。
 * 无可用 Provider 时 isAvailable() 返回 false，调用方应拒绝请求。
 */
import type { LLMProvider } from './types';
import { resolveProviderType } from './types';
import type { LLMConfig } from './types';
import { ClaudeProvider } from './providers/claude';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import { createLogger } from '../logger';

const log = createLogger('LLMRouter');

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT = 120000;

function clampTokens(v: number): number {
  return Math.max(256, Math.min(65536, v));
}

export class LLMRouter {
  private provider: LLMProvider | null = null;

  constructor(config: LLMConfig) {
    this.provider = this.createProvider(config);
    if (this.provider) {
      log.info(`Provider 初始化: ${config.provider} (${this.provider.model})`);
    } else {
      log.warn('无可用 Provider，LLM 功能不可用');
    }
  }

  /** 获取当前 Provider；未配置时返回 null */
  getProvider(): LLMProvider | null {
    return this.provider;
  }

  /** 当前是否可用 */
  isAvailable(): boolean {
    return this.provider !== null;
  }

  /** 当前 Provider 描述（用于日志/UI） */
  getProviderName(): string {
    if (!this.provider) return '未配置';
    const type = resolveProviderType(this.provider.model);
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return `${label} (${this.provider.model})`;
  }

  /** 更新配置，重建 Provider */
  updateConfig(config: LLMConfig): void {
    this.provider = this.createProvider(config);
    if (this.provider) {
      log.info(`Provider 已更新: ${config.provider} (${this.provider.model})`);
    } else {
      log.warn('Provider 更新后无可用配置');
    }
  }

  // ─── 私有方法 ──────────────────────────────────────────

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
