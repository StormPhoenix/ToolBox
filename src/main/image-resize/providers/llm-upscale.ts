/**
 * TODO [V2]: 基于 LLM 的图像超分 Provider
 *
 * 实现思路：
 * 1. checkAvailability() 读取 userData/llm-config.json，检查当前 provider
 *    是否配置了 apiKey 与 model。未配置时返回
 *    { available: false, reason: '请先在设置中配置 LLM' }。
 * 2. resize() 通过主进程已有的 LLMRouter（src/main/llm/router.ts）
 *    调用多模态模型或专用超分 API，将输入 buffer 作为图片 block 传入，
 *    返回处理后的 buffer 写入 outputPath。
 * 3. 由于 LLM 处理可能耗时数十秒，需在 ResizeSuccess.warnings 中
 *    声明实际使用的模型名（如 'gpt-4o-image-upscale-v1'）。
 * 4. 错误统一抛出带 code 的 Error；外层 Router 会 catch 转为
 *    ResizeFailure 结构（LLM_NOT_CONFIGURED / LLM_API_ERROR）。
 *
 * 本版本不实例化、不 register 本 Provider。
 */
import type {
  AvailabilityCheck,
  ProviderStaticInfo,
  ResizeOptions,
  ResizeProvider,
  ResizeSuccess,
} from '../types';

export class LLMUpscaleProvider implements ResizeProvider {
  readonly info: ProviderStaticInfo = {
    id: 'llm-upscale',
    displayName: 'LLM 超分（需配置）',
    description: '使用多模态大模型进行图像超分，耗时较长',
    category: 'ai',
    supportsUpscale: true,
    supportsDownscale: false,
  };

  async checkAvailability(): Promise<AvailabilityCheck> {
    // TODO: 读取 LLM 配置并校验
    return { available: false, reason: '即将推出，本版本暂未实现' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resize(
    _inputPath: string,
    _outputPath: string,
    _options: ResizeOptions
  ): Promise<Omit<ResizeSuccess, 'tempOutputPath' | 'durationMs'>> {
    // TODO: 调用 LLMRouter 完成超分
    throw Object.assign(new Error('LLM 超分尚未实现'), {
      code: 'LLM_NOT_CONFIGURED',
    });
  }
}
