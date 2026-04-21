<template>
  <aside class="thumb-panel">
    <div class="panel-header">
      <span>页面</span>
      <span class="page-count">{{ visibleCount }} / {{ total }}</span>
    </div>
    <div class="thumb-list" ref="listRef">
      <ThumbnailItem
        v-for="(page, i) in pages"
        :key="page.originalIndex"
        :page="page"
        :index="i"
        :isActive="activePageIndex === i"
        :pdfDoc="pdfDoc"
        @select="$emit('select', $event)"
        @contextmenu="(ev, idx) => $emit('contextmenu', ev, idx)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import ThumbnailItem from './ThumbnailItem.vue';
import type { PageState } from '../store/pdfState';

const props = defineProps<{
  pages: PageState[];
  activePageIndex: number;
  pdfDoc: PDFDocumentProxy | null;
}>();

defineEmits<{
  select: [index: number];
  contextmenu: [event: MouseEvent, index: number];
}>();

const listRef = ref<HTMLElement | null>(null);

const visibleCount = computed(() => props.pages.filter(p => !p.removed).length);
const total = computed(() => props.pages.length);
</script>

<style scoped>
.thumb-panel {
  width: 160px;
  min-width: 160px;
  height: 100%;
  background: #111118;
  border-right: 1px solid #1e1e30;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 0.78rem;
  color: #8888a8;
  border-bottom: 1px solid #1e1e30;
  flex-shrink: 0;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.page-count {
  color: #555570;
  font-weight: 400;
}

.thumb-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thumb-list::-webkit-scrollbar { width: 4px; }
.thumb-list::-webkit-scrollbar-track { background: transparent; }
.thumb-list::-webkit-scrollbar-thumb { background: #2d2d44; border-radius: 2px; }
</style>
