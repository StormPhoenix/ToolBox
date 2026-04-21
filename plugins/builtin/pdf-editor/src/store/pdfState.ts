import { ref, computed, shallowRef } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFDocument } from 'pdf-lib';

// ── 页面类型 ──────────────────────────────────────────────────

export type PageKind =
  | { kind: 'original'; originalIndex: number }
  | { kind: 'blank' }
  | { kind: 'image'; file: File; objectUrl: string; sizeMode: ImageSizeMode }
  | { kind: 'pdf'; sourceBytes: Uint8Array; sourcePageIndices: number[] };

/** 插入图片时的页面尺寸模式 */
export type ImageSizeMode = 'a4' | 'fit-image' | 'match-neighbor';

export interface PageState extends PageKind {
  /** 当前显示序号（1-based，随删除/插入动态变化） */
  displayIndex: number;
  /** 是否已被标记删除（内存中，未导出） */
  removed: boolean;
}

// ── 全局状态 ──────────────────────────────────────────────────

/** pdf.js 文档实例（只读渲染） */
export const pdfDoc = shallowRef<PDFDocumentProxy | null>(null);
/** pdf-lib 文档实例（编辑操作） */
export const pdfLibDoc = shallowRef<PDFDocument | null>(null);

/** 原始文件 ArrayBuffer（用于重新加载 pdf-lib） */
export const pdfBytes = ref<Uint8Array | null>(null);
/** 当前打开的文件名（仅文件名，不含路径） */
export const fileName = ref<string>('');
/** 当前打开的文件完整路径（对话框导入时记录，拖拽导入时为空） */
export const filePath = ref<string>('');
/** 页面状态列表 */
export const pages = ref<PageState[]>([]);
/** 当前选中的页面索引（在 pages 中的下标） */
export const activePageIndex = ref<number>(0);
/** 是否有未保存的修改 */
export const isDirty = ref<boolean>(false);

/** 当前可见的页面（未被移除） */
export const visiblePages = computed(() =>
  pages.value.filter(p => !p.removed)
);

/** 总页数（含插入页，不含已删除） */
export const totalPages = computed(() => pages.value.length);

/** 是否有任何修改（删除或插入） */
export const hasModifications = computed(() =>
  pages.value.some(p => p.removed || p.kind !== 'original')
);

/** 重新计算所有可见页的 displayIndex */
export function recalcDisplayIndex(): void {
  let idx = 1;
  for (const p of pages.value) {
    if (!p.removed) {
      p.displayIndex = idx++;
    }
  }
}

/** 重置所有状态 */
export function resetState(): void {
  pdfDoc.value = null;
  pdfLibDoc.value = null;
  pdfBytes.value = null;
  fileName.value = '';
  filePath.value = '';
  pages.value = [];
  activePageIndex.value = 0;
  isDirty.value = false;
}
