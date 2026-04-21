import * as pdfjsLib from 'pdfjs-dist';
import { electronAPI } from '@toolbox/bridge';
import { ref } from 'vue';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).href;

// ── 类型 ─────────────────────────────────────────────────────

export interface PdfFileItem {
  /** 唯一 id，用于 SortableJS key */
  id: string;
  /** 系统文件路径 */
  filePath: string;
  /** 显示文件名 */
  fileName: string;
  /** 总页数 */
  pageCount: number;
  /** 起始页（1-based，含） */
  startPage: number;
  /** 终止页（1-based，含） */
  endPage: number;
  /** 原始文件字节，供合并使用 */
  bytes: Uint8Array;
}

// ── 状态 ─────────────────────────────────────────────────────

export const fileItems = ref<PdfFileItem[]>([]);

let _idCounter = 0;
function genId(): string {
  return `pdf-${++_idCounter}`;
}

// ── 操作 ─────────────────────────────────────────────────────

/** 通过系统路径加载 PDF 并追加到列表 */
async function loadFromPath(filePath: string): Promise<void> {
  const fileName = filePath.split(/[\\/]/).pop() ?? 'document.pdf';
  const base64 = await electronAPI.readFile(filePath, 'base64');
  const bytes = base64ToUint8Array(base64);

  const task = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const pageCount = doc.numPages;
  doc.destroy();

  fileItems.value.push({
    id: genId(),
    filePath,
    fileName,
    pageCount,
    startPage: 1,
    endPage: pageCount,
    bytes,
  });
}

/** 打开对话框批量导入 PDF */
export async function importFromDialog(): Promise<void> {
  const result = await electronAPI.showOpenDialog({
    title: '选择 PDF 文件',
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return;

  for (const p of result.filePaths) {
    await loadFromPath(p);
  }
}

/** 拖拽导入（支持多文件） */
export async function importFromDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files ?? []).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  for (const file of files) {
    let srcPath = '';
    try {
      srcPath = await electronAPI.getPathForFile(file);
    } catch {
      // 降级：直接读取 file 对象
    }

    if (srcPath) {
      await loadFromPath(srcPath);
    } else {
      // 无法获取系统路径时，直接从 File 对象读取
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const task = pdfjsLib.getDocument({ data: bytes.slice() });
      const doc = await task.promise;
      const pageCount = doc.numPages;
      doc.destroy();
      fileItems.value.push({
        id: genId(),
        filePath: '',
        fileName: file.name,
        pageCount,
        startPage: 1,
        endPage: pageCount,
        bytes,
      });
    }
  }
}

/** 删除指定文件 */
export function removeFile(id: string): void {
  const idx = fileItems.value.findIndex((f) => f.id === id);
  if (idx !== -1) fileItems.value.splice(idx, 1);
}

/** 清空列表 */
export function clearFiles(): void {
  fileItems.value = [];
}

// ── 页码范围校验 ──────────────────────────────────────────────

/** 返回某条目页码范围是否合法 */
export function isRangeValid(item: PdfFileItem): boolean {
  const { startPage, endPage, pageCount } = item;
  return (
    Number.isInteger(startPage) &&
    Number.isInteger(endPage) &&
    startPage >= 1 &&
    endPage >= startPage &&
    endPage <= pageCount
  );
}

/** 整个列表是否可以执行合并 */
export function canMerge(): boolean {
  return fileItems.value.length >= 2 && fileItems.value.every(isRangeValid);
}

// ── 工具函数 ─────────────────────────────────────────────────

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
