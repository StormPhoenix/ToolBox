<template>
  <div
    class="thumb-item"
    :class="{ active: isActive, removed: page.removed }"
    @click="!page.removed && $emit('select', index)"
    @contextmenu.prevent="!page.removed && $emit('contextmenu', $event, index)"
    :title="page.removed ? '已标记移除' : `第 ${page.displayIndex} 页`"
  >
    <!-- 移除标记遮罩 -->
    <div class="removed-overlay" v-if="page.removed">
      <span>已移除</span>
    </div>

    <!-- Canvas 渲染区 -->
    <div class="thumb-canvas-wrap">
      <canvas ref="canvasRef" class="thumb-canvas" />
      <div class="thumb-loading" v-if="loading">
        <div class="spinner" />
      </div>
    </div>

    <!-- 页码 -->
    <div class="thumb-label">{{ page.removed ? '—' : page.displayIndex }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageState } from '../store/pdfState';

const props = defineProps<{
  page: PageState;
  index: number;
  isActive: boolean;
  pdfDoc: PDFDocumentProxy | null;
}>();

defineEmits<{
  select: [index: number];
  contextmenu: [event: MouseEvent, index: number];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);

let renderTask: { cancel: () => void } | null = null;

async function render() {
  if (!props.pdfDoc || !canvasRef.value || props.page.removed) return;
  loading.value = true;

  // pdf.js 页码从 1 开始
  const pdfPage = await props.pdfDoc.getPage(props.page.originalIndex + 1);
  const viewport = pdfPage.getViewport({ scale: 0.3 });

  const canvas = canvasRef.value;
  const ctx = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  if (renderTask) renderTask.cancel();

  renderTask = pdfPage.render({
    canvasContext: ctx,
    viewport,
  }) as unknown as { cancel: () => void };

  try {
    await (renderTask as unknown as Promise<void>);
  } catch {
    // 取消渲染时忽略
  } finally {
    loading.value = false;
  }
}

onMounted(render);
watch(() => props.pdfDoc, render);

onUnmounted(() => {
  if (renderTask) renderTask.cancel();
});
</script>

<style scoped>
.thumb-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  user-select: none;
}

.thumb-item:hover:not(.removed) {
  background: #1a1a28;
  border-color: #2d2d44;
}

.thumb-item.active {
  background: #1e1b3a;
  border-color: #6c5ce7;
}

.thumb-item.removed {
  opacity: 0.35;
  cursor: default;
}

/* Canvas */
.thumb-canvas-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  background: #fff;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumb-canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.thumb-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.7);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #ddd;
  border-top-color: #6c5ce7;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* 移除遮罩 */
.removed-overlay {
  position: absolute;
  inset: 0;
  background: rgba(231, 76, 60, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: #ff7675;
  font-weight: 600;
  letter-spacing: 1px;
  z-index: 1;
  border-radius: 4px;
}

/* 页码 */
.thumb-label {
  font-size: 0.72rem;
  color: #8888a8;
}

.thumb-item.active .thumb-label {
  color: #a29bfe;
}
</style>
