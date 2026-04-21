import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import {
  pdfDoc, pdfLibDoc, pdfBytes, fileName, filePath,
  pages, activePageIndex, isDirty, resetState,
} from '../store/pdfState';

// ── pdf.js worker ────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

// ── postMessage 桥接（插件 iframe 内无法直接访问 electronAPI）──
let _bridgeId = 0;

function callElectronAPI<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `bridge_${++_bridgeId}_${Date.now()}`;

    function onMessage(event: MessageEvent) {
      const { __toolboxBridge, id: msgId, result, error } = event.data ?? {};
      if (!__toolboxBridge || msgId !== id) return;
      window.removeEventListener('message', onMessage);
      if (error) reject(new Error(error));
      else resolve(result as T);
    }

    window.addEventListener('message', onMessage);

    // 发送请求到父框架（Shell）
    window.parent.postMessage(
      { __toolboxBridge: true, id, method, args },
      '*'
    );

    // 超时保护 30s
    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error(`[toolbox-bridge] timeout: ${method}`));
    }, 30_000);
  });
}

// ── PDF 加载 ─────────────────────────────────────────────────

export async function loadPdfFromBuffer(buffer: ArrayBuffer, name: string): Promise<void> {
  resetState();
  fileName.value = name;

  const uint8 = new Uint8Array(buffer);
  pdfBytes.value = uint8;

  // pdf.js — 用于渲染
  const loadingTask = pdfjsLib.getDocument({ data: uint8.slice() });
  const doc = await loadingTask.promise;
  pdfDoc.value = doc;

  // pdf-lib — 用于编辑
  const libDoc = await PDFDocument.load(uint8.slice());
  pdfLibDoc.value = libDoc;

  // 初始化页面状态
  const count = doc.numPages;
  pages.value = Array.from({ length: count }, (_, i) => ({
    originalIndex: i,
    displayIndex: i + 1,
    removed: false,
  }));

  activePageIndex.value = 0;
  isDirty.value = false;
}

// ── 文件导入 ─────────────────────────────────────────────────

export async function importFromDialog(): Promise<void> {
  const result = await callElectronAPI<Electron.OpenDialogReturnValue>(
    'showOpenDialog',
    {
      title: '选择 PDF 文件',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      properties: ['openFile'],
    }
  );

  if (result.canceled || !result.filePaths.length) return;

  const srcPath = result.filePaths[0];
  const name = srcPath.split(/[\\/]/).pop() ?? 'document.pdf';

  // 读取为 base64，转换为 ArrayBuffer
  const base64 = await callElectronAPI<string>('readFile', srcPath, 'base64');
  const buffer = base64ToArrayBuffer(base64);
  await loadPdfFromBuffer(buffer, name);

  // 记录源文件路径，供"保存"直接覆盖使用
  filePath.value = srcPath;
}

export async function importFromDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;

  // Electron/Windows 下本地拖拽的 file.type 可能为空字符串，用扩展名兜底
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return;

  // 通过 Shell 桥接调用 webUtils.getPathForFile() 获取系统路径
  let srcPath = '';
  try {
    srcPath = await callElectronAPIWithFile('getPathForFile', file);
  } catch {
    // 降级：无路径时保存走另存为
  }

  const buffer = await file.arrayBuffer();
  await loadPdfFromBuffer(buffer, file.name);

  // 写入路径（有则直接保存，无则另存为）
  filePath.value = srcPath;
}

/**
 * 专用于传递 File 对象的桥接调用（通过 postMessage 的 data.file 字段传递）
 */
function callElectronAPIWithFile(method: string, file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = `bridge_${++_bridgeId}_${Date.now()}`;

    function onMessage(evt: MessageEvent) {
      const { __toolboxBridge, id: msgId, result, error } = evt.data ?? {};
      if (!__toolboxBridge || msgId !== id) return;
      window.removeEventListener('message', onMessage);
      if (error) reject(new Error(error));
      else resolve(result as string);
    }

    window.addEventListener('message', onMessage);

    window.parent.postMessage(
      { __toolboxBridge: true, id, method, file },
      '*'
    );

    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error(`[toolbox-bridge] timeout: ${method}`));
    }, 5_000);
  });
}

