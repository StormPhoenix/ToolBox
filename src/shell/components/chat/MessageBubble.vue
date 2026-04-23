<template>
  <div class="bubble-row" :class="[`role-${message.role}`]">
    <div class="bubble">
      <!-- 附件缩略图（仅 user 消息可能有） -->
      <div v-if="imageSources.length > 0" class="bubble-images">
        <img
          v-for="(src, i) in imageSources"
          :key="i"
          :src="src"
          class="bubble-image"
          alt="附件"
        />
      </div>

      <!-- 文本内容：assistant 走 Markdown，user 走纯文本 -->
      <MarkdownView v-if="message.role === 'assistant'" :text="textContent" />
      <div v-else-if="textContent" class="bubble-user-text">{{ textContent }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage } from '@toolbox/bridge';
import MarkdownView from './MarkdownView.vue';

const props = defineProps<{
  message: ChatMessage;
}>();

/** 从 content 中提取纯文本 */
const textContent = computed((): string => {
  const c = props.message.content;
  if (typeof c === 'string') return c;
  return c
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
});

/** 从 content 中提取图片，拼为 data URL */
const imageSources = computed((): string[] => {
  const c = props.message.content;
  if (typeof c === 'string') return [];
  return c
    .filter(
      (b): b is {
        type: 'image';
        source: { type: 'base64'; media_type: string; data: string };
      } => b.type === 'image'
    )
    .map((b) => `data:${b.source.media_type};base64,${b.source.data}`);
});
</script>

<style scoped>
.bubble-row {
  display: flex;
  width: 100%;
  margin: 6px 0;
}

.role-user {
  justify-content: flex-end;
}

.role-assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: min(760px, 88%);
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.role-user .bubble {
  background: var(--accent);
  color: #fff;
  border-top-right-radius: 4px;
}

.role-assistant .bubble {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
}

.bubble-user-text {
  white-space: pre-wrap;
  font-size: 0.9rem;
}

.bubble-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.bubble-image {
  max-width: 180px;
  max-height: 180px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--bg-base);
}
</style>
