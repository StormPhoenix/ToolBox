<template>
  <div class="detail">
    <!-- 头部 -->
    <div class="detail-header">
      <div class="header-left">
        <div class="persona-name" :title="persona.name">{{ persona.name }}</div>
        <div class="persona-meta">
          <span class="status-badge" :class="persona.status">
            {{ persona.status === 'published' ? '已发布' : '草稿' }}
          </span>
          <span class="meta-sep">·</span>
          <span class="meta-date">更新于 {{ formatDate(persona.updated) }}</span>
          <span class="meta-sep">·</span>
          <button class="meta-link" type="button" @click="openDir('persona')">
            📂 本地目录
          </button>
          <template v-if="persona.status === 'published'">
            <span class="meta-sep">·</span>
            <button class="meta-link" type="button" @click="openDir('published')">
              🚀 Skill 目录
            </button>
          </template>
        </div>
      </div>
      <div class="header-actions">
        <button
          class="recipe-btn"
          type="button"
          :disabled="recipeChanging"
          :title="recipeKnown ? '点击切换配方' : '当前配方不存在，点击重新选择'"
          @click="showRecipeModal = true"
        >
          <span class="recipe-icon">🧪</span>
          <span class="recipe-btn-name">{{ persona.recipe_name }}</span>
          <span v-if="!recipeKnown" class="recipe-warn">⚠</span>
          <span class="recipe-caret">▾</span>
        </button>
      </div>
    </div>

    <div class="detail-body">

      <!-- 材料区 -->
      <section class="materials-section">
        <div class="section-header">
          <h3>材料 <span class="count">({{ persona.sources.length }})</span></h3>
        </div>

        <!-- 已有材料列表 -->
        <div v-if="persona.sources.length > 0" class="material-list">
          <div v-for="(s, i) in persona.sources" :key="i" class="material-item">
            <span class="material-type-badge">{{ typeLabel(s.type) }}</span>
            <span class="material-label" :title="s.label">{{ s.label }}</span>
            <button
              class="material-remove"
              type="button"
              title="删除材料"
              @click="removeMaterial(i)"
            >
              ×
            </button>
          </div>
        </div>
        <div v-else class="empty-materials">尚无材料，添加至少 1 份后才能蒸馏</div>

        <!-- 添加材料：Tab 切换 -->
        <div class="add-tabs">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            class="tab"
            :class="{ active: activeTab === tab.id }"
            type="button"
            @click="activeTab = tab.id"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            <span>{{ tab.label }}</span>
          </button>
        </div>

        <div class="tab-panel">
          <!-- 文本 Tab -->
          <div v-if="activeTab === 'text'" class="tab-content">
            <textarea
              v-model="textInput"
              class="text-input"
              placeholder="粘贴文章 / 笔记 / 对话…"
              rows="5"
              :disabled="addingText"
            />
            <div class="panel-actions">
              <button
                class="add-btn"
                type="button"
                :disabled="!textInput.trim() || addingText"
                @click="addText"
              >
                {{ addingText ? '添加中…' : '添加文本' }}
              </button>
            </div>
          </div>

          <!-- 文件 Tab -->
          <div v-else-if="activeTab === 'file'" class="tab-content file-tab">
            <div class="tab-hint">支持 .txt / .md / .markdown 文件，可多选</div>
            <div class="panel-actions center">
              <button
                class="upload-btn-large"
                type="button"
                :disabled="addingFile"
                @click="pickFile"
              >
                📂 选择文件…
              </button>
            </div>
          </div>

          <!-- URL Tab -->
          <div v-else class="tab-content">
            <input
              v-model="urlInput"
              class="url-input"
              type="url"
              placeholder="https://example.com/article"
              :disabled="fetchingUrl"
              @keydown.enter.prevent="addUrl"
            />
            <div v-if="urlError" class="url-error">{{ urlError }}</div>
            <div class="panel-actions">
              <button
                class="add-btn"
                type="button"
                :disabled="!urlInput.trim() || fetchingUrl"
                @click="addUrl"
              >
                {{ fetchingUrl ? '抓取中…' : '抓取 URL' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- SKILL.md 区 -->
      <section class="skill-section">
        <div class="section-header">
          <h3>SKILL.md</h3>
          <div class="section-actions">
            <!-- 蒸馏控制 -->
            <button
              v-if="!isDistilling"
              class="action-btn small"
              type="button"
              :disabled="persona.sources.length === 0"
              :title="persona.sources.length === 0 ? '请先添加至少 1 份材料' : ''"
              @click="startDistill"
            >
              {{ hasSkillMd ? '🔄 重新蒸馏' : '✨ 开始蒸馏' }}
            </button>
            <button
              v-if="isDistilling"
              class="action-btn small danger"
              type="button"
              @click="abortDistill"
            >
              ⏹ 中止
            </button>

            <!-- 编辑保存 -->
            <button
              v-if="!isDistilling && hasSkillMd"
              class="action-btn small"
              type="button"
              :disabled="!isDirty || saving"
              @click="saveSkillMd"
            >
              {{ saving ? '保存中…' : isDirty ? '💾 保存修改' : '已保存' }}
            </button>

            <!-- 发布 / 撤销发布 -->
            <button
              v-if="!isDistilling && hasSkillMd && persona.status === 'draft'"
              class="action-btn small primary"
              type="button"
              :disabled="publishing"
              @click="publish()"
            >
              {{ publishing ? '发布中…' : '🚀 发布为 Skill' }}
            </button>
            <button
              v-if="!isDistilling && hasSkillMd && persona.status === 'published'"
              class="action-btn small"
              type="button"
              :disabled="publishing"
              @click="unpublish"
            >
              {{ publishing ? '撤销中…' : '↩ 撤销发布' }}
            </button>
          </div>
        </div>

        <!-- 蒸馏进行中：进度展示 -->
        <div v-if="isDistilling" class="distill-progress">
          <div
            v-for="(s, i) in persona.sources"
            :key="i"
            class="extract-item"
            :class="{
              done: extractDone.has(i),
              running: extractRunning.has(i) && !extractDone.has(i),
            }"
          >
            <span class="extract-status">
              {{ extractDone.has(i) ? '✓' : extractRunning.has(i) ? '⟳' : '·' }}
            </span>
            <span class="extract-label">{{ s.label }}</span>
          </div>
          <div class="extract-item" :class="{ running: synthesizing }">
            <span class="extract-status">{{ synthesizing ? '⟳' : '·' }}</span>
            <span class="extract-label">合成中…</span>
          </div>

          <div v-if="streamText" class="stream-preview">
            <div class="preview-label">实时预览</div>
            <div class="preview-content">{{ streamText }}</div>
          </div>
        </div>

        <!-- 未蒸馏过：占位 -->
        <div v-else-if="!hasSkillMd" class="skill-empty">
          <div class="empty-msg">尚未生成 SKILL.md。添加材料后点击「开始蒸馏」。</div>
        </div>

        <!-- 已有 SKILL.md：编辑器 + 预览 -->
        <div v-else class="editor-split">
          <textarea
            v-model="localSkillMd"
            class="md-editor"
            spellcheck="false"
          />
          <div class="md-preview">
            <MarkdownView :text="localSkillMd" />
          </div>
        </div>
      </section>

      <!-- 危险区 -->
      <section class="danger-section">
        <button class="action-btn danger small" type="button" @click="deletePersona">
          🗑 删除此人格
        </button>
      </section>

    </div>

    <!-- 切换配方模态 -->
    <RecipePickerModal
      v-if="showRecipeModal"
      :recipes="recipes"
      :current-recipe="persona.recipe_name"
      title="切换配方"
      subtitle="切换不会影响已添加的材料和当前 SKILL.md，下次蒸馏时使用新配方"
      confirm-label="切换"
      @select="onRecipeModalSelect"
      @cancel="showRecipeModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type {
  PersonaMeta,
  PersonaRecipeInfo,
  PersonaEvent,
} from '@toolbox/bridge';
import MarkdownView from '../chat/MarkdownView.vue';
import RecipePickerModal from './RecipePickerModal.vue';

