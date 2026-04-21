<template>
  <div class="split-preview" v-if="segments.length > 0">
    <p class="preview-title">输出预览（共 {{ segments.length }} 份）</p>
    <div class="preview-list">
      <div class="preview-row" v-for="(seg, i) in segments" :key="i">
        <span class="preview-num">{{ i + 1 }}</span>
        <span class="preview-range">第 {{ seg.start }} ~ {{ seg.end }} 页</span>
        <span class="preview-name">→ {{ resolveFileName(fileBaseName, seg) }}</span>
      </div>
    </div>
  </div>
  <div class="split-preview empty" v-else>
    <p class="preview-empty">配置拆分参数后此处显示输出预览</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { resolveFileName } from '../composables/useSplitCustom';
import { fileName, stripPdfExt } from '../composables/usePdfLoad';
import type { SplitSegment } from '../composables/useSplitCustom';

defineProps<{
  segments: SplitSegment[];
}>();

const fileBaseName = computed(() => stripPdfExt(fileName.value || 'document'));
</script>

<style scoped>
.split-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-title {
  font-size: 0.78rem;
  color: #8888a8;
  font-weight: 600;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 180px;
  overflow-y: auto;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  padding: 3px 6px;
  border-radius: 4px;
  background: #1a1a28;
}

.preview-num {
  min-width: 20px;
  color: #6c5ce7;
  font-weight: 600;
  text-align: right;
}

.preview-range {
  color: #8888a8;
  white-space: nowrap;
  min-width: 100px;
}

.preview-name {
  color: #e8e8f2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-empty {
  font-size: 0.78rem;
  color: #555570;
  text-align: center;
  padding: 8px 0;
}
</style>
