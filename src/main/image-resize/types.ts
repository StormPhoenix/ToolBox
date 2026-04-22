/**
 * Image Resize 主进程类型定义
 *
 * 与 plugins/shared/bridge/src/types.ts 中的 Image Resize 类型保持一致；
 * 为避免主进程 tsconfig 直接依赖 bridge 源码，在此独立声明同构类型。
 */

export type ResizeAlgorithmId =
  | 'nearest'
  | 'bilinear'
  | 'bicubic'
  | 'lanczos'
  | 'llm-upscale';

export type ResizeCategory = 'classical' | 'ai';

export type ResizeOutputFormat = 'jpeg' | 'png' | 'webp' | 'avif';

export interface ResizeProviderInfo {
  id: ResizeAlgorithmId;
  displayName: string;
  description: string;
  category: ResizeCategory;
  available: boolean;
  unavailableReason?: string;
  supportsUpscale: boolean;
  supportsDownscale: boolean;
}

export interface ResizeOptions {
  algorithm: ResizeAlgorithmId;
  maxLongEdge: number;
  outputFormat: ResizeOutputFormat;
  quality?: number;
  preserveExif: boolean;
  llmOptions?: {
    model?: string;
    prompt?: string;
    scale?: 2 | 4;
  };
}

export interface ImageBasicInfo {
  filename: string;
  byteSize: number;
  format: string;
  colorSpace: string;
  width: number;
  height: number;
}

export interface ParseMetadataResult {
  sessionId: string;
  basic: ImageBasicInfo;
  exif: Record<string, unknown> | null;
  thumbnailPath: string;
}

export interface ResizeSuccess {
  ok: true;
  tempOutputPath: string;
  width: number;
  height: number;
  byteSize: number;
  format: string;
  durationMs: number;
  actualAlgorithm: ResizeAlgorithmId;
  warnings?: string[];
}

export interface ResizeFailure {
  ok: false;
  error: {
    code:
      | 'DECODE_FAILED'
      | 'UNSUPPORTED_FORMAT'
      | 'DISK_FULL'
      | 'LLM_NOT_CONFIGURED'
      | 'LLM_API_ERROR'
      | 'UNKNOWN';
    message: string;
    detail?: string;
  };
}

export type ResizeResponse = ResizeSuccess | ResizeFailure;

/** Provider 静态描述（不含运行时 available 字段） */
export type ProviderStaticInfo = Omit<ResizeProviderInfo, 'available' | 'unavailableReason'>;

/** 可用性检查结果 */
export interface AvailabilityCheck {
  available: boolean;
  reason?: string;
}

/** Resize Provider 接口 —— 新增算法只需实现此接口并在 router 中 register */
export interface ResizeProvider {
  readonly info: ProviderStaticInfo;

  /** 运行时可用性检查；本地算法恒返回 { available: true } */
  checkAvailability(): Promise<AvailabilityCheck>;

  /**
   * 核心处理方法。
   *
   * @param inputPath  原图绝对路径
   * @param outputPath 目标临时文件路径（由 Router 分配）
   * @param options    处理参数
   * @returns          成功时返回 ResizeSuccess（tempOutputPath 由 Router 填充）
   */
  resize(
    inputPath: string,
    outputPath: string,
    options: ResizeOptions
  ): Promise<Omit<ResizeSuccess, 'tempOutputPath' | 'durationMs'>>;
}

/** 允许的输入文件扩展名白名单（小写，不带点） */
export const SUPPORTED_INPUT_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif',
] as const;

export type SupportedInputExt = (typeof SUPPORTED_INPUT_EXTENSIONS)[number];
