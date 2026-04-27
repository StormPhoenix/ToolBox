<template>
  <aside class="persona-list">
    <div class="list-header">
      <button class="new-btn" type="button" @click="$emit('new')">
        <span>＋</span>
        <span>新建人格</span>
      </button>
    </div>

    <div class="list-scroll">
      <div v-if="personas.length === 0" class="empty-hint">
        暂无人格<br />点击上方按钮开始蒸馏
      </div>

      <template v-else>
        <!-- 已发布 -->
        <div v-if="published.length > 0" class="group">
          <div class="group-label">已发布</div>
          <PersonaItem
            v-for="p in published"
            :key="p.id"
            :persona="p"
            :active="activeId === p.id"
            @click="$emit('select', p.id)"
            @delete="$emit('delete', p.id)"
          />
        </div>

        <!-- 草稿 -->
        <div v-if="drafts.length > 0" class="group">
          <div class="group-label">草稿</div>
          <PersonaItem
            v-for="p in drafts"
            :key="p.id"
            :persona="p"
            :active="activeId === p.id"
            @click="$emit('select', p.id)"
            @delete="$emit('delete', p.id)"
          />
        </div>
      </template>
    </div>

    <div class="list-footer">
      <button class="footer-btn" type="button" @click="$emit('open-recipe-dir')" title="打开配方目录">
        📂 配方目录
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PersonaMeta } from '@toolbox/bridge';
import PersonaItem from './PersonaItem.vue';

const props = defineProps<{
  personas: PersonaMeta[];
  activeId: string | null;
}>();

defineEmits<{
  'new': [];
  'select': [id: string];
  'delete': [id: string];
  'open-recipe-dir': [];
}>();

const published = computed(() => props.personas.filter(p => p.status === 'published'));
const drafts = computed(() => props.personas.filter(p => p.status === 'draft'));
</script>

<style scoped>
.persona-list {
  width: 240px;
  min-width: 240px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-header {
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.new-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), transform var(--transition);
}
.new-btn:hover {
  background: var(--accent-light);
  transform: translateY(-1px);
}

.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
}

.empty-hint {
  padding: 36px 14px;
  color: var(--text-dim);
  text-align: center;
  font-size: 0.82rem;
  line-height: 1.6;
}

.group {
  margin-bottom: 8px;
}

.group-label {
  font-size: 0.7rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 8px;
}

.list-footer {
  padding: 8px;
  border-top: 1px solid var(--border);
}

.footer-btn {
  width: 100%;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background var(--transition), color var(--transition);
}
.footer-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}
</style>
