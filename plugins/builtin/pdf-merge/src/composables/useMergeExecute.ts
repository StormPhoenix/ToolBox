import { ref } from 'vue';
import { PDFDocument } from 'pdf-lib';
import { electronAPI } from '@toolbox/bridge';
import { fileItems, uint8ArrayToBase64 } from './usePdfFiles';

// ── 状态 ─────────────────────────────────────────────────────

export type MergeStatus = 'idle' | 'running' | 'done' | 'error';

export const mergeStatus = ref<MergeStatus>('idle');
export const mergeError = ref('');
export const lastOutputPath = ref('');

// ── 执行 ─────────────────────────────────────────────────────

/**
 * 按当前 fileItems 列表顺序和页码范围合并 PDF，弹出保存对话框
 * @returns 'saved' 成功保存，'canceled' 用户取消，'error' 出错
 */
export async function executeMerge(): Promise<'saved' | 'canceled' | 'error'> {
  mergeStatus.value = 'running';
  mergeError.value = '';

  // 1. 弹出保存路径选择
  const saveResult = await electronAPI.showSaveDialog({
    title: '保存合并后的 PDF',
    defaultPath: 'merged.pdf',
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    mergeStatus.value = 'idle';
    return 'canceled';
  }

  const outputPath = saveResult.filePath.endsWith('.pdf')
    ? saveResult.filePath
    : saveResult.filePath + '.pdf';

  // 2. 合并
  try {
    const outDoc = await PDFDocument.create();

    for (const item of fileItems.value) {
      const srcDoc = await PDFDocument.load(item.bytes.slice());
      // pdf-lib 页码 0-based，item 是 1-based
      const indices = Array.from(
        { length: item.endPage - item.startPage + 1 },
        (_, k) => item.startPage - 1 + k,
      );
      const copied = await outDoc.copyPages(srcDoc, indices);
      for (const page of copied) outDoc.addPage(page);
    }

    const outBytes = await outDoc.save();
    const base64 = uint8ArrayToBase64(outBytes);
    await electronAPI.writeFile(outputPath, base64, 'base64');

    lastOutputPath.value = outputPath;
    mergeStatus.value = 'done';
    return 'saved';
  } catch (e: unknown) {
    mergeError.value = e instanceof Error ? e.message : '未知错误';
    mergeStatus.value = 'error';
    return 'error';
  }
}

export function resetMergeStatus(): void {
  mergeStatus.value = 'idle';
  mergeError.value = '';
}
