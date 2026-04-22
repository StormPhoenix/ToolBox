/**
 * ResizeRouter —— 按算法 id 路由到具体 Provider，统一错误处理与临时文件分配。
 *
 * 扩展新算法 3 步（前端零改动）：
 * 1. plugins/shared/bridge/src/types.ts 与 ./types.ts 的
 *    ResizeAlgorithmId 联合类型加入新 id
 * 2. 在 providers/ 下新增实现文件，实现 ResizeProvider 接口
 * 3. 在本文件 createDefaultRouter() 中 register 新 Provider
 */
import type {
  ResizeAlgorithmId,
  ResizeOptions,
  ResizeProvider,
  ResizeProviderInfo,
  ResizeResponse,
} from './types';
import { TempManager } from './temp-manager';
import { NearestProvider } from './providers/nearest';
import { BilinearProvider } from './providers/bilinear';
import { BicubicProvider } from './providers/bicubic';
import { LanczosProvider } from './providers/lanczos';
import { LLMUpscaleProvider } from './providers/llm-upscale';
import { createLogger } from '../logger';

const log = createLogger('ResizeRouter');

export class ResizeRouter {
  private providers = new Map<ResizeAlgorithmId, ResizeProvider>();
  private tempManager: TempManager;

  constructor(tempManager: TempManager) {
    this.tempManager = tempManager;
  }

  register(provider: ResizeProvider): void {
    this.providers.set(provider.info.id, provider);
  }

  /** 供 UI 填充下拉菜单 */
  async listProviders(): Promise<ResizeProviderInfo[]> {
    const result: ResizeProviderInfo[] = [];
    for (const p of this.providers.values()) {
      const check = await p.checkAvailability();
      result.push({
        ...p.info,
        available: check.available,
        unavailableReason: check.reason,
      });
    }
    return result;
  }

  /**
   * 端到端处理：分配输出路径 → 调用 Provider → 统一错误结构
   */
  async process(
    inputPath: string,
    options: ResizeOptions,
    sessionId: string
  ): Promise<ResizeResponse> {
    const provider = this.providers.get(options.algorithm);
    if (!provider) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: `未注册的算法: ${options.algorithm}`,
        },
      };
    }

    // 预检可用性（对 LLM 等 Provider 很关键）
    const check = await provider.checkAvailability();
    if (!check.available) {
      return {
        ok: false,
        error: {
          code: 'LLM_NOT_CONFIGURED',
          message: check.reason ?? '当前算法不可用',
        },
      };
    }

    const outputPath = await this.tempManager.allocPreviewPath(
      sessionId,
      options.outputFormat
    );

    const started = Date.now();
    try {
      const partial = await provider.resize(inputPath, outputPath, options);
      const durationMs = Date.now() - started;
      log.info(
        `resize done: ${options.algorithm} ${partial.width}x${partial.height} ` +
          `${partial.byteSize}B in ${durationMs}ms`
      );
      return {
        ...partial,
        tempOutputPath: outputPath,
        durationMs,
      };
    } catch (err) {
      const e = err as Error & { code?: string };
      const raw = e.message ?? '处理失败';
      log.warn(`resize failed: ${options.algorithm} ${raw}`);
      return {
        ok: false,
        error: {
          code: mapErrorCode(e),
          message: humanizeMessage(e),
          detail: e.stack,
        },
      };
    }
  }
}

type ResizeErrorCode =
  | 'DECODE_FAILED'
  | 'UNSUPPORTED_FORMAT'
  | 'DISK_FULL'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_API_ERROR'
  | 'UNKNOWN';

function mapErrorCode(e: Error & { code?: string }): ResizeErrorCode {
  // 简单映射：按 code / message 特征判断
  if (e.code === 'ENOSPC') return 'DISK_FULL';
  if (e.code === 'DECODE_FAILED') return 'DECODE_FAILED';
  if (e.code === 'UNSUPPORTED_FORMAT') return 'UNSUPPORTED_FORMAT';
  if (e.code === 'LLM_NOT_CONFIGURED') return 'LLM_NOT_CONFIGURED';
  if (e.code === 'LLM_API_ERROR') return 'LLM_API_ERROR';
  const msg = (e.message ?? '').toLowerCase();
  if (msg.includes('unsupported') || msg.includes('unknown format')) {
    return 'UNSUPPORTED_FORMAT';
  }
  if (msg.includes('vips') || msg.includes('decode')) return 'DECODE_FAILED';
  return 'UNKNOWN';
}

function humanizeMessage(e: Error & { code?: string }): string {
  const code = mapErrorCode(e);
  switch (code) {
    case 'DECODE_FAILED':
      return '图片解码失败，可能文件已损坏';
    case 'UNSUPPORTED_FORMAT':
      return '不支持的图片格式';
    case 'DISK_FULL':
      return '磁盘空间不足，请清理后重试';
    case 'LLM_NOT_CONFIGURED':
      return e.message || '请先在设置中配置 LLM';
    case 'LLM_API_ERROR':
      return e.message || 'LLM 调用失败';
    default:
      return e.message || '处理失败';
  }
}

/** 构造默认 Router：注册 4 个经典 Provider + LLM 骨架（当前 unavailable） */
export function createDefaultRouter(tempManager: TempManager): ResizeRouter {
  const router = new ResizeRouter(tempManager);
  router.register(new NearestProvider());
  router.register(new BilinearProvider());
  router.register(new BicubicProvider());
  router.register(new LanczosProvider());
  router.register(new LLMUpscaleProvider());
  return router;
}
