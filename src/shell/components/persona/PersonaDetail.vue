<template>
  <div class="detail">
    <!-- 头部 -->
    <div class="detail-header">
      <div class="header-left">
        <div class="persona-name">{{ persona.name }}</div>
        <div class="persona-meta">
          <span class="status-badge" :class="persona.status">
            {{ persona.status === 'published' ? '已发布' : '草稿' }}
          </span>
          <span class="meta-sep">·</span>
          <span class="recipe-tag">{{ persona.recipe_name }}</span>
          <span class="meta-sep">·</span>
          <span class="meta-date">{{ persona.sources.length }} 份材料 · {{ formatDate(persona.updated) }}</span>
        </div>
      </div>
      <div class="header-actions">
        <button
          class="action-btn"
          type="button"
          title="重新蒸馏（使用当前材料和配方）"
          :disabled="redistilling"
          @click="redistill"
        >
          {{ redistilling ? '蒸馏中…' : '🔄 重新蒸馏' }}
        </button>
        <button
          v-if="persona.status === 'draft'"
          class="action-btn primary"
          type="button"
          :disabled="publishing"
          @click="publish"
        >
          {{ publishing ? '发布中…' : '🚀 发布为 Skill' }}
        </button>
        <button
          v-else
          class="action-btn"
          type="button"
          :disabled="publishing"
          @click="unpublish"
        >
          {{ publishing ? '撤销中…' : '↩ 撤销发布' }}
        </button>
        <button
          class="action-btn danger"
          type="button"
          @click="deletePersona"
        >
          🗑 删除
        </button>
      </div>
    </div>

    <!-- 重新蒸馏进度（覆盖编辑区） -->
    <div v-if="redistilling" class="redistill-overlay">
      <div class="redistill-progress">
        <div
          v-for="(s, i) in persona.sources"
          :key="i"
          class="extract-item"
          :class="{
            done: extractDone.has(i),
            running: extractRunning.has(i) && !extractDone.has(i),
          }"
        >
          <span class="extract-status">{{ extractDone.has(i) ? '✓' : extractRunning.has(i) ? '⟳' : '·' }}</span>
          <span>{{ s.label }}</span>
        </div>
        <div class="extract-item" :class="{ running: synthesizing }">
          <span class="extract-status">{{ synthesizing ? '⟳' : '·' }}</span>
          <span>合成中…</span>
        </div>
      </div>
      <div v-if="streamText" class="redistill-stream">{{ streamText }}</div>
      <button class="abort-btn" type="button" @click="abortRedistill">中止</button>
    </div>

    <!-- 编辑区：左编辑器 + 右预览 -->
    <div v-else class="editor-area">
      <div class="editor-toolbar">
        <span class="toolbar-label">SKILL.md</span>
        <button
          class="save-btn"
          type="button"
          :disabled="!isDirty || saving"
          @click="saveEdit"
        >
          {{ saving ? '保存中…' : isDirty ? '💾 保存修改' : '已保存' }}
        </button>
      </div>
      <div class="editor-split">
        <textarea
          v-model="localSkillMd"
          class="md-editor"
          spellcheck="false"
        />
        <div class="md-preview">
          <MarkdownView :text="localSkillMd" />
        </div>
      </div>
    </div>

    <!-- Toast -->
    <transition name="toast">
      <div v-if="toast" class="toast" :class="`toast-${toast.kind}`">
        {{ toast.text }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import type { PersonaMeta, PersonaRecipeInfo, PersonaEvent } from '@toolbox/bridge';
import MarkdownView from '../chat/MarkdownView.vue';

const props = defineProps<{
  persona: PersonaMeta;
  skillMd: string;
  recipes: PersonaRecipeInfo[];
}>();

const emit = defineEmits<{
  'update': [meta: PersonaMeta];
  'deleted': [];
  'published': [];
  'unpublished': [];
}>();

// ── 编辑状态 ──────────────────────────────────────────────

const localSkillMd = ref(props.skillMd);
watch(() => props.skillMd, (v) => { localSkillMd.value = v; });

const isDirty = computed(() => localSkillMd.value !== props.skillMd);
const saving = ref(false);

async function saveEdit(): Promise<void> {
  if (!isDirty.value) return;
  saving.value = true;
  try {
    const meta = await window.electronAPI.personaSave({
      id: props.persona.id,
      name: props.persona.name,
      recipe_name: props.persona.recipe_name,
      skillMd: localSkillMd.value,
      sources: props.persona.sources,
    });
    emit('update', meta);
    showToast('info', '已保存');
  } catch (err) {
    showToast('error', `保存失败：${(err as Error).message}`);
  } finally {
    saving.value = false;
  }
}

// ── 发布 ──────────────────────────────────────────────────

const publishing = ref(false);

async function publish(): Promise<void> {
  publishing.value = true;
  try {
    await window.electronAPI.personaPublish(props.persona.id);
    emit('published');
    showToast('info', '已发布为 Skill');
  } catch (err) {
    showToast('error', `发布失败：${(err as Error).message}`);
  } finally {
    publishing.value = false;
  }
}

async function unpublish(): Promise<void> {
  publishing.value = true;
  try {
    await window.electronAPI.personaUnpublish(props.persona.id);
    emit('unpublished');
    showToast('info', '已撤销发布');
  } catch (err) {
    showToast('error', `撤销失败：${(err as Error).message}`);
  } finally {
    publishing.value = false;
  }
}

// ── 删除 ──────────────────────────────────────────────────

async function deletePersona(): Promise<void> {
  if (!confirm(`确定要删除人格 "${props.persona.name}" 吗？此操作不可撤销。`)) return;
  await window.electronAPI.personaDelete(props.persona.id);
  emit('deleted');
}

// ── 重新蒸馏 ──────────────────────────────────────────────

const redistilling = ref(false);
const extractRunning = ref<Set<number>>(new Set());
const extractDone = ref<Set<number>>(new Set());
const synthesizing = ref(false);
const streamText = ref('');
let currentRequestId = '';
let disposeListener: (() => void) | null = null;

async function redistill(): Promise<void> {
  if (props.persona.sources.length === 0) {
    showToast('error', '没有可用的材料，无法重新蒸馏');
    return;
  }

  redistilling.value = true;
  extractRunning.value = new Set();
  extractDone.value = new Set();
  synthesizing.value = false;
  streamText.value = '';

  disposeListener = window.electronAPI.onPersonaEvent((event: PersonaEvent) => {
    if (event.requestId !== currentRequestId) return;

    if (event.kind === 'extract-start') {
      extractRunning.value = new Set([...extractRunning.value, event.sourceIndex]);
    } else if (event.kind === 'extract-done') {
      extractDone.value = new Set([...extractDone.value, event.sourceIndex]);
      if (extractDone.value.size === props.persona.sources.length) {
        synthesizing.value = true;
      }
    } else if (event.kind === 'synthesis-chunk') {
      streamText.value += event.chunk;
    } else if (event.kind === 'synthesis-end') {
      localSkillMd.value = streamText.value;
      redistilling.value = false;
      synthesizing.value = false;
      showToast('info', '蒸馏完成，请审阅并保存');
      cleanupListener();
    } else if (event.kind === 'error') {
      redistilling.value = false;
      showToast('error', `蒸馏失败：${event.message}`);
      cleanupListener();
    } else if (event.kind === 'aborted') {
      redistilling.value = false;
      cleanupListener();
    }
  });

  // 需要读取已存档的材料内容
  const materialContents = await loadMaterialContents();
  const result = await window.electronAPI.personaDistill({
    recipe_name: props.persona.recipe_name,
    materials: props.persona.sources.map((s, i) => ({
      type: s.type,
      label: s.label,
      content: materialContents[i] ?? '',
    })),
  });
  currentRequestId = result.requestId;
}

async function loadMaterialContents(): Promise<string[]> {
  return window.electronAPI.personaLoadMaterials(props.persona.id);
}

function abortRedistill(): void {
  if (currentRequestId) {
    void window.electronAPI.personaDistillAbort(currentRequestId);
  }
}

function cleanupListener(): void {
  disposeListener?.();
  disposeListener = null;
}

onBeforeUnmount(() => cleanupListener());

// ── Toast ──────────────────────────────────────────────────

interface ToastState { kind: 'info' | 'error'; text: string; }
const toast = ref<ToastState | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(kind: 'info' | 'error', text: string): void {
  toast.value = { kind, text };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = null; }, 2500);
}

