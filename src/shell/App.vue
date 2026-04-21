<template>
  <div class="app-layout">
    <!-- 侧边栏 -->
    <Sidebar
      v-model="activeCategoryId"
      :categories="CATEGORIES"
    />

    <!-- 主内容区 -->
    <main class="app-content">
      <!-- 查看插件详情 -->
      <ToolViewer
        v-if="activePlugin"
        :plugin="activePlugin"
        @back="activate(null)"
      />

      <!-- 工具列表 -->
      <div class="content-scroll" v-else>
        <ToolGrid
          :title="currentCategory?.label ?? '全部工具'"
          :plugins="currentPlugins"
          @activate="activate"
        />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import ToolGrid from './components/ToolGrid.vue';
import ToolViewer from './components/ToolViewer.vue';
import { usePlugins } from './composables/usePlugins';
import { CATEGORIES } from './data/categories';

const { activePlugin, getByCategory, activate, loadRegistry } = usePlugins();

const activeCategoryId = ref('all');

const currentCategory = computed(() =>
  CATEGORIES.find(c => c.id === activeCategoryId.value)
);

const currentPlugins = computed(() =>
  getByCategory(activeCategoryId.value)
);

onMounted(() => loadRegistry());
</script>

<style scoped>
.app-layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.app-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-content);
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
</style>
