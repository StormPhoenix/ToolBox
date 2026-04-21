import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PageSizes } from 'pdf-lib';
import { createLogger, electronAPI } from '@toolbox/bridge';
import {
  pdfDoc, pdfLibDoc, pdfBytes, fileName, filePath,
  pages, activePageIndex, isDirty, resetState, recalcDisplayIndex,
} from '../store/pdfState';
import type { PageState, ImageSizeMode } from '../store/pdfState';
import type { InsertPosition, InsertType } from '../components/ContextMenu.vue';

const log = createLogger('pdf-editor');

// ── pdf.js worker ────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

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
    kind: 'original' as const,
    originalIndex: i,
    displayIndex: i + 1,
    removed: false,
  }));

  activePageIndex.value = 0;
  isDirty.value = false;
}

// ── 文件导入 ─────────────────────────────────────────────────

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
    // 降级：无路径时保存走另存为
  }

  const buffer = await file.arrayBuffer();
  await loadPdfFromBuffer(buffer, file.name);

  filePath.value = srcPath;
  log.info(`ImportFromDrop: ${srcPath}`);
}

// ── 页面操作 ─────────────────────────────────────────────────

export function markPageRemoved(pageIndex: number): void {
  const page = pages.value[pageIndex];
  if (!page || page.removed) return;
  page.removed = true;
  isDirty.value = true;
  recalcDisplayIndex();

  // 移动激活页到下一个可见页
  const visible = pages.value.filter(p => !p.removed);
  if (visible.length === 0) {
    activePageIndex.value = -1;
  } else {
    const refIdx = page.kind === 'original' ? page.originalIndex : pageIndex;
    const next = visible.find(p => pages.value.indexOf(p) > pageIndex)
      ?? visible[visible.length - 1];
    activePageIndex.value = pages.value.indexOf(next);
    void refIdx;
  }
}

/**
 * 撤销针对指定页的修改：
 * - 若为原始页且已标记删除 → 恢复
 * - 若为插入页 → 从 pages 中移除
 */
export function revertPage(pageIndex: number): void {
  const page = pages.value[pageIndex];
  if (!page) return;

  if (page.kind === 'original') {
    // 撤销删除
    page.removed = false;
  } else {
    // 撤销插入：释放 objectUrl 资源
    if (page.kind === 'image') {
      URL.revokeObjectURL(page.objectUrl);
    }
    pages.value.splice(pageIndex, 1);
    // 校正 activePageIndex
    if (activePageIndex.value >= pages.value.length) {
      activePageIndex.value = Math.max(0, pages.value.length - 1);
    }
  }

  recalcDisplayIndex();
  isDirty.value = pages.value.some(p => p.removed || p.kind !== 'original');
}

/** 撤销所有修改，恢复到初始状态 */
export function revertAll(): void {
  // 释放图片 objectUrl
  for (const p of pages.value) {
    if (p.kind === 'image') URL.revokeObjectURL(p.objectUrl);
  }
  // 保留所有原始页，移除所有插入页
  pages.value = pages.value
    .filter(p => p.kind === 'original')
    .map((p, i) => ({ ...p, removed: false, displayIndex: i + 1 }));

  activePageIndex.value = 0;
  isDirty.value = false;
}

/**
 * 在指定位置插入页面
 * @param pageIndex  右键菜单触发的页在 pages 中的下标
 * @param position   'before' | 'after'
 * @param newPage    新页的 PageState（不含 displayIndex，由本函数计算）
 */
export function insertPage(
  pageIndex: number,
  position: InsertPosition,
  newPage: Omit<PageState, 'displayIndex' | 'removed'>,
): void {
  const insertAt = position === 'before' ? pageIndex : pageIndex + 1;
  const entry: PageState = { ...newPage, displayIndex: 0, removed: false } as PageState;
  pages.value.splice(insertAt, 0, entry);
  recalcDisplayIndex();
  isDirty.value = true;
  // 激活新插入的页
  activePageIndex.value = insertAt;
}

