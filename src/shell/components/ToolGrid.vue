<template>
  <div class="tool-grid">
    <!-- 分类标题 -->
    <div class="grid-header">
      <h2 class="grid-title">{{ title }}</h2>
      <span class="grid-count">{{ plugins.length }} 个工具</span>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-if="plugins.length === 0">
      <div class="empty-icon">🔍</div>
      <p>该分类下暂无工具</p>
    </div>

    <!-- 工具列表 -->
    <div class="grid-list" v-else>
      <PluginCard
        v-for="plugin in plugins"
        :key="plugin.id"
        :plugin="plugin"
        @activate="$emit('activate', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import PluginCard from './PluginCard.vue';
import type { PluginManifest } from '../types';

defineProps<{
  title: string;
  plugins: PluginManifest[];
}>();

defineEmits<{ activate: [id: string] }>();
</script>

<style scoped>
.tool-grid {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.grid-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.grid-title {
  font-size: 1.1rem;
  font-weight: 600;
}

.grid-count {
  font-size: 0.78rem;
  color: var(--text-dim);
}

.grid-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding-bottom: 16px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-dim);
  font-size: 0.9rem;
}

.empty-icon {
  font-size: 2.4rem;
  opacity: 0.5;
}
</style>
