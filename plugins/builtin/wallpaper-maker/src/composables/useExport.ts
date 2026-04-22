import { ref, reactive } from 'vue';
import { electronAPI } from '@toolbox/bridge';
import { workingPresets } from './usePresets';
import { sourceImage } from './useSourceImage';
import { getCropState, computeCropRect } from './useCropState';

const STORAGE_KEY = 'wallpaper-maker.export-options';

export interface ExportOptions {
  format: 'jpg' | 'png' | 'webp';
  quality: number;   // 60–100
  outputDir: string;
}

function loadOptions(): ExportOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ExportOptions>;
      return {
        format: parsed.format ?? 'jpg',
        quality: parsed.quality ?? 85,
        outputDir: parsed.outputDir ?? '',
      };
    }
  } catch {
    // ignore
  }
  return { format: 'jpg', quality: 85, outputDir: '' };
}

export const exportOptions = reactive<ExportOptions>(loadOptions());

export function saveExportOptions(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(exportOptions));
}

export const exportProgress = reactive({ current: 0, total: 0, running: false });
export const lastOutputDir = ref('');

export async function pickOutputDir(): Promise<void> {
  const result = await electronAPI.showOpenDialog({
    title: '选择输出目录',
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    exportOptions.outputDir = result.filePaths[0];
    saveExportOptions();
  }
}

export async function runExport(): Promise<'done' | 'error'> {
  const img = sourceImage.value;
  if (!img) return 'error';
  const presets = workingPresets.value;
  if (presets.length === 0) return 'error';

  // 如果未设置输出目录，先弹窗让用户选
  if (!exportOptions.outputDir) {
    await pickOutputDir();
    if (!exportOptions.outputDir) return 'error';
  }

  exportProgress.running = true;
  exportProgress.current = 0;
  exportProgress.total = presets.length;

  try {
    for (const preset of presets) {
      const state = getCropState(preset.id);
      const { sx, sy, sw, sh } = computeCropRect(
        img.width, img.height,
        preset.width, preset.height,
        state,
      );

      const canvas = new OffscreenCanvas(preset.width, preset.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法获取 Canvas 上下文');
      ctx.drawImage(img.bitmap, sx, sy, sw, sh, 0, 0, preset.width, preset.height);

      const mimeType =
        exportOptions.format === 'png' ? 'image/png' :
        exportOptions.format === 'webp' ? 'image/webp' :
        'image/jpeg';
      const quality =
        exportOptions.format === 'png' ? undefined : exportOptions.quality / 100;

      const blob = await canvas.convertToBlob({ type: mimeType, quality });
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      // 转 base64
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);

      const ext = exportOptions.format === 'jpg' ? 'jpg' : exportOptions.format;
      const sep = exportOptions.outputDir.includes('/') ? '/' : '\\';
      const fileName = `${img.fileName}_${preset.id}.${ext}`;
      const filePath = `${exportOptions.outputDir}${sep}${fileName}`;

      await electronAPI.writeFile(filePath, base64, 'base64');
      exportProgress.current += 1;
    }

    lastOutputDir.value = exportOptions.outputDir;
    return 'done';
  } catch (e) {
    console.error('导出失败', e);
    return 'error';
  } finally {
    exportProgress.running = false;
  }
}
