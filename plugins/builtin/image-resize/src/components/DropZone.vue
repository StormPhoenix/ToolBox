<script setup lang="ts">
/**
 * Drop Zone：空态显示大提示；导入后显示略缩图。
 * 点击整个区域可触发文件选择；拖拽也走父组件的全局 handler。
 */
defineProps<{
  /** 是否已有导入的图片 */
  hasImage: boolean;
  /** 略缩图的 file:// URL */
  thumbUrl?: string | null;
  /** 原图文件名（仅在 hasImage=true 时用于展示） */
  filename?: string | null;
  /** 是否正在拖拽悬停（父组件传入） */
  isDragOver?: boolean;
}>();

defineEmits<{
  (e: 'pick'): void;
}>();
</script>

<template>
  <div
    class="drop-zone"
    :class="{ 'has-image': hasImage, 'drag-over': isDragOver }"
    @click="$emit('pick')"
  >
    <template v-if="!hasImage">
      <div class="zone-icon">🖼️</div>
      <div class="zone-title">拖拽图片到此处，或点击选择</div>
      <div class="zone-hint">
        支持 JPEG / PNG / WebP / AVIF / GIF / BMP / TIFF
      </div>
    </template>

    <template v-else>
      <img v-if="thumbUrl" :src="thumbUrl" class="thumb" alt="略缩图" />
      <div class="thumb-meta">
        <div class="thumb-title">{{ filename }}</div>
        <div class="thumb-hint">点击或拖入可替换图片</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-content);
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition);
  padding: 24px;
}

.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--accent);
  background: rgba(108, 92, 231, 0.06);
  color: var(--text-primary);
}

.zone-icon {
  font-size: 56px;
}

.zone-title {
  font-size: 16px;
  color: var(--text-primary);
  font-weight: 500;
}

.zone-hint {
  font-size: 12px;
  color: var(--text-dim);
}

.drop-zone.has-image {
  flex-direction: row;
  justify-content: flex-start;
  gap: 16px;
  padding: 16px;
  min-height: 96px;
  max-height: 140px;
}

.thumb {
  max-width: 120px;
  max-height: 96px;
  border-radius: var(--radius-sm);
  object-fit: contain;
  background: var(--bg-base);
  flex-shrink: 0;
}

.thumb-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.thumb-title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thumb-hint {
  color: var(--text-dim);
  font-size: 12px;
}
</style>
