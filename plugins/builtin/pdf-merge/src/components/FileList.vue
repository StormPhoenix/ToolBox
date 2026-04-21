<template>
  <div ref="listEl" class="file-list">
    <div
      v-for="item in fileItems"
      :key="item.id"
      :data-id="item.id"
      class="file-card"
      :class="{ invalid: !isRangeValid(item) }"
    >
      <!-- 拖拽把手 + 文件信息 -->
      <div class="card-header">
        <span class="drag-handle" title="拖拽排序">⠿</span>
        <span class="file-icon">📄</span>
        <span class="file-name" :title="item.fileName">{{ item.fileName }}</span>
        <span class="page-total">{{ item.pageCount }} 页</span>
        <button class="btn-remove" @click="removeFile(item.id)" title="移除">✕</button>
      </div>

      <!-- 页码范围 -->
      <div class="card-range">
        <label class="range-label">页码范围</label>
        <div class="range-inputs">
          <input
            type="number"
            class="range-input"
            :class="{ error: !isRangeValid(item) }"
            :min="1"
            :max="item.pageCount"
            :value="item.startPage"
            @change="onStartChange(item, $event)"
            @blur="clampStart(item)"
            title="起始页"
          />
          <span class="range-sep">–</span>
          <input
            type="number"
            class="range-input"
            :class="{ error: !isRangeValid(item) }"
            :min="1"
            :max="item.pageCount"
            :value="item.endPage"
            @change="onEndChange(item, $event)"
            @blur="clampEnd(item)"
            title="终止页"
          />
        </div>
        <span class="range-hint" v-if="!isRangeValid(item)">
          范围无效（1 – {{ item.pageCount }}）
        </span>
        <button class="btn-reset-range" @click="resetRange(item)" title="恢复全选">全选</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Sortable from 'sortablejs';
import {
  fileItems,
  removeFile,
  isRangeValid,
} from '../composables/usePdfFiles';
import type { PdfFileItem } from '../composables/usePdfFiles';

// ── SortableJS ────────────────────────────────────────────────

const listEl = ref<HTMLElement | null>(null);
let sortable: Sortable | null = null;

onMounted(() => {
  if (!listEl.value) return;
  sortable = Sortable.create(listEl.value, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'card-ghost',
    chosenClass: 'card-chosen',
    onEnd(evt) {
      const { oldIndex, newIndex } = evt;
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
      const arr = fileItems.value.slice();
      const [moved] = arr.splice(oldIndex, 1);
      arr.splice(newIndex, 0, moved);
      fileItems.value = arr;
    },
  });
});

onBeforeUnmount(() => {
  sortable?.destroy();
  sortable = null;
});

// ── 页码范围操作 ──────────────────────────────────────────────

function onStartChange(item: PdfFileItem, event: Event): void {
  const val = parseInt((event.target as HTMLInputElement).value, 10);
  if (!isNaN(val)) item.startPage = val;
}

function onEndChange(item: PdfFileItem, event: Event): void {
  const val = parseInt((event.target as HTMLInputElement).value, 10);
  if (!isNaN(val)) item.endPage = val;
}

function clampStart(item: PdfFileItem): void {
  item.startPage = Math.max(1, Math.min(item.startPage, item.endPage));
}

function clampEnd(item: PdfFileItem): void {
  item.endPage = Math.max(item.startPage, Math.min(item.endPage, item.pageCount));
}

function resetRange(item: PdfFileItem): void {
  item.startPage = 1;
  item.endPage = item.pageCount;
}
</script>

<style scoped>
.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 0;
}

/* ── 文件卡片 ── */
.file-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.file-card.invalid {
  border-color: #e17055;
}

.file-card.card-ghost {
  opacity: 0.4;
  background: var(--bg-active);
}

.file-card.card-chosen {
  box-shadow: 0 0 0 2px var(--accent-glow);
  border-color: var(--accent);
}

/* ── 卡片头部 ── */
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.drag-handle {
  cursor: grab;
  color: var(--text-dim);
  font-size: 1.1rem;
  line-height: 1;
  flex-shrink: 0;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.file-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.file-name {
  flex: 1;
  font-size: 0.85rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-total {
  font-size: 0.78rem;
  color: var(--text-dim);
  flex-shrink: 0;
  white-space: nowrap;
}

.btn-remove {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: color var(--transition), background var(--transition);
  flex-shrink: 0;
}

.btn-remove:hover {
  color: #ff7675;
  background: rgba(231, 76, 60, 0.12);
}

/* ── 页码范围 ── */
.card-range {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  flex-wrap: wrap;
}

.range-label {
  font-size: 0.78rem;
  color: var(--text-dim);
  flex-shrink: 0;
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.range-input {
  width: 60px;
  padding: 4px 8px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.82rem;
  text-align: center;
  transition: border-color var(--transition);
  /* 隐藏 number 输入框的上下箭头 */
  appearance: textfield;
  -moz-appearance: textfield;
}

.range-input::-webkit-inner-spin-button,
.range-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.range-input:focus {
  outline: none;
  border-color: var(--accent);
}

.range-input.error {
  border-color: #e17055;
  color: #ff7675;
}

.range-sep {
  color: var(--text-dim);
  font-size: 0.9rem;
}

.range-hint {
  font-size: 0.75rem;
  color: #ff7675;
}

.btn-reset-range {
  margin-left: auto;
  padding: 3px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 0.75rem;
  cursor: pointer;
  transition: border-color var(--transition), color var(--transition);
}

.btn-reset-range:hover {
  border-color: var(--accent-light);
  color: var(--accent-light);
}
</style>
