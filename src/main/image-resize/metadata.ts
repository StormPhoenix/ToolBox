/**
 * 图片元数据解析 —— sharp + exifr 组合
 *
 * - sharp.rotate().metadata() 获取视觉尺寸（纠正 Orientation 后）
 * - exifr.parse() 解析完整 EXIF（含 GPS、XMP、IPTC）
 * - sharp 生成 256px 略缩图
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
// exifr 官方支持 CJS，主进程编译为 CJS，可直接命名导入
// eslint-disable-next-line @typescript-eslint/no-var-requires
import exifr from 'exifr';
import type { ImageBasicInfo } from './types';
import { createLogger } from '../logger';

const log = createLogger('ImageResize-Meta');

const THUMBNAIL_SIZE = 256;

export interface MetadataResult {
  basic: ImageBasicInfo;
  exif: Record<string, unknown> | null;
}

/** 解析图片基本信息 + EXIF */
export async function parseMetadata(inputPath: string): Promise<MetadataResult> {
  const stat = await fs.stat(inputPath);

  // 使用 rotate() 让 sharp 按 EXIF Orientation 返回视觉尺寸
  const meta = await sharp(inputPath).rotate().metadata();

  const basic: ImageBasicInfo = {
    filename: path.basename(inputPath),
    byteSize: stat.size,
    format: meta.format ?? 'unknown',
    colorSpace: meta.space ?? 'unknown',
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };

  let exif: Record<string, unknown> | null = null;
  try {
    const parsed = await exifr.parse(inputPath, {
      gps: true,
      xmp: true,
      iptc: true,
      icc: false,
      tiff: true,
      exif: true,
    });
    exif = parsed ?? null;
  } catch (err) {
    log.warn(`EXIF 解析失败 ${basic.filename}: ${(err as Error).message}`);
    exif = null;
  }

  return { basic, exif };
}

/** 生成 256px 略缩图（JPEG，q=80），写入 outputPath，返回该路径 */
export async function generateThumbnail(
  inputPath: string,
  outputPath: string
): Promise<string> {
  await sharp(inputPath)
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toFile(outputPath);
  return outputPath;
}
