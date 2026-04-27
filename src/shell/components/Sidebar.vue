<template>
  <aside class="sidebar" :class="{ collapsed }">
    <!-- Logo -->
    <div class="sidebar-logo" @click="collapsed = !collapsed">
      <span class="logo-icon">🧰</span>
      <span class="logo-text" v-show="!collapsed">ToolBox</span>
    </div>

    <!-- 分类列表 -->
    <nav class="sidebar-nav">
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="nav-item"
        :class="{ active: modelValue === cat.id }"
        @click="$emit('update:modelValue', cat.id)"
        :title="collapsed ? cat.label : undefined"
      >
        <span class="nav-icon">{{ cat.icon }}</span>
        <span class="nav-label" v-show="!collapsed">{{ cat.label }}</span>
      </button>
    </nav>

    <!-- 底部：角色工坊 + AI 对话 + 设置 -->
    <div class="sidebar-footer">
      <button
        class="nav-item"
        :class="{ active: modelValue === 'persona' }"
        @click="$emit('update:modelValue', 'persona')"
        :title="collapsed ? '角色工坊' : undefined"
      >
        <span class="nav-icon">🎭</span>
        <span class="nav-label" v-show="!collapsed">角色工坊</span>
      </button>
      <button
        class="nav-item"
        :class="{ active: modelValue === 'chat' }"
        @click="$emit('update:modelValue', 'chat')"
        :title="collapsed ? 'AI 对话' : undefined"
      >
        <span class="nav-icon">💬</span>
        <span class="nav-label" v-show="!collapsed">AI 对话</span>
      </button>
      <button
        class="nav-item"
        :class="{ active: modelValue === 'settings' }"
        @click="$emit('update:modelValue', 'settings')"
        :title="collapsed ? '设置' : undefined"
      >
        <span class="nav-icon">⚙</span>
        <span class="nav-label" v-show="!collapsed">设置</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { Category } from '../types';

defineProps<{
  modelValue: string;
  categories: Category[];
}>();

defineEmits<{
  'update:modelValue': [value: string];
}>();

const collapsed = ref(false);
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: width var(--transition), min-width var(--transition);
  overflow: hidden;
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed);
  min-width: var(--sidebar-collapsed);
}

/* Logo */
.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  -webkit-app-region: drag;
}
.logo-icon {
  font-size: 1.4rem;
  min-width: 28px;
  text-align: center;
  flex-shrink: 0;
}
.logo-text {
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, var(--accent-light), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Nav */
.sidebar-nav {
  flex: 1;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
  white-space: nowrap;
  text-align: left;
  font-size: 0.875rem;
}

.nav-item:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--bg-active);
  color: var(--accent-light);
}

.nav-icon {
  font-size: 1rem;
  min-width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
