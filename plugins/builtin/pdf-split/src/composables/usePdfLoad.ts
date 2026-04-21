import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { electronAPI } from '@toolbox/bridge';
import { ref, computed } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).href;

// ── 共享状态 ─────────────────────────────────────────────────

export const pdfDoc = ref<PDFDocumentProxy | null>(null);
export const pdfLibDoc = ref<PDFDocument | null>(null);
export const pdfBytes = ref<Uint8Array | null>(null);
export const fileName = ref('');
export const filePath = ref('');
export const pageCount = computed(() => pdfDoc.value?.numPages ?? 0);

// ── 加载 ─────────────────────────────────────────────────────

export async function loadPdfFromBuffer(buffer: ArrayBuffer, name: string): Promise<void> {
  const uint8 = new Uint8Array(buffer);
  pdfBytes.value = uint8;
  fileName.value = name;

  const loadingTask = pdfjsLib.getDocument({ data: uint8.slice() });
  pdfDoc.value = await loadingTask.promise;

  pdfLibDoc.value = await PDFDocument.load(uint8.slice());
}

export async function importFromDialog(): Promise<void> {
  const result = await electronAPI.showOpenDialog({
    title: '选择 PDF 文件',
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths.length) return;

  const srcPath = result.filePaths[0];
  const name = srcPath.split(/[\\/]/).pop() ?? 'document.pdf';
  const base64 = await electronAPI.readFile(srcPath, 'base64');
  const buffer = base64ToArrayBuffer(base64);
  await loadPdfFromBuffer(buffer, name);
  filePath.value = srcPath;
}

export async function importFromDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return;

  let srcPath = '';
  try {
    srcPath = await electronAPI.getPathForFile(file);
  } catch {
    // 降级
  }

  const buffer = await file.arrayBuffer();
  await loadPdfFromBuffer(buffer, file.name);
  filePath.value = srcPath;
}

// ── 工具函数 ─────────────────────────────────────────────────

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

export function arrayBufferToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 从文件名中去掉 .pdf 扩展名 */
export function stripPdfExt(name: string): string {
  return name.replace(/\.pdf$/i, '');
}
