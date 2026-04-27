<template>
  <div class="wizard">
    <!-- 步骤指示器 -->
    <div class="wizard-header">
      <div class="step-bar">
        <div
          v-for="(label, i) in STEPS"
          :key="i"
          class="step"
          :class="{ done: step > i + 1, active: step === i + 1 }"
        >
          <div class="step-dot">{{ step > i + 1 ? '✓' : i + 1 }}</div>
          <div class="step-label">{{ label }}</div>
        </div>
      </div>
      <button class="close-btn" type="button" @click="$emit('cancel')">✕</button>
    </div>

    <div class="wizard-body">

      <!-- Step 1：选择配方 -->
      <div v-if="step === 1" class="step-content">
        <h2 class="step-title">选择配方</h2>
        <p class="step-desc">配方决定了蒸馏方式和输出风格。你也可以在用户配方目录中放入开源蒸馏 Skill。</p>
        <div class="recipe-grid">
          <div
            v-for="r in recipes"
            :key="r.name"
            class="recipe-card"
            :class="{ selected: selectedRecipe === r.name }"
            @click="selectedRecipe = r.name"
          >
            <div class="recipe-name">{{ r.name }}</div>
            <div class="recipe-desc">{{ r.description }}</div>
            <div v-if="r.suitable_for?.length" class="recipe-tags">
              <span v-for="t in r.suitable_for" :key="t" class="tag">{{ t }}</span>
            </div>
            <div v-if="r.builtin" class="builtin-badge">内置</div>
          </div>
        </div>
      </div>

      <!-- Step 2：添加材料 -->
      <div v-else-if="step === 2" class="step-content">
        <h2 class="step-title">添加材料</h2>
        <p class="step-desc">多种来源可以混合使用，建议至少提供 2 份材料以获得更好的蒸馏效果。</p>

        <!-- 文本输入 -->
        <div class="material-input-row">
          <textarea
            v-model="textInput"
            class="text-input"
            placeholder="粘贴文字片段（文章摘录、采访、演讲文稿等）…"
            rows="4"
          />
          <button
            class="add-btn"
            type="button"
            :disabled="!textInput.trim()"
            @click="addTextMaterial"
          >
            添加
          </button>
        </div>

        <!-- 文件上传 -->
        <div class="material-input-row">
          <button class="upload-btn" type="button" @click="pickFile">
            📂 选择文件（TXT / MD）
          </button>
        </div>

        <!-- URL 输入 -->
        <div class="material-input-row url-row">
          <input
            v-model="urlInput"
            class="url-input"
            type="url"
            placeholder="https://example.com/article"
            @keydown.enter.prevent="addUrlMaterial"
          />
          <button
            class="add-btn"
            type="button"
            :disabled="!urlInput.trim() || fetchingUrl"
            @click="addUrlMaterial"
          >
            {{ fetchingUrl ? '抓取中…' : '抓取' }}
          </button>
        </div>
        <div v-if="urlError" class="url-error">{{ urlError }}</div>

        <!-- 材料列表 -->
        <div v-if="materials.length > 0" class="material-list">
          <div v-for="(m, i) in materials" :key="i" class="material-item">
            <span class="material-type-badge">{{ typeLabel(m.type) }}</span>
            <span class="material-label" :title="m.label">{{ m.label }}</span>
            <span class="material-len">{{ m.content.length }} 字符</span>
            <button class="remove-btn" type="button" @click="materials.splice(i, 1)">✕</button>
          </div>
        </div>
        <div v-else class="empty-materials">尚未添加任何材料</div>
      </div>

      <!-- Step 3：蒸馏进行中 -->
      <div v-else-if="step === 3" class="step-content distill-step">
        <h2 class="step-title">蒸馏中</h2>

        <!-- 提取进度 -->
        <div class="extract-progress">
          <div
            v-for="(m, i) in materials"
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
            <span class="extract-label">{{ m.label }}</span>
          </div>
          <div class="extract-item" :class="{ running: synthesizing, done: synthesisDone }">
            <span class="extract-status">
              {{ synthesisDone ? '✓' : synthesizing ? '⟳' : '·' }}
            </span>
            <span class="extract-label">合成中…</span>
          </div>
        </div>

        <!-- 流式输出预览 -->
        <div v-if="streamText" class="stream-preview">
          <div class="preview-label">生成预览</div>
          <div class="preview-content">{{ streamText }}</div>
        </div>

        <button v-if="!synthesisDone" class="abort-btn" type="button" @click="abortDistill">
          中止
        </button>
      </div>

      <!-- Step 4：Review & Edit -->
      <div v-else-if="step === 4" class="step-content review-step">
        <h2 class="step-title">审阅与编辑</h2>
        <p class="step-desc">可直接编辑左侧 SKILL.md 内容，右侧实时预览渲染效果。</p>
        <div class="editor-split">
          <textarea
            v-model="editedSkillMd"
            class="md-editor"
            spellcheck="false"
          />
          <div class="md-preview">
            <MarkdownView :text="editedSkillMd" />
          </div>
        </div>
      </div>

      <!-- Step 5：命名并保存 -->
      <div v-else-if="step === 5" class="step-content">
        <h2 class="step-title">保存人格</h2>
        <p class="step-desc">为这份人格起一个名字，方便后续识别。</p>
        <div class="name-form">
          <label class="form-label">人格名称</label>
          <input
            v-model="personaName"
            class="name-input"
            type="text"
            placeholder="例如：费曼思维、苏格拉底、张三的思维模式"
            maxlength="80"
            @keydown.enter.prevent="doSave"
          />
          <div class="name-hint">{{ personaName.length }}/80</div>
        </div>
      </div>

    </div>

    <!-- 底部导航 -->
    <div class="wizard-footer">
      <button
        v-if="step > 1 && step !== 3"
        class="nav-btn secondary"
        type="button"
        @click="prevStep"
      >
        ← 上一步
      </button>
      <div class="footer-spacer" />

      <!-- Step 1 → 2 -->
      <button
        v-if="step === 1"
        class="nav-btn primary"
        type="button"
        :disabled="!selectedRecipe"
        @click="step = 2"
      >
        下一步 →
      </button>

      <!-- Step 2 → 3（开始蒸馏） -->
      <button
        v-else-if="step === 2"
        class="nav-btn primary"
        type="button"
        :disabled="materials.length === 0"
        @click="startDistill"
      >
        开始蒸馏 ✨
      </button>

      <!-- Step 3 → 4（蒸馏完成后） -->
      <button
        v-else-if="step === 3 && synthesisDone"
        class="nav-btn primary"
        type="button"
        @click="step = 4"
      >
        审阅结果 →
      </button>

      <!-- Step 4 → 5 -->
      <button
        v-else-if="step === 4"
        class="nav-btn primary"
        type="button"
        :disabled="!editedSkillMd.trim()"
        @click="step = 5"
      >
        下一步 →
      </button>

      <!-- Step 5 保存 -->
      <button
        v-else-if="step === 5"
        class="nav-btn primary"
        type="button"
        :disabled="!personaName.trim() || saving"
        @click="doSave"
      >
        {{ saving ? '保存中…' : '保存草稿' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { PersonaRecipeInfo, PersonaEvent } from '@toolbox/bridge';
import MarkdownView from '../chat/MarkdownView.vue';

const props = defineProps<{
  recipes: PersonaRecipeInfo[];
}>();

const emit = defineEmits<{
  'cancel': [];
  'saved': [id: string];
}>();

const STEPS = ['选择配方', '添加材料', '蒸馏', '审阅', '保存'];

// ── 步骤状态 ───────────────────────────────────────────────

const step = ref(1);

// ── Step 1 ────────────────────────────────────────────────

const selectedRecipe = ref(props.recipes[0]?.name ?? '');

// ── Step 2 ────────────────────────────────────────────────

interface MaterialEntry {
  type: 'text' | 'file' | 'url';
  label: string;
  content: string;
}

const materials = ref<MaterialEntry[]>([]);
const textInput = ref('');
const urlInput = ref('');
const urlError = ref('');
const fetchingUrl = ref(false);

function typeLabel(type: string): string {
  return type === 'text' ? '文本' : type === 'file' ? '文件' : 'URL';
}

function addTextMaterial(): void {
  const content = textInput.value.trim();
  if (!content) return;
  materials.value.push({ type: 'text', label: '手动输入', content });
  textInput.value = '';
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

  for (const filePath of result.filePaths) {
    try {
      const content = await window.electronAPI.readFile(filePath);
      const label = filePath.split('/').pop() ?? filePath;
      materials.value.push({ type: 'file', label, content });
    } catch (err) {
      console.error('读取文件失败:', err);
    }
  }
}

async function addUrlMaterial(): Promise<void> {
  const url = urlInput.value.trim();
  if (!url) return;
  urlError.value = '';
  fetchingUrl.value = true;
  try {
    const result = await window.electronAPI.personaFetchUrl(url);
    if (result.ok) {
      const label = new URL(url).hostname + new URL(url).pathname.slice(0, 30);
      materials.value.push({ type: 'url', label, content: result.content });
      urlInput.value = '';
    } else {
      urlError.value = result.error;
    }
  } catch (err) {
    urlError.value = (err as Error).message;
  } finally {
    fetchingUrl.value = false;
  }
}

// ── Step 3：蒸馏 ──────────────────────────────────────────

const extractRunning = ref<Set<number>>(new Set());
const extractDone = ref<Set<number>>(new Set());
const synthesizing = ref(false);
const synthesisDone = ref(false);
const streamText = ref('');
let currentRequestId = '';
let disposeEventListener: (() => void) | null = null;

async function startDistill(): Promise<void> {
  step.value = 3;
  extractRunning.value = new Set();
  extractDone.value = new Set();
  synthesizing.value = false;
  synthesisDone.value = false;
  streamText.value = '';

  disposeEventListener = window.electronAPI.onPersonaEvent((event: PersonaEvent) => {
    if (event.requestId !== currentRequestId) return;

    if (event.kind === 'extract-start') {
      extractRunning.value = new Set([...extractRunning.value, event.sourceIndex]);
    } else if (event.kind === 'extract-done') {
      extractDone.value = new Set([...extractDone.value, event.sourceIndex]);
      if (extractDone.value.size === materials.value.length) {
        synthesizing.value = true;
      }
    } else if (event.kind === 'synthesis-chunk') {
      streamText.value += event.chunk;
    } else if (event.kind === 'synthesis-end') {
      synthesizing.value = false;
      synthesisDone.value = true;
      editedSkillMd.value = streamText.value;
      cleanup();
    } else if (event.kind === 'error') {
      console.error('蒸馏失败:', event.message);
      synthesizing.value = false;
      step.value = 2;
      alert(`蒸馏失败：${event.message}`);
      cleanup();
    } else if (event.kind === 'aborted') {
      step.value = 2;
      cleanup();
    }
  });

  const result = await window.electronAPI.personaDistill({
    recipe_name: selectedRecipe.value,
    materials: materials.value.map(m => ({
      type: m.type,
      label: m.label,
      content: m.content,
    })),
  });
  currentRequestId = result.requestId;
}

function abortDistill(): void {
  if (currentRequestId) {
    void window.electronAPI.personaDistillAbort(currentRequestId);
  }
}

function cleanup(): void {
  disposeEventListener?.();
  disposeEventListener = null;
}

// ── Step 4 ────────────────────────────────────────────────

const editedSkillMd = ref('');

// ── Step 5 ────────────────────────────────────────────────

const personaName = ref('');
const saving = ref(false);

async function doSave(): Promise<void> {
  const name = personaName.value.trim();
  if (!name || !editedSkillMd.value.trim()) return;
  saving.value = true;
  try {
    const meta = await window.electronAPI.personaSave({
      name,
      recipe_name: selectedRecipe.value,
      skillMd: editedSkillMd.value,
      sources: materials.value.map((m, i) => ({
        type: m.type,
        label: m.label,
        stored_as: `source-${i}.${m.type === 'url' ? 'md' : 'txt'}`,
      })),
    });
    emit('saved', meta.id);
  } catch (err) {
    console.error('保存失败:', err);
    alert(`保存失败：${(err as Error).message}`);
  } finally {
    saving.value = false;
  }
}

function prevStep(): void {
  if (step.value > 1) step.value--;
}
</script>

<style scoped>
.wizard {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.wizard-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
}

.step-bar {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1;
}

.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--text-dim);
  flex: 1;
}

