<template>
  <div class="composer" :class="{ 'has-attachments': attachments.length > 0 }">
    <!-- 附件预览：纯图模式网格缩略图 -->
    <div v-if="attachments.length > 0" class="attachments-grid">
      <div
        v-for="(att, i) in attachments"
        :key="i"
        class="attachment-cell"
        :title="`${att.name} · ${formatBytes(att.byteSize)}`"
      >
        <img
          :src="att.previewUrl"
          class="attachment-cell-img"
          alt=""
          draggable="false"
        />
        <button
          class="attachment-cell-remove"
          type="button"
          title="移除"
          @click="removeAttachment(i)"
        >
          ✕
        </button>
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

    <!-- 错误提示（附件校验等） -->
    <div v-if="warnMessage" class="composer-warn">
      {{ warnMessage }}
    </div>

    <div class="composer-hint">
      Enter 发送 · Shift + Enter 换行 · Esc 停止 · 单张 ≤ 10MB · 最多 {{ MAX_ATTACHMENTS }} 张
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
 * - 拖拽（由外层 ChatView 监听 drop 后调用 addAttachments 导入）
 * - Enter 发送 / Shift+Enter 换行 / Esc 停止
 * - 单张 > 10MB / 单次 > 6 张 拦截
 */
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue';
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

// ── 常量 ────────────────────────────────────────────────
/** 单张图片最大字节数（10MB） */
const MAX_SINGLE_BYTES = 10 * 1024 * 1024;
/** 单条消息最多附件数 */
const MAX_ATTACHMENTS = 6;

/** 内部附件（含预览 URL 与字节数，用于 UI） */
interface InternalAttachment extends ChatAttachmentInput {
  /** 供 <img> 绑定的 object URL（组件销毁时 revoke） */
  previewUrl: string;
  /** 原始二进制字节数（未转 base64 前） */
  byteSize: number;
}

const text = ref('');
const attachments = ref<InternalAttachment[]>([]);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const warnMessage = ref<string | null>(null);
let warnTimer: ReturnType<typeof setTimeout> | null = null;

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function showWarn(msg: string): void {
  warnMessage.value = msg;
  if (warnTimer) clearTimeout(warnTimer);
  warnTimer = setTimeout(() => {
    warnMessage.value = null;
  }, 3500);
}

function autoResize(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 240) + 'px';
}

watch(text, () => nextTick(autoResize));

function removeAttachment(idx: number): void {
  const att = attachments.value[idx];
  if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
  attachments.value.splice(idx, 1);
}

/** 数量校验：返回还能加几张（≤0 时整体拒绝） */
function remainingQuota(): number {
  return MAX_ATTACHMENTS - attachments.value.length;
}

/** 接收 { base64, mediaType, name, byteSize } 构造内部附件并加入 */
function addOneAttachment(params: {
  name: string;
  mediaType: SupportedMediaType;
  base64: string;
  byteSize: number;
  previewBlob?: Blob;
}): boolean {
  if (remainingQuota() <= 0) {
    showWarn(`单条消息最多附 ${MAX_ATTACHMENTS} 张图片`);
    return false;
  }
  if (params.byteSize > MAX_SINGLE_BYTES) {
    showWarn(
      `图片过大：${params.name}（${formatBytes(params.byteSize)}），上限 10MB`
    );
    return false;
  }
  const blob =
    params.previewBlob ??
    new Blob([Uint8Array.from(atob(params.base64), (c) => c.charCodeAt(0))], {
      type: params.mediaType,
    });
  const previewUrl = URL.createObjectURL(blob);
  attachments.value.push({
    name: params.name,
    mediaType: params.mediaType,
    base64: params.base64,
    byteSize: params.byteSize,
    previewUrl,
  });
  return true;
}

/**
 * 供外层（ChatView 拖拽 / 历史气泡"重发"）调用：批量导入附件。
 * 传入一组 ChatAttachmentInput（base64），组件内部自行构造预览 URL。
 */
function addAttachments(list: ChatAttachmentInput[]): void {
  for (const att of list) {
    if (!isSupportedMediaType(att.mediaType)) continue;
    const byteSize = Math.floor((att.base64.length * 3) / 4); // base64 → bytes 近似
    if (!addOneAttachment({
      name: att.name,
      mediaType: att.mediaType,
      base64: att.base64,
      byteSize,
    })) break;
  }
}

defineExpose({ addAttachments });

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
    if (remainingQuota() <= 0) break;
    try {
      const base64 = await window.electronAPI.readFile(filePath, 'base64');
      const byteSize = Math.floor((base64.length * 3) / 4);
      const name = filePath.split(/[\\/]/).pop() || 'image';
      addOneAttachment({ name, mediaType, base64, byteSize });
    } catch (err) {
      console.error('读取图片失败:', err);
      showWarn(`读取失败：${filePath.split(/[\\/]/).pop()}`);
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
    if (remainingQuota() <= 0) {
      showWarn(`单条消息最多附 ${MAX_ATTACHMENTS} 张图片`);
      break;
    }
    void readFileAsBase64(file).then((base64) => {
      if (isSupportedMediaType(file.type)) {
        addOneAttachment({
          name: file.name || 'pasted-image.png',
          mediaType: file.type,
          base64,
          byteSize: file.size,
          previewBlob: file,
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
  // 只保留 ChatAttachmentInput 字段传出，不泄漏 previewUrl 等 UI 内部字段
  const payload = {
    text: text.value.trim(),
    attachments: attachments.value.map((a) => ({
      name: a.name,
      mediaType: a.mediaType,
      base64: a.base64,
    })),
  };
  emit('submit', payload);
  // 清理预览 URL
  for (const a of attachments.value) URL.revokeObjectURL(a.previewUrl);
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

onBeforeUnmount(() => {
  for (const a of attachments.value) URL.revokeObjectURL(a.previewUrl);
  if (warnTimer) clearTimeout(warnTimer);
});
</script>

<style scoped>
.composer {
  border-top: 1px solid var(--border);
  background: var(--bg-sidebar);
  padding: 12px 20px 10px;
}

/* 附件网格（P1-H） */
.attachments-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 72px);
  gap: 8px;
  margin-bottom: 10px;
}

.attachment-cell {
  position: relative;
  width: 72px;
  height: 56px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-base);
  border: 1px solid var(--border);
}

.attachment-cell-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.attachment-cell-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 0.65rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  transition: opacity var(--transition);
}
.attachment-cell:hover .attachment-cell-remove {
  opacity: 1;
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

.composer-warn {
  margin-top: 6px;
  font-size: 0.78rem;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}

.composer-hint {
  margin-top: 6px;
  font-size: 0.72rem;
  color: var(--text-dim);
  text-align: center;
}
</style>
