<template>
  <div
    class="thumb-item"
    :class="{ selected: isSelected }"
    @click.exact="onSingleClick"
    @click.ctrl.exact="onCtrlClick"
    @click.meta.exact="onCtrlClick"
    @click.shift.exact="onShiftClick"
    :title="`第 ${pageNum} 页`"
  >
    <div class="thumb-canvas-wrap">
      <canvas ref="canvasRef" class="thumb-canvas" />
      <div class="thumb-loading" v-if="loading">
        <div class="spinner" />
      </div>
      <!-- 选中对勾 -->
      <div class="check-badge" v-if="isSelected">✓</div>
    </div>
    <div class="thumb-label">{{ pageNum }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const props = defineProps<{
  pageNum: number;
  pdfDoc: PDFDocumentProxy | null;
  isSelected: boolean;
}>();

const emit = defineEmits<{
  click: [page: number, mode: 'single' | 'ctrl' | 'shift'];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);

let renderTask: { cancel: () => void } | null = null;

function onSingleClick(): void { emit('click', props.pageNum, 'single'); }
function onCtrlClick(): void { emit('click', props.pageNum, 'ctrl'); }
function onShiftClick(): void { emit('click', props.pageNum, 'shift'); }

async function render(): Promise<void> {
  if (!props.pdfDoc || !canvasRef.value) return;
  loading.value = true;

  if (renderTask) renderTask.cancel();

  const pdfPage = await props.pdfDoc.getPage(props.pageNum);
  const viewport = pdfPage.getViewport({ scale: 0.3 });

  const canvas = canvasRef.value;
  const ctx = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  renderTask = pdfPage.render({ canvasContext: ctx, viewport }) as unknown as { cancel: () => void };

  try {
    await (renderTask as unknown as Promise<void>);
  } catch {
    // 取消时忽略
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
  gap: 5px;
  padding: 6px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  user-select: none;
}

.thumb-item:hover {
  background: #1a1a28;
  border-color: #2d2d44;
}

.thumb-item.selected {
  background: #1e1b3a;
  border-color: #6c5ce7;
}

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
  background: rgba(255, 255, 255, 0.7);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #ddd;
  border-top-color: #6c5ce7;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.check-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  background: #6c5ce7;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.thumb-label {
  font-size: 0.7rem;
  color: #8888a8;
}

.thumb-item.selected .thumb-label {
  color: #a29bfe;
}
</style>