.step:not(:last-child)::after {
  content: '─';
  flex: 1;
  color: var(--border);
  font-size: 0.7rem;
  text-align: center;
}

.step.active {
  color: var(--accent-light);
}

.step.done {
  color: var(--text-secondary);
}

.step-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  flex-shrink: 0;
  background: var(--bg-base);
}
.step.active .step-dot {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.step.done .step-dot {
  border-color: var(--text-secondary);
  background: var(--bg-card);
}

.step-label {
  white-space: nowrap;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--transition), color var(--transition);
}
.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

/* Body */
.wizard-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.step-content {
  max-width: 760px;
}

.step-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.step-desc {
  font-size: 0.86rem;
  color: var(--text-dim);
  margin: 0 0 20px;
  line-height: 1.5;
}

/* Recipe cards */
.recipe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.recipe-card {
  position: relative;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
}
.recipe-card:hover {
  border-color: var(--accent-light);
  background: var(--bg-card-hover);
}
.recipe-card.selected {
  border-color: var(--accent);
  background: var(--bg-active);
}

.recipe-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}
.recipe-card.selected .recipe-name {
  color: var(--accent-light);
}

.recipe-desc {
  font-size: 0.78rem;
  color: var(--text-dim);
  line-height: 1.4;
  margin-bottom: 8px;
}

