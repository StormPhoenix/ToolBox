/**
 * Chat 图片缓存层
 *
 * 核心职责：
 * 1. 把用户上传的 base64 图片经 sharp 压缩后写盘到 userData/chat-images/
 * 2. 以"压缩后内容 MD5"作为文件名，天然去重（同图重发只占 1 份磁盘）
 * 3. 提供从 imageRef 还原 base64 的 loader（供 chat-engine 发送给 LLM 时使用）
 * 4. 启动时清理不被任何会话引用的孤儿文件
 *
 * 设计要点：
 * - 压缩阈值：最长边 > 1568px 等比缩小（`fit: inside`）
 *     · JPEG → 输出 JPEG（质量 85）
 *     · PNG / WEBP → 输出 PNG（sharp 自动压缩）
 *     · GIF → 不压缩、原样落盘（避免丢动画帧）
 * - hash 基于"落盘后 buffer"计算，保证幂等去重
 * - 文件名严格匹配正则 `^[a-f0-9]{32}\.(png|jpe?g|gif|webp)$`，便于 protocol 校验
 * - 所有对外暴露的 imageRef 只含纯数据字段（可 JSON.stringify，无响应式代理问题）
 */
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { createLogger } from '../logger';
import type { ChatMessage, ChatSession } from './types';

const log = createLogger('ImageCache');

const IMAGES_DIRNAME = 'chat-images';
const SESSIONS_DIRNAME = 'chat-sessions';

/** 压缩阈值：最长边像素 */
const MAX_DIMENSION = 1568;
/** JPEG 质量 */
const JPEG_QUALITY = 85;

export type SupportedMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

/** 持久化图片引用块（替换 LLMImageBlock 存盘） */
export interface LLMImageRefBlock {
  type: 'image_ref';
  /** 缓存文件绝对路径 */
  cachePath: string;
  /** MD5 hash（即文件名 stem），UI 构造 toolbox-img://<hash>.<ext> 用 */
  hash: string;
  /** 最终落盘的 MIME 类型（可能因压缩变化，如 WEBP → PNG） */
  mediaType: SupportedMediaType;
  /** 原始文件名（仅展示） */
  fileName: string;
  /** 落盘字节数（仅辅助展示） */
  byteSize: number;
  /** 图像宽度（像素） */
  width?: number;
  /** 图像高度（像素） */
  height?: number;
}

// ─── 路径工具 ──────────────────────────────────────────────

function getImagesDir(): string {
  return path.join(app.getPath('userData'), IMAGES_DIRNAME);
}

function getSessionsDir(): string {
  return path.join(app.getPath('userData'), SESSIONS_DIRNAME);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getImagesDir(), { recursive: true });
}

/** 合法文件名正则（也被 image-protocol 共用） */
export const CACHE_FILENAME_REGEX = /^[a-f0-9]{32}\.(png|jpe?g|gif|webp)$/;

function mediaTypeToExt(mt: SupportedMediaType): 'png' | 'jpg' | 'gif' | 'webp' {
  switch (mt) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
  }
}

/** 根据 hash + mediaType 拼出缓存文件路径 */
export function buildCachePath(hash: string, mediaType: SupportedMediaType): string {
  return path.join(getImagesDir(), `${hash}.${mediaTypeToExt(mediaType)}`);
}

// ─── 压缩管线 ──────────────────────────────────────────────

interface CompressResult {
  buffer: Buffer;
  mediaType: SupportedMediaType;
  width?: number;
  height?: number;
}

/**
 * 压缩输入图片到最长边 ≤ 1568px。
 * 返回最终要落盘的 buffer + mediaType（可能与输入不同）。
 *
 * - 源为 GIF：**原样返回**（避免丢帧）
 * - 源为 JPEG：输出 JPEG（质量 85）
 * - 源为 PNG / WEBP：输出 PNG（对 LLM 视觉效果等价，保留无损语义）
 */
