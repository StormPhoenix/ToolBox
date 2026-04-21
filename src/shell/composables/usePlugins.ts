import { ref, computed } from 'vue';
import type { PluginManifest } from '../types';

// 构建时由 scripts/build-registry.mjs 生成，运行时从 dist/ 读取
// 开发时为空数组，由 Electron 主进程通过 IPC 注入
const plugins = ref<PluginManifest[]>([]);

const activePluginId = ref<string | null>(null);

const activePlugin = computed(() =>
  plugins.value.find(p => p.id === activePluginId.value) ?? null
);

function getByCategory(categoryId: string): PluginManifest[] {
  if (categoryId === 'all') return plugins.value;
  return plugins.value.filter(p => p.category === categoryId);
}

function activate(id: string | null): void {
  activePluginId.value = id;
}

async function loadRegistry(): Promise<void> {
  try {
    const res = await fetch('../../dist/plugin-registry.json');
    if (res.ok) {
      plugins.value = await res.json();
    }
  } catch {
    console.warn('[ToolBox] Failed to load plugin-registry.json');
  }
}

export function usePlugins() {
  return { plugins, activePluginId, activePlugin, getByCategory, activate, loadRegistry };
}
