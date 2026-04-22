<template>
  <div class="crop-preview-wrap">

    <!-- 无图片 -->
    <div class="empty-state" v-if="!sourceImage">
      <span class="empty-icon">🖼️</span>
      <p>请先导入图片</p>
    </div>

    <!-- 有图片但无预设 -->
    <div class="empty-state" v-else-if="!activePreset">
      <span class="empty-icon">📐</span>
      <p>请从左侧添加并选择预设</p>
    </div>

    <!-- 裁剪预览 -->
    <template v-else>
      <!-- 安全区开关 -->
      <div class="toolbar">
        <span class="preset-label">{{ activePreset.name }} · {{ activePreset.width }}×{{ activePreset.height }}</span>
        <label class="safe-toggle">
          <input type="checkbox" v-model="showSafeArea" />
          <span>安全区域</span>
        </label>
        <button class="btn-reset" @click="resetCrop" title="双击或点击此处重置">↺ 重置</button>
      </div>

      <!-- 画布容器 -->
      <div
        class="canvas-container"
        ref="containerRef"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @dblclick="resetCrop"
      >
        <canvas ref="canvasRef" class="preview-canvas" />
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { sourceImage } from '../composables/useSourceImage';
import { activePresetId, workingPresets } from '../composables/usePresets';
import { getCropState, resetCropState, computeCropRect } from '../composables/useCropState';
import { BUILTIN_PRESETS } from '../data/builtin-presets';

const showSafeArea = ref(true);
const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const activePreset = computed(() =>
  activePresetId.value
    ? BUILTIN_PRESETS.find(p => p.id === activePresetId.value) ?? null
    : null,
);

// ── 渲染 ────────────────────────────────────────────────────────────────────

function render(): void {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  const img = sourceImage.value;
  const preset = activePreset.value;
  if (!canvas || !container || !img || !preset) return;

  const state = getCropState(preset.id);
  const { sx, sy, sw, sh } = computeCropRect(
    img.width, img.height,
    preset.width, preset.height,
    state,
  );

  // 画布尺寸适配容器（保持比例）
  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const presetRatio = preset.width / preset.height;
  let drawW = containerW;
  let drawH = drawW / presetRatio;
  if (drawH > containerH) {
    drawH = containerH;
    drawW = drawH * presetRatio;
  }
  // 减去 padding
  const pad = 24;
  drawW = Math.max(1, drawW - pad * 2);
  drawH = Math.max(1, drawH - pad * 2);

  canvas.width = Math.round(drawW);
  canvas.height = Math.round(drawH);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 绘制裁剪后的图片
  ctx.drawImage(img.bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // 安全区遮罩
  if (showSafeArea.value) {
    const sa = preset.safeArea;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';

    const cw = canvas.width;
    const ch = canvas.height;

    if (sa.top > 0) ctx.fillRect(0, 0, cw, ch * sa.top);
    if (sa.bottom > 0) ctx.fillRect(0, ch * (1 - sa.bottom), cw, ch * sa.bottom);
    if (sa.left > 0) ctx.fillRect(0, 0, cw * sa.left, ch);
    if (sa.right > 0) ctx.fillRect(cw * (1 - sa.right), 0, cw * sa.right, ch);

    // 虚线边框
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    if (sa.top > 0) {
      ctx.beginPath();
      ctx.moveTo(0, ch * sa.top);
      ctx.lineTo(cw, ch * sa.top);
      ctx.stroke();
    }
    if (sa.bottom > 0) {
      ctx.beginPath();
      ctx.moveTo(0, ch * (1 - sa.bottom));
      ctx.lineTo(cw, ch * (1 - sa.bottom));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

// ── RAF 节流 ─────────────────────────────────────────────────────────────────

let rafId: number | null = null;

function scheduleRender(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    render();
  });
}

// ── 拖拽 ─────────────────────────────────────────────────────────────────────

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartCx = 0;
let dragStartCy = 0;

function onMouseDown(e: MouseEvent): void {
  if (!activePreset.value || !sourceImage.value) return;
  dragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const state = getCropState(activePreset.value.id);
  dragStartCx = state.cx;
  dragStartCy = state.cy;
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging || !activePreset.value || !sourceImage.value || !canvasRef.value) return;

  const preset = activePreset.value;
  const img = sourceImage.value;
  const state = getCropState(preset.id);

  // 鼠标移动量在画布上的比例 → 映射到图片坐标系
  const { sw, sh } = computeCropRect(img.width, img.height, preset.width, preset.height, state);
  const canvas = canvasRef.value;

  // 每像素对应多少图片坐标
  const dxImg = ((e.clientX - dragStartX) / canvas.width) * sw;
  const dyImg = ((e.clientY - dragStartY) / canvas.height) * sh;

  // 拖拽方向相反（拖图片时 cx 减小）
  state.cx = Math.max(0, Math.min(1, dragStartCx - dxImg / img.width));
  state.cy = Math.max(0, Math.min(1, dragStartCy - dyImg / img.height));

  scheduleRender();
}

function onMouseUp(): void {
  dragging = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
}

// ── 滚轮缩放 ─────────────────────────────────────────────────────────────────

function onWheel(e: WheelEvent): void {
  if (!activePreset.value || !sourceImage.value) return;
  const state = getCropState(activePreset.value.id);
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  state.zoom = Math.max(1, Math.min(10, state.zoom + delta));
  scheduleRender();
}

// ── 重置 ─────────────────────────────────────────────────────────────────────

function resetCrop(): void {
  if (!activePreset.value) return;
  resetCropState(activePreset.value.id);
  scheduleRender();
}

// ── ResizeObserver ────────────────────────────────────────────────────────────

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => scheduleRender());
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  if (rafId !== null) cancelAnimationFrame(rafId);
});

// 监听依赖变化 → 重新渲染
watch(
  [activePresetId, sourceImage, showSafeArea],
  () => nextTick(() => scheduleRender()),
);
</script>

<style scoped>
.crop-preview-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-base);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-dim, #555570);
}

.empty-icon { font-size: 2.5rem; opacity: 0.5; }

.empty-state p {
  font-size: 0.85rem;
}

/* ── 顶部工具条 ── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-sidebar);
}

.preset-label {
  flex: 1;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
}

.safe-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.78rem;
  color: var(--text-secondary, #8888a8);
  cursor: pointer;
  user-select: none;
}

.safe-toggle input[type="checkbox"] {
  accent-color: var(--accent);
  cursor: pointer;
}

.btn-reset {
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary, #8888a8);
  font-size: 0.75rem;
  cursor: pointer;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
  white-space: nowrap;
}

.btn-reset:hover {
  border-color: var(--accent);
  color: var(--accent-light);
  background: var(--bg-active);
}

/* ── 画布容器 ── */
.canvas-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  padding: 24px;
}

.canvas-container:active {
  cursor: grabbing;
}

.preview-canvas {
  display: block;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  max-width: 100%;
  max-height: 100%;
}
</style>
