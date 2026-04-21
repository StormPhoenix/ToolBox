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
      <button class="devtools-btn" title="打开插件 DevTools" @click="openDevTools">
        <span>⚙</span>
        <span>DevTools</span>
      </button>
    </div>

    <!-- webview 容器 -->
    <div class="iframe-wrapper">
      <!-- preloadUrl 就绪后才渲染 webview，确保 preload 脚本被正确注入 -->
      <webview
        v-if="preloadUrl"
        ref="webviewRef"
        class="plugin-frame"
        :src="pluginUrl"
        :preload="preloadUrl"
        @did-finish-load="onLoad"
        @did-fail-load="onLoadError"
      />
      <!-- 加载遮罩：preload 未就绪或 webview 仍在加载时显示 -->
      <div class="frame-loading" v-if="!preloadUrl || loading">
        <div class="loading-spinner"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { PluginManifest } from '../types';
import type { ElectronAPI } from '../types/global.d.ts';

const props = defineProps<{ plugin: PluginManifest }>();
defineEmits<{ back: [] }>();

const webviewRef = ref<{ openDevTools(): void } | null>(null);
const loading = ref(true);
const preloadUrl = ref('');

const pluginUrl = computed(() =>
  `../../plugins/builtin/${props.plugin.id}/dist/${props.plugin.entry}`
);

function onLoad(): void {
  loading.value = false;
}

function onLoadError(): void {
  loading.value = false;
}

function openDevTools(): void {
  webviewRef.value?.openDevTools();
}

// 从主进程获取 preload 绝对路径，转换为 file:// URL 供 webview 使用
onMounted(async () => {
  const api = (globalThis as unknown as { electronAPI: ElectronAPI }).electronAPI;
  const preloadPath: string = await api.getPreloadPath();
  // Windows 路径需要转换：C:\foo\bar → file:///C:/foo/bar
  preloadUrl.value = `file:///${preloadPath.replace(/\\/g, '/')}`;
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

.back-btn {
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
.back-btn:hover {
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

.devtools-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.78rem;
  transition: color var(--transition), border-color var(--transition);
}
.devtools-btn:hover {
  color: var(--accent-light);
  border-color: var(--accent);
}

/* webview 容器（类名保持 iframe-wrapper / plugin-frame 以兼容外部引用） */
.iframe-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
  /* webview 是自定义元素，需要显式撑满父容器 */
  display: flex;
  flex-direction: column;
}

.plugin-frame {
  flex: 1;
  width: 100%;
  border: none;
  background: var(--bg-content);
  display: flex;
}

/* 加载遮罩 */
.frame-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-content);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
