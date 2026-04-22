<template>
  <div
    class="app"
    @dragover.prevent="onDragOver"
    @dragleave.self="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- ── 顶部：图片导入区 ── -->
    <header class="image-bar">
      <!-- 空状态：点击或拖拽导入 -->
      <div
        class="drop-zone"
        v-if="!sourceImage"
        @click="importFromDialog"
        :class="{ 'drag-active': isDragOver }"
      >
        <span class="drop-icon">🖼️</span>
        <span class="drop-text">拖拽图片到此处，或<em>点击选择</em></span>
        <span class="drop-hint">支持 JPG / PNG / WebP</span>
      </div>

      <!-- 已导入：缩略图 + 更换按钮 -->
      <div class="image-preview-row" v-else>
        <img :src="sourceImage.dataUrl" class="thumb" alt="原始图" />
        <div class="image-meta">
          <span class="image-name">{{ sourceImage.fileName }}</span>
          <span class="image-size">{{ sourceImage.width }} × {{ sourceImage.height }}</span>
        </div>
        <button class="btn-change" @click="onClearImage">更换图片</button>
      </div>
    </header>

    <!-- ── 主体：左侧预设列表 + 右侧裁剪预览 ── -->
    <div class="main-body">
      <PresetPanel />
      <CropPreview />
    </div>

    <!-- ── 底部：导出通栏 ── -->
    <ExportBar
      @export-done="onExportDone"
      @export-error="onExportError"
    />

    <!-- ── 全局拖拽遮罩（已有图片时） ── -->
    <div class="drag-mask" v-if="isDragOver && sourceImage">
      <div class="drag-mask-inner">
        <span class="drag-mask-icon">🖼️</span>
        <p>松开以替换当前图片</p>
      </div>
    </div>

    <!-- ── Toast ── -->
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.type}`">
        <span>{{ toast.message }}</span>
        <button
          v-if="toast.showOpen"
          class="toast-open-btn"
          @click="openOutputDir"
        >📂 打开输出目录</button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import PresetPanel from './components/PresetPanel.vue';
import CropPreview from './components/CropPreview.vue';
import ExportBar from './components/ExportBar.vue';
import {
  sourceImage,
  importFromDialog,
  importFromDrop,
  clearImage,
} from './composables/useSourceImage';
import { lastOutputDir } from './composables/useExport';
import { electronAPI } from '@toolbox/bridge';

// ── 拖拽 ─────────────────────────────────────────────────────────────────────

const isDragOver = ref(false);

function onDragOver(): void {
  isDragOver.value = true;
}

function onDragLeave(): void {
  isDragOver.value = false;
}

async function onDrop(event: DragEvent): Promise<void> {
  isDragOver.value = false;
  await importFromDrop(event);
}

// ── 更换图片 ─────────────────────────────────────────────────────────────────

function onClearImage(): void {
  clearImage();
}

// ── 导出回调 ─────────────────────────────────────────────────────────────────

function onExportDone(outputDir: string): void {
  showToast('✅ 导出完成！', 'success', true);
}

function onExportError(): void {
  showToast('❌ 导出失败，请重试', 'error', false);
}

async function openOutputDir(): Promise<void> {
  if (lastOutputDir.value) {
    await electronAPI.openInExplorer(lastOutputDir.value);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const toast = reactive({
  visible: false,
  message: '',
  type: 'success' as 'success' | 'error',
  showOpen: false,
});
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(
  message: string,
  type: 'success' | 'error' = 'success',
  showOpen = false,
): void {
  if (toastTimer) clearTimeout(toastTimer);
  toast.message = message;
  toast.type = type;
  toast.showOpen = showOpen;
  toast.visible = true;
  toastTimer = setTimeout(() => { toast.visible = false; }, 5000);
}
</script>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-base:        #0d0d14;
  --bg-sidebar:     #111118;
  --bg-content:     #0f0f17;
  --bg-card:        #1a1a28;
  --bg-card-hover:  #1f1f30;
  --bg-active:      #1e1b3a;
  --text-primary:   #e8e8f2;
  --text-secondary: #8888a8;
  --text-dim:       #555570;
  --accent:         #6c5ce7;
  --accent-light:   #a29bfe;
  --accent-glow:    rgba(108, 92, 231, 0.25);
  --border:         #1e1e30;
  --border-active:  #6c5ce7;
  --radius-sm:      6px;
  --radius-md:      10px;
  --radius-lg:      16px;
  --transition:     0.18s ease;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

/* ── 顶部图片导入区 ── */
.image-bar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg-sidebar);
}

/* 空状态：拖拽区 */
.drop-zone {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  cursor: pointer;
  transition: background var(--transition);
}

.drop-zone:hover,
.drop-zone.drag-active {
  background: rgba(108, 92, 231, 0.06);
}

.drop-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.drop-text {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.drop-text em {
  font-style: normal;
  color: var(--accent-light);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.drop-hint {
  font-size: 0.72rem;
  color: var(--text-dim);
  margin-left: 4px;
}

/* 已导入：预览行 */
.image-preview-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}

.thumb {
  width: 56px;
  height: 42px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.image-meta {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.image-name {
  font-size: 0.82rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.image-size {
  font-size: 0.72rem;
  color: var(--text-dim);
}

.btn-change {
  padding: 5px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 0.78rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
}

.btn-change:hover {
  border-color: var(--accent);
  color: var(--accent-light);
  background: var(--bg-active);
}

/* ── 主体 ── */
.main-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ── 拖拽遮罩 ── */
.drag-mask {
  position: absolute;
  inset: 0;
  background: rgba(13, 13, 20, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 200;
}

.drag-mask-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 60px;
  border: 2px dashed var(--accent);
  border-radius: var(--radius-lg);
  background: rgba(108, 92, 231, 0.08);
}

.drag-mask-icon { font-size: 2.5rem; }

.drag-mask-inner p {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--accent-light);
}

/* ── Toast ── */
.toast {
  position: fixed;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 24px;
  font-size: 0.84rem;
  font-weight: 500;
  white-space: nowrap;
  z-index: 2000;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  gap: 12px;
}

.toast--success {
  background: #1a3a2a;
  color: #55efc4;
  border: 1px solid #00b894;
}

.toast--error {
  background: #3a1a1a;
  color: #ff7675;
  border: 1px solid #e17055;
}

.toast-open-btn {
  padding: 3px 12px;
  border-radius: 12px;
  border: 1px solid #00b894;
  background: transparent;
  color: #55efc4;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background var(--transition);
  white-space: nowrap;
}

.toast-open-btn:hover { background: rgba(0,184,148,0.15); }

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
