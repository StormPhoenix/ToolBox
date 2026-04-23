<template>
  <div ref="containerRef" class="markdown-body" v-html="renderedHtml" />
</template>

<script setup lang="ts">
/**
 * MarkdownView
 *
 * 将传入的 text 渲染为 Markdown HTML，并为代码块挂载"复制"按钮事件。
 *
 * 性能：内部对 render 使用 rAF 合批，避免流式场景下每个 chunk 都重 parse。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { renderMarkdown, attachCodeCopyHandler } from '../../utils/markdown';

const props = defineProps<{
  text: string;
}>();

const containerRef = ref<HTMLElement | null>(null);
let detachCopy: (() => void) | null = null;

// rAF 合批：流式 text 高频变化时，每帧最多 render 一次
const batchedText = ref<string>(props.text);
let rafId: number | null = null;

watch(
  () => props.text,
  (val) => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      batchedText.value = val;
      rafId = null;
    });
  }
);

const renderedHtml = computed(() => renderMarkdown(batchedText.value));

onMounted(() => {
  if (containerRef.value) {
    detachCopy = attachCodeCopyHandler(containerRef.value);
  }
});

onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  detachCopy?.();
});
</script>

<style scoped>
.markdown-body {
  color: var(--text-primary);
  font-size: 0.9rem;
  line-height: 1.65;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.markdown-body :deep(p) {
  margin: 0.4em 0;
}
.markdown-body :deep(p:first-child) { margin-top: 0; }
.markdown-body :deep(p:last-child)  { margin-bottom: 0; }

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 0.9em 0 0.45em;
  font-weight: 700;
  color: var(--text-primary);
}
.markdown-body :deep(h1) { font-size: 1.35rem; }
.markdown-body :deep(h2) { font-size: 1.2rem; }
.markdown-body :deep(h3) { font-size: 1.05rem; }
.markdown-body :deep(h4) { font-size: 0.95rem; }

.markdown-body :deep(a) {
  color: var(--accent-light);
  text-decoration: none;
}
.markdown-body :deep(a:hover) { text-decoration: underline; }

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.5em;
}
.markdown-body :deep(li) { margin: 0.2em 0; }

.markdown-body :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.4em 0.9em;
  border-left: 3px solid var(--accent);
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

/* 行内 code */
.markdown-body :deep(code) {
  font-family: 'Consolas', 'Cascadia Code', 'Menlo', monospace;
  font-size: 0.85em;
  background: var(--bg-card);
  padding: 0.12em 0.4em;
  border-radius: 4px;
  color: #eab676;
}

/* 代码块 */
.markdown-body :deep(pre.code-block) {
  position: relative;
  margin: 0.6em 0;
  border-radius: var(--radius-sm);
  background: #1a1a20;
  border: 1px solid var(--border);
  overflow: hidden;
}

.markdown-body :deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 10px;
  font-size: 0.72rem;
  background: #14141a;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}

.markdown-body :deep(.code-lang) {
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.markdown-body :deep(.code-copy) {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.72rem;
  transition: background var(--transition), color var(--transition);
}
.markdown-body :deep(.code-copy:hover) {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.markdown-body :deep(pre.code-block code) {
  display: block;
  padding: 10px 12px;
  background: transparent;
  color: #e8e8f2;
  font-family: 'Consolas', 'Cascadia Code', 'Menlo', monospace;
  font-size: 0.82rem;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
  border-radius: 0;
}

/* 表格 */
.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 0.85rem;
  display: block;
  overflow-x: auto;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}
.markdown-body :deep(th) {
  background: var(--bg-card);
  font-weight: 600;
}

/* hr */
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}
</style>