const props = defineProps<{
  persona: PersonaMeta;
  skillMd: string;
  recipes: PersonaRecipeInfo[];
  isDistilling: boolean;
  /**
   * 来自父组件的实时事件流（仅当前 persona 的事件）。
   * 父组件每次插入新事件，本组件 watch 并处理。
   */
  liveEvents: PersonaEvent[];
}>();

const emit = defineEmits<{
  'meta-updated': [meta: PersonaMeta];
  'skill-md-updated': [content: string];
}>();

// ── SKILL.md 编辑状态 ─────────────────────────────────────

const localSkillMd = ref(props.skillMd);
watch(() => props.skillMd, (v) => { localSkillMd.value = v; });

const hasSkillMd = computed(() => props.skillMd.trim().length > 0);
const isDirty = computed(() => localSkillMd.value !== props.skillMd);
const saving = ref(false);

async function saveSkillMd(): Promise<void> {
  if (!isDirty.value) return;
  saving.value = true;
  try {
    const meta = await window.electronAPI.personaSaveSkillMd({
      id: props.persona.id,
      skillMd: localSkillMd.value,
    });
    emit('meta-updated', meta);
    emit('skill-md-updated', localSkillMd.value);
  } finally {
    saving.value = false;
  }
}

// ── 材料操作 ─────────────────────────────────────────────

