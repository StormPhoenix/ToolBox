/**
 * Canvas 视口变换（拖拽平移 + 滚轮缩放）
 *
 * 使用方式：
 *   const { transform, onWheel, onMouseDown, reset, fit } = useCanvasViewport(...)
 *   将 onWheel、onMouseDown 绑到 canvas 元素；transform.value 用于 ctx.setTransform。
 */
import { reactive, type Ref, computed, onMounted, onUnmounted } from 'vue';

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface UseCanvasViewportOptions {
  canvasRef: Ref<HTMLCanvasElement | null>;
  /** 图像的自然宽高；null 表示未加载 */
  imageSize: Ref<{ width: number; height: number } | null>;
  /** 最小缩放倍率（可选，默认 fitToWindow） */
  minScale?: number;
  /** 最大缩放倍率 */
  maxScale?: number;
}

export function useCanvasViewport(opts: UseCanvasViewportOptions) {
  const MAX_SCALE = opts.maxScale ?? 16;

  const state = reactive<ViewTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  // 适应窗口时的 scale（动态计算）
  const fitScale = computed((): number => {
    const canvas = opts.canvasRef.value;
    const img = opts.imageSize.value;
    if (!canvas || !img) return 1;
    const sx = canvas.clientWidth / img.width;
    const sy = canvas.clientHeight / img.height;
    return Math.min(sx, sy, 1); // 不超过 100%
  });

  const minScale = computed((): number => {
    return opts.minScale ?? Math.min(fitScale.value, 1) * 0.5;
  });

  function clampScale(s: number): number {
    return Math.max(minScale.value, Math.min(MAX_SCALE, s));
  }

  /** 滚轮缩放：以鼠标位置为锚点 */
  function onWheel(e: WheelEvent): void {
    const canvas = opts.canvasRef.value;
    if (!canvas || !opts.imageSize.value) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.0015);
    const newScale = clampScale(state.scale * factor);
    if (newScale === state.scale) return;

    // 锚点公式：new = mouse - (mouse - old) * (newScale / oldScale)
    const k = newScale / state.scale;
    state.offsetX = mx - (mx - state.offsetX) * k;
    state.offsetY = my - (my - state.offsetY) * k;
    state.scale = newScale;
  }

  // 拖拽
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onMouseDown(e: MouseEvent): void {
    if (!opts.imageSize.value) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    state.offsetX += e.clientX - lastX;
    state.offsetY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onMouseUp(): void {
    dragging = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  /** 适应窗口：居中 + 缩放至完整可见 */
  function fit(): void {
    const canvas = opts.canvasRef.value;
    const img = opts.imageSize.value;
    if (!canvas || !img) return;
    const s = fitScale.value;
    state.scale = s;
    state.offsetX = (canvas.clientWidth - img.width * s) / 2;
    state.offsetY = (canvas.clientHeight - img.height * s) / 2;
  }

  /** 切换到 1:1 */
  function actualSize(): void {
    const canvas = opts.canvasRef.value;
    const img = opts.imageSize.value;
    if (!canvas || !img) return;
    state.scale = 1;
    state.offsetX = (canvas.clientWidth - img.width) / 2;
    state.offsetY = (canvas.clientHeight - img.height) / 2;
  }

  /** 双击在 fit ↔ 100% 间切换 */
  function onDoubleClick(): void {
    const f = fitScale.value;
    if (Math.abs(state.scale - 1) < 0.01) {
      fit();
    } else {
      if (Math.abs(state.scale - f) < 0.01) actualSize();
      else fit();
    }
  }

  /** 放大 / 缩小（按中心） */
  function zoomBy(factor: number): void {
    const canvas = opts.canvasRef.value;
    if (!canvas) return;
    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;
    const newScale = clampScale(state.scale * factor);
    if (newScale === state.scale) return;
    const k = newScale / state.scale;
    state.offsetX = cx - (cx - state.offsetX) * k;
    state.offsetY = cy - (cy - state.offsetY) * k;
    state.scale = newScale;
  }

  function reset(): void {
    state.scale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
  }

  // 键盘快捷键
  function onKeyDown(e: KeyboardEvent): void {
    // 仅在没有输入框聚焦时响应
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (e.key === '+' || e.key === '=') {
      zoomBy(1.2);
      e.preventDefault();
    } else if (e.key === '-') {
      zoomBy(1 / 1.2);
      e.preventDefault();
    } else if (e.key === '0') {
      fit();
      e.preventDefault();
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

  return {
    transform: state,
    fitScale,
    onWheel,
    onMouseDown,
    onDoubleClick,
    fit,
    actualSize,
    zoomBy,
    reset,
  };
}
