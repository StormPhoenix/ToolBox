<template>
  <div
    class="persona-item"
    :class="{ active }"
    @click="onClick"
  >
    <div class="item-spinner" v-if="distilling" title="正在蒸馏中">⟳</div>

    <div class="item-main">
      <template v-if="renaming">
        <input
          ref="renameInputEl"
          v-model="renameValue"
          class="rename-input"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
      </template>
      <template v-else>
        <div class="item-name" :title="persona.name">{{ persona.name }}</div>
        <div class="item-meta">
          <span class="recipe-tag" :title="persona.recipe_name">{{ persona.recipe_name }}</span>
          <span>·</span>
          <span>{{ persona.sources.length }} 份材料</span>
        </div>
      </template>
    </div>

    <div v-if="!renaming" class="item-actions" @click.stop>
      <button
        class="action-btn"
        type="button"
        title="重命名"
        @click="beginRename"
      >
        ✎
      </button>
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
import { ref, nextTick } from 'vue';
import type { PersonaMeta } from '@toolbox/bridge';

const props = defineProps<{
  persona: PersonaMeta;
  active: boolean;
  distilling: boolean;
}>();

const emit = defineEmits<{
  'click': [];
  'delete': [];
  'rename': [newName: string];
}>();

const renaming = ref(false);
const renameValue = ref('');
const renameInputEl = ref<HTMLInputElement | null>(null);

function onClick(): void {
  if (renaming.value) return;
  emit('click');
}

function beginRename(): void {
  renaming.value = true;
  renameValue.value = props.persona.name;
  void nextTick(() => {
    renameInputEl.value?.focus();
    renameInputEl.value?.select();
  });
}

function commitRename(): void {
  if (!renaming.value) return;
  const next = renameValue.value.trim();
  if (next && next !== props.persona.name) {
    emit('rename', next);
  }
  renaming.value = false;
  renameValue.value = '';
}

function cancelRename(): void {
  renaming.value = false;
  renameValue.value = '';
}

function confirmDelete(): void {
  if (confirm(`确定要删除人格 "${props.persona.name}" 吗？此操作不可撤销。`)) {
    emit('delete');
  }
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

.item-spinner {
  width: 14px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--accent-light);
  animation: spin 1.2s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  max-width: 90px;
}

.item-actions {
  display: none;
  gap: 2px;
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
.action-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}
.action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.rename-input {
  width: 100%;
  background: var(--bg-base);
  border: 1px solid var(--border-active);
  color: var(--text-primary);
  padding: 4px 6px;
  font-size: 0.86rem;
  border-radius: 4px;
  outline: none;
}
</style>
