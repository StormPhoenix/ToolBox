<template>
  <div
    class="thumb-panel"
    ref="panelRef"
    @mousedown="onPanelMouseDown"
  >
    <div class="thumb-grid" ref="gridRef">
      <ThumbnailItem
        v-for="n in pageCount"
        :key="n"
        :pageNum="n"
        :pdfDoc="pdfDoc"
        :isSelected="selectedPages.has(n)"
        @click="onItemClick"
      />
    </div>

    <!-- 框选遮罩 -->
    <div
      v-if="isDragging"
      class="select-rect"
      :style="selectRectStyle"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import ThumbnailItem from './ThumbnailItem.vue';
import { selectedPages, selectPage, selectRange } from '../composables/useThumbnails';
import { pageCount } from '../composables/usePdfLoad';

defineProps<{
  pdfDoc: PDFDocumentProxy | null;
}>();

const panelRef = ref<HTMLElement | null>(null);
const gridRef = ref<HTMLElement | null>(null);

// ── 多选交互 ─────────────────────────────────────────────────

function onItemClick(page: number, mode: 'single' | 'ctrl' | 'shift'): void {
  selectPage(page, mode);
}

// ── 框选逻辑 ─────────────────────────────────────────────────

const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });
const dragCurrent = ref({ x: 0, y: 0 });

const selectRectStyle = computed(() => {
  const x1 = Math.min(dragStart.value.x, dragCurrent.value.x);
  const y1 = Math.min(dragStart.value.y, dragCurrent.value.y);
  const x2 = Math.max(dragStart.value.x, dragCurrent.value.x);
  const y2 = Math.max(dragStart.value.y, dragCurrent.value.y);
  return {
    left: `${x1}px`,
    top: `${y1}px`,
    width: `${x2 - x1}px`,
    height: `${y2 - y1}px`,
  };
});

function onPanelMouseDown(e: MouseEvent): void {
  // 只响应直接点击面板背景（非缩略图）
  const target = e.target as HTMLElement;
  if (target.closest('.thumb-item')) return;

  isDragging.value = true;
  const panelRect = panelRef.value!.getBoundingClientRect();
  dragStart.value = {
    x: e.clientX - panelRect.left + panelRef.value!.scrollLeft,
    y: e.clientY - panelRect.top + panelRef.value!.scrollTop,
  };
  dragCurrent.value = { ...dragStart.value };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e: MouseEvent): void {
  if (!isDragging.value) return;
  const panelRect = panelRef.value!.getBoundingClientRect();
  dragCurrent.value = {
    x: e.clientX - panelRect.left + panelRef.value!.scrollLeft,
    y: e.clientY - panelRect.top + panelRef.value!.scrollTop,
  };
}

function onMouseUp(): void {
  if (!isDragging.value) return;
  isDragging.value = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);

  const rx1 = Math.min(dragStart.value.x, dragCurrent.value.x);
  const ry1 = Math.min(dragStart.value.y, dragCurrent.value.y);
  const rx2 = Math.max(dragStart.value.x, dragCurrent.value.x);
  const ry2 = Math.max(dragStart.value.y, dragCurrent.value.y);

  // 框选面积过小视为普通点击，不做任何选中
  if (rx2 - rx1 < 5 && ry2 - ry1 < 5) return;

  const grid = gridRef.value;
  if (!grid) return;

  const panelRect = panelRef.value!.getBoundingClientRect();
  const panelScrollLeft = panelRef.value!.scrollLeft;
  const panelScrollTop = panelRef.value!.scrollTop;

  const items = grid.querySelectorAll<HTMLElement>('.thumb-item');
  const hitPages: number[] = [];

  items.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    const elLeft = r.left - panelRect.left + panelScrollLeft;
    const elTop = r.top - panelRect.top + panelScrollTop;
    const elRight = elLeft + r.width;
    const elBottom = elTop + r.height;

    const overlap =
      elLeft < rx2 && elRight > rx1 && elTop < ry2 && elBottom > ry1;
    if (overlap) hitPages.push(idx + 1);
  });

  if (hitPages.length > 0) {
    selectRange(hitPages[0], hitPages[hitPages.length - 1]);
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
});
</script>

<style scoped>
.thumb-panel {
  width: 220px;
  flex-shrink: 0;
  background: #111118;
  border-right: 1px solid #1e1e30;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  user-select: none;
}

.thumb-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  padding: 10px 8px;
}

/* 框选遮罩 */
.select-rect {
  position: absolute;
  pointer-events: none;
  background: rgba(108, 92, 231, 0.15);
  border: 1px solid rgba(108, 92, 231, 0.6);
  border-radius: 3px;
  z-index: 10;
}
</style>
