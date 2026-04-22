<script setup lang="ts">
import type { ImageBasicInfo } from '@toolbox/bridge';

defineProps<{
  basic: ImageBasicInfo | null;
}>();

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
</script>

<template>
  <div class="card">
    <div class="card-title">基本信息</div>
    <div v-if="basic" class="fields">
      <div class="field">
        <span class="label">文件名</span>
        <span class="value" :title="basic.filename">{{ basic.filename }}</span>
      </div>
      <div class="field">
        <span class="label">大小</span>
        <span class="value">{{ formatSize(basic.byteSize) }}</span>
      </div>
      <div class="field">
        <span class="label">格式</span>
        <span class="value">{{ basic.format.toUpperCase() }}</span>
      </div>
      <div class="field">
        <span class="label">色彩空间</span>
        <span class="value">{{ basic.colorSpace }}</span>
      </div>
      <div class="field">
        <span class="label">原始分辨率</span>
        <span class="value">{{ basic.width }} × {{ basic.height }}</span>
      </div>
    </div>
    <div v-else class="empty">未导入图片</div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}

.card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.label {
  color: var(--text-dim);
  flex-shrink: 0;
}

.value {
  color: var(--text-primary);
  font-family: 'SF Mono', ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
  text-align: right;
}

.empty {
  color: var(--text-dim);
  font-size: 12px;
  padding: 8px 0;
}
</style>
