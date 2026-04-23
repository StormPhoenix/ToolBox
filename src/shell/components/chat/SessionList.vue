<template>
  <aside class="session-list">
    <div class="session-header">
      <button class="new-btn" type="button" @click="$emit('new')">
        <span class="new-icon">＋</span>
        <span>新会话</span>
      </button>
    </div>

    <div class="session-scroll">
      <div v-if="sessions.length === 0" class="empty-hint">
        暂无会话
      </div>

      <div
        v-for="s in sessions"
        :key="s.id"
        class="session-item"
        :class="{ active: s.id === activeId }"
        @click="$emit('select', s.id)"
      >
        <div class="session-main">
          <template v-if="renamingId === s.id">
            <input
              ref="renameInputEl"
              v-model="renamingTitle"
              class="rename-input"
              @click.stop
              @keydown.enter.prevent="commitRename(s.id)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(s.id)"
            />
          </template>
          <template v-else>
            <div class="session-title" :title="s.title">{{ s.title }}</div>
            <div class="session-meta">
              <span>{{ s.messageCount }} 条</span>
              <span>·</span>
              <span>{{ formatTime(s.updatedAt) }}</span>
            </div>
          </template>
        </div>

        <div v-if="renamingId !== s.id" class="session-actions" @click.stop>
          <button
            class="action-btn"
            type="button"
            title="重命名"
            @click="beginRename(s)"
          >
            ✎
          </button>
          <button
            class="action-btn danger"
            type="button"
            title="删除"
            @click="confirmDelete(s)"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import type { SessionIndexEntry } from '@toolbox/bridge';

defineProps<{
  sessions: SessionIndexEntry[];
  activeId: string | null;
}>();

const emit = defineEmits<{
  'new': [];
  'select': [id: string];
  'delete': [id: string];
  'rename': [id: string, title: string];
}>();

const renamingId = ref<string | null>(null);
const renamingTitle = ref('');
const renameInputEl = ref<HTMLInputElement | HTMLInputElement[] | null>(null);

function beginRename(s: SessionIndexEntry): void {
  renamingId.value = s.id;
  renamingTitle.value = s.title;
  void nextTick(() => {
    const el = Array.isArray(renameInputEl.value)
      ? renameInputEl.value[0]
      : renameInputEl.value;
    el?.focus();
    el?.select();
  });
}

function commitRename(id: string): void {
  if (renamingId.value !== id) return;
  const title = renamingTitle.value.trim();
  if (title) {
    emit('rename', id, title);
  }
  renamingId.value = null;
  renamingTitle.value = '';
}

function cancelRename(): void {
  renamingId.value = null;
  renamingTitle.value = '';
}

function confirmDelete(s: SessionIndexEntry): void {
  if (confirm(`确定要删除会话 "${s.title}" 吗？此操作不可撤销。`)) {
    emit('delete', s.id);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
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
  return `${mo}-${dd} ${hh}:${mm}`;
}
</script>

<style scoped>
.session-list {
  width: 240px;
  min-width: 240px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.session-header {
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.new-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), transform var(--transition);
}
.new-btn:hover {
  background: var(--accent-light);
  transform: translateY(-1px);
}

.new-icon {
  font-size: 1rem;
  line-height: 1;
}

.session-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.empty-hint {
  padding: 28px 14px;
  color: var(--text-dim);
  text-align: center;
  font-size: 0.82rem;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition);
  margin-bottom: 2px;
}
.session-item:hover {
  background: var(--bg-card);
}
.session-item.active {
  background: var(--bg-active);
}

.session-main {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 0.86rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item.active .session-title {
  color: var(--accent-light);
}

.session-meta {
  margin-top: 3px;
  font-size: 0.72rem;
  color: var(--text-dim);
  display: flex;
  gap: 5px;
}

.session-actions {
  display: none;
  gap: 2px;
}
.session-item:hover .session-actions {
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