// ── 页面操作 ─────────────────────────────────────────────────

export function markPageRemoved(pageIndex: number): void {
  const page = pages.value[pageIndex];
  if (!page || page.removed) return;
  page.removed = true;
  isDirty.value = true;

  // 移动激活页到下一个可见页
  const visible = pages.value.filter(p => !p.removed);
  if (visible.length === 0) {
    activePageIndex.value = -1;
  } else {
    const next = visible.find(p => p.originalIndex > page.originalIndex)
      ?? visible[visible.length - 1];
    activePageIndex.value = pages.value.indexOf(next);
  }
}

// ── 导出 ─────────────────────────────────────────────────────

/** 构建编辑后的 PDF bytes（公共步骤） */
async function buildOutputBytes(): Promise<Uint8Array> {
  const freshDoc = await PDFDocument.load(pdfBytes.value!.slice());
  const removedIndices = pages.value
    .filter(p => p.removed)
    .map(p => p.originalIndex)
    .sort((a, b) => b - a);
  for (const idx of removedIndices) {
    freshDoc.removePage(idx);
  }
  return freshDoc.save();
}

/**
 * 保存成功后提交状态：
 * - 用保存后的字节更新 pdfBytes（新的"原始"状态）
 * - 重建 pages 数组：过滤掉已移除的页，重新连续编号
 * - 重置 activePageIndex 和 isDirty
 */
async function commitSave(outBytes: Uint8Array): Promise<void> {
  // 1. 更新 pdfBytes 为保存后的字节
  pdfBytes.value = outBytes;

  // 2. 重建 pages：仅保留未移除的页，originalIndex 从 0 重新连续编号
  const surviving = pages.value.filter(p => !p.removed);
  pages.value = surviving.map((_, i) => ({
    originalIndex: i,
    displayIndex: i + 1,
    removed: false,
  }));

  // 3. 同步重建 pdf-lib 实例（供下次编辑使用）
  pdfLibDoc.value = await PDFDocument.load(outBytes.slice());

  // 4. 重置选中页到合法范围
  const maxIndex = pages.value.length - 1;
  if (activePageIndex.value > maxIndex) {
    activePageIndex.value = Math.max(0, maxIndex);
  }

  // 5. 清除 dirty 标记
  isDirty.value = false;
}

/**
 * 保存：直接覆盖源文件。
 * 若无源文件路径（拖拽导入），自动降级为另存为。
 * 返回是否保存成功。
 */
export async function savePdf(): Promise<boolean> {
  if (!pdfBytes.value) return false;

  if (!filePath.value) {
    return saveAsPdf();
  }

  const outBytes = await buildOutputBytes();
  const base64 = arrayBufferToBase64(outBytes);
  await callElectronAPI<void>('writeFile', filePath.value, base64, 'base64');
  await commitSave(outBytes);
  return true;
}

/**
 * 另存为：弹出保存对话框让用户选择路径。
 * 返回是否保存成功（用户取消返回 false）。
 */
export async function saveAsPdf(): Promise<boolean> {
  if (!pdfBytes.value) return false;

  const dialogResult = await callElectronAPI<Electron.SaveDialogReturnValue>(
    'showSaveDialog',
    {
      title: '另存为',
      defaultPath: fileName.value,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    }
  );

  if (dialogResult.canceled || !dialogResult.filePath) return false;

  const outBytes = await buildOutputBytes();
  const base64 = arrayBufferToBase64(outBytes);
  await callElectronAPI<void>('writeFile', dialogResult.filePath, base64, 'base64');

  // 另存为成功后更新路径
  filePath.value = dialogResult.filePath;
  fileName.value = dialogResult.filePath.split(/[\\/]/).pop() ?? fileName.value;
  await commitSave(outBytes);
  return true;
}

// ── 工具函数 ─────────────────────────────────────────────────

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  // 大文件分块处理，避免 call stack 溢出
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
