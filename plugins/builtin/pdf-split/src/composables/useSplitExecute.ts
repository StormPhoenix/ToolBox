import { ref } from 'vue';
import { PDFDocument } from 'pdf-lib';
import { electronAPI } from '@toolbox/bridge';
import { pdfBytes, fileName, stripPdfExt, arrayBufferToBase64 } from './usePdfLoad';
import { resolveFileName } from './useSplitCustom';
import type { SplitSegment } from './useSplitCustom';

export type SplitStatus = 'idle' | 'running' | 'done' | 'error';

export const splitStatus = ref<SplitStatus>('idle');
export const splitProgress = ref({ current: 0, total: 0 });
export const splitError = ref('');
export const lastOutputDir = ref('');

/** 执行拆分：segments 已经是平均或自定义模式下的最终列表 */
export async function executeSplit(segments: SplitSegment[]): Promise<boolean> {
  if (!pdfBytes.value || segments.length === 0) return false;

  // 1. 弹出目录选择
  const dirResult = await electronAPI.showOpenDialog({
    title: '选择输出目录',
    properties: ['openDirectory'],
  });
  if (dirResult.canceled || !dirResult.filePaths.length) return false;

  const outputDir = dirResult.filePaths[0];
  lastOutputDir.value = outputDir;

  // 2. 逐段生成文件
  splitStatus.value = 'running';
  splitProgress.value = { current: 0, total: segments.length };
  splitError.value = '';

  try {
    const srcBytes = pdfBytes.value.slice();
    const fileBase = stripPdfExt(fileName.value);
    const sep = outputDir.includes('/') ? '/' : '\\';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const outDoc = await PDFDocument.create();
      const srcDoc = await PDFDocument.load(srcBytes);

      // pdf-lib 页码 0-based，segment 是 1-based
      const indices = Array.from(
        { length: seg.end - seg.start + 1 },
        (_, k) => seg.start - 1 + k,
      );

      const copied = await outDoc.copyPages(srcDoc, indices);
      for (const p of copied) outDoc.addPage(p);

      const outBytes = await outDoc.save();
      const base64 = arrayBufferToBase64(outBytes);
      const outFileName = resolveFileName(fileBase, seg);
      const outPath = `${outputDir}${sep}${outFileName}`;
      await electronAPI.writeFile(outPath, base64, 'base64');

      splitProgress.value = { current: i + 1, total: segments.length };
    }

    splitStatus.value = 'done';
    return true;
  } catch (e: unknown) {
    splitError.value = e instanceof Error ? e.message : '未知错误';
    splitStatus.value = 'error';
    return false;
  }
}

export function resetSplitStatus(): void {
  splitStatus.value = 'idle';
  splitProgress.value = { current: 0, total: 0 };
  splitError.value = '';
}
