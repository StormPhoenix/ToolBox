import { ref, computed } from 'vue';
import { BUILTIN_PRESETS, type Preset } from '../data/builtin-presets';

const STORAGE_KEY = 'wallpaper-maker.selected-preset-ids';

// 用户工作列表（已添加的预设 id）
const selectedIds = ref<string[]>(loadFromStorage());

function loadFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // ignore
  }
  return [];
}

function saveToStorage(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds.value));
}

/** 当前工作列表中的预设对象 */
export const workingPresets = computed<Preset[]>(() =>
  selectedIds.value
    .map(id => BUILTIN_PRESETS.find(p => p.id === id))
    .filter((p): p is Preset => p !== undefined),
);

/** 某个内置预设是否已在工作列表中 */
export function isPresetAdded(id: string): boolean {
  return selectedIds.value.includes(id);
}

/** 将预设添加到工作列表 */
export function addPreset(id: string): void {
  if (selectedIds.value.includes(id)) return;
  selectedIds.value = [...selectedIds.value, id];
  saveToStorage();
}

/** 从工作列表移除预设 */
export function removePreset(id: string): void {
  selectedIds.value = selectedIds.value.filter(x => x !== id);
  saveToStorage();
}

/** 当前激活（右侧预览）的预设 id */
export const activePresetId = ref<string | null>(
  selectedIds.value[0] ?? null,
);

export function setActivePreset(id: string): void {
  activePresetId.value = id;
}
