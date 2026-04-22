/**
 * 经典缩放算法的共用实现基础：基于 sharp 的统一处理管线
 *
 * 新增经典算法 Provider 只需 extends 本类，在构造函数中传入不同的 info +
 * sharp kernel 值即可。
 */
import * as fs from 'fs/promises';
import sharp from 'sharp';
import type {
  AvailabilityCheck,
  ProviderStaticInfo,
  ResizeOptions,
  ResizeProvider,
  ResizeSuccess,
} from '../types';

export type SharpKernel = 'nearest' | 'cubic' | 'lanczos2' | 'lanczos3' | 'mitchell';

export abstract class SharpResizeProvider implements ResizeProvider {
  readonly info: ProviderStaticInfo;
  private readonly kernel: SharpKernel;
  private readonly extraWarning?: string;

  protected constructor(
    info: ProviderStaticInfo,
    kernel: SharpKernel,
    extraWarning?: string
  ) {
    this.info = info;
    this.kernel = kernel;
    this.extraWarning = extraWarning;
  }

  async checkAvailability(): Promise<AvailabilityCheck> {
    return { available: true };
  }

  async resize(
    inputPath: string,
    outputPath: string,
    options: ResizeOptions
  ): Promise<Omit<ResizeSuccess, 'tempOutputPath' | 'durationMs'>> {
    // 用 rotate() 获取视觉尺寸，按最大长边等比计算目标宽高
    const meta = await sharp(inputPath).rotate().metadata();
    const origW = meta.width ?? 0;
    const origH = meta.height ?? 0;
    if (origW === 0 || origH === 0) {
      throw Object.assign(new Error('无法获取图片尺寸'), { code: 'DECODE_FAILED' });
    }

    const longEdge = Math.max(origW, origH);
    const ratio = options.maxLongEdge / longEdge;
    const targetW = Math.max(1, Math.round(origW * ratio));
    const targetH = Math.max(1, Math.round(origH * ratio));

    let pipeline = sharp(inputPath)
      .rotate() // 自动应用 EXIF Orientation
      .resize(targetW, targetH, {
        kernel: this.kernel,
        fit: 'inside',
        withoutEnlargement: false, // 允许放大（自动判断）
      });

    // 按格式编码
    pipeline = applyFormat(pipeline, options);

    // 保留 EXIF（V1 恒为 true）
    if (options.preserveExif) {
      pipeline = pipeline.withMetadata();
    }

    await pipeline.toFile(outputPath);

    const stat = await fs.stat(outputPath);
    const warnings: string[] = [];
    if (this.extraWarning) warnings.push(this.extraWarning);

    return {
      ok: true,
      width: targetW,
      height: targetH,
      byteSize: stat.size,
      format: options.outputFormat,
      actualAlgorithm: this.info.id,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

function applyFormat(
  pipeline: sharp.Sharp,
  options: ResizeOptions
): sharp.Sharp {
  const q = options.quality ?? 85;
  switch (options.outputFormat) {
    case 'jpeg':
      return pipeline.jpeg({ quality: q, mozjpeg: true });
    case 'png':
      return pipeline.png({ compressionLevel: 9 });
    case 'webp':
      return pipeline.webp({ quality: q });
    case 'avif':
      return pipeline.avif({ quality: q });
    default:
      return pipeline;
  }
}
