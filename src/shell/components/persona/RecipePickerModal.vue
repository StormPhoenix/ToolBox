<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">{{ title }}</div>
        <button class="close-btn" type="button" @click="$emit('cancel')">✕</button>
      </div>

      <div class="modal-subtitle">{{ subtitle }}</div>

      <div class="recipe-grid">
        <div
          v-for="r in recipes"
          :key="r.name"
          class="recipe-card"
          :class="{ selected: selected === r.name }"
          @click="selected = r.name"
          @dblclick="confirm"
        >
          <div class="recipe-name">{{ r.name }}</div>
          <div class="recipe-desc">{{ r.description }}</div>
          <div v-if="r.suitable_for?.length" class="recipe-tags">
            <span v-for="t in r.suitable_for" :key="t" class="tag">{{ t }}</span>
          </div>
          <div v-if="r.builtin" class="builtin-badge">内置</div>
        </div>
      </div>

      <div v-if="recipes.length === 0" class="empty-recipes">
        当前没有可用配方。请检查 <code>userData/persona-recipes/</code> 或重启应用。
      </div>

      <div class="modal-footer">
        <button class="btn secondary" type="button" @click="$emit('cancel')">取消</button>
        <button
          class="btn primary"
          type="button"
          :disabled="!selected"
          @click="confirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PersonaRecipeInfo } from '@toolbox/bridge';

const props = withDefaults(
  defineProps<{
    recipes: PersonaRecipeInfo[];
    /** 当前已选中的配方 name；用于"切换配方"场景预填 */
    currentRecipe?: string | null;
    title?: string;
    subtitle?: string;
    confirmLabel?: string;
  }>(),
  {
    currentRecipe: null,
    title: '选择配方',
    subtitle: '配方决定了蒸馏的方式和输出风格',
    confirmLabel: '确定',
  }
);

const emit = defineEmits<{
  'select': [recipeName: string];
  'cancel': [];
}>();

const selected = ref<string>(props.currentRecipe ?? props.recipes[0]?.name ?? '');

// 当父组件后续异步加载完 recipes 时同步默认选中
watch(
  () => props.recipes,
  (rs) => {
    if (!selected.value && rs.length > 0) {
      selected.value = props.currentRecipe ?? rs[0].name;
    }
  }
);

function confirm(): void {
  if (selected.value) emit('select', selected.value);
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.modal {
  width: 100%;
  max-width: 720px;
  max-height: calc(100vh - 64px);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.92rem;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--transition), color var(--transition);
}
.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.modal-subtitle {
  font-size: 0.82rem;
  color: var(--text-dim);
  padding: 12px 20px 4px;
}

/* Recipe grid */
.recipe-grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.recipe-card {
  position: relative;
  padding: 14px 16px;
  background: var(--bg-base);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
}
.recipe-card:hover {
  border-color: var(--accent-light);
  background: var(--bg-card-hover);
}
.recipe-card.selected {
  border-color: var(--accent);
  background: var(--bg-active);
}

.recipe-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
  padding-right: 36px; /* 留位给 builtin 徽标 */
}
.recipe-card.selected .recipe-name {
  color: var(--accent-light);
}

.recipe-desc {
  font-size: 0.78rem;
  color: var(--text-dim);
  line-height: 1.45;
  margin-bottom: 8px;
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

.builtin-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.62rem;
  color: var(--text-dim);
  background: var(--bg-card);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
}

.empty-recipes {
  padding: 30px 20px;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.84rem;
}
.empty-recipes code {
  background: var(--bg-base);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.78rem;
}

/* Footer */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-base);
}

.btn {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 0.86rem;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition), opacity var(--transition);
}
.btn.secondary {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}
.btn.secondary:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent-light);
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
