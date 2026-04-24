<template>
  <div class="bubble-toolbar" :class="[`role-${role}`]">
    <!-- 复制（user + assistant 共有） -->
    <button
      class="bubble-toolbar-btn"
      type="button"
      :title="copied ? '已复制' : '复制此消息'"
      :aria-label="copied ? '已复制' : '复制此消息'"
      @click.stop="onCopy"
    >
      <span v-if="copied" class="icon icon-check">✓</span>
      <span v-else class="icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="4" y="4" width="9" height="10" rx="1.6" />
          <path d="M3 11V3a1 1 0 0 1 1-1h7" />
        </svg>
      </span>
    </button>

    <!-- 编辑（仅 user） -->
    <button
      v-if="role === 'user'"
      class="bubble-toolbar-btn"
      :class="{ disabled: editDisabled }"
      type="button"
      :title="editDisabled ? '生成中，稍后再试' : '编辑此消息'"
      :aria-label="editDisabled ? '生成中，稍后再试' : '编辑此消息'"
      :disabled="editDisabled"
      @click.stop="onEdit"
    >
      <span class="icon" aria-hidden="true">
        <!-- 铅笔图标 -->
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M11.5 1.5l3 3L5 14H2v-3z" />
          <path d="M9.5 3.5l3 3" />
        </svg>
      </span>
    </button>

    <!-- 重新生成（仅 assistant） -->
    <button
      v-if="role === 'assistant'"
      class="bubble-toolbar-btn"
      :class="{ disabled: regenerateDisabled }"
      type="button"
      :title="regenerateDisabled ? '生成中，稍后再试' : '重新生成'"
      :aria-label="regenerateDisabled ? '生成中，稍后再试' : '重新生成'"
      :disabled="regenerateDisabled"
      @click.stop="onRegenerate"
    >
      <span class="icon" aria-hidden="true">
        <!-- 循环箭头（两段弧 + 箭头） -->
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M13.5 8a5.5 5.5 0 0 1-9.8 3.4" />
          <path d="M2.5 8a5.5 5.5 0 0 1 9.8-3.4" />
          <polyline points="12.3 2 12.3 4.6 9.7 4.6" />
          <polyline points="3.7 14 3.7 11.4 6.3 11.4" />
        </svg>
      </span>
    </button>

    <!-- 多选（user + assistant 共有） -->
    <button
      class="bubble-toolbar-btn"
      :class="{ disabled: enterSelectionDisabled }"
      type="button"
      title="多选"
      aria-label="多选"
      :disabled="enterSelectionDisabled"
      @click.stop="$emit('enter-selection')"
    >
      <span class="icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M3 4.2l1.3 1.3L7 2.8" />
          <path d="M3 10.2l1.3 1.3L7 8.8" />
          <line x1="9" y1="4.5" x2="14" y2="4.5" />
          <line x1="9" y1="10.5" x2="14" y2="10.5" />
        </svg>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * BubbleToolbar — 消息气泡下方的 hover 工具栏
 *
 * 按钮矩阵（按 role 差异化）：
 *
 * | 按钮     | user | assistant |
 * |----------|------|-----------|
 * | 复制     | ✓    | ✓         |
 * | 重新生成 | ✗    | ✓         |
 * | 多选     | ✓    | ✓         |
 *
 * 禁用规则：
 *  - 重新生成：isStreaming === true 时禁用
 *  - 多选：isStreaming === true 时禁用
 *  - 复制：始终可用
 */
import { ref, computed } from 'vue';
import type { ChatMessage } from '@toolbox/bridge';
import { useChat } from '../../composables/useChat';

const props = defineProps<{
  message: ChatMessage;
  role: ChatMessage['role'];
  htmlProvider?: () => string | null;
  textContent: string;
}>();

const emit = defineEmits<{
  'enter-selection': [];
  regenerate: [];
  'enter-editing': [];
  copied: [];
}>();

const { isStreaming } = useChat();

const regenerateDisabled = computed(() => isStreaming.value);
const editDisabled = computed(() => isStreaming.value);
const enterSelectionDisabled = computed(() => isStreaming.value);

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function collectImagePlaceholders(msg: ChatMessage): string[] {
  if (typeof msg.content === 'string') return [];
  const out: string[] = [];
  for (const b of msg.content) {
    if (b && typeof b === 'object' && (b as { type: string }).type === 'image_ref') {
      const ref = b as {
        type: 'image_ref';
        hash: string;
        mediaType: string;
        fileName: string;
      };
      const ext =
        ref.mediaType === 'image/jpeg'
          ? 'jpg'
          : ref.mediaType === 'image/gif'
            ? 'gif'
            : ref.mediaType === 'image/webp'
              ? 'webp'
              : 'png';
      out.push(`![${ref.fileName}](toolbox-img:///${ref.hash}.${ext})`);
    } else if (b && typeof b === 'object' && (b as { type: string }).type === 'image') {
      out.push(`![图片](pasted)`);
    }
  }
  return out;
}

function onRegenerate(): void {
  if (regenerateDisabled.value) return;
  emit('regenerate');
}

function onEdit(): void {
  if (editDisabled.value) return;
  emit('enter-editing');
}

async function onCopy(): Promise<void> {
  const imgLines = collectImagePlaceholders(props.message);
  const textParts = [props.textContent, ...imgLines].filter((s) => s && s.length);
  const plainText = textParts.join('\n\n') || '（空消息）';

  const htmlChunks: string[] = [];
  const rawHtml = props.htmlProvider?.() ?? null;
  if (rawHtml && rawHtml.trim()) {
    htmlChunks.push(rawHtml);
  } else if (props.textContent.trim()) {
    const paras = props.textContent
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
    htmlChunks.push(paras.join(''));
  }
  for (const line of imgLines) {
    htmlChunks.push(`<p><em>${escapeHtml(line)}</em></p>`);
  }
  const html = htmlChunks.join('') || `<p>${escapeHtml(plainText)}</p>`;

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(plainText);
    }
    copied.value = true;
    emit('copied');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      copied.value = false;
    }, 1000);
  } catch (err) {
    console.error('[BubbleToolbar] copy failed:', err);
    try {
      await navigator.clipboard.writeText(plainText);
      copied.value = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        copied.value = false;
      }, 1000);
    } catch {
      /* 放弃 */
    }
  }
}
</script>

<style scoped>
.bubble-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  height: 24px;
  margin-top: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease-out;
}

.role-user {
  justify-content: flex-end;
}
.role-assistant {
  justify-content: flex-start;
}

.bubble-toolbar-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  border-radius: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.1s linear;
}
.bubble-toolbar-btn:hover:not(:disabled) {
  color: var(--text-primary);
}
.bubble-toolbar-btn.disabled,
.bubble-toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon {
  display: inline-flex;
  line-height: 0;
}

.icon-check {
  color: #10b981;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1;
}
</style>
