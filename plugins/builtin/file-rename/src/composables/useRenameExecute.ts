import { ref } from 'vue';
import { electronAPI } from '@toolbox/bridge';
import { fileItems, previewNames, hasDuplicate, clearFiles } from './useFileItems';

// ── 状态 ─────────────────────────────────────────────────────

export type RenameStatus = 'idle' | 'running' | 'done' | 'error';

export const renameStatus = ref<RenameStatus>('idle');
export const renameError  = ref('');

// ── 执行 ─────────────────────────────────────────────────────

/**
 * 按当前预览名列表对所有文件执行重命名。
 * 只有用户点击「执行重命名」按钮后才调用。
 * @returns 'done' 全部成功；'error' 至少一个失败；'skip' 无可操作项
 */
export async function executeRename(): Promise<'done' | 'error' | 'skip'> {
  if (fileItems.value.length === 0) return 'skip';
  if (hasDuplicate.value) return 'skip';

  renameStatus.value = 'running';
  renameError.value = '';

  const errors: string[] = [];

  for (let i = 0; i < fileItems.value.length; i++) {
    const item = fileItems.value[i];
    const newName = previewNames.value[i];

    // 名称未变化则跳过
    if (newName === item.fileName) continue;

    // 构造新路径：替换文件名部分
    const sep = item.filePath.includes('/') ? '/' : '\\';
    const dir = item.filePath.split(sep).slice(0, -1).join(sep);
    const newPath = dir + sep + newName;

    try {
      await electronAPI.renameFile(item.filePath, newPath);
      // 更新内存状态，避免重复操作
      item.filePath = newPath;
      item.fileName = newName;
      const dotIdx = newName.lastIndexOf('.');
      item.stem = dotIdx > 0 ? newName.slice(0, dotIdx) : newName;
      item.ext  = dotIdx > 0 ? newName.slice(dotIdx) : '';
      item.manualStem = null;
    } catch (e: unknown) {
      errors.push(`${item.fileName}: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  if (errors.length > 0) {
    renameError.value = errors.join('\n');
    renameStatus.value = 'error';
    return 'error';
  }

  renameStatus.value = 'done';
  // 重命名成功后清空列表
  clearFiles();
  return 'done';
}

export function resetRenameStatus(): void {
  renameStatus.value = 'idle';
  renameError.value = '';
}
