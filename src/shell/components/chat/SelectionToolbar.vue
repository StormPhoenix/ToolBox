<template>
  <div class="selection-toolbar">
    <div class="selection-info">
      <span class="count">已选 <b>{{ selectedCount }}</b> 条</span>
      <button
        class="link-btn"
        type="button"
        :disabled="totalSelectable === 0"
        @click="$emit('select-all')"
      >
        全选
      </button>
    </div>

    <div class="selection-actions">
      <button
        class="btn btn-secondary"
        type="button"
        :disabled="selectedCount === 0 || copying"
        :title="copied ? '已复制' : '复制为 Markdown 到剪贴板'"
        @click="onCopy"
      >
        <span v-if="copied">✓ 已复制</span>
        <span v-else-if="copying">复制中…</span>
        <span v-else>📋 复制</span>
      </button>

      <button
        class="btn btn-primary"
        type="button"
        :disabled="selectedCount === 0 || exporting"
        :title="exporting ? '导出中…' : '导出为 Markdown 文件'"
        @click="$emit('export-file')"
      >
        <span v-if="exporting">导出中…</span>
        <span v-else>⬇ 导出</span>
      </button>

      <button
        class="btn btn-ghost"
        type="button"
        title="退出多选 (Esc)"
        @click="$emit('cancel')"
      >
        取消
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SelectionToolbar — 选择模式下替代 Composer 的底部工具栏
 *
 * 按钮：全选 · 复制 · 导出 · 取消
 * 复制按钮处于 "copying" / "copied" / 默认 三态；导出按钮 "exporting" / 默认 二态。
 */
import { ref } from 'vue';

defineProps<{
  selectedCount: number;
  /** 当前可选消息总数（用于禁用"全选"按钮） */
  totalSelectable: number;
  /** 外层导出中 */
  exporting?: boolean;
}>();

const emit = defineEmits<{
  'select-all': [];
  /** 父级处理文件导出（弹保存对话框 + 调 IPC） */
  'export-file': [];
  /** 复制到剪贴板：父级构造 plain text + html 并返回 Promise<void> */
  copy: [done: (ok: boolean) => void];
  cancel: [];
}>();

const copying = ref(false);
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function onCopy(): void {
  if (copying.value) return;
  copying.value = true;
  emit('copy', (ok: boolean) => {
    copying.value = false;
    if (ok) {
      copied.value = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        copied.value = false;
      }, 1400);
    }
  });
}
</script>

<style scoped>
.selection-toolbar {
  border-top: 1px solid var(--border);
  background: var(--bg-sidebar);
  padding: 10px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.selection-info {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.selection-info .count b {
  color: var(--text-primary);
  font-weight: 600;
  margin: 0 2px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent-light);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 0.82rem;
  border-radius: 4px;
  transition: color var(--transition), background var(--transition);
}
.link-btn:hover:not(:disabled) {
  background: var(--bg-card);
  color: var(--accent);
}
.link-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn {
  border: 1px solid transparent;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition:
    background var(--transition),
    color var(--transition),
    border-color var(--transition),
    transform var(--transition);
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-light);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  border-color: var(--border);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--border-active, var(--accent));
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}
.btn-ghost:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}
</style>
