import { reactive } from 'vue';

/**
 * 每个预设独立的裁剪状态。
 * cx/cy：图片中心点在图片坐标系中的归一化位置（0–1），初始 0.5。
 * zoom：缩放系数，1 = cover 铺满（不留黑边），> 1 表示放大。
 */
export interface CropState {
  cx: number;
  cy: number;
  zoom: number;
}

// key: presetId → CropState
const cropStates = reactive<Record<string, CropState>>({});

function defaultState(): CropState {
  return { cx: 0.5, cy: 0.5, zoom: 1 };
}

export function getCropState(presetId: string): CropState {
  if (!cropStates[presetId]) {
    cropStates[presetId] = defaultState();
  }
  return cropStates[presetId];
}

export function resetCropState(presetId: string): void {
  cropStates[presetId] = defaultState();
}

export function removeCropState(presetId: string): void {
  delete cropStates[presetId];
}

/**
 * 计算裁剪矩形（源图坐标系）。
 *
 * 返回 { sx, sy, sw, sh }：
 *   drawImage(bitmap, sx, sy, sw, sh, 0, 0, preset.width, preset.height)
 */
export function computeCropRect(
  imgW: number,
  imgH: number,
  presetW: number,
  presetH: number,
  state: CropState,
): { sx: number; sy: number; sw: number; sh: number } {
  const r = presetW / presetH;

  // 1. cover 铺满时的裁剪尺寸（zoom=1 基准）
  let sw: number;
  let sh: number;
  if (imgW / imgH >= r) {
    // 图片更宽：以高度为基准
    sh = imgH;
    sw = sh * r;
  } else {
    // 图片更高：以宽度为基准
    sw = imgW;
    sh = sw / r;
  }

  // 2. 应用缩放（zoom > 1 → 裁剪区缩小 → 图片在预览里放大）
  sw /= state.zoom;
  sh /= state.zoom;

  // 3. 中心像素
  const px = state.cx * imgW;
  const py = state.cy * imgH;

  // 4. 左上角，clamp 防止越界
  const sx = Math.max(0, Math.min(px - sw / 2, imgW - sw));
  const sy = Math.max(0, Math.min(py - sh / 2, imgH - sh));

  return { sx, sy, sw, sh };
}
