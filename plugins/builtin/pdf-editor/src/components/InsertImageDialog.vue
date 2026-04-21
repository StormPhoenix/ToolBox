<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-backdrop" @click.self="onCancel">
      <div class="dialog">
        <div class="dialog-header">
          <span class="dialog-title">插入图片</span>
          <button class="dialog-close" @click="onCancel">✕</button>
        </div>

        <div class="dialog-body">
          <!-- 图片预览 -->
          <div class="img-preview-wrap">
            <img v-if="objectUrl" :src="objectUrl" class="img-preview" alt="预览" />
          </div>

          <!-- 尺寸模式选择 -->
          <div class="size-options">
            <p class="size-label">页面尺寸</p>
            <label
              v-for="opt in sizeOptions"
              :key="opt.value"
              class="size-option"
              :class="{ selected: sizeMode === opt.value }"
            >
              <input type="radio" :value="opt.value" v-model="sizeMode" />
              <span class="size-option-text">
                <span class="size-option-name">{{ opt.name }}</span>
                <span class="size-option-desc">{{ opt.desc }}</span>
              </span>
            </label>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-secondary" @click="onCancel">取消</button>
          <button class="btn btn-primary" @click="onConfirm">插入</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ImageSizeMode } from '../store/pdfState';

const visible = ref(false);
const objectUrl = ref('');
const sizeMode = ref<ImageSizeMode>('fit-image');
let pendingFile: File | null = null;
let resolveCallback: ((result: { file: File; sizeMode: ImageSizeMode } | null) => void) | null = null;

const sizeOptions: { value: ImageSizeMode; name: string; desc: string }[] = [
  { value: 'a4',             name: 'A4 标准',     desc: '固定 A4 尺寸（210 × 297mm）' },
  { value: 'fit-image',      name: '匹配图片',     desc: '按图片原始宽高比生成页面' },
  { value: 'match-neighbor', name: '参考相邻页',   desc: '尺寸与插入位置相邻页一致' },
];

/** 外部调用：打开弹窗，返回 Promise。用户确认返回 {file, sizeMode}，取消返回 null */
function open(file: File): Promise<{ file: File; sizeMode: ImageSizeMode } | null> {
  pendingFile = file;
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = URL.createObjectURL(file);
  sizeMode.value = 'fit-image';
  visible.value = true;
  return new Promise(resolve => { resolveCallback = resolve; });
}

function onConfirm() {
  if (!pendingFile) return;
  resolveCallback?.({ file: pendingFile, sizeMode: sizeMode.value });
  cleanup();
}

function onCancel() {
  resolveCallback?.(null);
  cleanup();
}

function cleanup() {
  visible.value = false;
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = '';
  }
  pendingFile = null;
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
  width: 420px;
  max-width: 90vw;
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
}

.dialog-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e8e8f2;
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
}
.dialog-close:hover {
  background: #2a2a40;
  color: #e8e8f2;
}

.dialog-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 图片预览 */
.img-preview-wrap {
  width: 100%;
  height: 160px;
  background: #0d0d14;
  border-radius: 8px;
  border: 1px solid #2d2d44;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.img-preview {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* 尺寸选项 */
.size-label {
  font-size: 0.78rem;
  color: #8888a8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  margin-bottom: 6px;
}

.size-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.size-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #2d2d44;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.size-option input[type="radio"] {
  accent-color: #6c5ce7;
  flex-shrink: 0;
}

.size-option.selected {
  background: rgba(108, 92, 231, 0.1);
  border-color: #6c5ce7;
}

.size-option:hover:not(.selected) {
  background: #22223a;
}

.size-option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.size-option-name {
  font-size: 0.85rem;
  color: #e8e8f2;
}

.size-option-desc {
  font-size: 0.75rem;
  color: #8888a8;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #2d2d44;
}

.btn {
  padding: 7px 18px;
  border-radius: 7px;
  border: 1px solid #2d2d44;
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-secondary {
  background: #22223a;
  color: #e8e8f2;
}
.btn-secondary:hover { background: #2a2a40; }

.btn-primary {
  background: #6c5ce7;
  color: #fff;
  border-color: #6c5ce7;
}
.btn-primary:hover { background: #5a4bd1; }
</style>
