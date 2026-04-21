<template>
  <div class="preview-area" ref="wrapRef">
    <div class="preview-scroll">
      <div class="canvas-container" v-if="currentPage && pdfDoc">
        <canvas ref="canvasRef" class="pdf-canvas" />
        <div class="page-loading" v-if="rendering">
          <div class="spinner" />
        </div>
      </div>
      <div class="preview-empty" v-else>
        <span>请选择页面</span>
      </div>
    </div>

    <!-- 底部页码导航 -->
    <div class="preview-footer" v-if="currentPage">
      <button class="nav-btn" :disabled="isFirst" @click="$emit('prev')">‹</button>
      <span class="page-info">
        第 <strong>{{ currentPage.displayIndex }}</strong> 页
        &nbsp;/&nbsp;
        共 <strong>{{ visibleTotal }}</strong> 页
      </span>
      <button class="nav-btn" :disabled="isLast" @click="$emit('next')">›</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageState } from '../store/pdfState';

const props = defineProps<{
  currentPage: PageState | null;
  pdfDoc: PDFDocumentProxy | null;
  visibleTotal: number;
  isFirst: boolean;
  isLast: boolean;
}>();

defineEmits<{ prev: []; next: [] }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wrapRef = ref<HTMLElement | null>(null);
const rendering = ref(false);

let currentRenderTask: { cancel: () => void } | null = null;

watch(
  () => [props.currentPage, props.pdfDoc] as const,
  async ([page, doc]) => {
    if (!page || !doc) return;

    // 等待 DOM 更新（canvas 由 v-if 控制，需先挂载）
    await nextTick();
    if (!canvasRef.value) return;

    rendering.value = true;
    if (currentRenderTask) currentRenderTask.cancel();

    const pdfPage = await doc.getPage(page.originalIndex + 1);

    // 根据容器宽度自适应 scale
    const containerWidth = wrapRef.value?.clientWidth ?? 600;
    const targetWidth = Math.min(containerWidth - 48, 900);
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const scale = targetWidth / baseViewport.width;
    const viewport = pdfPage.getViewport({ scale });

    const canvas = canvasRef.value!;
    const ctx = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const task = pdfPage.render({ canvasContext: ctx, viewport });
    currentRenderTask = task as unknown as { cancel: () => void };

    try {
      await task.promise;
    } catch {
      // 取消时忽略
    } finally {
      rendering.value = false;
    }
  },
  { immediate: true, flush: 'post' }
);
</script>

<style scoped>
.preview-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #0f0f17;
}

.preview-scroll {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 24px;
}

.canvas-container {
  position: relative;
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.6);
  border-radius: 2px;
}

.pdf-canvas {
  display: block;
  max-width: 100%;
}

.page-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 15, 23, 0.6);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #2d2d44;
  border-top-color: #6c5ce7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.preview-empty {
  color: #555570;
  font-size: 0.9rem;
  margin-top: 80px;
}

/* 底部导航 */
.preview-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 10px;
  border-top: 1px solid #1e1e30;
  background: #111118;
  flex-shrink: 0;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #2d2d44;
  background: #1a1a28;
  color: #e8e8f2;
  font-size: 1.1rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.nav-btn:hover:not(:disabled) {
  background: #22223a;
  border-color: #6c5ce7;
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.page-info {
  font-size: 0.82rem;
  color: #8888a8;
  min-width: 120px;
  text-align: center;
}

.page-info strong {
  color: #e8e8f2;
}
</style>
