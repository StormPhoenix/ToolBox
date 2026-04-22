<template>
  <div
    class="app"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    :class="{ 'drag-over': isDragOver }"
  >
    <!-- ── 顶部工具栏 ── -->
    <header class="toolbar">
      <div class="toolbar-left">
        <span class="app-title">✏️ 文件重命名</span>
        <span class="file-count" v-if="fileItems.length > 0">
          {{ fileItems.length }} 个文件
        </span>
      </div>
      <div class="toolbar-actions">
        <button class="btn btn-secondary" @click="importFromDialog">
          📂 添加文件
        </button>
        <button
          class="btn btn-secondary btn-clear"
          v-if="fileItems.length > 0"
          @click="clearFiles"
        >
          🗑 清空
        </button>
      </div>
    </header>

    <!-- ── 主体 ── -->
    <div class="main-body">

      <!-- 空状态 -->
      <div
        class="drop-zone"
        v-if="fileItems.length === 0"
        @click="importFromDialog"
      >
        <div class="drop-icon">✏️</div>
        <p class="drop-title">点击或拖拽文件 / 文件夹到此处</p>
        <p class="drop-hint">支持批量导入，文件夹仅读取第一层文件</p>
      </div>

      <template v-else>
        <!-- ── 规则配置区 ── -->
        <div class="rule-panel">
          <!-- 规则选择 tabs -->
          <div class="rule-tabs">
            <button
              v-for="tab in ruleTabs"
              :key="tab.type"
              class="rule-tab"
              :class="{ active: activeRule.type === tab.type }"
              @click="switchRule(tab.type as RuleType)"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- 规则配置内容 -->
          <div class="rule-body">

            <!-- 查找替换 -->
            <template v-if="activeRule.type === 'replace'">
              <div class="rule-fields">
                <div class="field-group">
                  <label class="field-label">查找</label>
                  <input
                    class="field-input"
                    type="text"
                    placeholder="输入要查找的字符串"
                    v-model="(activeRule as RuleReplace).find"
                  />
                </div>
                <span class="rule-arrow">→</span>
                <div class="field-group">
                  <label class="field-label">替换为</label>
                  <input
                    class="field-input"
                    type="text"
                    placeholder="留空则删除该字符串"
                    v-model="(activeRule as RuleReplace).replaceWith"
                  />
                </div>
              </div>
              <p class="rule-hint">大小写敏感，全字符串替换</p>
            </template>

            <!-- 前后缀 -->
            <template v-else-if="activeRule.type === 'affix'">
              <div class="rule-fields">
                <div class="field-group">
                  <label class="field-label">前缀</label>
                  <input
                    class="field-input"
                    type="text"
                    placeholder="添加到文件名前"
                    v-model="(activeRule as RuleAffix).prefix"
                  />
                </div>
                <span class="rule-arrow">文件名</span>
                <div class="field-group">
                  <label class="field-label">后缀</label>
                  <input
                    class="field-input"
                    type="text"
                    placeholder="添加到文件名后（扩展名前）"
                    v-model="(activeRule as RuleAffix).suffix"
                  />
                </div>
              </div>
            </template>

            <!-- 序号模式 -->
            <template v-else-if="activeRule.type === 'sequence'">
              <div class="rule-fields">
                <div class="field-group">
                  <label class="field-label">起始数字</label>
                  <input
                    class="field-input field-input--short"
                    type="number"
                    min="0"
                    v-model.number="(activeRule as RuleSequence).start"
                  />
                </div>
                <div class="field-group field-group--toggle">
                  <label class="field-label">补零</label>
                  <button
                    class="toggle-btn"
                    :class="{ on: (activeRule as RuleSequence).padZero }"
                    @click="(activeRule as RuleSequence).padZero = !(activeRule as RuleSequence).padZero"
                  >
                    {{ (activeRule as RuleSequence).padZero ? '开' : '关' }}
                  </button>
                </div>
              </div>
              <p class="rule-hint">序号模式将整个文件名替换为数字（保留扩展名）</p>
            </template>

            <!-- 手动编辑 -->
            <template v-else-if="activeRule.type === 'manual'">
              <p class="rule-hint rule-hint--manual">
                直接在预览列表中点击「新文件名」列进行编辑，可与其他规则叠加使用
              </p>
            </template>

          </div>
        </div>

        <!-- ── 预览列表区 ── -->
        <div class="list-wrapper">
          <div ref="listEl" class="file-list">
            <div
              v-for="(item, index) in fileItems"
              :key="item.id"
              :data-id="item.id"
              class="file-card"
              :class="{ conflict: isConflict(index) }"
            >
              <span class="drag-handle" title="拖拽排序">⠿</span>
              <span class="file-icon">📄</span>
              <!-- 原文件名 -->
              <span class="file-name original" :title="item.fileName">{{ item.fileName }}</span>
              <span class="arrow">→</span>
              <!-- 新文件名：手动模式下可编辑 stem，其余展示 -->
              <span
                v-if="activeRule.type !== 'manual'"
                class="file-name preview"
                :class="{ conflict: isConflict(index) }"
                :title="previewNames[index]"
              >{{ previewNames[index] }}</span>
              <span
                v-else
                class="file-name preview editable"
                :class="{ conflict: isConflict(index) }"
              >
                <input
                  class="name-input"
                  type="text"
                  :value="item.manualStem ?? item.stem"
                  @input="onManualInput(item, $event)"
                  :title="previewNames[index]"
                />{{ item.ext }}
              </span>
              <button class="btn-remove" @click="removeFile(item.id)" title="移除">✕</button>
            </div>
          </div>
        </div>

        <!-- ── 底部操作栏 ── -->
        <div class="action-bar">
          <div class="action-bar-hint">
            <span v-if="hasDuplicate" class="hint-error">⚠ 存在重名冲突，无法执行</span>
            <span v-else-if="renameStatus === 'error'" class="hint-error">❌ 部分文件重命名失败</span>
          </div>
          <button
            class="btn btn-primary btn-rename"
            :disabled="hasDuplicate || renameStatus === 'running' || fileItems.length === 0"
            @click="onRename"
          >
            <template v-if="renameStatus === 'running'">重命名中…</template>
            <template v-else>✏️ 执行重命名</template>
          </button>
        </div>
      </template>
    </div>

    <!-- 全局拖拽遮罩 -->
    <div class="drag-mask" v-if="isDragOver && fileItems.length > 0">
      <div class="drag-mask-inner">
        <div class="drag-mask-icon">📄</div>
        <p>松开以添加文件</p>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.type}`">
        {{ toast.message }}
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onBeforeUnmount } from 'vue';
import Sortable from 'sortablejs';
import {
  fileItems,
  activeRule,
  previewNames,
  hasDuplicate,
  importFromDialog,
  importFromDrop,
  removeFile,
  clearFiles,
} from './composables/useFileItems';
import type { RuleType, RuleReplace, RuleAffix, RuleSequence, FileItem } from './composables/useFileItems';
import {
  executeRename,
  renameStatus,
  resetRenameStatus,
} from './composables/useRenameExecute';

// ── 规则切换 ──────────────────────────────────────────────────

const ruleTabs = [
  { type: 'replace',  label: '查找替换' },
  { type: 'affix',    label: '前后缀'   },
  { type: 'sequence', label: '序号模式' },
  { type: 'manual',   label: '手动编辑' },
] as const;

function switchRule(type: RuleType): void {
  switch (type) {
    case 'replace':  activeRule.value = { type: 'replace',  find: '', replaceWith: '' }; break;
    case 'affix':    activeRule.value = { type: 'affix',    prefix: '', suffix: '' };    break;
    case 'sequence': activeRule.value = { type: 'sequence', start: 1,  padZero: true }; break;
    case 'manual':   activeRule.value = { type: 'manual' };                              break;
  }
}

// ── 手动编辑 ──────────────────────────────────────────────────

function onManualInput(item: FileItem, event: Event): void {
  item.manualStem = (event.target as HTMLInputElement).value;
}

// ── 冲突检测 ──────────────────────────────────────────────────

function isConflict(index: number): boolean {
  const name = previewNames.value[index];
  return previewNames.value.filter(n => n === name).length > 1;
}

// ── SortableJS ────────────────────────────────────────────────

const listEl = ref<HTMLElement | null>(null);
let sortable: Sortable | null = null;

// listEl 在 fileItems 非空后才会渲染，用 watch 代替 onMounted
watch(listEl, (el) => {
  if (el && !sortable) {
    sortable = Sortable.create(el, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'card-ghost',
      chosenClass: 'card-chosen',
      onEnd(evt) {
        const { oldIndex, newIndex } = evt;
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
        const arr = fileItems.value.slice();
        const [moved] = arr.splice(oldIndex, 1);
        arr.splice(newIndex, 0, moved);
        fileItems.value = arr;
      },
    });
  } else if (!el && sortable) {
    sortable.destroy();
    sortable = null;
  }
});

// ── 拖拽导入 ──────────────────────────────────────────────────

const isDragOver = ref(false);

function onDragOver(): void { isDragOver.value = true; }
function onDragLeave(): void { isDragOver.value = false; }

async function onDrop(event: DragEvent): Promise<void> {
  isDragOver.value = false;
  await importFromDrop(event);
}

// ── 执行重命名 ────────────────────────────────────────────────

async function onRename(): Promise<void> {
  resetRenameStatus();
  const result = await executeRename();
  if (result === 'done') {
    showToast('✅ 重命名完成！', 'success');
  } else if (result === 'error') {
    showToast('❌ 部分文件重命名失败', 'error');
  }
}

// ── Toast ─────────────────────────────────────────────────────

const toast = reactive({ visible: false, message: '', type: 'success' as 'success' | 'error' });
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  if (toastTimer) clearTimeout(toastTimer);
  toast.message = message;
  toast.type = type;
  toast.visible = true;
  toastTimer = setTimeout(() => { toast.visible = false; }, 4000);
}
</script>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-base:       #0d0d14;
  --bg-sidebar:    #111118;
  --bg-card:       #1a1a28;
  --bg-card-hover: #1f1f30;
  --bg-active:     #1e1b3a;
  --text-primary:  #e8e8f2;
  --text-secondary:#8888a8;
  --text-dim:      #555570;
  --accent:        #6c5ce7;
  --accent-light:  #a29bfe;
  --accent-glow:   rgba(108, 92, 231, 0.25);
  --border:        #1e1e30;
  --radius-sm:     6px;
  --radius-md:     10px;
  --radius-lg:     16px;
  --transition:    0.18s ease;
}

html, body, #app { width: 100%; height: 100%; overflow: hidden; }

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 52px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 12px;
}
.toolbar-left { display: flex; align-items: center; gap: 10px; overflow: hidden; }
.app-title { font-weight: 700; font-size: 0.9rem; white-space: nowrap; }
.file-count { font-size: 0.78rem; color: var(--text-dim); white-space: nowrap; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* ── 按钮 ── */
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); font-size: 0.82rem; cursor: pointer;
  transition: background var(--transition), border-color var(--transition), opacity var(--transition);
  white-space: nowrap;
}
.btn:disabled { opacity: 0.35; cursor: default; }
.btn-secondary { background: var(--bg-card); color: var(--text-primary); }
.btn-secondary:hover:not(:disabled) { background: #22223a; border-color: var(--accent); }
.btn-clear { color: var(--text-dim); }
.btn-clear:hover:not(:disabled) { color: #ff7675; border-color: #e17055; background: rgba(231,76,60,0.08); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover:not(:disabled) { background: #5a4bd1; }

/* ── 主体 ── */
.main-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

/* ── 空状态 ── */
.drop-zone {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; cursor: pointer;
  border: 2px dashed var(--border); border-radius: var(--radius-lg);
  margin: 32px;
  transition: border-color var(--transition), background var(--transition);
}
.drop-zone:hover,
.drag-over .drop-zone { border-color: var(--accent); background: rgba(108,92,231,0.04); }
.drop-icon { font-size: 3rem; opacity: 0.5; }
.drop-title { font-size: 1rem; font-weight: 600; color: var(--text-dim); }
.drop-hint { font-size: 0.8rem; color: #555570; }

/* ── 规则面板 ── */
.rule-panel {
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px 12px;
}

.rule-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.rule-tab {
  padding: 4px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
  font-size: 0.8rem;
  cursor: pointer;
  transition: color var(--transition), border-color var(--transition), background var(--transition);
}
.rule-tab:hover { color: var(--text-primary); background: var(--bg-card); }
.rule-tab.active {
  color: var(--accent-light);
  border-color: var(--accent);
  background: var(--bg-active);
  font-weight: 600;
}

.rule-body { display: flex; flex-direction: column; gap: 6px; }

.rule-fields {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-group--toggle {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 1px;
}

.field-label {
  font-size: 0.72rem;
  color: var(--text-dim);
  white-space: nowrap;
}

.field-input {
  padding: 5px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.82rem;
  min-width: 160px;
  transition: border-color var(--transition);
}
.field-input:focus { outline: none; border-color: var(--accent); }
.field-input--short { min-width: 80px; width: 80px; }

.rule-arrow {
  font-size: 0.85rem;
  color: var(--text-dim);
  margin-bottom: 6px;
  flex-shrink: 0;
}

/* 补零开关 */
.toggle-btn {
  padding: 3px 14px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-dim);
  font-size: 0.78rem;
  cursor: pointer;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}
.toggle-btn.on {
  background: var(--bg-active);
  color: var(--accent-light);
  border-color: var(--accent);
}

.rule-hint {
  font-size: 0.73rem;
  color: var(--text-dim);
  margin-top: 2px;
}
.rule-hint--manual {
  padding: 8px 0;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

/* ── 文件预览列表 ── */
.list-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 10px 16px;
}
.list-wrapper::-webkit-scrollbar { width: 5px; }
.list-wrapper::-webkit-scrollbar-track { background: transparent; }
.list-wrapper::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.file-list { display: flex; flex-direction: column; gap: 6px; padding: 2px 0; }

.file-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition), box-shadow var(--transition);
  min-width: 0;
}
.file-card.conflict { border-color: #e17055; }
.file-card.card-ghost { opacity: 0.4; background: var(--bg-active); }
.file-card.card-chosen { box-shadow: 0 0 0 2px var(--accent-glow); border-color: var(--accent); }

.drag-handle {
  cursor: grab; color: var(--text-dim); font-size: 1.1rem;
  line-height: 1; flex-shrink: 0; user-select: none;
}
.drag-handle:active { cursor: grabbing; }

.file-icon { font-size: 0.95rem; flex-shrink: 0; }

.file-name {
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.file-name.original { color: var(--text-secondary); flex: 1; }
.file-name.preview { color: var(--text-primary); font-weight: 500; flex: 1; }
.file-name.preview.conflict { color: #ff7675; }
.file-name.editable { display: flex; align-items: center; gap: 0; flex: 1; min-width: 0; }

.arrow { font-size: 0.85rem; color: var(--text-dim); flex-shrink: 0; }

/* 手动编辑输入框 */
.name-input {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.82rem;
  font-weight: 500;
  transition: border-color var(--transition);
}
.name-input:focus { outline: none; border-color: var(--accent); }

.btn-remove {
  background: transparent; border: none; color: var(--text-dim);
  font-size: 0.8rem; cursor: pointer; padding: 2px 4px;
  border-radius: var(--radius-sm); flex-shrink: 0;
  transition: color var(--transition), background var(--transition);
}
.btn-remove:hover { color: #ff7675; background: rgba(231,76,60,0.12); }

/* ── 底部操作栏 ── */
.action-bar {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 12px; padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0; background: var(--bg-sidebar);
}
.action-bar-hint { flex: 1; font-size: 0.78rem; }
.hint-error { color: #ff7675; }
.btn-rename { padding: 8px 28px; font-size: 0.88rem; font-weight: 600; }

/* ── 拖拽遮罩 ── */
.drag-mask {
  position: absolute; inset: 52px 0 0 0;
  background: rgba(13,13,20,0.75); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 100;
}
.drag-mask-inner {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 40px 60px;
  border: 2px dashed var(--accent); border-radius: var(--radius-lg);
  background: rgba(108,92,231,0.08);
}
.drag-mask-icon { font-size: 3rem; }
.drag-mask-inner p { font-size: 1rem; font-weight: 600; color: var(--accent-light); }

/* ── Toast ── */
.toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  padding: 10px 20px; border-radius: 24px; font-size: 0.85rem;
  font-weight: 500; white-space: nowrap; z-index: 2000;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
.toast--success { background: #1a3a2a; color: #55efc4; border: 1px solid #00b894; }
.toast--error   { background: #3a1a1a; color: #ff7675; border: 1px solid #e17055; }

.toast-enter-active, .toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0; transform: translateX(-50%) translateY(10px);
}
</style>
