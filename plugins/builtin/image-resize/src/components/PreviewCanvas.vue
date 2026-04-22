<script setup lang="ts">
/**
 * 预览区核心组件：
 * - 空态：Drop Zone（由父组件控制显示与否）
 * - 有原图无预览：提示
 * - generating：spinner
 * - done：canvas 渲染预览 + 拖拽/缩放
 * - error：错误面板
 */
import { ref, watch, onMounted, nextTick, computed } from 'vue';
import { useCanvasViewport } from '../composables/useCanvasViewport';
import type { ResizeSuccess } from '@toolbox/bridge';

const props = defineProps<{
  status: 'empty' | 'imported' | 'generating' | 'done' | 'error';
  result: ResizeSuccess | null;
  errorMsg: string | null;
  errorDetail: string | null;
  /** 当前选中算法名，用于 loading 文案 */
  algorithmName?: string;
  /** 参数是否已修改（dirty 时显示黄色提示条） */
  dirty: boolean;
}>();

const emit = defineEmits<{
  (e: 'retry'): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wrapperRef = ref<HTMLDivElement | null>(null);
const imageSize = ref<{ width: number; height: number } | null>(null);

let bitmap: ImageBitmap | null = null;
const showDetail = ref(false);

const vp = useCanvasViewport({
  canvasRef,
  imageSize,
});

// ── 加载预览图 ───────────────────────────────────────────────────────────

async function loadPreview(tempPath: string): Promise<void> {
  try {
    // 用 fetch + blob + createImageBitmap 高效解码
    const res = await fetch('file://' + tempPath);
    const blob = await res.blob();
    if (bitmap) {
      bitmap.close?.();
      bitmap = null;
    }
    bitmap = await createImageBitmap(blob);
    imageSize.value = { width: bitmap.width, height: bitmap.height };
    await nextTick();
    vp.fit();
    draw();
  } catch (err) {
    console.error('预览加载失败', err);
  }
}

watch(
  () => props.result?.tempOutputPath,
  (path) => {
    if (path) loadPreview(path);
    else {
      bitmap?.close?.();
      bitmap = null;
      imageSize.value = null;
      const canvas = canvasRef.value;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }
);

// 重绘：每次 transform 变化时调用
function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas || !bitmap) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== canvas.clientWidth * dpr) {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  // 棋盘格背景
  drawChecker(ctx, canvas.clientWidth, canvas.clientHeight);

  // 应用视图变换
  ctx.translate(vp.transform.offsetX, vp.transform.offsetY);
  ctx.scale(vp.transform.scale, vp.transform.scale);
  ctx.imageSmoothingEnabled = vp.transform.scale < 4;
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
}

function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const size = 12;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      const odd = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = odd ? '#12121c' : '#16162a';
      ctx.fillRect(x, y, size, size);
    }
  }
}

// 监听 transform 变化重绘
watch(
  () => [vp.transform.scale, vp.transform.offsetX, vp.transform.offsetY],
  () => draw()
);

// resize observer 自适应画布尺寸
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (wrapperRef.value) {
    ro = new ResizeObserver(() => {
      if (bitmap) {
        vp.fit();
      }
      draw();
    });
    ro.observe(wrapperRef.value);
  }
});

const scalePct = computed(() => Math.round(vp.transform.scale * 100));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
</script>