/** 获取插入空白页时参考的相邻页尺寸（单位：pt） */
export async function getNeighborPageSize(
  pageIndex: number,
  position: InsertPosition,
): Promise<[number, number]> {
  if (!pdfDoc.value) return PageSizes.A4;

  const neighborIdx = position === 'before' ? pageIndex - 1 : pageIndex;
  // 找邻近的原始页
  let refPage: PageState | undefined;
  if (neighborIdx >= 0 && neighborIdx < pages.value.length) {
    refPage = pages.value.slice(0, neighborIdx + 1).reverse().find(p => p.kind === 'original' && !p.removed);
  }
  if (!refPage) {
    refPage = pages.value.find(p => p.kind === 'original' && !p.removed);
  }
  if (!refPage || refPage.kind !== 'original') return PageSizes.A4;

  const page = await pdfDoc.value.getPage(refPage.originalIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  return [vp.width, vp.height];
}

// ── 导出 ─────────────────────────────────────────────────────

/** 构建编辑后的 PDF bytes（核心逻辑） */
async function buildOutputBytes(): Promise<Uint8Array> {
  const freshDoc = await PDFDocument.load(pdfBytes.value!.slice());

  // 第一步：收集原始页的最终顺序（考虑删除、插入）
  // pages 数组已经代表最终的页面顺序
  const outputDoc = await PDFDocument.create();

  for (const page of pages.value) {
    if (page.removed) continue;

    if (page.kind === 'original') {
      // 从原始文档 copy 页面
      const [copied] = await outputDoc.copyPages(freshDoc, [page.originalIndex]);
      outputDoc.addPage(copied);

    } else if (page.kind === 'blank') {
      // 空白页：参考相邻页尺寸（此处用 A4 兜底，实际尺寸在 insertPage 时已传入 sizeMode，
      // 但 blank 不存储尺寸，统一在 buildOutputBytes 时用 A4）
      outputDoc.addPage(PageSizes.A4);

    } else if (page.kind === 'image') {
      // 图片页
      const imgBytes = await page.file.arrayBuffer();
      const isJpeg = page.file.type === 'image/jpeg' || page.file.name.toLowerCase().endsWith('.jpg') || page.file.name.toLowerCase().endsWith('.jpeg');
      const embeddedImg = isJpeg
        ? await outputDoc.embedJpg(imgBytes)
        : await outputDoc.embedPng(imgBytes);

      let pageWidth: number;
      let pageHeight: number;

      if (page.sizeMode === 'a4') {
        [pageWidth, pageHeight] = PageSizes.A4;
      } else if (page.sizeMode === 'fit-image') {
        pageWidth = embeddedImg.width;
        pageHeight = embeddedImg.height;
      } else {
        // match-neighbor：从 blank placeholder 获取尺寸，此处用图片原始尺寸兜底
        pageWidth = embeddedImg.width;
        pageHeight = embeddedImg.height;
      }

      const newPage = outputDoc.addPage([pageWidth, pageHeight]);
      newPage.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });

    } else if (page.kind === 'pdf') {
      // PDF 页
      const srcDoc = await PDFDocument.load(page.sourceBytes.slice());
      const copied = await outputDoc.copyPages(srcDoc, page.sourcePageIndices);
      for (const cp of copied) outputDoc.addPage(cp);
    }
  }

  return outputDoc.save();
}

/**
 * 保存成功后提交状态
 */
async function commitSave(outBytes: Uint8Array): Promise<void> {
  // 释放图片 objectUrl
  for (const p of pages.value) {
    if (p.kind === 'image') URL.revokeObjectURL(p.objectUrl);
  }

  pdfBytes.value = outBytes;

  const surviving = pages.value.filter(p => !p.removed);
  pages.value = surviving.map((_, i) => ({
    kind: 'original' as const,
    originalIndex: i,
    displayIndex: i + 1,
    removed: false,
  }));

  pdfLibDoc.value = await PDFDocument.load(outBytes.slice());

  const loadingTask = pdfjsLib.getDocument({ data: outBytes.slice() });
  pdfDoc.value = await loadingTask.promise;

  const maxIndex = pages.value.length - 1;
  if (activePageIndex.value > maxIndex) {
    activePageIndex.value = Math.max(0, maxIndex);
  }

  isDirty.value = false;
}

export async function savePdf(): Promise<boolean> {
  if (!pdfBytes.value) return false;
  if (!filePath.value) return saveAsPdf();

  const outBytes = await buildOutputBytes();
  const base64 = arrayBufferToBase64(outBytes);
  await electronAPI.writeFile(filePath.value, base64, 'base64');
  await commitSave(outBytes);
  return true;
}

export async function saveAsPdf(): Promise<boolean> {
  if (!pdfBytes.value) return false;

  const dialogResult = await electronAPI.showSaveDialog({
    title: '另存为',
    defaultPath: fileName.value,
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
  });

  if (dialogResult.canceled || !dialogResult.filePath) return false;

  const outBytes = await buildOutputBytes();
  const base64 = arrayBufferToBase64(outBytes);
  await electronAPI.writeFile(dialogResult.filePath, base64, 'base64');

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
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 读取图片文件的原始尺寸（px）→ 返回 [width, height] */
export function getImageNaturalSize(file: File): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve([img.naturalWidth, img.naturalHeight]);
      URL.revokeObjectURL(url);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** 将像素尺寸转为 PDF pt（72dpi 基准） */
export function pxToPt(px: number): number {
  return (px / 96) * 72;
}

/** 辅助：读取插入用的 PDF 文件字节 */
export async function readInsertPdfFile(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/** 辅助：通过 dialog 选择图片文件 */
export async function pickImageFile(): Promise<File | null> {
  const result = await electronAPI.showOpenDialog({
    title: '选择图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const imgPath = result.filePaths[0];
  const base64 = await electronAPI.readFile(imgPath, 'base64');
  const binary = atob(base64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  const name = imgPath.split(/[\\/]/).pop() ?? 'image.png';
  const ext = name.split('.').pop()?.toLowerCase() ?? 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new File([buf], name, { type: mime });
}

/** 辅助：通过 dialog 选择要插入的 PDF 文件，返回字节和文件名 */
export async function pickInsertPdfFile(): Promise<{ bytes: Uint8Array; name: string } | null> {
  const result = await electronAPI.showOpenDialog({
    title: '选择要插入的 PDF',
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const pdfPath = result.filePaths[0];
  const base64 = await electronAPI.readFile(pdfPath, 'base64');
  const buffer = base64ToArrayBuffer(base64);
  const name = pdfPath.split(/[\\/]/).pop() ?? 'insert.pdf';
  return { bytes: new Uint8Array(buffer), name };
}

export type { InsertPosition, InsertType, ImageSizeMode };