async function compress(
  inputBuffer: Buffer,
  sourceMediaType: SupportedMediaType
): Promise<CompressResult> {
  // GIF 直通，避免 sharp 默认只读第一帧导致丢失动画
  if (sourceMediaType === 'image/gif') {
    return { buffer: inputBuffer, mediaType: 'image/gif' };
  }

  const pipeline = sharp(inputBuffer, { failOn: 'error' });
  const meta = await pipeline.metadata();

  const longestSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  const needResize = longestSide > MAX_DIMENSION;

  let working = pipeline.rotate(); // 自动纠正 EXIF 方向
  if (needResize) {
    working = working.resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let buffer: Buffer;
  let outMediaType: SupportedMediaType;
  if (sourceMediaType === 'image/jpeg') {
    buffer = await working.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    outMediaType = 'image/jpeg';
  } else {
    // PNG / WEBP 输出 PNG
    buffer = await working.png({ compressionLevel: 9 }).toBuffer();
    outMediaType = 'image/png';
  }

  // 重新读一次得到最终尺寸（resize 后 meta 会变）
  const outMeta = await sharp(buffer).metadata();
  return {
    buffer,
    mediaType: outMediaType,
    width: outMeta.width,
    height: outMeta.height,
  };
}

// ─── 对外接口：附件 → imageRef ────────────────────────────

export interface StoreImageInput {
  /** 用户原始文件名（仅展示） */
  fileName: string;
  /** 原始 MIME */
  mediaType: SupportedMediaType;
  /** 原始 base64（不含 data URL 前缀） */
  base64: string;
}

/**
 * 压缩并落盘一张图片，返回 imageRef。
 * 若 hash 碰撞（同图已存在）则直接复用已有文件。
 */
export async function storeImage(input: StoreImageInput): Promise<LLMImageRefBlock> {
  await ensureDir();

  const rawBuffer = Buffer.from(input.base64, 'base64');
  const compressed = await compress(rawBuffer, input.mediaType);

  const hash = createHash('md5').update(compressed.buffer).digest('hex');
  const cachePath = buildCachePath(hash, compressed.mediaType);

  // 已存在则跳过写入
  try {
    await fs.access(cachePath);
    log.info(
      `storeImage 命中缓存: hash=${hash}, name=${input.fileName}, bytes=${compressed.buffer.length}`
    );
  } catch {
    await fs.writeFile(cachePath, compressed.buffer);
    log.info(
      `storeImage 新增: hash=${hash}, name=${input.fileName}, ` +
        `bytes=${compressed.buffer.length}, ${compressed.width}x${compressed.height}`
    );
  }

  return {
    type: 'image_ref',
    cachePath,
    hash,
    mediaType: compressed.mediaType,
    fileName: input.fileName,
    byteSize: compressed.buffer.length,
    width: compressed.width,
    height: compressed.height,
  };
}

/**
 * 从 imageRef 读取 buffer 并返回 base64（供发送给 LLM 使用）。
 * 文件丢失时返回 null（chat-engine 会降级为文本占位）。
 */
export async function loadImageBase64(
  ref: LLMImageRefBlock
): Promise<string | null> {
  try {
    const buffer = await fs.readFile(ref.cachePath);
    return buffer.toString('base64');
  } catch (err) {
    log.warn(`loadImageBase64 失败: ${ref.cachePath} — ${(err as Error).message}`);
    return null;
  }
}

// ─── 启动清理：删除孤儿文件 ────────────────────────────────

/**
 * 扫描 chat-images/ 中所有 md5 文件，对比 chat-sessions/ 中引用的 hash，
 * 未被任何会话引用的文件直接删除。
 */
export async function cleanOrphanImages(): Promise<void> {
  const imagesDir = getImagesDir();
  const sessionsDir = getSessionsDir();

  // 图片目录可能不存在
  let files: string[];
  try {
    files = await fs.readdir(imagesDir);
  } catch {
    return;
  }

  // 收集全部被引用的 hash
  const referenced = new Set<string>();
  try {
    const sessionFiles = await fs.readdir(sessionsDir);
    for (const f of sessionFiles) {
      if (!f.endsWith('.json') || f === 'index.json') continue;
      try {
        const raw = await fs.readFile(path.join(sessionsDir, f), 'utf-8');
        const session = JSON.parse(raw) as ChatSession;
        for (const msg of session.messages || []) {
          collectHashesFromMessage(msg, referenced);
        }
      } catch {
        /* 单个文件损坏忽略 */
      }
    }
  } catch {
    /* sessions 目录不存在 → 所有图都是孤儿 */
  }

  let deleted = 0;
  for (const name of files) {
    if (!CACHE_FILENAME_REGEX.test(name)) continue;
    const hash = name.split('.')[0];
    if (referenced.has(hash)) continue;
    try {
      await fs.unlink(path.join(imagesDir, name));
      deleted++;
    } catch {
      /* 忽略 */
    }
  }
  if (deleted > 0) {
    log.info(`cleanOrphanImages 清理孤儿图片: ${deleted} 个`);
  }
}

function collectHashesFromMessage(msg: ChatMessage, out: Set<string>): void {
  if (typeof msg.content === 'string') return;
  for (const b of msg.content) {
    if (
      typeof b === 'object' &&
      b !== null &&
      (b as { type: string }).type === 'image_ref'
    ) {
      const ref = b as unknown as LLMImageRefBlock;
      if (ref.hash) out.add(ref.hash);
    }
  }
}

/** 供 protocol handler 使用：校验文件名合法并返回绝对路径，非法返回 null */
export function resolveCachedImagePath(filename: string): string | null {
  if (!CACHE_FILENAME_REGEX.test(filename)) return null;
  const absolute = path.join(getImagesDir(), filename);
  // 再次防御：确保仍在 imagesDir 之内
  const base = getImagesDir() + path.sep;
  if (!absolute.startsWith(base)) return null;
  return absolute;
}
