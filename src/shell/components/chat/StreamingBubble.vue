<template>
  <div class="bubble-row role-assistant">
    <div class="bubble streaming">
      <MarkdownView v-if="text" :text="text" />
      <div v-else class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MarkdownView from './MarkdownView.vue';

defineProps<{
  text: string;
}>();
</script>

<style scoped>
.bubble-row {
  display: flex;
  justify-content: flex-start;
  margin: 6px 0;
}

.bubble {
  max-width: min(760px, 88%);
  padding: 10px 14px;
  border-radius: 12px;
  border-top-left-radius: 4px;
  line-height: 1.6;
  word-break: break-word;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-active);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.streaming {
  position: relative;
}

/* 打字指示器（text 为空时） */
.typing-indicator {
  display: inline-flex;
  gap: 4px;
  padding: 4px 0;
}
.typing-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-light);
  animation: blink 1.2s infinite ease-in-out;
}
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
  40%           { opacity: 1;   transform: translateY(-2px); }
}
</style>
