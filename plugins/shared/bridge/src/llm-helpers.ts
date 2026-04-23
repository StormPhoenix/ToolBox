/**
 * LLM 辅助工具函数
 *
 * 为插件提供图片文件 → LLMMessage 的标准化构建能力，
 * 避免各插件重复编写 MIME 推断和 block 组装逻辑。
 *
 * 典型用法：
 *   import { inferImageMediaType, buildImageMessage } from '@toolbox/bridge';
 *   import { electronAPI } from '@toolbox/bridge';
 *
 *   const mediaType = inferImageMediaType(filePath);
 *   if (!mediaType) throw new Error('不支持的图片格式');
 *
 *   const base64 = await electronAPI.readFile(filePath, 'base64');
 *   const msg = buildImageMessage(base64, mediaType, '请描述这张图片');
 *   const result = await electronAPI.llmChat([msg], { system: '你是图像分析助手' });
 */

import type { LLMMessage } from './types';

// ── MIME 类型 ──────────────────────────────────────────────────────────────

/** LLM 支持的图片 MIME 类型 */
export type ImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

/** 文件后缀 → MIME 映射表 */
const EXT_TO_MEDIA_TYPE: Record<string, ImageMediaType> = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  gif:  'image/gif',
  webp: 'image/webp',
};

/**
 * 从文件路径后缀推断 LLM 支持的图片 MIME 类型。
 * 不支持的格式返回 null（调用方应提前拦截并给用户友好提示）。
 *
 * @example
 * inferImageMediaType('/path/to/photo.jpg')  // → 'image/jpeg'
 * inferImageMediaType('/path/to/doc.pdf')    // → null
 */
export function inferImageMediaType(filePath: string): ImageMediaType | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MEDIA_TYPE[ext] ?? null;
}

// ── 消息构建 ───────────────────────────────────────────────────────────────

/**
 * 将 base64 图片数据打包为 LLMMessage（role: 'user'）。
 *
 * - 若提供 textPrompt，文本 block 排在图片 block 之前（符合主流模型偏好）。
 * - base64 字符串由调用方通过 `electronAPI.readFile(path, 'base64')` 获取。
 *
 * @param base64     图片的 base64 编码字符串（不含 data URL 前缀）
 * @param mediaType  MIME 类型，可由 inferImageMediaType() 获取
 * @param textPrompt 可选的文字提示，拼在图片前
 *
 * @example
 * const msg = buildImageMessage(base64, 'image/png', '请分析这张截图中的问题');
 * const result = await electronAPI.llmChat([msg]);
 */
export function buildImageMessage(
  base64: string,
  mediaType: ImageMediaType,
  textPrompt?: string
): LLMMessage {
  return {
    role: 'user',
    content: [
      ...(textPrompt
        ? [{ type: 'text' as const, text: textPrompt }]
        : []),
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: mediaType,
          data: base64,
        },
      },
    ],
  };
}

/**
 * 构建包含多张图片的 LLMMessage（role: 'user'）。
 *
 * 适用于需要同时分析多张图片的场景（如对比前后两张图）。
 * 各图片按数组顺序排列，文本提示放在所有图片之前。
 *
 * @param images     图片数组，每项含 base64 + mediaType
 * @param textPrompt 可选的文字提示
 */
export function buildMultiImageMessage(
  images: Array<{ base64: string; mediaType: ImageMediaType }>,
  textPrompt?: string
): LLMMessage {
  return {
    role: 'user',
    content: [
      ...(textPrompt
        ? [{ type: 'text' as const, text: textPrompt }]
        : []),
      ...images.map((img) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: img.mediaType,
          data: img.base64,
        },
      })),
    ],
  };
}