<template>
  <div class="preview-wrap" ref="wrapperRef">
    <!-- Dirty 提示 -->
    <div v-if="dirty && status === 'done'" class="dirty-banner">
      ⚠️ 参数已修改，点击"生成"以更新预览
    </div>

    <!-- 有结果：显示 canvas -->
    <template v-if="status === 'done' && result">
      <canvas
        ref="canvasRef"
        class="preview-canvas"
        @wheel="vp.onWheel"
        @mousedown.prevent="vp.onMouseDown"
        @dblclick="vp.onDoubleClick"
      />
      <!-- 底部工具栏 -->
      <div class="toolbar">
        <button @click="vp.zoomBy(1 / 1.25)">−</button>
        <span class="scale-indicator">{{ scalePct }}%</span>
        <button @click="vp.zoomBy(1.25)">+</button>
        <button @click="vp.fit()">适应</button>
        <button @click="vp.actualSize()">1:1</button>
      </div>

      <!-- 结果信息 -->
      <div class="result-info">
        <div class="info-row">
          <span>输出分辨率</span>
          <span class="value">{{ result.width }} × {{ result.height }}</span>
        </div>
        <div class="info-row">
          <span>文件大小</span>
          <span class="value">{{ formatSize(result.byteSize) }}</span>
        </div>
        <div class="info-row">
          <span>算法</span>
          <span class="value">{{ result.actualAlgorithm }}</span>
        </div>
        <div class="info-row">
          <span>耗时</span>
          <span class="value">{{ result.durationMs }} ms</span>
        </div>
        <div v-if="result.warnings && result.warnings.length" class="warnings">
          <div v-for="w in result.warnings" :key="w">⚠️ {{ w }}</div>
        </div>
      </div>
    </template>

    <!-- generating -->
    <div v-else-if="status === 'generating'" class="state-panel">
      <div class="spinner" />
      <div class="state-title">
        {{ algorithmName ? `正在使用 ${algorithmName} 处理…` : '正在处理…' }}
      </div>
      <div class="state-hint">大图处理较慢，请耐心等待</div>
    </div>

    <!-- error -->
    <div v-else-if="status === 'error'" class="state-panel error">
      <div class="state-icon">⚠️</div>
      <div class="state-title">处理失败</div>
      <div class="state-msg">{{ errorMsg }}</div>
      <button v-if="errorDetail" class="link-btn" @click="showDetail = !showDetail">
        {{ showDetail ? '▲ 收起详情' : '▼ 查看详情' }}
      </button>
      <pre v-if="showDetail && errorDetail" class="error-detail">{{ errorDetail }}</pre>
      <button class="primary" style="margin-top: 12px" @click="$emit('retry')">重试</button>
    </div>

    <!-- imported but no preview -->
    <div v-else-if="status === 'imported'" class="state-panel">
      <div class="state-icon">🎨</div>
      <div class="state-title">点击『生成』查看处理后的预览</div>
      <div class="state-hint">
        在左侧设置最大长边与算法，然后点击左下角的生成按钮
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--bg-content);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

.preview-canvas:active {
  cursor: grabbing;
}

.toolbar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  background: rgba(20, 20, 32, 0.9);
  backdrop-filter: blur(8px);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  z-index: 2;
}

.toolbar button {
  padding: 4px 10px;
  min-width: 32px;
  font-size: 12px;
}

.scale-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  font-size: 12px;
  color: var(--text-secondary);
  font-family: 'SF Mono', ui-monospace, monospace;
}

.result-info {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(20, 20, 32, 0.9);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 12px;
  min-width: 200px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  color: var(--text-dim);
}

.info-row .value {
  color: var(--text-primary);
  font-family: 'SF Mono', ui-monospace, monospace;
}

.warnings {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
  color: var(--warning);
  font-size: 11px;
}

.state-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-secondary);
  padding: 24px;
  text-align: center;
}

.state-icon {
  font-size: 40px;
}

.state-title {
  font-size: 16px;
  color: var(--text-primary);
  font-weight: 500;
}

.state-hint {
  font-size: 12px;
  color: var(--text-dim);
  max-width: 320px;
}

.state-msg {
  font-size: 13px;
  color: var(--error);
  max-width: 420px;
}

.state-panel.error .state-title {
  color: var(--error);
}

.link-btn {
  background: transparent;
  border: none;
  color: var(--accent-light);
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.error-detail {
  max-width: 480px;
  max-height: 160px;
  overflow: auto;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: left;
  white-space: pre-wrap;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.dirty-banner {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 228px;
  background: rgba(241, 196, 15, 0.12);
  border: 1px solid rgba(241, 196, 15, 0.35);
  color: var(--warning);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 12px;
  z-index: 2;
}
</style>
