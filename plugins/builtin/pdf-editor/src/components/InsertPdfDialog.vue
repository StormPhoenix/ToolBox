<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-backdrop" @click.self="onCancel">
      <div class="dialog">
        <div class="dialog-header">
          <span class="dialog-title">选择插入页面 — {{ sourceFileName }}</span>
          <button class="dialog-close" @click="onCancel">✕</button>
        </div>

        <div class="dialog-body">

          <!-- 快捷选择栏 -->
          <div class="quick-bar">
            <span class="quick-label">快捷选择：</span>
            <button class="quick-btn" @click="selectAll">全部</button>
            <button class="quick-btn" @click="clearAll">清空</button>
            <span class="selected-count">已选 {{ selectedIndices.size }} / {{ totalPageCount }} 页</span>
          </div>

          <!-- 页码范围输入 -->
          <div class="range-row">
            <label class="range-label">页码范围</label>
            <input
              class="range-input"
              v-model="rangeText"
              placeholder="如：1-3, 5, 7-9"
              @change="applyRange"
            />
            <button class="quick-btn" @click="applyRange">应用</button>
          </div>

          <!-- 缩略图网格 -->
          <div class="thumb-grid" ref="gridRef">
            <div
              v-for="item in thumbItems"
              :key="item.pageIndex"
              class="thumb-cell"
              :class="{ selected: selectedIndices.has(item.pageIndex) }"
              @click="togglePage(item.pageIndex)"
            >
              <div class="cell-canvas-wrap">
                <canvas :ref="el => setCanvasRef(el as HTMLCanvasElement | null, item.pageIndex)" class="cell-canvas" />
                <div class="cell-loading" v-if="item.loading">
                  <div class="spinner" />
                </div>
                <!-- 选中勾 -->
                <div class="cell-check" v-if="selectedIndices.has(item.pageIndex)">✓</div>
              </div>
              <div class="cell-label">{{ item.pageIndex + 1 }}</div>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-secondary" @click="onCancel">取消</button>
          <button
            class="btn btn-primary"
            :disabled="selectedIndices.size === 0"
            @click="onConfirm"
          >
            插入 {{ selectedIndices.size }} 页
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface ThumbItem {
  pageIndex: number;
  loading: boolean;
}

const visible = ref(false);
const sourceFileName = ref('');
const totalPageCount = ref(0);
const rangeText = ref('');
const selectedIndices = reactive(new Set<number>());
const thumbItems = ref<ThumbItem[]>([]);

let sourceDoc: PDFDocumentProxy | null = null;
let sourceBytes: Uint8Array | null = null;
const canvasRefs = new Map<number, HTMLCanvasElement>();

let resolveCallback: ((result: { sourceBytes: Uint8Array; indices: number[] } | null) => void) | null = null;

/** 外部调用：传入已读取的 PDF bytes 和文件名 */
async function open(
  bytes: Uint8Array,
  name: string,
): Promise<{ sourceBytes: Uint8Array; indices: number[] } | null> {
  sourceBytes = bytes;
  sourceFileName.value = name;
  selectedIndices.clear();
  canvasRefs.clear();
  rangeText.value = '';

  // 加载 pdf.js 文档
  const task = pdfjsLib.getDocument({ data: bytes.slice() });
  sourceDoc = await task.promise;
  totalPageCount.value = sourceDoc.numPages;

  // 初始化缩略图列表
  thumbItems.value = Array.from({ length: totalPageCount.value }, (_, i) => ({
    pageIndex: i,
    loading: true,
  }));

  visible.value = true;

  // 渲染缩略图（异步逐页）
  renderThumbs();

  return new Promise(resolve => { resolveCallback = resolve; });
}

function setCanvasRef(el: HTMLCanvasElement | null, pageIndex: number) {
  if (el) {
    canvasRefs.set(pageIndex, el);
  }
}

async function renderThumbs() {
  if (!sourceDoc) return;
  for (let i = 0; i < totalPageCount.value; i++) {
    const item = thumbItems.value[i];
    if (!item) continue;
    const canvas = canvasRefs.get(i);
    if (!canvas) continue;

    try {
      const page = await sourceDoc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 0.25 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
      // 忽略单页渲染失败
    } finally {
      item.loading = false;
    }
  }
}

function togglePage(pageIndex: number) {
  if (selectedIndices.has(pageIndex)) {
    selectedIndices.delete(pageIndex);
  } else {
    selectedIndices.add(pageIndex);
  }
}

