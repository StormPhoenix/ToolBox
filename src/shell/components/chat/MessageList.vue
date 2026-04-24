<template>
  <div
    ref="scrollRef"
    class="message-list"
    :class="{ 'selection-mode': selectionMode }"
    @scroll="onScroll"
  >
    <div ref="innerRef" class="message-list-inner">
      <div v-if="messages.length === 0 && !streamingText" class="empty-placeholder">
        <div class="placeholder-icon">💬</div>
        <div class="placeholder-text">开始对话吧</div>
        <div class="placeholder-hint">
          按 Enter 发送，Shift + Enter 换行
        </div>
      </div>

      <MessageBubble
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :selection-mode="selectionMode"
        :selected="isSelected(msg.id)"
        :editing-message-id="editingMessageId"
        @open-lightbox="(p) => $emit('open-lightbox', p)"
        @resend-image="(r) => $emit('resend-image', r)"
        @toggle-select="(id) => $emit('toggle-select', id)"
        @enter-selection="(id) => $emit('enter-selection', id)"
        @regenerate="(id) => $emit('regenerate', id)"
        @enter-editing="(id) => $emit('enter-editing', id)"
        @cancel-editing="$emit('cancel-editing')"
        @submit-edit="(p) => $emit('submit-edit', p)"
      />

      <!-- 流式气泡：选择态下不展示，避免用户误以为能选 -->
      <StreamingBubble v-if="isStreaming && !selectionMode" :text="streamingText" />

      <div v-if="errorMessage && !selectionMode" class="error-banner">
        <span class="error-text">{{ errorMessage }}</span>
        <button class="error-dismiss" type="button" @click="$emit('dismiss-error')">
          ✕
        </button>
      </div>
    </div>

    <transition name="fade">
      <button
        v-if="showJumpToBottom"
        class="jump-to-bottom"
        type="button"
        @click="scrollToBottom(true)"
      >
        ↓ 新消息
      </button>
    </transition>
  </div>
</template>

<script setup lang="ts">
/**
 * 消息列表
 *
 * 滚动策略：
 * - 初始定位（切换/打开会话时）：瞬跳到底部，视觉上不经过"从顶滚到底"
 *   · 触发源为 props.sessionId 变化（含 immediate）
 *   · 使用 behavior: 'auto' 强制瞬跳
 * - 运行时自动跟随：messages / streamingText / isStreaming 变化时滚到底
 * - 容器高度变化兜底（ResizeObserver）：
 *   · 图片解码、Markdown/代码块异步撑高后内容高度增加时，
 *     若当前 autoScroll=true，自动再瞬跳一次保持贴底
 * - 用户手动向上滚超过阈值 → 暂停自动滚底，显示"↓ 新消息"按钮
 * - 点击按钮或手动回到底部 → 恢复自动滚底
 */