.recipe-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  background: rgba(108, 92, 231, 0.12);
  color: var(--accent-light);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.68rem;
}

.builtin-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.62rem;
  color: var(--text-dim);
  background: var(--bg-base);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
}

/* Materials */
.material-input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  align-items: flex-start;
}

.text-input {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 0.86rem;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}
.text-input:focus {
  outline: none;
  border-color: var(--accent);
}

.url-row {
  align-items: center;
}

.url-input {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 0.86rem;
}
.url-input:focus {
  outline: none;
  border-color: var(--accent);
}

.url-error {
  color: #fca5a5;
  font-size: 0.78rem;
  margin-top: -6px;
  margin-bottom: 8px;
}

.upload-btn,
.add-btn {
  padding: 8px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.84rem;
  white-space: nowrap;
  transition: background var(--transition), border-color var(--transition);
}
.upload-btn:hover,
.add-btn:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--accent);
}
.add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.material-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.material-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-card);
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

.material-len {
  font-size: 0.72rem;
  color: var(--text-dim);
  flex-shrink: 0;
}

.remove-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px 4px;
  border-radius: 3px;
  transition: color var(--transition);
}
.remove-btn:hover {
  color: #fca5a5;
}

.empty-materials {
  color: var(--text-dim);
  font-size: 0.82rem;
  text-align: center;
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
}

