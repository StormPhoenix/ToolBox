<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal">
      <!-- 头部 -->
      <div class="modal-header">
        <div class="modal-title">新建人格</div>
        <button class="close-btn" type="button" @click="$emit('cancel')">✕</button>
      </div>

      <!-- Tab 切换 -->
      <div class="tab-bar">
        <button
          class="tab-item"
          :class="{ active: mode === 'new' }"
          type="button"
          @click="switchMode('new')"
        >
          🧪 新建
        </button>
        <button
          class="tab-item"
          :class="{ active: mode === 'import' }"
          type="button"
          @click="switchMode('import')"
        >
          📥 导入
        </button>
      </div>

      <!-- ── 新建 Tab ─────────────────────────────────── -->
      <template v-if="mode === 'new'">
        <div class="modal-subtitle">选择配方决定蒸馏的方式和输出风格，名称稍后可在侧栏重命名</div>

        <div class="recipe-grid">
          <RecipeCard
            v-for="r in recipes"
            :key="r.name"
            :recipe="r"
            :selected="selectedRecipe === r.name"
            @click="selectedRecipe = r.name"
            @dblclick="confirmNew"
          />
        </div>

        <div v-if="recipes.length === 0" class="empty-recipes">
          当前没有可用配方。请检查 <code>userData/persona-recipes/</code> 或重启应用。
        </div>

        <div class="modal-footer">
          <button class="btn secondary" type="button" @click="$emit('cancel')">取消</button>
          <button
            class="btn primary"
            type="button"
            :disabled="!selectedRecipe"
            @click="confirmNew"
          >
            创建
          </button>
        </div>
      </template>

      <!-- ── 导入 Tab ─────────────────────────────────── -->
      <template v-else>
        <div class="modal-subtitle">选择已蒸馏好的 SKILL.md 文件，导入后可直接发布为 Skill</div>

        <div class="import-area">
          <!-- 文件选择 -->
          <div class="file-pick-row">
            <button
              class="pick-btn"
              type="button"
              :disabled="picking"
              @click="pickFile"
            >
              📂 选择 SKILL.md 文件…
            </button>
            <div v-if="importedFileName" class="file-info">
              <span class="file-name">{{ importedFileName }}</span>
              <span class="file-path" :title="importedFilePath">{{ importedFilePath }}</span>
            </div>
          </div>

          <!-- 内容预览（选中文件后显示） -->
          <div v-if="importedContent" class="preview-wrapper">
            <div class="preview-label">文件预览</div>
            <div class="preview-scroll">
              <pre class="preview-text">{{ importedContent }}</pre>
            </div>
          </div>

          <!-- 未选择时的占位 -->
          <div v-else class="import-placeholder">
            <div class="placeholder-icon">📄</div>
            <div class="placeholder-text">请选择一个 SKILL.md 文件</div>
            <div class="placeholder-hint">支持 .md 格式，可以是任何已蒸馏好的 SKILL.md</div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn secondary" type="button" @click="$emit('cancel')">取消</button>
          <button
            class="btn primary"
            type="button"
            :disabled="!importedContent || picking"
            @click="confirmImport"
          >
            导入
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PersonaRecipeInfo } from '@toolbox/bridge';
import RecipeCard from './RecipeCard.vue';

const props = defineProps<{
  recipes: PersonaRecipeInfo[];
}>();

const emit = defineEmits<{
  'create-new': [recipeName: string];
  'create-import': [filePath: string, content: string];
  'cancel': [];
}>();

// ── Tab 状态 ────────────────────────────────────────────────

type Mode = 'new' | 'import';
const mode = ref<Mode>('new');

function switchMode(m: Mode): void {
  mode.value = m;
}

// ── 新建 Tab ─────────────────────────────────────────────────

const selectedRecipe = ref<string>(props.recipes[0]?.name ?? '');

watch(
  () => props.recipes,
  (rs) => {
    if (!selectedRecipe.value && rs.length > 0) {
      selectedRecipe.value = rs[0].name;
    }
  }
);

function confirmNew(): void {
  if (selectedRecipe.value) emit('create-new', selectedRecipe.value);
}

// ── 导入 Tab ─────────────────────────────────────────────────

const picking = ref(false);
const importedFilePath = ref('');
const importedFileName = ref('');
const importedContent = ref('');

async function pickFile(): Promise<void> {
  picking.value = true;
  try {
    const result = await window.electronAPI.showOpenDialog({
      title: '选择 SKILL.md 文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown 文件', extensions: ['md'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return;

    const filePath = result.filePaths[0];
    const content = await window.electronAPI.readFile(filePath);
    importedFilePath.value = filePath;
    importedFileName.value = filePath.split(/[\\/]/).pop() ?? filePath;
    importedContent.value = content;
  } finally {
    picking.value = false;
  }
}

function confirmImport(): void {
  if (importedContent.value && importedFilePath.value) {
    emit('create-import', importedFilePath.value, importedContent.value);
  }
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.modal {
  width: 100%;
  max-width: 720px;
  max-height: calc(100vh - 64px);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.92rem;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--transition), color var(--transition);
}
.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

/* Tab Bar */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  padding: 0 20px;
}

.tab-item {
  padding: 10px 18px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.88rem;
  font-weight: 500;
  margin-bottom: -1px;
  transition: color var(--transition), border-color var(--transition);
}
.tab-item:hover {
  color: var(--text-primary);
}
.tab-item.active {
  color: var(--accent-light);
  border-bottom-color: var(--accent);
}

.modal-subtitle {
  font-size: 0.82rem;
  color: var(--text-dim);
  padding: 12px 20px 4px;
}

/* Recipe grid（新建 Tab） */
.recipe-grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.empty-recipes {
  padding: 30px 20px;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.84rem;
}
.empty-recipes code {
  background: var(--bg-base);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.78rem;
}

/* 导入 Tab */
.import-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  gap: 14px;
  min-height: 300px;
}

.file-pick-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
}

.pick-btn {
  padding: 8px 16px;
  background: var(--bg-base);
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.86rem;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--transition), border-color var(--transition);
}
.pick-btn:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--accent);
  border-style: solid;
}
.pick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.file-name {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-path {
  font-size: 0.74rem;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Monaco', 'Menlo', monospace;
}

/* 预览区 */
.preview-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  min-height: 0;
}

.preview-label {
  font-size: 0.72rem;
  color: var(--text-dim);
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base);
  flex-shrink: 0;
}

.preview-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  background: var(--bg-content);
}

.preview-text {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', monospace;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 占位 */
.import-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
}

.placeholder-icon {
  font-size: 2rem;
  opacity: 0.5;
}

.placeholder-text {
  font-size: 0.88rem;
  color: var(--text-secondary);
}

.placeholder-hint {
  font-size: 0.78rem;
  color: var(--text-dim);
}

/* Footer */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-base);
  flex-shrink: 0;
}

.btn {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 0.86rem;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition), opacity var(--transition);
}
.btn.secondary {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}
.btn.secondary:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent-light);
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