import { ref, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import type { ChatMessage } from '@toolbox/bridge';
import MessageBubble from './MessageBubble.vue';
import StreamingBubble from './StreamingBubble.vue';
import type { LightboxItem } from './ImageLightbox.vue';

const props = defineProps<{
  /**
   * 当前会话 id。用作"初始定位"的触发源，
   * 比 watch messages 引用更稳定（流式结束时 activeSession 会被整个替换，
   * 但 sessionId 不变，因此不会误触发初始瞬跳）。
   */
  sessionId: string | null;
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  errorMessage: string | null;
  /** 选择态：显示 checkbox 列、禁用流式气泡与错误条 */
  selectionMode?: boolean;
  /** 判断某条消息是否已选中 */
  isSelected?: (id: string) => boolean;
  /** 当前正在编辑的消息 id */
  editingMessageId?: string | null;
}>();

defineEmits<{
  'dismiss-error': [];
  'open-lightbox': [params: { items: LightboxItem[]; index: number }];
  'resend-image': [ref: {
    cachePath: string;
    hash: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    fileName: string;
  }];
  'toggle-select': [id: string];
  'enter-selection': [id: string];
  'regenerate': [id: string];
  'enter-editing': [id: string];
  'cancel-editing': [];
  'submit-edit': [payload: {
    targetMessageId: string;
    newText: string;
    imageRefs: import('@toolbox/bridge').LLMImageRefBlock[];
  }];
}>();

// 默认未提供 isSelected 时返回 false
const isSelected = (id: string): boolean => {
  return props.isSelected ? props.isSelected(id) : false;
};

const scrollRef = ref<HTMLElement | null>(null);
const innerRef = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const showJumpToBottom = ref(false);

const BOTTOM_THRESHOLD = 40;

function isAtBottom(): boolean {
  const el = scrollRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
}

/**
 * 跳到底部。
 *
 * 始终使用 `behavior: 'auto'` 瞬跳：
 * - 打开会话时避免"从顶部滑到底部"的视觉；
 * - 流式 chunk 高频到达时 smooth 会追不上，反而观感更差；
 * - "↓ 新消息"按钮跳转通常距离较远，瞬跳更利落。
 */
function scrollToBottom(force = false): void {
  const el = scrollRef.value;
  if (!el) return;
  if (!force && !autoScroll.value) return;
  el.scrollTop = el.scrollHeight;
  autoScroll.value = true;
  showJumpToBottom.value = false;
}

function onScroll(): void {
  const el = scrollRef.value;
  if (!el) return;
  const atBottom = isAtBottom();
  if (atBottom) {
    autoScroll.value = true;
    showJumpToBottom.value = false;
  } else {
    // 用户滚出底部则暂停自动滚底
    autoScroll.value = false;
    if (props.isStreaming) {
      showJumpToBottom.value = true;
    }
  }
}

// ── 初始定位：会话切换/首次挂载时瞬跳到底 ──────────────────
// 触发源为 sessionId（而非 messages 引用），以避免流式结束时
// activeSession 被替换引发的误触发。
watch(
  () => props.sessionId,
  (id) => {
    if (!id) return;
    // 等 Vue 完成 DOM patch，再等浏览器 layout 一帧，确保 scrollHeight 可读
    void nextTick(() => {
      requestAnimationFrame(() => scrollToBottom(true));
    });
  },
  { immediate: true, flush: 'post' }
);

// 运行时自动跟随：内容/流式状态变化时合批滚动
watch(
  () => [props.messages.length, props.streamingText, props.isStreaming],
  () => {
    void nextTick(() => scrollToBottom());
  },
  { flush: 'post' }
);

// ── ResizeObserver 兜底 ────────────────────────────────────
// 图片解码、代码高亮、Markdown 异步资源等会在首次 paint 之后
// 继续撑高容器。只要当前仍处于"贴底"意图（autoScroll=true），
// 就再瞬跳一次保证视觉底部不漂移。
let resizeObserver: ResizeObserver | null = null;
let lastInnerHeight = 0;

onMounted(() => {
  if (!innerRef.value || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const h = entry.contentRect.height;
    // 仅在内容"增高"且用户仍有贴底意图时兜底
    if (h > lastInnerHeight && autoScroll.value) {
      // 直接赋值 scrollTop，避免在 observer 回调里触发 smooth 动画（已无 smooth，此处仍保守使用瞬跳）
      const el = scrollRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    }
    lastInnerHeight = h;
  });
  resizeObserver.observe(innerRef.value);
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

defineExpose({ scrollToBottom });
</script>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 18px 24px;
  position: relative;
  /*
   * 注：不设置 scroll-behavior: smooth。
   * - 打开会话的初始定位必须瞬跳，否则会出现"从顶滑到底"的视觉；
   * - 流式 chunk 高频到达时 smooth 追不上；
   * - "↓ 新消息"按钮跳转通常距离较远，瞬跳更利落。
   */
}

.message-list-inner {
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 空态 */
.empty-placeholder {
  margin: 80px auto;
  text-align: center;
  color: var(--text-dim);
}
.placeholder-icon {
  font-size: 3rem;
  margin-bottom: 12px;
  opacity: 0.6;
}
.placeholder-text {
  font-size: 1.1rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.placeholder-hint {
  font-size: 0.82rem;
  color: var(--text-dim);
}

/* 错误条 */
.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: var(--radius-sm);
  color: #fca5a5;
  font-size: 0.88rem;
}

.error-dismiss {
  background: none;
  border: none;
  color: #fca5a5;
  cursor: pointer;
  font-size: 0.95rem;
  padding: 2px 6px;
  border-radius: 4px;
}
.error-dismiss:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* 跳到底部按钮 */
.jump-to-bottom {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.78rem;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