/* Distill step */
.distill-step {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.extract-progress {
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
.extract-item.running {
  color: var(--accent-light);
}
.extract-item.done {
  color: var(--text-secondary);
}

.extract-status {
  width: 16px;
  text-align: center;
  font-size: 0.8rem;
}

.stream-preview {
  background: var(--bg-card);
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
  background: var(--bg-base);
}

.preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-size: 0.82rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  font-family: 'Monaco', 'Menlo', monospace;
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
  transition: background var(--transition);
}
.abort-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Review step */
.review-step {
  max-width: none !important;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-split {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 0;
  margin-top: 4px;
}

.md-editor {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 12px;
  font-size: 0.82rem;
  font-family: 'Monaco', 'Menlo', monospace;
  line-height: 1.6;
  resize: none;
  outline: none;
}
.md-editor:focus {
  border-color: var(--accent);
}

.md-preview {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  overflow-y: auto;
  font-size: 0.86rem;
  line-height: 1.6;
  color: var(--text-primary);
}

/* Name form */
.name-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 400px;
}

.form-label {
  font-size: 0.82rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.name-input {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--transition);
}
.name-input:focus {
  border-color: var(--accent);
}

.name-hint {
  font-size: 0.72rem;
  color: var(--text-dim);
  text-align: right;
}

/* Footer */
.wizard-footer {
  display: flex;
  align-items: center;
  padding: 12px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
  gap: 12px;
}

.footer-spacer { flex: 1; }

.nav-btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  border: none;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), transform var(--transition), opacity var(--transition);
}
.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}
.nav-btn.primary {
  background: var(--accent);
  color: #fff;
}
.nav-btn.primary:hover:not(:disabled) {
  background: var(--accent-light);
  transform: translateY(-1px);
}
.nav-btn.secondary {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}
.nav-btn.secondary:hover:not(:disabled) {
  background: var(--bg-active);
  color: var(--text-primary);
}
</style>
