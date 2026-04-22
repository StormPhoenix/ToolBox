<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import Sortable from 'sortablejs';
import { electronAPI } from '@toolbox/bridge';

// ── 类型 ─────────────────────────────────────────────────────────────────

type RuleType = 'find-replace' | 'prefix-suffix' | 'sequence' | 'manual';

interface FileItem {
  id: string;
  originalPath: string;   // 完整原始路径
  dirPath: string;        // 所在目录
  originalName: string;   // 原始文件名（含扩展名）
  newName: string;        // 预览新文件名（含扩展名）
  manualOverride: boolean; // 是否已手动编辑
  editingName: string;    // 行内编辑中间状态
  isEditing: boolean;
}

// ── 规则参数 ────────────────────────────────────────────────────────────

const activeRule = ref<RuleType>('find-replace');

const findReplaceParams = ref({ find: '', replace: '' });
const prefixSuffixParams = ref({ prefix: '', suffix: '' });
const sequenceParams = ref({ start: 1, padZero: true });

// ── 文件列表 ─────────────────────────────────────────────────────────────

const files = ref<FileItem[]>([]);
let idCounter = 0;

function makeId(): string {
  return `f-${++idCounter}`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

function stemOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function addFiles(paths: string[]): void {
  const existing = new Set(files.value.map(f => f.originalPath));
  const toAdd: FileItem[] = [];
  for (const p of paths) {
    if (existing.has(p)) continue;
    const parts = p.replace(/\\/g, '/').split('/');
    const name = parts[parts.length - 1];
    const dir = parts.slice(0, -1).join('/');
    toAdd.push({
      id: makeId(),
      originalPath: p,
      dirPath: dir,
      originalName: name,
      newName: name,
      manualOverride: false,
      editingName: name,
      isEditing: false,
    });
  }
  // 按文件名字母排序后追加
  toAdd.sort((a, b) => a.originalName.localeCompare(b.originalName));
  files.value.push(...toAdd);
  applyRule();
}

function removeFile(id: string): void {
  files.value = files.value.filter(f => f.id !== id);
  applyRule();
}

function clearAll(): void {
  files.value = [];
}

// ── 规则应用 ─────────────────────────────────────────────────────────────

function applyRule(): void {
  const rule = activeRule.value;
  const total = files.value.length;

  files.value.forEach((f, i) => {
    if (f.manualOverride) return;

    let newName = f.originalName;

    if (rule === 'find-replace') {
      const { find, replace } = findReplaceParams.value;
      if (find) {
        newName = f.originalName.split(find).join(replace);
      }
    } else if (rule === 'prefix-suffix') {
      const { prefix, suffix } = prefixSuffixParams.value;
      const stem = stemOf(f.originalName);
      const ext = extOf(f.originalName);
      newName = `${prefix}${stem}${suffix}${ext}`;
    } else if (rule === 'sequence') {
      const { start, padZero } = sequenceParams.value;
      const ext = extOf(f.originalName);
      const num = start + i;
      let numStr: string;
      if (padZero) {
        const maxNum = start + total - 1;
        const digits = String(maxNum).length;
        numStr = String(num).padStart(digits, '0');
      } else {
        numStr = String(num);
      }
      newName = `${numStr}${ext}`;
    }
    // manual: no auto-apply

    f.newName = newName;
    f.editingName = newName;
  });
}

// 监听规则参数变化，自动 re-apply
watch(
  [activeRule, findReplaceParams, prefixSuffixParams, sequenceParams],
  () => applyRule(),
  { deep: true }
);

function switchRule(rule: RuleType): void {
  if (rule === activeRule.value) return;
  // 若有手动编辑行，提示覆盖
  const hasManual = files.value.some(f => f.manualOverride);
  if (hasManual) {
    pendingRuleSwitchTo.value = rule;
    showRuleSwitchConfirm.value = true;
    return;
  }
  doSwitchRule(rule);
}

const showRuleSwitchConfirm = ref(false);
const pendingRuleSwitchTo = ref<RuleType | null>(null);

function confirmRuleSwitch(): void {
  if (pendingRuleSwitchTo.value) {
    doSwitchRule(pendingRuleSwitchTo.value);
  }
  showRuleSwitchConfirm.value = false;
  pendingRuleSwitchTo.value = null;
}

function cancelRuleSwitch(): void {
  showRuleSwitchConfirm.value = false;
  pendingRuleSwitchTo.value = null;
}

function doSwitchRule(rule: RuleType): void {
  files.value.forEach(f => {
    f.manualOverride = false;
  });
  activeRule.value = rule;
  applyRule();
}

// ── 行内编辑（手动模式） ─────────────────────────────────────────────────

function startEdit(f: FileItem): void {
  f.isEditing = true;
  f.editingName = f.newName;
}

function commitEdit(f: FileItem): void {
  f.isEditing = false;
  const trimmed = f.editingName.trim();
  if (trimmed && trimmed !== f.newName) {
    f.newName = trimmed;
    f.manualOverride = true;
  }
}

function cancelEdit(f: FileItem): void {
  f.isEditing = false;
  f.editingName = f.newName;
}

// ── 冲突检测 ─────────────────────────────────────────────────────────────

const conflictSet = computed<Set<string>>(() => {
  const seen = new Map<string, number>();
  files.value.forEach(f => {
    const key = `${f.dirPath}|${f.newName}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  const dupes = new Set<string>();
  seen.forEach((count, key) => {
    if (count > 1) dupes.add(key);
  });
  return dupes;
});

function isConflict(f: FileItem): boolean {
  return conflictSet.value.has(`${f.dirPath}|${f.newName}`);
}

function hasChanged(f: FileItem): boolean {
  return f.newName !== f.originalName;
}

const hasConflicts = computed(() => conflictSet.value.size > 0);
const changedCount = computed(() => files.value.filter(f => hasChanged(f)).length);
const canExecute = computed(() =>
  files.value.length > 0 && !hasConflicts.value && changedCount.value > 0
);

// ── SortableJS ───────────────────────────────────────────────────────────

const listRef = ref<HTMLElement | null>(null);
let sortable: Sortable | null = null;

function initSortable(): void {
  if (sortable || !listRef.value) return;
  sortable = Sortable.create(listRef.value, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(evt) {
      const { oldIndex, newIndex } = evt;
      if (oldIndex === undefined || newIndex === undefined) return;
      if (oldIndex === newIndex) return;
      const arr = [...files.value];
      const [moved] = arr.splice(oldIndex, 1);
      arr.splice(newIndex, 0, moved);
      files.value = arr;
      applyRule();
    },
  });
}

// listRef 在 files 从空变为非空后才挂载到 DOM，需等 nextTick 再初始化
watch(
  () => files.value.length > 0,
  async (hasFiles) => {
    if (hasFiles) {
      await nextTick();
      initSortable();
    } else {
      sortable?.destroy();
      sortable = null;
    }
  }
);

onUnmounted(() => {
  sortable?.destroy();
  sortable = null;
});

// ── 文件输入 — 拖放 ───────────────────────────────────────────────────────

const isDragOver = ref(false);

async function handleDrop(e: DragEvent): Promise<void> {
  isDragOver.value = false;
  if (!e.dataTransfer) return;

  const filePaths: string[] = [];
  const dirPaths: string[] = [];

  for (const item of Array.from(e.dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    const file = item.getAsFile();
    if (!file) continue;
    const p = await electronAPI.getPathForFile(file);
    if (!p) continue;

    if (entry?.isDirectory) {
      dirPaths.push(p);
    } else {
      filePaths.push(p);
    }
  }

  // 展开文件夹第一层
  for (const dir of dirPaths) {
    await addFromDir(dir);
  }
  addFiles(filePaths);
}

// ── 文件输入 — 按钮 ──────────────────────────────────────────────────────

async function pickFiles(): Promise<void> {
  const result = await electronAPI.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return;
  addFiles(result.filePaths);
}

async function pickFolder(): Promise<void> {
  const result = await electronAPI.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled) return;
  for (const dir of result.filePaths) {
    await addFromDir(dir);
  }
}

async function addFromDir(dir: string): Promise<void> {
  const entries = await electronAPI.readDir(dir);
  const filePaths = entries.filter(e => !e.isDir).map(e => e.path);
  addFiles(filePaths);
}

// ── 执行重命名 ────────────────────────────────────────────────────────────

const showConfirmModal = ref(false);
const isExecuting = ref(false);
const toastMsg = ref('');
const toastType = ref<'success' | 'warn' | 'error'>('success');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string, type: 'success' | 'warn' | 'error' = 'success'): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastMsg.value = msg;
  toastType.value = type;
  toastTimer = setTimeout(() => {
    toastMsg.value = '';
  }, 4000);
}

async function executeRename(): Promise<void> {
  showConfirmModal.value = false;
  isExecuting.value = true;

  const tasks = files.value.filter(f => hasChanged(f));
  let successCount = 0;
  const failedItems: { name: string; error: string }[] = [];

  for (const f of tasks) {
    const oldPath = f.originalPath;
    const newPath = `${f.dirPath}/${f.newName}`;
    try {
      await electronAPI.renameFile(oldPath, newPath);
      // 更新列表状态
      f.originalPath = newPath;
      f.originalName = f.newName;
      f.manualOverride = false;
      successCount++;
    } catch (err) {
      failedItems.push({ name: f.originalName, error: String(err) });
    }
  }

  isExecuting.value = false;

  if (failedItems.length === 0) {
    showToast(`已成功重命名 ${successCount} 个文件`, 'success');
  } else {
    showToast(
      `重命名完成：${successCount} 个成功，${failedItems.length} 个失败`,
      'warn'
    );
  }

  applyRule();
}

// ── 规则标签映射 ─────────────────────────────────────────────────────────

const ruleLabels: Record<RuleType, string> = {
  'find-replace': '查找替换',
  'prefix-suffix': '前后缀',
  'sequence': '序号模式',
  'manual': '手动编辑',
};
</script>

<template>
  <div class="app">
    <!-- ── HEADER ── -->
    <header class="header">
      <h1 class="title">批量重命名</h1>
      <p class="subtitle">选择文件，配置规则，确认后一次性重命名</p>
    </header>

    <!-- ── 规则面板 ── -->
    <section class="rule-panel">
      <div class="rule-tabs">
        <button
          v-for="rule in (['find-replace', 'prefix-suffix', 'sequence', 'manual'] as RuleType[])"
          :key="rule"
          class="rule-tab"
          :class="{ active: activeRule === rule }"
          @click="switchRule(rule)"
        >
          {{ ruleLabels[rule] }}
        </button>
      </div>

      <div class="rule-body">
        <!-- 查找替换 -->
        <template v-if="activeRule === 'find-replace'">
          <div class="rule-row">
            <label>查找</label>
            <input
              v-model="findReplaceParams.find"
              class="rule-input"
              placeholder="输入要查找的字符串（大小写敏感）"
            />
          </div>
          <div class="rule-row">
            <label>替换为</label>
            <input
              v-model="findReplaceParams.replace"
              class="rule-input"
              placeholder="留空则删除匹配内容"
            />
          </div>
        </template>

        <!-- 前后缀 -->
        <template v-else-if="activeRule === 'prefix-suffix'">
          <div class="rule-row">
            <label>前缀</label>
            <input
              v-model="prefixSuffixParams.prefix"
              class="rule-input"
              placeholder="添加到文件名最前面"
            />
          </div>
          <div class="rule-row">
            <label>后缀</label>
            <input
              v-model="prefixSuffixParams.suffix"
              class="rule-input"
              placeholder="添加到扩展名之前"
            />
          </div>
        </template>

        <!-- 序号模式 -->
        <template v-else-if="activeRule === 'sequence'">
          <div class="rule-row">
            <label>起始数字</label>
            <input
              v-model.number="sequenceParams.start"
              class="rule-input rule-input--short"
              type="number"
              min="0"
            />
          </div>
          <div class="rule-row">
            <label>补零</label>
            <label class="toggle">
              <input v-model="sequenceParams.padZero" type="checkbox" />
              <span class="toggle-track">
                <span class="toggle-thumb" />
              </span>

            </label>
          </div>
        </template>

        <!-- 手动编辑 -->
        <template v-else>
          <p class="rule-tip">点击列表中「新文件名」单元格直接编辑，按 Enter 确认，Esc 取消。</p>
        </template>
      </div>
    </section>

    <!-- ── 文件预览区 ── -->
    <section class="file-section">
      <!-- 空状态 / 拖放区 -->
      <div
        v-if="files.length === 0"
        class="drop-zone"
        :class="{ 'drop-zone--over': isDragOver }"
        @dragenter.prevent="isDragOver = true"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="handleDrop"
      >
        <span class="drop-icon">📂</span>
        <p class="drop-primary">拖拽文件或文件夹到此处</p>
        <p class="drop-secondary">或使用下方按钮选择文件</p>
      </div>

      <!-- 文件列表 -->
      <template v-else>
        <!-- 冲突提示 -->
        <div v-if="hasConflicts" class="conflict-banner">
          ⚠ 存在文件名冲突，请修正后再执行重命名
        </div>

        <!-- 表头 -->
        <div class="list-header">
          <span class="col-handle" />
          <span class="col-original">原文件名</span>
          <span class="col-new">新文件名</span>
          <span class="col-status">状态</span>
          <span class="col-remove" />
        </div>

        <!-- 列表体（SortableJS 挂载目标） -->
        <div
          ref="listRef"
          class="list-body"
          @dragenter.prevent="isDragOver = true"
          @dragover.prevent="isDragOver = true"
          @dragleave.prevent="isDragOver = false"
          @drop.prevent="handleDrop"
        >
          <div
            v-for="f in files"
            :key="f.id"
            class="list-row"
            :class="{
              'row--conflict': isConflict(f),
              'row--changed': hasChanged(f) && !isConflict(f),
            }"
          >
            <!-- 拖拽手柄 -->
            <span class="col-handle drag-handle" title="拖拽排序">⠿</span>

            <!-- 原文件名 -->
            <span class="col-original text-dim" :title="f.originalName">{{ f.originalName }}</span>

            <!-- 新文件名（手动编辑 / 只读） -->
            <span class="col-new">
              <template v-if="f.isEditing">
                <input
                  class="inline-input"
                  v-model="f.editingName"
                  @keydown.enter="commitEdit(f)"
                  @keydown.esc="cancelEdit(f)"
                  @blur="commitEdit(f)"
                  autofocus
                />
              </template>
              <template v-else>
                <span
                  class="new-name-text"
                  :class="{ 'new-name--conflict': isConflict(f) }"
                  :title="f.newName"
                  @click="startEdit(f)"
                >{{ f.newName }}</span>
              </template>
            </span>

            <!-- 状态标记 -->
            <span class="col-status">
              <span v-if="isConflict(f)" class="badge badge--conflict" title="文件名冲突">冲突</span>
              <span v-else-if="hasChanged(f)" class="badge badge--changed">已修改</span>
              <span v-else class="badge badge--same">—</span>
            </span>

            <!-- 移除 -->
            <button class="col-remove btn-remove" @click="removeFile(f.id)" title="从列表移除">✕</button>
          </div>
        </div>
      </template>
    </section>

    <!-- ── FOOTER ── -->
    <footer class="footer">
      <div class="footer-left">
        <button class="btn btn--secondary" @click="pickFiles">选择文件</button>
        <button class="btn btn--secondary" @click="pickFolder">选择文件夹</button>
        <button v-if="files.length > 0" class="btn btn--ghost" @click="clearAll">清空列表</button>
      </div>
      <div class="footer-right">
        <span v-if="files.length > 0" class="file-count">
          共 {{ files.length }} 个文件，{{ changedCount }} 个将被重命名
        </span>
        <button
          class="btn btn--primary"
          :disabled="!canExecute || isExecuting"
          @click="showConfirmModal = true"
        >
          {{ isExecuting ? '执行中…' : '确认重命名' }}
        </button>
      </div>
    </footer>

    <!-- ── 规则切换确认弹窗 ── -->
    <Teleport to="body">
      <div v-if="showRuleSwitchConfirm" class="modal-overlay" @click.self="cancelRuleSwitch">
        <div class="modal">
          <h2 class="modal-title">切换规则</h2>
          <p class="modal-body">切换规则将覆盖所有手动编辑的文件名，是否继续？</p>
          <div class="modal-actions">
            <button class="btn btn--secondary" @click="cancelRuleSwitch">取消</button>
            <button class="btn btn--primary" @click="confirmRuleSwitch">确认切换</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 执行确认弹窗 ── -->
    <Teleport to="body">
      <div v-if="showConfirmModal" class="modal-overlay" @click.self="showConfirmModal = false">
        <div class="modal">
          <h2 class="modal-title">确认重命名</h2>
          <p class="modal-body">
            即将重命名 <strong>{{ changedCount }}</strong> 个文件，<br />
            此操作<strong>不可撤销</strong>，请确认后继续。
          </p>
          <div class="modal-actions">
            <button class="btn btn--secondary" @click="showConfirmModal = false">取消</button>
            <button class="btn btn--primary" @click="executeRename">确认执行</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Toast 提示 ── -->
    <Teleport to="body">
      <div v-if="toastMsg" class="toast" :class="`toast--${toastType}`">
        {{ toastMsg }}
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── 整体布局 ── */
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}

/* ── Header ── */
.header {
  padding: 20px 24px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* ── 规则面板 ── */
.rule-panel {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.rule-tabs {
  display: flex;
  gap: 2px;
  padding: 12px 24px 0;
}

.rule-tab {
  padding: 6px 16px;
  font-size: 13px;
  border: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition);
  border-bottom: 2px solid transparent;
}

.rule-tab:hover {
  color: var(--text-primary);
  background: var(--bg-card-hover);
}

.rule-tab.active {
  color: var(--accent-light);
  border-bottom-color: var(--accent);
  background: var(--bg-active);
}

.rule-body {
  padding: 14px 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rule-row label {
  width: 64px;
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.rule-input {
  flex: 1;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  padding: 5px 10px;
  outline: none;
  transition: border-color var(--transition);
}

.rule-input:focus {
  border-color: var(--border-active);
}

.rule-input--short {
  flex: none;
  width: 100px;
}

.rule-tip {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* ── Toggle 开关 ── */
.toggle {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  cursor: pointer;
}

.toggle input[type='checkbox'] {
  display: none;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--border);
  border-radius: 10px;
  position: relative;
  transition: background var(--transition);
}

.toggle input:checked + .toggle-track {
  background: var(--accent);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: left var(--transition);
}

.toggle input:checked + .toggle-track .toggle-thumb {
  left: 18px;
}

/* ── 文件区 ── */
.file-section {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── 拖放区 ── */
.drop-zone {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 16px 24px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition), background var(--transition);
  cursor: default;
}

.drop-zone--over {
  border-color: var(--accent);
  background: var(--accent-glow);
}

.drop-icon {
  font-size: 40px;
}

.drop-primary {
  font-size: 15px;
  color: var(--text-primary);
}

.drop-secondary {
  font-size: 13px;
  color: var(--text-dim);
}

/* ── 冲突横幅 ── */
.conflict-banner {
  margin: 8px 24px 0;
  padding: 8px 14px;
  background: rgba(220, 60, 60, 0.15);
  border: 1px solid rgba(220, 60, 60, 0.4);
  border-radius: var(--radius-sm);
  color: #ff6b6b;
  font-size: 13px;
  flex-shrink: 0;
}

/* ── 列表头 ── */
.list-header,
.list-row {
  display: grid;
  grid-template-columns: 28px 1fr 1fr 72px 32px;
  align-items: center;
  gap: 8px;
  padding: 0 24px;
}

.list-header {
  padding-top: 10px;
  padding-bottom: 6px;
  font-size: 12px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

/* ── 列表体 ── */
.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 8px;
}

.list-row {
  padding-top: 7px;
  padding-bottom: 7px;
  border-radius: var(--radius-sm);
  transition: background var(--transition);
}

.list-row:hover {
  background: var(--bg-card-hover);
}

.row--changed {
  background: rgba(108, 92, 231, 0.06);
}

.row--conflict {
  background: rgba(220, 60, 60, 0.08);
}

/* 列 */
.col-handle {
  color: var(--text-dim);
  font-size: 16px;
  text-align: center;
}

.drag-handle {
  cursor: grab;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.col-original,
.col-new {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.text-dim {
  color: var(--text-secondary);
  font-size: 13px;
}

.new-name-text {
  font-size: 13px;
  color: var(--text-primary);
  cursor: text;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-radius: 3px;
  padding: 1px 3px;
  transition: background var(--transition);
}

.new-name-text:hover {
  background: var(--bg-active);
}

.new-name--conflict {
  color: #ff6b6b;
}

.inline-input {
  width: 100%;
  background: var(--bg-base);
  border: 1px solid var(--border-active);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  padding: 2px 6px;
  outline: none;
}

/* 状态徽章 */
.col-status {
  display: flex;
  justify-content: center;
}

.badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}

.badge--same {
  color: var(--text-dim);
}

.badge--changed {
  color: var(--accent-light);
  background: rgba(108, 92, 231, 0.15);
}

.badge--conflict {
  color: #ff6b6b;
  background: rgba(220, 60, 60, 0.15);
}

/* 移除按钮 */
.btn-remove {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
  padding: 3px;
  border-radius: var(--radius-sm);
  transition: color var(--transition), background var(--transition);
  text-align: center;
}

.btn-remove:hover {
  color: #ff6b6b;
  background: rgba(220, 60, 60, 0.12);
}

/* ── Footer ── */
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
  gap: 12px;
}

.footer-left,
.footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-count {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ── 按钮 ── */
.btn {
  padding: 6px 16px;
  font-size: 13px;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  transition: opacity var(--transition), background var(--transition);
  white-space: nowrap;
}

.btn--primary {
  background: var(--accent);
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  opacity: 0.88;
}

.btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn--secondary {
  background: var(--bg-active);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.btn--secondary:hover {
  background: var(--bg-card-hover);
}

.btn--ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.btn--ghost:hover {
  color: var(--text-primary);
  background: var(--bg-card-hover);
}

/* ── 模态弹窗 ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  min-width: 320px;
  max-width: 480px;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.modal-body {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 24px;
}

.modal-body strong {
  color: var(--text-primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* ── Toast ── */
.toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-size: 13px;
  z-index: 200;
  pointer-events: none;
  animation: toast-in 0.2s ease;
}

.toast--success {
  background: rgba(0, 200, 120, 0.2);
  border: 1px solid rgba(0, 200, 120, 0.4);
  color: #00c878;
}

.toast--warn {
  background: rgba(255, 180, 0, 0.15);
  border: 1px solid rgba(255, 180, 0, 0.35);
  color: #ffb400;
}

.toast--error {
  background: rgba(220, 60, 60, 0.15);
  border: 1px solid rgba(220, 60, 60, 0.4);
  color: #ff6b6b;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* ── SortableJS ghost / chosen ── */
:deep(.sortable-ghost) {
  opacity: 0.4;
  background: var(--bg-active) !important;
}

:deep(.sortable-chosen) {
  box-shadow: inset 0 0 0 1px var(--accent);
  background: rgba(108, 92, 231, 0.08) !important;
}
</style>
