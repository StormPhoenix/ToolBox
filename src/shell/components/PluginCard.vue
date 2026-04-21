<template>
  <div class="plugin-card" @click="$emit('activate', plugin.id)">
    <div class="card-icon">{{ plugin.icon }}</div>
    <div class="card-body">
      <div class="card-name">{{ plugin.name }}</div>
      <div class="card-desc">{{ plugin.description }}</div>
    </div>
    <div class="card-badge" v-if="plugin.builtin">内置</div>
  </div>
</template>

<script setup lang="ts">
import type { PluginManifest } from '../types';

defineProps<{ plugin: PluginManifest }>();
defineEmits<{ activate: [id: string] }>();
</script>

<style scoped>
.plugin-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition),
    transform 0.12s ease;
  position: relative;
}

.plugin-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--accent);
  transform: translateY(-1px);
}

.card-icon {
  font-size: 1.8rem;
  min-width: 40px;
  text-align: center;
  flex-shrink: 0;
}

.card-body {
  flex: 1;
  overflow: hidden;
}

.card-name {
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  font-size: 0.78rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-badge {
  font-size: 0.65rem;
  background: var(--accent-glow);
  color: var(--accent-light);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 2px 6px;
  flex-shrink: 0;
}
</style>