// ── 工具 ──────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<style scoped>
.detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* Header */
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  gap: 16px;
  flex-shrink: 0;
}

.header-left { flex: 1; min-width: 0; }

.persona-name {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.persona-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--text-dim);
  flex-wrap: wrap;
}

.status-badge {
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 0.72rem;
  font-weight: 500;
}
.status-badge.published {
  background: rgba(52, 211, 153, 0.15);
  color: #6ee7b7;
}
.status-badge.draft {
  background: rgba(156, 163, 175, 0.15);
  color: var(--text-dim);
}

.recipe-tag {
  background: rgba(108, 92, 231, 0.15);
  color: var(--accent-light);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.72rem;
}

.meta-sep { color: var(--border); }

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.action-btn {
  padding: 7px 14px;
  background: var(--bg-card-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.82rem;
  transition: background var(--transition), border-color var(--transition), color var(--transition);
  white-space: nowrap;
}
.action-btn:hover:not(:disabled) {
  background: var(--bg-active);
  border-color: var(--accent);
  color: var(--text-primary);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.action-btn.primary:hover:not(:disabled) {
  background: var(--accent-light);
}
.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

/* Editor area */
.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base);
  flex-shrink: 0;
}

.toolbar-label {
  font-size: 0.72rem;
  color: var(--text-dim);
  font-family: monospace;
}

.save-btn {
  padding: 5px 12px;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  transition: background var(--transition), opacity var(--transition);
}
.save-btn:disabled {
  opacity: 0.45;
  cursor: default;
  background: var(--bg-card);
  color: var(--text-dim);
}
.save-btn:hover:not(:disabled) {
  background: var(--accent-light);
}

.editor-split {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  overflow: hidden;
}

.md-editor {
  background: var(--bg-base);
  border: none;
  border-right: 1px solid var(--border);
  color: var(--text-primary);
  padding: 16px;
  font-size: 0.82rem;
  font-family: 'Monaco', 'Menlo', monospace;
  line-height: 1.6;
  resize: none;
  outline: none;
}

.md-preview {
  padding: 16px 20px;
  overflow-y: auto;
  font-size: 0.86rem;
  line-height: 1.7;
  color: var(--text-primary);
  background: var(--bg-content);
}

/* Redistill overlay */
.redistill-overlay {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  overflow-y: auto;
}

.redistill-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.extract-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.84rem;
  color: var(--text-dim);
}
.extract-item.running { color: var(--accent-light); }
.extract-item.done { color: var(--text-secondary); }
.extract-status {
  width: 16px;
  text-align: center;
}

.redistill-stream {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  font-size: 0.8rem;
  font-family: monospace;
  color: var(--text-secondary);
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
  line-height: 1.5;
}

.abort-btn {
  align-self: flex-start;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #fca5a5;
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.84rem;
}

/* Toast */
.toast {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 18px;
  border-radius: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 0.84rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  z-index: 10;
  white-space: nowrap;
}
.toast-error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}
.toast-enter-active, .toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}
</style>
