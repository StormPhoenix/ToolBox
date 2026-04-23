<template>
  <div class="composer" :class="{ 'has-attachments': attachments.length > 0 }">
    <!-- 附件预览 -->
    <div v-if="attachments.length > 0" class="attachments-row">
      <div
        v-for="(att, i) in attachments"
        :key="i"
        class="attachment-chip"
      >
        <img
          :src="`data:${att.mediaType};base64,${att.base64}`"
          class="attachment-thumb"
          alt=""
        />
        <span class="attachment-name" :title="att.name">{{ att.name }}</span>
        <button class="attachment-remove" type="button" @click="removeAttachment(i)">✕</button>
      </div>
    </div>

    <div class="composer-body">
      <button
        class="icon-btn"
        type="button"
        title="添加图片"
        :disabled="disabled || isStreaming"
        @click="pickImage"
      >
        📎
      </button>

      <textarea
        ref="textareaRef"
        v-model="text"
        class="composer-textarea"
        rows="1"
        :placeholder="placeholder"
        :disabled="disabled"
        @keydown="onKeydown"
        @paste="onPaste"
        @input="autoResize"
      />

      <button
        v-if="isStreaming"
        class="action-btn action-stop"
        type="button"
        title="停止生成"
        @click="$emit('abort')"
      >
        ⏹
      </button>
      <button
        v-else
        class="action-btn action-send"
        type="button"
        :disabled="disabled || !canSend"
        title="发送 (Enter)"
        @click="submit"
      >
        ▶
      </button>
    </div>

    <div class="composer-hint">
      Enter 发送 · Shift + Enter 换行 · Esc 停止
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Composer — 消息输入框
 *
 * 支持：
 * - 多行输入（自动 resize）
 * - 图片粘贴（Ctrl+V）
 * - 文件选择（📎 按钮 → showOpenDialog）
 * - Enter 发送 / Shift+Enter 换行 / Esc 停止
 */
import { ref, computed, nextTick, watch } from 'vue';
import type { ChatAttachmentInput } from '@toolbox/bridge';

const props = defineProps<{
  disabled?: boolean;
  isStreaming: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  submit: [payload: { text: string; attachments: ChatAttachmentInput[] }];
  abort: [];
}>();

const text = ref('');
const attachments = ref<ChatAttachmentInput[]>([]);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const canSend = computed(
  () => text.value.trim().length > 0 || attachments.value.length > 0
);

const placeholder = computed(
  () => props.placeholder ?? '向 AI 提问……'
);

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

type SupportedMediaType = typeof SUPPORTED_IMAGE_TYPES[number];

function isSupportedMediaType(t: string): t is SupportedMediaType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(t);
}

function inferMediaTypeFromExt(filename: string): SupportedMediaType | null {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return null;
}

function autoResize(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 240) + 'px';
}

watch(text, () => nextTick(autoResize));

function removeAttachment(idx: number): void {
  attachments.value.splice(idx, 1);
}

async function pickImage(): Promise<void> {
  const result = await window.electronAPI.showOpenDialog({
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      },
    ],
  });
  if (result.canceled || !result.filePaths.length) return;

  for (const filePath of result.filePaths) {
    const mediaType = inferMediaTypeFromExt(filePath);
    if (!mediaType) continue;
    try {
      const base64 = await window.electronAPI.readFile(filePath, 'base64');
      const name = filePath.split(/[\\/]/).pop() || 'image';
      attachments.value.push({ name, mediaType, base64 });
    } catch (err) {
      console.error('读取图片失败:', err);
    }
  }
}

function onPaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (!isSupportedMediaType(file.type)) continue;
    event.preventDefault();
    void readFileAsBase64(file).then((base64) => {
      if (isSupportedMediaType(file.type)) {
        attachments.value.push({
          name: file.name || 'pasted-image.png',
          mediaType: file.type,
          base64,
        });
      }
    });
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf('base64,');
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    reader.readAsDataURL(file);
  });
}

function submit(): void {
  if (!canSend.value || props.disabled) return;
  emit('submit', {
    text: text.value.trim(),
    attachments: [...attachments.value],
  });
  text.value = '';
  attachments.value = [];
  void nextTick(autoResize);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (props.isStreaming) return; // 流式中禁发
    submit();
  } else if (e.key === 'Escape' && props.isStreaming) {
    e.preventDefault();
    emit('abort');
  }
}
</script>

<style scoped>
.composer {
  border-top: 1px solid var(--border);
  background: var(--bg-sidebar);
  padding: 12px 20px 10px;
}

.attachments-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.attachment-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 4px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  max-width: 200px;
  font-size: 0.78rem;
}

.attachment-thumb {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--bg-base);
}

.attachment-name {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-remove {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 0 4px;
  font-size: 0.75rem;
}
.attachment-remove:hover {
  color: var(--text-primary);
}

/* 主体 */
.composer-body {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 10px;
  transition: border-color var(--transition);
}
.composer-body:focus-within {
  border-color: var(--border-active);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  padding: 6px;
  color: var(--text-secondary);
  border-radius: 6px;
  transition: background var(--transition);
}
.icon-btn:hover:not(:disabled) {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.composer-textarea {
  flex: 1;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.92rem;
  line-height: 1.5;
  padding: 6px 4px;
  max-height: 240px;
}
.composer-textarea::placeholder {
  color: var(--text-dim);
}

.action-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition), transform var(--transition);
}
.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.action-send {
  background: var(--accent);
}
.action-send:hover:not(:disabled) {
  background: var(--accent-light);
  transform: translateY(-1px);
}
.action-stop {
  background: #ef4444;
}
.action-stop:hover {
  background: #dc2626;
}

.composer-hint {
  margin-top: 6px;
  font-size: 0.72rem;
  color: var(--text-dim);
  text-align: center;
}
</style>
