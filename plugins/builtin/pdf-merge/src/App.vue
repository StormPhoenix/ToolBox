<template>
  <div
    class="app"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    :class="{ 'drag-over': isDragOver }"
  >
    <!-- ── 顶部工具栏 ── -->
    <header class="toolbar">
      <div class="toolbar-left">
        <span class="app-title">🔗 PDF 合并</span>
        <span class="file-count" v-if="fileItems.length > 0">
          {{ fileItems.length }} 个文件
        </span>
      </div>
      <div class="toolbar-actions">
        <button class="btn btn-secondary" @click="importFromDialog">
          📂 添加文件
        </button>
        <button
          class="btn btn-secondary btn-clear"
          v-if="fileItems.length > 0"
          @click="clearFiles"
        >
          🗑 清空
        </button>
      </div>
    </header>

    <!-- ── 主体 ── -->
    <div class="main-body">

      <!-- 空状态：拖拽 / 点击导入 -->
      <div
        class="drop-zone"
        v-if="fileItems.length === 0"
        @click="importFromDialog"
      >
        <div class="drop-icon">🔗</div>
        <p class="drop-title">点击或拖拽 PDF 文件到此处</p>
        <p class="drop-hint">支持同时添加多个 .pdf 文件</p>
      </div>

      <!-- 文件列表 -->
      <template v-else>
        <div class="list-wrapper">
          <FileList />
        </div>

        <!-- 底部操作栏 -->
        <div class="action-bar">
          <div class="action-bar-hint" v-if="!canMerge()">
            <template v-if="fileItems.length < 2">至少需要 2 个文件</template>
            <template v-else>请修正页码范围后再合并</template>
          </div>
          <button
            class="btn btn-primary btn-merge"
            :disabled="!canMerge() || mergeStatus === 'running'"
            @click="onMerge"
          >
            <template v-if="mergeStatus === 'running'">合并中…</template>
            <template v-else>🔗 合并并保存</template>
          </button>
        </div>
      </template>

    </div>

    <!-- 全局拖拽遮罩提示 -->
    <div class="drag-mask" v-if="isDragOver && fileItems.length > 0">
      <div class="drag-mask-inner">
        <div class="drag-mask-icon">📄</div>
        <p>松开以添加文件</p>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.type}`">
        <span>{{ toast.message }}</span>
        <button
          v-if="toast.showOpen"
          class="toast-open-btn"
          @click="openOutputDir"
        >
          📂 在文件管理器中显示
        </button>
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import FileList from './components/FileList.vue';
import {
  fileItems,
  importFromDialog,
  importFromDrop,
  clearFiles,
  canMerge,
} from './composables/usePdfFiles';
import {
  executeMerge,
  mergeStatus,
  lastOutputPath,
  resetMergeStatus,
} from './composables/useMergeExecute';
import { electronAPI } from '@toolbox/bridge';

// ── 拖拽状态 ──────────────────────────────────────────────────

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

// ── 合并 ──────────────────────────────────────────────────────

async function onMerge(): Promise<void> {
  resetMergeStatus();
  const result = await executeMerge();
  if (result === 'saved') {
    showToast('✅ 合并完成！', 'success', true);
  } else if (result === 'error') {
    showToast('❌ 合并失败，请重试', 'error', false);
  }
  // 'canceled' 时静默处理
}

async function openOutputDir(): Promise<void> {
  if (!lastOutputPath.value) return;
  // 取目录路径（去掉文件名）
  const sep = lastOutputPath.value.includes('/') ? '/' : '\\';
  const dir = lastOutputPath.value.split(sep).slice(0, -1).join(sep);
  await electronAPI.openInExplorer(dir);
}

// ── Toast ──────────────────────────────────────────────────────

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
  --bg-base:       #0d0d14;
  --bg-sidebar:    #111118;
  --bg-card:       #1a1a28;
  --bg-card-hover: #1f1f30;
  --bg-active:     #1e1b3a;
  --text-primary:  #e8e8f2;
  --text-dim:      #8888a8;
  --accent:        #6c5ce7;
  --accent-light:  #a29bfe;
  --accent-glow:   rgba(108, 92, 231, 0.25);
  --border:        #1e1e30;
  --radius-sm:     6px;
  --radius-md:     10px;
  --radius-lg:     16px;
  --transition:    0.18s ease;
}

html, body, #app {
  width: 100%; height: 100%; overflow: hidden;
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

.file-count {
  font-size: 0.78rem;
  color: var(--text-dim);
  white-space: nowrap;
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
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition), opacity var(--transition);
  white-space: nowrap;
}

.btn:disabled { opacity: 0.35; cursor: default; }

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
}
.btn-secondary:hover:not(:disabled) {
  background: #22223a;
  border-color: var(--accent);
}

.btn-clear {
  color: var(--text-dim);
}
.btn-clear:hover:not(:disabled) {
  color: #ff7675;
  border-color: #e17055;
  background: rgba(231, 76, 60, 0.08);
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
  flex-direction: column;
  overflow: hidden;
}

/* ── 空状态拖拽区 ── */
.drop-zone {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  margin: 32px;
  transition: border-color var(--transition), background var(--transition);
}

.drop-zone:hover,
.drag-over .drop-zone {
  border-color: var(--accent);
  background: rgba(108, 92, 231, 0.04);
}

.drop-icon { font-size: 3rem; opacity: 0.5; }
.drop-title { font-size: 1rem; font-weight: 600; color: var(--text-dim); }
.drop-hint { font-size: 0.8rem; color: #555570; }

/* ── 文件列表区 ── */
.list-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
}

.list-wrapper::-webkit-scrollbar {
  width: 5px;
}
.list-wrapper::-webkit-scrollbar-track {
  background: transparent;
}
.list-wrapper::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

/* ── 底部操作栏 ── */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-sidebar);
}

.action-bar-hint {
  font-size: 0.78rem;
  color: var(--text-dim);
}

.btn-merge {
  padding: 8px 28px;
  font-size: 0.88rem;
  font-weight: 600;
}

/* ── 拖拽遮罩（列表非空时） ── */
.drag-mask {
  position: absolute;
  inset: 52px 0 0 0; /* 顶部留出 toolbar 高度 */
  background: rgba(13, 13, 20, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 100;
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

.drag-mask-icon { font-size: 3rem; }

.drag-mask-inner p {
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-light);
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
  font-size: 0.78rem;
  cursor: pointer;
  transition: background var(--transition);
  white-space: nowrap;
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
