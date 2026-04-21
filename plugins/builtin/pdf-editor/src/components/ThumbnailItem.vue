<template>
  <div
    class="thumb-item"
    :class="{ active: isActive, removed: page.removed, inserted: isInserted }"
    @click="!page.removed && $emit('select', index)"
    @contextmenu.prevent="!page.removed && $emit('contextmenu', $event, index)"
    :title="itemTitle"
  >
    <!-- 撤销按钮（仅有修改时显示） -->
    <button
      v-if="hasModification"
      class="revert-btn"
      :title="revertTitle"
      @click.stop="$emit('revert', index)"
    >
      ↩
    </button>

    <!-- 移除标记遮罩 -->
    <div class="removed-overlay" v-if="page.removed">
      <span>已移除</span>
    </div>

    <!-- 缩略图内容区 -->
    <div class="thumb-canvas-wrap">

      <!-- 原始页：用 canvas 渲染 -->
      <template v-if="page.kind === 'original'">
        <canvas ref="canvasRef" class="thumb-canvas" />
        <div class="thumb-loading" v-if="loading">
          <div class="spinner" />
        </div>
      </template>

      <!-- 空白页：白色矩形占位 -->
      <template v-else-if="page.kind === 'blank'">
        <div class="blank-placeholder">
          <span class="blank-icon">📄</span>
          <span class="blank-label">空白页</span>
        </div>
      </template>

      <!-- 图片页：直接显示图片 -->
      <template v-else-if="page.kind === 'image'">
        <img :src="page.objectUrl" class="thumb-img" alt="插入图片" />
        <div class="insert-badge">🖼</div>
      </template>

      <!-- PDF 插入页：PDF 图标占位 -->
      <template v-else-if="page.kind === 'pdf'">
        <div class="pdf-placeholder">
          <span class="pdf-icon">📋</span>
          <span class="pdf-label">{{ page.sourcePageIndices.length }} 页</span>
        </div>
        <div class="insert-badge">PDF</div>
      </template>

    </div>

    <!-- 页码 -->
    <div class="thumb-label">{{ page.removed ? '—' : page.displayIndex }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
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
  revert: [index: number];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);

let renderTask: { cancel: () => void } | null = null;

/** 是否为插入页（非原始页） */
const isInserted = computed(() => props.page.kind !== 'original');

/** 是否有修改（删除标记 或 插入页） */
const hasModification = computed(() => props.page.removed || isInserted.value);

const itemTitle = computed(() => {
  if (props.page.removed) return '已标记移除';
  if (props.page.kind === 'blank') return `第 ${props.page.displayIndex} 页（插入空白页）`;
  if (props.page.kind === 'image') return `第 ${props.page.displayIndex} 页（插入图片）`;
  if (props.page.kind === 'pdf') return `第 ${props.page.displayIndex} 页（插入 PDF）`;
  return `第 ${props.page.displayIndex} 页`;
});

const revertTitle = computed(() => {
  if (props.page.removed) return '撤销移除';
  return '撤销插入';
});

async function render(): Promise<void> {
  if (props.page.kind !== 'original') return;
  if (!props.pdfDoc || !canvasRef.value || props.page.removed) return;

  loading.value = true;
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

/* 插入页：左侧绿色细边框提示 */
.thumb-item.inserted {
  border-left-color: #00b894;
}

/* 撤销按钮 */
.revert-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 5;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(136, 136, 168, 0.5);
  color: #e8e8f2;
  font-size: 0.72rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  line-height: 1;
}

.revert-btn:hover {
  background: rgba(108, 92, 231, 0.85);
}

/* Canvas（原始页） */
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

/* 空白页占位 */
.blank-placeholder {
  width: 100%;
  height: 100%;
  background: #f8f8f8;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.blank-icon { font-size: 1.4rem; opacity: 0.4; }
.blank-label { font-size: 0.6rem; color: #999; }

/* 图片页 */
.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* PDF 占位 */
.pdf-placeholder {
  width: 100%;
  height: 100%;
  background: #eef0f8;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.pdf-icon { font-size: 1.6rem; }
.pdf-label { font-size: 0.6rem; color: #666; }

/* 插入类型徽标 */
.insert-badge {
  position: absolute;
  bottom: 3px;
  right: 3px;
  background: rgba(108, 92, 231, 0.85);
  color: #fff;
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  line-height: 1.4;
}

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
.thumb-item.active .thumb-label { color: #a29bfe; }
</style>
