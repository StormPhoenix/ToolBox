import { ref, watch } from 'vue';
import { pdfDoc, pageCount } from './usePdfLoad';

/** 已选中的页码集合（1-based） */
export const selectedPages = ref<Set<number>>(new Set());

/** 上一次单击的页码（用于 Shift 范围选择） */
let lastClickedPage = 1;

export function clearSelection(): void {
  selectedPages.value = new Set();
}

/**
 * 将集合中所有已选页码之间的间隔自动填满：
 * 找出 min ~ max 范围内所有整数都加入集合。
 */
function fillGaps(pages: Set<number>): Set<number> {
  if (pages.size < 2) return pages;
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const filled = new Set(pages);
  for (let i = sorted[0]; i <= sorted[sorted.length - 1]; i++) filled.add(i);
  return filled;
}

export function selectPage(page: number, mode: 'single' | 'ctrl' | 'shift'): void {
  const count = pageCount.value;
  if (page < 1 || page > count) return;

  if (mode === 'single') {
    selectedPages.value = new Set([page]);
    lastClickedPage = page;
  } else if (mode === 'ctrl') {
    const next = new Set(selectedPages.value);
    if (next.has(page)) {
      next.delete(page);
    } else {
      next.add(page);
    }
    selectedPages.value = fillGaps(next);
    lastClickedPage = page;
  } else {
    // shift：从 lastClickedPage 到 page 的连续范围
    const from = Math.min(lastClickedPage, page);
    const to = Math.max(lastClickedPage, page);
    const next = new Set(selectedPages.value);
    for (let i = from; i <= to; i++) next.add(i);
    selectedPages.value = fillGaps(next);
  }
}

export function selectRange(from: number, to: number): void {
  const next = new Set(selectedPages.value);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let i = lo; i <= hi; i++) next.add(i);
  // 框选本身已连续，fillGaps 结果一致，保持一致性仍调用
  selectedPages.value = fillGaps(next);
}

export function setSelection(pages: number[]): void {
  selectedPages.value = new Set(pages);
}

/** 当 PDF 重新加载时清空选中状态 */
watch(pdfDoc, () => {
  clearSelection();
});
