<template>
  <div
    ref="scrollRef"
    class="message-list"
    @scroll="onScroll"
  >
    <div class="message-list-inner">
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
      />

      <StreamingBubble v-if="isStreaming" :text="streamingText" />

      <div v-if="errorMessage" class="error-banner">
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
 * 自动滚底策略：
 * - 默认：messages/streamingText 变化时滚到底
 * - 用户手动向上滚超过 120px → 暂停自动滚底，显示"↓ 新消息"按钮
 * - 点击按钮或手动回到底部 → 恢复自动滚底
 */
import { ref, nextTick, watch } from 'vue';
import type { ChatMessage } from '@toolbox/bridge';
import MessageBubble from './MessageBubble.vue';
import StreamingBubble from './StreamingBubble.vue';

const props = defineProps<{
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  errorMessage: string | null;
}>();

defineEmits<{
  'dismiss-error': [];
}>();

const scrollRef = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const showJumpToBottom = ref(false);

const BOTTOM_THRESHOLD = 40;

function isAtBottom(): boolean {
  const el = scrollRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
}

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

// 监听内容变化，合批滚动
watch(
  () => [props.messages.length, props.streamingText, props.isStreaming],
  () => {
    void nextTick(() => scrollToBottom());
  },
  { flush: 'post' }
);

defineExpose({ scrollToBottom });
</script>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 18px 24px;
  position: relative;
  scroll-behavior: smooth;
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
