<template>
  <div
    class="recipe-card"
    :class="{ selected, selectable, compact }"
    @click="onClick"
    @dblclick="$emit('dblclick')"
  >
    <div class="recipe-name">{{ recipe.name }}</div>
    <div class="recipe-desc" :title="recipe.description">
      {{ truncate(recipe.description, 80) }}
    </div>
    <div v-if="recipe.suitable_for?.length" class="recipe-tags">
      <span v-for="t in recipe.suitable_for" :key="t" class="tag">{{ t }}</span>
    </div>
    <div class="origin-badge" :class="recipe.builtin ? 'builtin' : 'external'">
      {{ recipe.builtin ? '内置' : '外置' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PersonaRecipeInfo } from '@toolbox/bridge';

withDefaults(
  defineProps<{
    recipe: PersonaRecipeInfo;
    /** 是否处于"选中"视觉态（仅 selectable=true 时有效） */
    selected?: boolean;
    /** 是否可点击选中（false 时仅展示，无 hover 高亮） */
    selectable?: boolean;
    /** 紧凑模式（用于 Settings 等密集列表场景，减少 padding） */
    compact?: boolean;
  }>(),
  {
    selected: false,
    selectable: true,
    compact: false,
  }
);

const emit = defineEmits<{
  'click': [];
  'dblclick': [];
}>();

function onClick(): void {
  emit('click');
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}
</script>

<style scoped>
.recipe-card {
  position: relative;
  padding: 14px 16px;
  background: var(--bg-base);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition), background var(--transition);
}
.recipe-card.compact {
  padding: 11px 13px;
}

.recipe-card.selectable {
  cursor: pointer;
}
.recipe-card.selectable:hover {
  border-color: var(--accent-light);
  background: var(--bg-card-hover);
}
.recipe-card.selectable.selected {
  border-color: var(--accent);
  background: var(--bg-active);
}

.recipe-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
  padding-right: 44px;
}
.recipe-card.selectable.selected .recipe-name {
  color: var(--accent-light);
}
.recipe-card.compact .recipe-name {
  font-size: 0.86rem;
}

.recipe-desc {
  font-size: 0.78rem;
  color: var(--text-dim);
  line-height: 1.45;
  margin-bottom: 8px;
}
.recipe-card.compact .recipe-desc {
  font-size: 0.74rem;
  margin-bottom: 6px;
}

.recipe-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  background: rgba(108, 92, 231, 0.12);
  color: var(--accent-light);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.68rem;
}

/* 来源徽标（内置/外置） */
.origin-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.62rem;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
}
.origin-badge.builtin {
  color: var(--text-dim);
  background: var(--bg-card);
}
.origin-badge.external {
  color: #6ee7b7;
  background: rgba(52, 211, 153, 0.12);
  border-color: rgba(52, 211, 153, 0.3);
}
</style>
