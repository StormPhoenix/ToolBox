<template>
  <div class="export-bar">
    <!-- 格式 -->
    <div class="bar-group">
      <label class="bar-label">格式</label>
      <div class="seg-control">
        <button
          v-for="fmt in FORMATS"
          :key="fmt"
          class="seg-btn"
          :class="{ active: exportOptions.format === fmt }"
          @click="setFormat(fmt)"
        >{{ fmt.toUpperCase() }}</button>
      </div>
    </div>

    <!-- 质量（PNG 隐藏） -->
    <div class="bar-group" v-if="exportOptions.format !== 'png'">
      <label class="bar-label">质量 {{ exportOptions.quality }}%</label>
      <input
        type="range"
        min="60"
        max="100"
        step="1"
        v-model.number="exportOptions.quality"
        @change="saveExportOptions"
        class="quality-slider"
      />
    </div>

    <!-- 输出目录 -->
    <div class="bar-group bar-group--dir">
      <label class="bar-label">输出目录</label>
      <div class="dir-row">
        <span class="dir-path" :title="exportOptions.outputDir">
          {{ exportOptions.outputDir || '默认桌面' }}
        </span>
        <button class="btn-pick" @click="pickOutputDir">…</button>
      </div>
    </div>

    <!-- 导出按钮 + 进度 -->
    <div class="bar-actions">
      <div class="progress-label" v-if="exportProgress.running">
        {{ exportProgress.current }} / {{ exportProgress.total }}
      </div>
      <button
        class="btn-export"
        :disabled="!canExport || exportProgress.running"
        @click="onExport"
      >
        <template v-if="exportProgress.running">导出中…</template>
        <template v-else>🎨 生成并导出</template>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  exportOptions,
  exportProgress,
  saveExportOptions,
  pickOutputDir,
  runExport,
} from '../composables/useExport';
import { sourceImage } from '../composables/useSourceImage';
import { workingPresets } from '../composables/usePresets';

type Format = 'jpg' | 'png' | 'webp';
const FORMATS: Format[] = ['jpg', 'png', 'webp'];

const canExport = computed(
  () => !!sourceImage.value && workingPresets.value.length > 0,
);

const emit = defineEmits<{
  (e: 'export-done', outputDir: string): void;
  (e: 'export-error'): void;
}>();

function setFormat(fmt: Format): void {
  exportOptions.format = fmt;
  saveExportOptions();
}

async function onExport(): Promise<void> {
  const result = await runExport();
  if (result === 'done') {
    emit('export-done', exportOptions.outputDir);
  } else {
    emit('export-error');
  }
}
</script>

<style scoped>
.export-bar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 16px;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.bar-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.bar-group--dir {
  flex: 1;
  min-width: 160px;
}

.bar-label {
  font-size: 0.75rem;
  color: var(--text-secondary, #8888a8);
  white-space: nowrap;
}

/* 分段控件 */
.seg-control {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.seg-btn {
  padding: 4px 10px;
  font-size: 0.72rem;
  border: none;
  background: var(--bg-card);
  color: var(--text-secondary, #8888a8);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
  border-right: 1px solid var(--border);
}

.seg-btn:last-child { border-right: none; }

.seg-btn.active {
  background: var(--bg-active);
  color: var(--accent-light);
}

.seg-btn:hover:not(.active) {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

/* 质量滑块 */
.quality-slider {
  width: 90px;
  accent-color: var(--accent);
  cursor: pointer;
}

/* 目录行 */
.dir-row {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.dir-path {
  font-size: 0.75rem;
  color: var(--text-dim, #555570);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.btn-pick {
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.78rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color var(--transition), background var(--transition);
}

.btn-pick:hover {
  border-color: var(--accent);
  background: var(--bg-active);
}

/* 操作区 */
.bar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  flex-shrink: 0;
}

.progress-label {
  font-size: 0.78rem;
  color: var(--accent-light);
}

.btn-export {
  padding: 7px 22px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition), opacity var(--transition);
}

.btn-export:hover:not(:disabled) {
  background: #5a4bd1;
}

.btn-export:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
