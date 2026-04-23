<template>
  <div class="bubble-toolbar" :class="[`role-${role}`]">
    <button
      class="bubble-toolbar-btn"
      type="button"
      :title="copied ? '已复制' : '复制此消息'"
      :aria-label="copied ? '已复制' : '复制此消息'"
      @click.stop="onCopy"
    >
      <span v-if="copied" class="icon icon-check">✓</span>
      <span v-else class="icon" aria-hidden="true">
        <!-- 复制图标（双矩形） -->
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="4" y="4" width="9" height="10" rx="1.6" />
          <path d="M3 11V3a1 1 0 0 1 1-1h7" />
        </svg>
      </span>
    </button>

    <button
      class="bubble-toolbar-btn"
      type="button"
      title="多选"
      aria-label="多选"
      @click.stop="$emit('enter-selection')"
    >
      <span class="icon" aria-hidden="true">
        <!-- Checklist 图标 -->
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
 * 视觉规范（V1.2 调整，融入背景）：
 *  - 无背景 / 无边框 / 无阴影，纯线条图标直接贴在消息列表背景上
 *  - 默认 opacity 0 且 pointer-events: none，保留高度占位（不抖动）
 *  - 外层 .bubble-row:hover 时显现（hover 触发由父组件控制，非本组件）
 *  - icon 仅通过颜色变化反馈 hover（无圆形/方形 hover 底）
 *
 * 内含两个按钮：
 *  - 复制：把该条消息内容写入剪贴板（text/plain + text/html 双份）；
 *    成功后图标切换为 ✓（绿色）持续 1s 后复原
 *  - 多选：通知上层进入选择模式并预选中这一条
 */
import { ref } from 'vue';
import type { ChatMessage } from '@toolbox/bridge';

const props = defineProps<{
  message: ChatMessage;
  role: ChatMessage['role'];
  /**
   * 可选：已经渲染好的 HTML（用于 text/html 剪贴板格式）。
   * 不传则仅写入 text/plain。
   */
  htmlProvider?: () => string | null;
  /** 纯文本表示（由父级抽取，避免重复解析 content 的 text 块） */
  textContent: string;
}>();

const emit = defineEmits<{
  'enter-selection': [];
  copied: [];
}>();

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 收集消息中的图片 markdown 占位（附在文本末尾）。
 * image_ref → ![name](toolbox-img://hash.ext)
 * image(base64) → ![图片](pasted)
 */
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

async function onCopy(): Promise<void> {
  const imgLines = collectImagePlaceholders(props.message);
  const textParts = [props.textContent, ...imgLines].filter((s) => s && s.length);
  const plainText = textParts.join('\n\n') || '（空消息）';

  // text/html 分支：优先用 htmlProvider 提供的 assistant 渲染 HTML；
  // user 气泡无渲染 HTML，退化为 <p>…</p> 包裹 + 图片占位
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
/**
 * 工具栏行：普通 flow 元素，始终占位 24px 高度 + 4px 上边距。
 * 默认透明且不可交互；由父级 .bubble-row:hover 控制显现。
 */
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

/* user 气泡右对齐 → 工具栏右对齐；assistant 气泡左对齐 → 工具栏左对齐 */
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
  border-radius: 0; /* 不加 hover 底，不需要圆角 */
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.1s linear;
}
.bubble-toolbar-btn:hover {
  color: var(--text-primary);
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
