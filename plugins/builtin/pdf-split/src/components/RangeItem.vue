<template>
  <div class="range-item">
    <span class="range-index">{{ index + 1 }}</span>

    <label class="range-label">起始页</label>
    <input
      class="page-input"
      type="number"
      min="1"
      :max="pageCount"
      v-model.number="segment.start"
      @change="clampStart"
    />

    <label class="range-label">结束页</label>
    <input
      class="page-input"
      type="number"
      :min="segment.start"
      :max="pageCount"
      v-model.number="segment.end"
      @change="clampEnd"
    />

    <input
      class="name-input"
      type="text"
      placeholder="自动命名"
      v-model="segment.customName"
    />

    <button class="btn-remove" @click="$emit('remove')" title="删除此范围">✕</button>
  </div>
</template>

<script setup lang="ts">
import type { SplitSegment } from '../composables/useSplitCustom';

const props = defineProps<{
  index: number;
  segment: SplitSegment;
  pageCount: number;
}>();

defineEmits<{ remove: [] }>();

function clampStart(): void {
  if (props.segment.start < 1) props.segment.start = 1;
  if (props.segment.start > props.pageCount) props.segment.start = props.pageCount;
  if (props.segment.end < props.segment.start) props.segment.end = props.segment.start;
}

function clampEnd(): void {
  if (props.segment.end < props.segment.start) props.segment.end = props.segment.start;
  if (props.segment.end > props.pageCount) props.segment.end = props.pageCount;
}
</script>

<style scoped>
.range-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #1a1a28;
  border-radius: 6px;
  border: 1px solid #1e1e30;
}

.range-index {
  font-size: 0.72rem;
  color: #555570;
  min-width: 16px;
  text-align: center;
}

.range-label {
  font-size: 0.75rem;
  color: #8888a8;
  white-space: nowrap;
}

.page-input {
  width: 52px;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid #1e1e30;
  background: #0d0d14;
  color: #e8e8f2;
  font-size: 0.78rem;
  text-align: center;
  outline: none;
}

.page-input:focus {
  border-color: #6c5ce7;
}

.name-input {
  flex: 1;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid #1e1e30;
  background: #0d0d14;
  color: #e8e8f2;
  font-size: 0.78rem;
  outline: none;
  min-width: 0;
}

.name-input:focus {
  border-color: #6c5ce7;
}

.name-input::placeholder {
  color: #555570;
}

.btn-remove {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #555570;
  font-size: 0.72rem;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}

.btn-remove:hover {
  color: #ff7675;
  background: rgba(231, 76, 60, 0.1);
}
</style>
