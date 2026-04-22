/**
 * 插件会话状态管理：
 * - 导入图片 → parseImageMetadata → 保存 basic/exif/thumbnail/sessionId
 * - 生成预览 → resizeImage → 保存结果信息
 * - 另存为 → saveResizedImage
 */
import { ref, computed } from 'vue';
import { electronAPI } from '@toolbox/bridge';
import type {
  ImageBasicInfo,
  ParseMetadataResult,
  ResizeAlgorithmId,
  ResizeOptions,
  ResizeOutputFormat,
  ResizeResponse,
  ResizeSuccess,
} from '@toolbox/bridge';

export type SessionStatus = 'empty' | 'imported' | 'generating' | 'done' | 'error';

export function useImageSession() {
  const status = ref<SessionStatus>('empty');
  const errorMsg = ref<string | null>(null);
  const errorDetail = ref<string | null>(null);

  // 导入后数据
  const sourcePath = ref<string | null>(null);
  const sessionId = ref<string | null>(null);
  const basic = ref<ImageBasicInfo | null>(null);
  const exif = ref<Record<string, unknown> | null>(null);
  const thumbnailPath = ref<string | null>(null);

  // 生成后数据
  const lastResult = ref<ResizeSuccess | null>(null);
  /** 参数是否在成功生成后被修改过，用于 UI 提示"参数已修改" */
  const dirty = ref(false);

  /** 根据原图格式推导输出默认格式 */
  function defaultOutputFormat(format: string | undefined): ResizeOutputFormat {
    const f = (format ?? '').toLowerCase();
    if (f === 'png') return 'png';
    if (f === 'webp') return 'webp';
    if (f === 'avif') return 'avif';
    // gif / bmp / svg / tiff / heic 等 fallback JPEG
    return 'jpeg';
  }

  async function importFromPath(filePath: string): Promise<void> {
    status.value = 'generating'; // 借用 generating 态给 Drop Zone 一个 loading
    errorMsg.value = null;
    errorDetail.value = null;
    lastResult.value = null;
    dirty.value = false;

    try {
      const meta: ParseMetadataResult = await electronAPI.parseImageMetadata(filePath);
      sourcePath.value = filePath;
      sessionId.value = meta.sessionId;
      basic.value = meta.basic;
      exif.value = meta.exif;
      thumbnailPath.value = meta.thumbnailPath;
      status.value = 'imported';
    } catch (err) {
      const e = err as Error;
      status.value = 'error';
      errorMsg.value = e.message || '图片解析失败';
      errorDetail.value = e.stack ?? null;
    }
  }

  async function generate(
    algorithm: ResizeAlgorithmId,
    maxLongEdge: number,
    outputFormat: ResizeOutputFormat,
    quality: number
  ): Promise<void> {
    if (!sourcePath.value || !sessionId.value) return;
    status.value = 'generating';
    errorMsg.value = null;
    errorDetail.value = null;

    const options: ResizeOptions = {
      algorithm,
      maxLongEdge,
      outputFormat,
      quality,
      preserveExif: true,
    };

    try {
      const res: ResizeResponse = await electronAPI.resizeImage(
        sourcePath.value,
        options,
        sessionId.value
      );
      if (res.ok) {
        lastResult.value = res;
        dirty.value = false;
        status.value = 'done';
      } else {
        status.value = 'error';
        errorMsg.value = res.error.message;
        errorDetail.value = res.error.detail ?? null;
      }
    } catch (err) {
      const e = err as Error;
      status.value = 'error';
      errorMsg.value = e.message || '处理失败';
      errorDetail.value = e.stack ?? null;
    }
  }

  /** 另存为当前预览 */
  async function saveAs(targetPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!lastResult.value) return { ok: false, error: '没有可保存的预览' };
    return electronAPI.saveResizedImage(lastResult.value.tempOutputPath, targetPath);
  }

  function reset(): void {
    status.value = 'empty';
    errorMsg.value = null;
    errorDetail.value = null;
    sourcePath.value = null;
    sessionId.value = null;
    basic.value = null;
    exif.value = null;
    thumbnailPath.value = null;
    lastResult.value = null;
    dirty.value = false;
  }

  function markDirty(): void {
    if (status.value === 'done' || status.value === 'error') {
      dirty.value = true;
    }
  }

  /** 当前源图的最大长边（用于默认填充输入框） */
  const originalLongEdge = computed((): number => {
    if (!basic.value) return 0;
    return Math.max(basic.value.width, basic.value.height);
  });

  return {
    // 状态
    status,
    errorMsg,
    errorDetail,
    dirty,

    // 数据
    sourcePath,
    sessionId,
    basic,
    exif,
    thumbnailPath,
    lastResult,

    // 动作
    importFromPath,
    generate,
    saveAs,
    reset,
    markDirty,

    // 计算属性
    originalLongEdge,
    defaultOutputFormat,
  };
}
