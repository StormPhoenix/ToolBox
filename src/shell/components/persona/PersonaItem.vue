<template>
  <div
    class="persona-item"
    :class="{ active }"
    @click="$emit('click')"
  >
    <div class="item-main">
      <div class="item-name" :title="persona.name">{{ persona.name }}</div>
      <div class="item-meta">
        <span class="recipe-tag">{{ persona.recipe_name }}</span>
        <span>·</span>
        <span>{{ formatDate(persona.updated) }}</span>
      </div>
    </div>
    <div class="item-actions" @click.stop>
      <button
        class="action-btn danger"
        type="button"
        title="删除"
        @click="confirmDelete"
      >
        🗑
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PersonaMeta } from '@toolbox/bridge';

const props = defineProps<{
  persona: PersonaMeta;
  active: boolean;
}>();

const emit = defineEmits<{
  'click': [];
  'delete': [];
}>();

function confirmDelete(): void {
  if (confirm(`确定要删除人格 "${props.persona.name}" 吗？此操作不可撤销。`)) {
    emit('delete');
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mo}-${dd}`;
}
</script>

<style scoped>
.persona-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition);
  margin-bottom: 2px;
}
.persona-item:hover {
  background: var(--bg-card);
}
.persona-item.active {
  background: var(--bg-active);
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 0.86rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.persona-item.active .item-name {
  color: var(--accent-light);
}

.item-meta {
  margin-top: 3px;
  font-size: 0.72rem;
  color: var(--text-dim);
  display: flex;
  gap: 4px;
  align-items: center;
}

.recipe-tag {
  background: rgba(108, 92, 231, 0.15);
  color: var(--accent-light);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.68rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80px;
}

.item-actions {
  display: none;
}
.persona-item:hover .item-actions {
  display: flex;
}

.action-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 3px 5px;
  border-radius: 4px;
  font-size: 0.75rem;
  transition: background var(--transition), color var(--transition);
}
.action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}
</style>
