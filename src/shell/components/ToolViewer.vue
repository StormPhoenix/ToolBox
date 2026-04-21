<template>
  <div class="tool-viewer">
    <!-- 顶部工具栏 -->
    <div class="viewer-toolbar">
      <button class="back-btn" @click="$emit('back')">
        <span>←</span>
        <span>返回</span>
      </button>
      <div class="viewer-title">
        <span class="title-icon">{{ plugin.icon }}</span>
        <span class="title-name">{{ plugin.name }}</span>
      </div>
      <div class="toolbar-spacer"></div>
      <button class="focus-btn" @click="focusWindow" title="聚焦插件窗口">
        <span>⬡</span>
        <span>切换到窗口</span>
      </button>
    </div>

    <!-- 占位区：插件运行在独立窗口中 -->
    <div class="plugin-placeholder">
      <div class="placeholder-icon">{{ plugin.icon }}</div>
      <h2 class="placeholder-title">{{ plugin.name }}</h2>
      <p class="placeholder-desc">{{ plugin.description }}</p>
      <div class="placeholder-actions">
        <button class="action-btn action-btn--primary" @click="openWindow">
          打开工具窗口
        </button>
        <button class="action-btn action-btn--secondary" @click="$emit('back')">
          返回工具列表
        </button>
      </div>
      <p class="placeholder-hint">插件在独立窗口中运行，可与主界面同时使用</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import type { PluginManifest } from '../types';
import type { ElectronAPI } from '@toolbox/bridge';

const props = defineProps<{ plugin: PluginManifest }>();
defineEmits<{ back: [] }>();

/** Shell 渲染进程中 electronAPI 由 preload contextBridge 注入 */
const api = (globalThis as unknown as { electronAPI: ElectronAPI }).electronAPI;

function openWindow(): void {
  // entryPath 传空字符串，由主进程按约定目录自动推导
  api.openPlugin(props.plugin.id, '', props.plugin.name);
}

function focusWindow(): void {
  api.focusPlugin(props.plugin.id);
}

// 进入 ToolViewer 时自动打开插件窗口
onMounted(() => {
  openWindow();
});
</script>

<style scoped>
.tool-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 工具栏 */
.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  height: 48px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-sidebar);
}

.back-btn,
.focus-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.82rem;
  transition: color var(--transition), border-color var(--transition);
}
.back-btn:hover,
.focus-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.viewer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.92rem;
}
.title-icon { font-size: 1.1rem; }

.toolbar-spacer { flex: 1; }

/* 占位区 */
.plugin-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 48px 32px;
  background: var(--bg-content);
  text-align: center;
}

.placeholder-icon {
  font-size: 4rem;
  line-height: 1;
  opacity: 0.7;
}

.placeholder-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.placeholder-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  max-width: 360px;
  line-height: 1.6;
  margin: 0;
}

.placeholder-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.action-btn {
  padding: 9px 22px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  font-size: 0.88rem;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}

.action-btn--primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.action-btn--primary:hover {
  background: #5a4bd1;
}

.action-btn--secondary {
  background: var(--bg-card);
  color: var(--text-secondary);
}
.action-btn--secondary:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.placeholder-hint {
  font-size: 0.78rem;
  color: var(--text-dim);
  margin: 0;
}
</style>
