<template>
  <div class="app">

    <!-- ── 顶部工具栏 ── -->
    <header class="toolbar">
      <div class="toolbar-left">
        <span class="app-title">📄 PDF 编辑</span>
        <span class="file-name" v-if="fileName">{{ fileName }}</span>
        <span class="dirty-dot" v-if="isDirty" title="有未保存的修改">●</span>
      </div>

      <div class="toolbar-actions">
        <button class="btn btn-secondary" @click="importFromDialog">
          📂 打开文件
        </button>
        <template v-if="pdfDoc">
          <button
            class="btn btn-danger"
            :disabled="removedCount === 0"
            @click="undoAllRemove"
            title="撤销所有移除操作"
          >
            ↩ 撤销移除（{{ removedCount }}）
          </button>
          <button
            class="btn btn-primary"
            :disabled="!isDirty || saving"
            @click="onSave"
          >
            {{ saving ? '保存中...' : '💾 保存' }}
          </button>
          <button
            class="btn btn-secondary"
            :disabled="saving"
            @click="onSaveAs"
          >
            📤 另存为
          </button>
        </template>
      </div>
    </header>

    <!-- ── 主体 ── -->
    <div
      class="main-body"
      @dragover.prevent
      @drop="onDrop"
    >
      <!-- 拖拽导入提示（未加载时全屏显示） -->
      <div class="drop-zone" v-if="!pdfDoc" @click="importFromDialog">
        <div class="drop-icon">📄</div>
        <p class="drop-title">点击或拖拽 PDF 文件到此处</p>
        <p class="drop-hint">支持 .pdf 格式</p>
      </div>

      <!-- 左右布局（已加载） -->
      <template v-else>
        <ThumbnailPanel
          :pages="pages"
          :activePageIndex="activePageIndex"
          :pdfDoc="pdfDoc"
          @select="selectPage"
          @contextmenu="onThumbContextMenu"
        />

        <PreviewArea
          :currentPage="currentVisiblePage"
          :pdfDoc="pdfDoc"
          :visibleTotal="visiblePages.length"
          :isFirst="visibleActiveIndex <= 0"
          :isLast="visibleActiveIndex >= visiblePages.length - 1"
          @prev="goPrev"
          @next="goNext"
        />
      </template>
    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      ref="ctxMenuRef"
      @remove="onRemovePage"
    />

    <!-- Toast 提示 -->
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.type}`">
        {{ toast.message }}
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import ThumbnailPanel from './components/ThumbnailPanel.vue';
import PreviewArea from './components/PreviewArea.vue';
import ContextMenu from './components/ContextMenu.vue';
import {
  importFromDialog,
  importFromDrop,
  markPageRemoved,
  savePdf,
  saveAsPdf,
} from './composables/usePdf';
import {
  pdfDoc,
  fileName,
  pages,
  activePageIndex,
  isDirty,
  visiblePages,
} from './store/pdfState';

// ── 右键菜单引用 ──
const ctxMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null);

// ── 保存状态 ──
const saving = ref(false);

// ── Toast ──
const toast = reactive({ visible: false, message: '', type: 'success' as 'success' | 'error' });
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, type: 'success' | 'error' = 'success') {
  if (toastTimer) clearTimeout(toastTimer);
  toast.message = message;
  toast.type = type;
  toast.visible = true;
  toastTimer = setTimeout(() => { toast.visible = false; }, 2500);
}

// ── 计算属性 ──
const removedCount = computed(() => pages.value.filter(p => p.removed).length);

const visibleActiveIndex = computed(() => {
  const active = pages.value[activePageIndex.value];
  if (!active) return -1;
  return visiblePages.value.indexOf(active);
});

const currentVisiblePage = computed(() => {
  const active = pages.value[activePageIndex.value];
  if (!active || active.removed) return visiblePages.value[0] ?? null;
  return active;
});

// ── 事件处理 ──
function selectPage(index: number) {
  activePageIndex.value = index;
}

function onThumbContextMenu(event: MouseEvent, index: number) {
  ctxMenuRef.value?.open(event, index);
}

function onRemovePage(pageIndex: number) {
  markPageRemoved(pageIndex);
}

function goPrev() {
  const idx = visibleActiveIndex.value;
  if (idx <= 0) return;
  const prev = visiblePages.value[idx - 1];
  activePageIndex.value = pages.value.indexOf(prev);
}

function goNext() {
  const idx = visibleActiveIndex.value;
  if (idx >= visiblePages.value.length - 1) return;
  const next = visiblePages.value[idx + 1];
  activePageIndex.value = pages.value.indexOf(next);
}

async function onDrop(event: DragEvent) {
  await importFromDrop(event);
}

function undoAllRemove() {
  pages.value.forEach(p => { p.removed = false; });
  isDirty.value = false;
}

async function onSave() {
  saving.value = true;
  try {
    const ok = await savePdf();
    if (ok) showToast('✅ 保存成功');
  } catch (e: any) {
    showToast(`❌ 保存失败：${e?.message ?? '未知错误'}`, 'error');
  } finally {
    saving.value = false;
  }
}

async function onSaveAs() {
  saving.value = true;
  try {
    const ok = await saveAsPdf();
    if (ok) showToast('✅ 另存为成功');
  } catch (e: any) {
    showToast(`❌ 保存失败：${e?.message ?? '未知错误'}`, 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<style>
/* 全局重置 */
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
  max-width: 240px;
}

.dirty-dot {
  color: #fdcb6e;
  font-size: 0.7rem;
  flex-shrink: 0;
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

.btn:disabled {
  opacity: 0.35;
  cursor: default;
}

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
.btn-primary:hover:not(:disabled) {
  background: #5a4bd1;
}

.btn-danger {
  background: rgba(231, 76, 60, 0.12);
  color: #ff7675;
  border-color: rgba(231, 76, 60, 0.3);
}
.btn-danger:hover:not(:disabled) {
  background: rgba(231, 76, 60, 0.2);
}

/* ── 主体 ── */
.main-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── 拖拽导入区 ── */
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

.drop-icon {
  font-size: 3rem;
  opacity: 0.5;
}

.drop-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-dim);
}

.drop-hint {
  font-size: 0.8rem;
  color: #555570;
}

/* ── Toast ── */
.toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 22px;
  border-radius: 24px;
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
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
