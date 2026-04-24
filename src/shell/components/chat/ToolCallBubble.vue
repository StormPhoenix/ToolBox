<template>
  <div class="tool-call-bubble">
    <!-- 执行中状态 -->
    <div v-if="executing" class="tool-call-row executing">
      <span class="tool-icon">🔍</span>
      <span class="tool-label">
        正在搜索：{{ queryText }}
      </span>
      <span class="tool-spinner"></span>
    </div>

    <!-- 已完成的工具调用列表 -->
    <div
      v-for="(result, idx) in results"
      :key="idx"
      class="tool-call-row done"
      :class="{ error: !result.success }"
      @click="toggleExpand(idx)"
    >
      <span class="tool-icon">{{ result.success ? '🔍' : '⚠️' }}</span>
      <span class="tool-label">
        {{ result.success ? '已搜索' : '搜索失败' }}：{{ getQuery(result) }}
      </span>
      <span v-if="result.success" class="tool-meta">
        {{ getResultCount(result) }}
      </span>
      <span class="tool-expand">{{ expandedSet.has(idx) ? '▴' : '▾' }}</span>

      <!-- 展开详情 -->
      <div v-if="expandedSet.has(idx)" class="tool-detail" @click.stop>
        <pre class="tool-detail-text">{{ result.summary }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  executing: {
    toolName: string;
    toolDisplayName: string;
    toolInput: unknown;
  } | null;
  results: Array<{
    toolName: string;
    toolDisplayName: string;
    success: boolean;
    summary: string;
  }>;
}>();

const expandedSet = ref<Set<number>>(new Set());

function toggleExpand(idx: number) {
  const next = new Set(expandedSet.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  expandedSet.value = next;
}

const queryText = computed(() => {
  if (!props.executing?.toolInput) return '...';
  const input = props.executing.toolInput as Record<string, unknown>;
  return (input.query as string) || '...';
});

function getQuery(result: { summary: string }): string {
  try {
    const parsed = JSON.parse(result.summary);
    return parsed.query || '...';
  } catch {
    return '...';
  }
}

function getResultCount(result: { summary: string }): string {
  try {
    const parsed = JSON.parse(result.summary);
    if (parsed.resultCount !== undefined) {
      return `${parsed.resultCount} 条结果`;
    }
  } catch {
    // summary 可能被截断
  }
  return '';
}
</script>

<style scoped>
.tool-call-bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0;
}

.tool-call-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  background: var(--bg-tool-call, rgba(0, 0, 0, 0.04));
  cursor: pointer;
  user-select: none;
  flex-wrap: wrap;
  transition: background 0.15s;
}

.tool-call-row:hover {
  background: var(--bg-tool-call-hover, rgba(0, 0, 0, 0.07));
}

.tool-call-row.executing {
  cursor: default;
}

.tool-call-row.error {
  color: var(--text-error, #c44);
}

.tool-icon {
  flex-shrink: 0;
}

.tool-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-meta {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.7;
}

.tool-expand {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.5;
}

.tool-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: var(--accent, #4a9eff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-detail {
  width: 100%;
  margin-top: 6px;
  padding: 8px;
  background: var(--bg-code, rgba(0, 0, 0, 0.03));
  border-radius: 4px;
  cursor: text;
}

.tool-detail-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary, #333);
  max-height: 300px;
  overflow-y: auto;
}
</style>