type MaterialTab = 'text' | 'file' | 'url';

const TABS: Array<{ id: MaterialTab; label: string; icon: string }> = [
  { id: 'text', label: '文本', icon: '📝' },
  { id: 'file', label: '文件', icon: '📂' },
  { id: 'url', label: 'URL', icon: '🌐' },
];

const activeTab = ref<MaterialTab>('text');

const textInput = ref('');
const urlInput = ref('');
const urlError = ref('');
const addingText = ref(false);
const addingFile = ref(false);
const fetchingUrl = ref(false);

function typeLabel(type: string): string {
  return type === 'text' ? '文本' : type === 'file' ? '文件' : 'URL';
}

/** 把文本内容截断为不超过 N 字符的单行预览，用作材料 label */
function truncateLabel(text: string, max = 30): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

async function addText(): Promise<void> {
  const content = textInput.value.trim();
  if (!content) return;
  addingText.value = true;
  try {
    const meta = await window.electronAPI.personaAddMaterial({
      id: props.persona.id,
      type: 'text',
      label: truncateLabel(content),
      content,
    });
    emit('meta-updated', meta);
    textInput.value = '';
  } finally {
    addingText.value = false;
  }
}

async function pickFile(): Promise<void> {
  const result = await window.electronAPI.showOpenDialog({
    title: '选择材料文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '文本文件', extensions: ['txt', 'md', 'markdown'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  addingFile.value = true;
  try {
    let lastMeta: PersonaMeta | null = null;
    for (const filePath of result.filePaths) {
      const content = await window.electronAPI.readFile(filePath);
      const label = filePath.split(/[\\/]/).pop() ?? filePath;
      lastMeta = await window.electronAPI.personaAddMaterial({
        id: props.persona.id,
        type: 'file',
        label,
        content,
      });
    }
    if (lastMeta) emit('meta-updated', lastMeta);
  } finally {
    addingFile.value = false;
  }
}

async function addUrl(): Promise<void> {
  const url = urlInput.value.trim();
  if (!url) return;
  urlError.value = '';
  fetchingUrl.value = true;
  try {
    const fetchResult = await window.electronAPI.personaFetchUrl(url);
    if (!fetchResult.ok) {
      urlError.value = fetchResult.error;
      return;
    }
    const u = new URL(url);
    const label = `${u.hostname}${u.pathname.slice(0, 30)}`;
    const meta = await window.electronAPI.personaAddMaterial({
      id: props.persona.id,
      type: 'url',
      label,
      content: fetchResult.content,
    });
    emit('meta-updated', meta);
    urlInput.value = '';
  } catch (err) {
    urlError.value = (err as Error).message;
  } finally {
    fetchingUrl.value = false;
  }
}

async function removeMaterial(index: number): Promise<void> {
  const meta = await window.electronAPI.personaRemoveMaterial(props.persona.id, index);
  emit('meta-updated', meta);
}

// ── 配方切换 ─────────────────────────────────────────────

const recipeKnown = computed(() =>
  props.recipes.some(r => r.name === props.persona.recipe_name)
);
const recipeChanging = ref(false);
const showRecipeModal = ref(false);

async function onRecipeModalSelect(newRecipe: string): Promise<void> {
  showRecipeModal.value = false;
  if (!newRecipe || newRecipe === props.persona.recipe_name) return;
  recipeChanging.value = true;
  try {
    const meta = await window.electronAPI.personaSetRecipe(props.persona.id, newRecipe);
    emit('meta-updated', meta);
  } finally {
    recipeChanging.value = false;
  }
}

// ── 蒸馏控制 ─────────────────────────────────────────────

const extractRunning = ref<Set<number>>(new Set());
const extractDone = ref<Set<number>>(new Set());
const synthesizing = ref(false);
const streamText = ref('');
let currentRequestId = '';

async function startDistill(): Promise<void> {
  if (props.persona.sources.length === 0) return;
  resetDistillState();
  const result = await window.electronAPI.personaDistill({ id: props.persona.id });
  currentRequestId = result.requestId;
}

function abortDistill(): void {
  if (currentRequestId) {
    void window.electronAPI.personaDistillAbort(currentRequestId);
  }
}

function resetDistillState(): void {
  extractRunning.value = new Set();
  extractDone.value = new Set();
  synthesizing.value = false;
  streamText.value = '';
  currentRequestId = '';
}

// 监听父组件转发的事件
watch(
  () => props.liveEvents,
  (events) => {
    if (events.length === 0) return;
    const ev = events[events.length - 1];
    if (ev.kind === 'extract-start') {
      extractRunning.value = new Set([...extractRunning.value, ev.sourceIndex]);
      currentRequestId = ev.requestId;
    } else if (ev.kind === 'extract-done') {
      extractDone.value = new Set([...extractDone.value, ev.sourceIndex]);
      if (extractDone.value.size === props.persona.sources.length) {
        synthesizing.value = true;
      }
    } else if (ev.kind === 'synthesis-chunk') {
      streamText.value += ev.chunk;
    } else if (ev.kind === 'synthesis-end' || ev.kind === 'aborted' || ev.kind === 'error') {
      // 父组件会刷新 SKILL.md 内容；这里只清理本地进度状态
      resetDistillState();
    }
  },
  { deep: true }
);

// 切换 persona 时清理本地状态
watch(() => props.persona.id, () => {
  resetDistillState();
});

// ── 发布 ─────────────────────────────────────────────────

const publishing = ref(false);

async function publish(overwrite = false): Promise<void> {
  publishing.value = true;
  try {
    const result = await window.electronAPI.personaPublish(props.persona.id, {
      overwrite,
    });

    if (result.ok) {
      // 重新加载 meta 以更新 status 徽标和 published_dir
      const loaded = await window.electronAPI.personaLoad(props.persona.id);
      if (loaded) emit('meta-updated', loaded.meta);
      return;
    }

    if (result.reason === 'no_skill_md') {
      alert('SKILL.md 内容为空，无法发布');
      return;
    }

    if (result.reason === 'directory_taken') {
      const confirmed = confirm(
        `目录 "${result.slug}" 已被另一份 Skill 占用。\n` +
          `继续发布会覆盖现有内容（不可恢复），是否确认？`
      );
      if (confirmed) {
        // 递归调用，强制覆盖
        await publish(true);
      }
    }
  } catch (err) {
    alert(`发布失败：${(err as Error).message}`);
  } finally {
    publishing.value = false;
  }
}

async function unpublish(): Promise<void> {
  publishing.value = true;
  try {
    await window.electronAPI.personaUnpublish(props.persona.id);
    const result = await window.electronAPI.personaLoad(props.persona.id);
    if (result) emit('meta-updated', result.meta);
  } finally {
    publishing.value = false;
  }
}

// ── 打开本地目录 ─────────────────────────────────────────

async function openDir(target: 'persona' | 'published'): Promise<void> {
  const result = await window.electronAPI.personaOpenDir(props.persona.id, target);
  if (!result.ok) {
    // 目录不存在（极少出现：persona 已删除 or 已撤销发布），静默忽略
    console.warn(`打开目录失败: ${result.error}`);
  }
}

// ── 删除 ─────────────────────────────────────────────────

async function deletePersona(): Promise<void> {
  if (!confirm(`确定要删除人格 "${props.persona.name}" 吗？此操作不可撤销。`)) return;
  await window.electronAPI.personaDelete(props.persona.id);
  // 父组件会监听 personaList 变化自动切回空态
}

// ── 工具 ──────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
</script>

<style scoped>
.detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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

.meta-sep { color: var(--border); }

/* meta 行内联链接按钮 */
.meta-link {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.78rem;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  transition: color var(--transition);
}
.meta-link:hover {
  color: var(--accent-light);
}

/* 配方切换按钮（头部右上角） */
.recipe-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(108, 92, 231, 0.15);
  border: 1px solid rgba(108, 92, 231, 0.4);
  border-radius: var(--radius-sm);
  color: var(--accent-light);
  cursor: pointer;
  font-size: 0.84rem;
  transition: background var(--transition), border-color var(--transition);
  max-width: 240px;
}
.recipe-btn:hover:not(:disabled) {
  background: rgba(108, 92, 231, 0.25);
  border-color: var(--accent);
}
.recipe-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.recipe-icon {
  flex-shrink: 0;
  font-size: 0.95rem;
}
.recipe-btn-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.recipe-warn {
  color: #fbbf24;
  flex-shrink: 0;
}
.recipe-caret {
  flex-shrink: 0;
  font-size: 0.7rem;
  opacity: 0.7;
}

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
.action-btn.small {
  padding: 5px 10px;
  font-size: 0.78rem;
}

/* Body */
.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-header h3 {
  font-size: 0.92rem;
  color: var(--text-primary);
  margin: 0;
  font-weight: 600;
}
.section-header .count {
  font-weight: 400;
  color: var(--text-dim);
  font-size: 0.82rem;
  margin-left: 4px;
}
.section-actions {
  display: flex;
  gap: 8px;
}

/* Materials */
.materials-section,
.skill-section {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px 18px;
}

.material-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.material-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.material-type-badge {
  font-size: 0.68rem;
  background: rgba(108, 92, 231, 0.15);
  color: var(--accent-light);
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.material-label {
  flex: 1;
  font-size: 0.82rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-remove {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.95rem;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
}
.material-remove:hover {
  color: #fca5a5;
}

.empty-materials {
  color: var(--text-dim);
  font-size: 0.82rem;
  text-align: center;
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}

/* Tab 切换 */
.add-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.82rem;
  transition: color var(--transition), border-color var(--transition);
  margin-bottom: -1px;
}
.tab:hover {
  color: var(--text-primary);
}
.tab.active {
  color: var(--accent-light);
  border-bottom-color: var(--accent);
}
.tab-icon {
  font-size: 0.92rem;
}

.tab-panel {
  min-height: 140px;
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tab-content.file-tab {
  align-items: stretch;
  text-align: center;
  padding: 8px 0;
}

.tab-hint {
  color: var(--text-dim);
  font-size: 0.82rem;
  padding: 6px 0 8px;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.panel-actions.center {
  justify-content: center;
  padding: 14px 0 4px;
}

.text-input {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 0.86rem;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  width: 100%;
  box-sizing: border-box;
}
.text-input:focus {
  outline: none;
  border-color: var(--accent);
}

.url-input {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 0.86rem;
  width: 100%;
  box-sizing: border-box;
}
.url-input:focus {
  outline: none;
  border-color: var(--accent);
}

.url-error {
  color: #fca5a5;
  font-size: 0.78rem;
}

.add-btn {
  padding: 7px 16px;
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  color: #fff;
  cursor: pointer;
  font-size: 0.84rem;
  white-space: nowrap;
  font-weight: 500;
  transition: background var(--transition), opacity var(--transition);
}
.add-btn:hover:not(:disabled) {
  background: var(--accent-light);
}
.add-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.upload-btn-large {
  padding: 10px 24px;
  background: var(--bg-base);
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.88rem;
  transition: background var(--transition), border-color var(--transition);
}
.upload-btn-large:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--accent);
  border-style: solid;
}
.upload-btn-large:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* SKILL.md */
.distill-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
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
  font-size: 0.8rem;
}

.stream-preview {
  margin-top: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  max-height: 320px;
  display: flex;
  flex-direction: column;
}

.preview-label {
  font-size: 0.72rem;
  color: var(--text-dim);
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
}

.preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  font-family: 'Monaco', 'Menlo', monospace;
  line-height: 1.5;
}

.skill-empty {
  padding: 30px 16px;
  text-align: center;
  color: var(--text-dim);
}

.empty-msg {
  font-size: 0.86rem;
}

.editor-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  height: 480px;
}

.md-editor {
  background: var(--bg-base);
  border: none;
  border-right: 1px solid var(--border);
  color: var(--text-primary);
  padding: 12px 14px;
  font-size: 0.82rem;
  font-family: 'Monaco', 'Menlo', monospace;
  line-height: 1.6;
  resize: none;
  outline: none;
}
.md-editor:focus {
  background: var(--bg-card);
}

.md-preview {
  padding: 12px 16px;
  overflow-y: auto;
  font-size: 0.86rem;
  line-height: 1.7;
  color: var(--text-primary);
  background: var(--bg-content);
}

/* Danger zone */
.danger-section {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
