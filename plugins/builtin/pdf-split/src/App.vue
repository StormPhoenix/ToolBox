<template>
  <div class="app">

    <!-- ── 顶部工具栏 ── -->
    <header class="toolbar">
      <div class="toolbar-left">
        <span class="app-title">✂️ PDF 拆分</span>
        <span class="file-name" v-if="fileName">{{ fileName }}</span>
      </div>
      <div class="toolbar-actions">
        <button class="btn btn-secondary" @click="importFromDialog">
          📂 打开文件
        </button>
      </div>
    </header>

    <!-- ── 主体 ── -->
    <div
      class="main-body"
      @dragover.prevent
      @drop="onDrop"
    >
      <!-- 未加载时显示拖拽区 -->
      <div class="drop-zone" v-if="!pdfDoc" @click="importFromDialog">
        <div class="drop-icon">✂️</div>
        <p class="drop-title">点击或拖拽 PDF 文件到此处</p>
        <p class="drop-hint">支持 .pdf 格式</p>
      </div>

      <!-- 已加载：左右布局 -->
      <template v-else>

        <!-- 左侧缩略图面板 -->
        <ThumbnailPanel :pdfDoc="pdfDoc" />

        <!-- 右侧配置 + 预览区 -->
        <div class="right-panel">

          <!-- 模式切换 -->
          <div class="section mode-tabs">
            <button
              class="mode-tab"
              :class="{ active: activeMode === 'average' }"
              @click="switchMode('average')"
            >平均拆分</button>
            <button
              class="mode-tab"
              :class="{ active: activeMode === 'custom' }"
              @click="switchMode('custom')"
            >自定义范围</button>
          </div>

          <!-- 参数配置 -->
          <div class="section">
            <SplitModeAverage v-if="activeMode === 'average'" />
            <SplitModeCustom v-else />
          </div>

          <!-- 提取选中范围按钮（仅自定义模式显示） -->
          <div class="section extract-row" v-if="activeMode === 'custom'">
            <button
              class="btn-extract"
              :class="{ active: selectedPages.size > 0 }"
              :disabled="selectedPages.size === 0"
              @click="extractSelected"
              title="将缩略图选中页作为一个新范围条目"
            >
              提取选中范围（{{ selectedPages.size }} 页）
            </button>
          </div>

          <!-- 分段预览 -->
          <div class="section flex-scroll">
            <SplitPreview :segments="activeSegments" />
          </div>

          <!-- 开始拆分 -->
          <div class="section split-action">
            <button
              class="btn btn-primary btn-split"
              :disabled="!canSplit"
              @click="onSplit"
            >
              <template v-if="splitStatus === 'running'">
                拆分中… ({{ splitProgress.current }}/{{ splitProgress.total }})
              </template>
              <template v-else>
                ✂️ 开始拆分
              </template>
            </button>
          </div>

        </div>
      </template>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.type}`">
        <span>{{ toast.message }}</span>
        <button
          v-if="toast.showOpenDir"
          class="toast-open-btn"
          @click="openOutputDir"
        >📂 打开目录</button>
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue';
import ThumbnailPanel from './components/ThumbnailPanel.vue';
import SplitModeAverage from './components/SplitModeAverage.vue';
import SplitModeCustom from './components/SplitModeCustom.vue';
import SplitPreview from './components/SplitPreview.vue';
import {
  pdfDoc, fileName,
  importFromDialog, importFromDrop,
} from './composables/usePdfLoad';
import { averageSegments } from './composables/useSplitAverage';
import {
  customSegments, addSegment, clearSegments,
} from './composables/useSplitCustom';
import {
  executeSplit, splitStatus, splitProgress, lastOutputDir, resetSplitStatus,
} from './composables/useSplitExecute';
import { selectedPages, clearSelection } from './composables/useThumbnails';
import { electronAPI } from '@toolbox/bridge';
import type { SplitSegment } from './composables/useSplitCustom';

// ── 模式 ──────────────────────────────────────────────────────
type Mode = 'average' | 'custom';
const activeMode = ref<Mode>('average');

function switchMode(mode: Mode): void {
  activeMode.value = mode;
}

const activeSegments = computed<SplitSegment[]>(() =>
  activeMode.value === 'average' ? averageSegments.value : customSegments.value,
);

const canSplit = computed(() =>
  !!pdfDoc.value &&
  activeSegments.value.length > 0 &&
  splitStatus.value !== 'running',
);

// ── 提取选中范围 ──────────────────────────────────────────────
function extractSelected(): void {
  if (selectedPages.value.size === 0) return;
  const sorted = Array.from(selectedPages.value).sort((a, b) => a - b);
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  addSegment(start, end);
  clearSelection();
}

// ── PDF 加载 ──────────────────────────────────────────────────
async function onDrop(event: DragEvent): Promise<void> {
  await importFromDrop(event);
}

// 切换文件时清空自定义范围
watch(pdfDoc, () => {
  clearSegments();
  resetSplitStatus();
});

// ── 拆分 ──────────────────────────────────────────────────────
async function onSplit(): Promise<void> {
  const ok = await executeSplit(activeSegments.value);
  if (ok) {
    showToast(`✅ 完成，已保存 ${activeSegments.value.length} 个文件`, 'success', true);
  } else if (splitStatus.value === 'error') {
    showToast('❌ 拆分失败，请重试', 'error', false);
  }
  // 用户取消目录选择时不提示
}

async function openOutputDir(): Promise<void> {
  if (lastOutputDir.value) {
    await electronAPI.openInExplorer(lastOutputDir.value);
  }
}

// ── Toast ──────────────────────────────────────────────────────
const toast = reactive({
  visible: false,
  message: '',
  type: 'success' as 'success' | 'error',
  showOpenDir: false,
});
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(
  message: string,
  type: 'success' | 'error' = 'success',
  showOpenDir = false,
): void {
  if (toastTimer) clearTimeout(toastTimer);
  toast.message = message;
  toast.type = type;
  toast.showOpenDir = showOpenDir;
  toast.visible = true;
  toastTimer = setTimeout(() => { toast.visible = false; }, 4000);
}
</script>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0d0d14;
  --bg-sidebar: #111118;
  --bg-card: #1a1a28;
  --text: #e8e8f2;
  --text-dim: #8888a8;
  --accent: #6c5ce7;
  --accent-light: #a29bfe;
  --border: #1e1e30;
  --radius: 8px;
}

html, body, #app {
  width: 100%; height: 100%; overflow: hidden;
}

body {
  background: var(--bg);
  color: var(--text);
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
}

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 52px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.app-title {
  font-weight: 700;
  font-size: 0.9rem;
  white-space: nowrap;
}

.file-name {
  font-size: 0.82rem;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ── 按钮 ── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  white-space: nowrap;
}

.btn:disabled { opacity: 0.35; cursor: default; }

.btn-secondary {
  background: var(--bg-card);
  color: var(--text);
}
.btn-secondary:hover:not(:disabled) {
  background: #22223a;
  border-color: var(--accent);
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-primary:hover:not(:disabled) { background: #5a4bd1; }

/* ── 主体 ── */
.main-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── 拖拽区 ── */
.drop-zone {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  border: 2px dashed var(--border);
  border-radius: 16px;
  margin: 32px;
  transition: border-color 0.2s, background 0.2s;
}

.drop-zone:hover {
  border-color: var(--accent);
  background: rgba(108, 92, 231, 0.04);
}

.drop-icon { font-size: 3rem; opacity: 0.5; }
.drop-title { font-size: 1rem; font-weight: 600; color: var(--text-dim); }
.drop-hint { font-size: 0.8rem; color: #555570; }

/* ── 右侧面板 ── */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 0;
}

.section {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.section.flex-scroll {
  flex: 1;
  overflow-y: auto;
  flex-shrink: 1;
}

.section.split-action {
  padding: 12px 16px;
  border-bottom: none;
}

/* ── 模式切换 ── */
.mode-tabs {
  display: flex;
  gap: 0;
  padding: 10px 16px;
}

.mode-tab {
  padding: 5px 18px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.mode-tab:first-child {
  border-radius: var(--radius) 0 0 var(--radius);
}

.mode-tab:last-child {
  border-radius: 0 var(--radius) var(--radius) 0;
  border-left: none;
}

.mode-tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* ── 提取按钮 ── */
.extract-row {
  padding-top: 0;
  border-bottom: none;
}

.btn-extract {
  padding: 6px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-dim);
  font-size: 0.82rem;
  cursor: default;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  opacity: 0.5;
}

.btn-extract.active {
  cursor: pointer;
  opacity: 1;
  background: #1a3a1a;
  color: #55efc4;
  border-color: #00b894;
}

.btn-extract.active:hover {
  background: #1f4a1f;
}

/* ── 拆分按钮 ── */
.btn-split {
  width: 100%;
  justify-content: center;
  padding: 9px 0;
  font-size: 0.9rem;
}

/* ── Toast ── */
.toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 24px;
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  z-index: 2000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  gap: 10px;
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
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid #00b894;
  background: transparent;
  color: #55efc4;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.15s;
}

.toast-open-btn:hover {
  background: rgba(0, 184, 148, 0.15);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>
