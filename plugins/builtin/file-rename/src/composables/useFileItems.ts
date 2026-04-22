import { ref, computed } from 'vue';
import { electronAPI } from '@toolbox/bridge';

// ── 类型 ─────────────────────────────────────────────────────

export interface FileItem {
  /** 唯一 id，用于 SortableJS key */
  id: string;
  /** 系统文件完整路径 */
  filePath: string;
  /** 原始文件名（含扩展名） */
  fileName: string;
  /** 不含扩展名的 stem 部分 */
  stem: string;
  /** 扩展名（含点，如 ".jpg"；无扩展名时为 ""） */
  ext: string;
  /** 手动编辑的新名（不含扩展名）；null 表示未手动覆盖 */
  manualStem: string | null;
}

// ── 规则类型 ──────────────────────────────────────────────────

export type RuleType = 'replace' | 'affix' | 'sequence' | 'manual';

export interface RuleReplace {
  type: 'replace';
  find: string;
  replaceWith: string;
}

export interface RuleAffix {
  type: 'affix';
  prefix: string;
  suffix: string;
}

export interface RuleSequence {
  type: 'sequence';
  start: number;
  padZero: boolean;
}

export interface RuleManual {
  type: 'manual';
}

export type Rule = RuleReplace | RuleAffix | RuleSequence | RuleManual;

// ── 状态 ─────────────────────────────────────────────────────

export const fileItems = ref<FileItem[]>([]);

export const activeRule = ref<Rule>({ type: 'replace', find: '', replaceWith: '' });

let _idCounter = 0;
function genId(): string {
  return `fr-${++_idCounter}`;
}

// ── 文件导入 ──────────────────────────────────────────────────

function buildItem(filePath: string): FileItem {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const dotIdx = fileName.lastIndexOf('.');
  const stem = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext  = dotIdx > 0 ? fileName.slice(dotIdx) : '';
  return { id: genId(), filePath, fileName, stem, ext, manualStem: null };
}

/** 按文件名字典序排序后追加（去重同路径） */
function appendPaths(paths: string[]): void {
  const existing = new Set(fileItems.value.map(f => f.filePath));
  const newItems = paths
    .filter(p => !existing.has(p))
    .sort((a, b) => {
      const na = a.split(/[\\/]/).pop()!.toLowerCase();
      const nb = b.split(/[\\/]/).pop()!.toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    })
    .map(buildItem);
  fileItems.value.push(...newItems);
}

/** 通过对话框导入（多文件 + 文件夹第一层） */
export async function importFromDialog(): Promise<void> {
  const result = await electronAPI.showOpenDialog({
    title: '选择文件或文件夹',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return;

  const paths: string[] = [];
  for (const p of result.filePaths) {
    // 判断是否为文件夹：尝试 readDir，失败则视为文件
    try {
      const entries = await electronAPI.readDir(p);
      const files = entries.filter(e => !e.isDir).map(e => e.path);
      paths.push(...files);
    } catch {
      paths.push(p);
    }
  }
  appendPaths(paths);
}

/** 拖拽导入 */
export async function importFromDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const transferred = Array.from(event.dataTransfer?.files ?? []);
  const paths: string[] = [];
  for (const file of transferred) {
    let srcPath = '';
    try {
      srcPath = await electronAPI.getPathForFile(file);
    } catch {
      // ignore
    }
    if (!srcPath) continue;

    // 判断是否目录（通过 readDir）
    try {
      const entries = await electronAPI.readDir(srcPath);
      const files = entries.filter(e => !e.isDir).map(e => e.path);
      paths.push(...files);
    } catch {
      paths.push(srcPath);
    }
  }
  appendPaths(paths);
}

/** 移除指定文件 */
export function removeFile(id: string): void {
  const idx = fileItems.value.findIndex(f => f.id === id);
  if (idx !== -1) fileItems.value.splice(idx, 1);
}

/** 清空列表 */
export function clearFiles(): void {
  fileItems.value = [];
}

// ── 新名称计算 ────────────────────────────────────────────────

/** 根据当前规则计算某 item 在列表中的预览新名（含扩展名） */
export function computeNewName(item: FileItem, index: number, rule: Rule): string {
  // 基础 stem：先由规则生成，再叠加手动编辑覆盖
  let stem = applyRuleToStem(item, index, rule);

  // 手动编辑叠加
  if (item.manualStem !== null) {
    stem = item.manualStem;
  }

  return stem + item.ext;
}

function applyRuleToStem(item: FileItem, index: number, rule: Rule): string {
  switch (rule.type) {
    case 'replace': {
      const { find, replaceWith } = rule;
      if (!find) return item.stem;
      // 大小写敏感，普通字符串替换（全部替换）
      return item.stem.split(find).join(replaceWith);
    }
    case 'affix': {
      return rule.prefix + item.stem + rule.suffix;
    }
    case 'sequence': {
      const num = rule.start + index;
      if (rule.padZero) {
        // 自动计算位数：基于列表总长度和起始数字
        const maxNum = rule.start + fileItems.value.length - 1;
        const digits = String(maxNum).length;
        return String(num).padStart(digits, '0');
      }
      return String(num);
    }
    case 'manual':
      return item.stem;
  }
}

/** 所有文件的预览新名列表（与 fileItems 等长） */
export const previewNames = computed<string[]>(() =>
  fileItems.value.map((item, i) => computeNewName(item, i, activeRule.value))
);

/** 是否存在重名冲突 */
export const hasDuplicate = computed<boolean>(() => {
  const names = previewNames.value;
  return new Set(names).size !== names.length;
});
