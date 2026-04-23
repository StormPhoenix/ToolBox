<template>
  <header class="chat-header">
    <div class="header-main">
      <div class="title" :title="title">{{ title }}</div>
      <div v-if="modelLabel" class="model-badge">
        <span class="model-dot" :class="{ available }"></span>
        {{ modelLabel }}
      </div>
    </div>

    <div class="header-actions">
      <button
        v-if="session"
        class="icon-btn"
        type="button"
        title="清空当前会话上下文"
        @click="confirmClear"
      >
        🧹
      </button>
      <button
        class="icon-btn"
        type="button"
        title="去设置"
        @click="$emit('open-settings')"
      >
        ⚙
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChatSession } from '@toolbox/bridge';

const props = defineProps<{
  session: ChatSession | null;
  providerLabel: string;
  modelName: string;
  available: boolean;
}>();

const emit = defineEmits<{
  'clear-context': [];
  'open-settings': [];
}>();

const title = computed(() => props.session?.title ?? 'AI 对话');

const modelLabel = computed(() => {
  if (!props.available) return '未配置 LLM';
  if (!props.modelName) return props.providerLabel || '';
  return `${props.providerLabel} · ${props.modelName}`;
});

function confirmClear(): void {
  if (confirm('确定清空当前会话的上下文吗？消息记录将被删除。')) {
    emit('clear-context');
  }
}
</script>

<style scoped>
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-content);
  min-height: 54px;
}

.header-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.title {
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.model-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
}
.model-dot.available {
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 0.95rem;
  transition: background var(--transition), color var(--transition);
}
.icon-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}
</style>