function selectAll() {
  for (let i = 0; i < totalPageCount.value; i++) selectedIndices.add(i);
}

function clearAll() {
  selectedIndices.clear();
}

/** 解析 "1-3, 5, 7-9" 格式的页码范围（1-based 输入，转为 0-based） */
function applyRange() {
  const text = rangeText.value.trim();
  if (!text) return;
  selectedIndices.clear();
  const segments = text.split(',');
  for (const seg of segments) {
    const trimmed = seg.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Math.max(1, parseInt(range[1]));
      const end = Math.min(totalPageCount.value, parseInt(range[2]));
      for (let i = start; i <= end; i++) selectedIndices.add(i - 1);
    } else {
      const single = parseInt(trimmed);
      if (!isNaN(single) && single >= 1 && single <= totalPageCount.value) {
        selectedIndices.add(single - 1);
      }
    }
  }
}

function onConfirm() {
  if (!sourceBytes || selectedIndices.size === 0) return;
  // 按源 PDF 顺序排列
  const indices = Array.from(selectedIndices).sort((a, b) => a - b);
  resolveCallback?.({ sourceBytes: sourceBytes, indices });
  cleanup();
}

function onCancel() {
  resolveCallback?.(null);
  cleanup();
}

function cleanup() {
  visible.value = false;
  sourceDoc?.destroy();
  sourceDoc = null;
  sourceBytes = null;
  thumbItems.value = [];
  canvasRefs.clear();
  selectedIndices.clear();
  resolveCallback = null;
}

defineExpose({ open });
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  background: #1a1a28;
  border: 1px solid #2d2d44;
  border-radius: 12px;
  width: 640px;
  max-width: 92vw;
  max-height: 85vh;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: dialogIn 0.15s ease-out;
}

@keyframes dialogIn {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #2d2d44;
  flex-shrink: 0;
}

.dialog-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #e8e8f2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 480px;
}

.dialog-close {
  background: none;
  border: none;
  color: #8888a8;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}
.dialog-close:hover { background: #2a2a40; color: #e8e8f2; }

.dialog-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
}

/* 快捷选择 */
.quick-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.quick-label {
  font-size: 0.78rem;
  color: #8888a8;
}

.quick-btn {
  padding: 4px 10px;
  background: #22223a;
  border: 1px solid #2d2d44;
  border-radius: 5px;
  color: #e8e8f2;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.15s;
}
.quick-btn:hover { background: #2a2a40; border-color: #6c5ce7; }

.selected-count {
  margin-left: auto;
  font-size: 0.78rem;
  color: #a29bfe;
}

/* 范围输入 */
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.range-label {
  font-size: 0.78rem;
  color: #8888a8;
  white-space: nowrap;
}

.range-input {
  flex: 1;
  background: #0d0d14;
  border: 1px solid #2d2d44;
  border-radius: 6px;
  color: #e8e8f2;
  font-size: 0.82rem;
  padding: 5px 10px;
  outline: none;
  transition: border-color 0.15s;
}
.range-input:focus { border-color: #6c5ce7; }

/* 缩略图网格 */
.thumb-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
  padding: 4px 2px;
}

.thumb-grid::-webkit-scrollbar { width: 4px; }
.thumb-grid::-webkit-scrollbar-track { background: transparent; }
.thumb-grid::-webkit-scrollbar-thumb { background: #2d2d44; border-radius: 2px; }

.thumb-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  border-radius: 6px;
  padding: 4px;
  border: 2px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}
.thumb-cell:hover { background: #1a1a28; border-color: #2d2d44; }
.thumb-cell.selected { border-color: #6c5ce7; background: rgba(108,92,231,0.1); }

.cell-canvas-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  background: #fff;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cell-canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.cell-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.7);
}

.cell-check {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  background: #6c5ce7;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  color: #fff;
  font-weight: 700;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #ddd;
  border-top-color: #6c5ce7;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.cell-label {
  font-size: 0.68rem;
  color: #8888a8;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #2d2d44;
  flex-shrink: 0;
}

.btn {
  padding: 7px 18px;
  border-radius: 7px;
  border: 1px solid #2d2d44;
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s;
}
.btn:disabled { opacity: 0.35; cursor: default; }

.btn-secondary { background: #22223a; color: #e8e8f2; }
.btn-secondary:hover:not(:disabled) { background: #2a2a40; }

.btn-primary { background: #6c5ce7; color: #fff; border-color: #6c5ce7; }
.btn-primary:hover:not(:disabled) { background: #5a4bd1; }
</style>
