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
    </div>

    <!-- iframe 容器 -->
    <div class="iframe-wrapper">
      <iframe
        ref="frameRef"
        class="plugin-frame"
        :src="pluginUrl"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        allowtransparency="true"
        @load="onLoad"
      />
      <!-- 加载遮罩 -->
      <div class="frame-loading" v-if="loading">
        <div class="loading-spinner"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { PluginManifest } from '../types';

const props = defineProps<{ plugin: PluginManifest }>();
defineEmits<{ back: [] }>();

const frameRef = ref<HTMLIFrameElement | null>(null);
const loading = ref(true);

// 插件 dist 产物路径（相对于 dist/ 输出目录）
const pluginUrl = computed(() => {
  // 构建后的路径：dist/plugins/<id>/index.html
  // Vite 输出时需与 electron loadFile 的工作目录对应
  return `../../plugins/builtin/${props.plugin.id}/dist/${props.plugin.entry}`;
});

function onLoad() {
  loading.value = false;
}
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

/* iframe */
.iframe-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.plugin-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: var(--bg-content);
  display: block;
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
