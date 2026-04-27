<template>
  <div class="persona-studio">
    <PersonaList
      :personas="personas"
      :active-id="activeId"
      @new="startNew"
      @select="selectPersona"
      @delete="deletePersona"
      @open-recipe-dir="openRecipeDir"
    />

    <div class="studio-main">
      <!-- 空态 -->
      <div v-if="view === 'empty'" class="empty-state">
        <div class="empty-icon">🎭</div>
        <div class="empty-title">角色工坊</div>
        <div class="empty-hint">从材料中蒸馏思维角色，发布为可复用的 Skill</div>
        <button class="cta-btn" type="button" @click="startNew">＋ 新建人格</button>
      </div>

      <!-- 新建向导 -->
      <PersonaWizard
        v-else-if="view === 'wizard'"
        :recipes="recipes"
        @cancel="cancelWizard"
        @saved="onWizardSaved"
      />

      <!-- 人格详情 -->
      <PersonaDetail
        v-else-if="view === 'detail' && activePersona"
        :persona="activePersona"
        :skill-md="activeSkillMd"
        :recipes="recipes"
        @update="onPersonaUpdated"
        @deleted="onPersonaDeleted"
        @published="refreshPersonas"
        @unpublished="refreshPersonas"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { PersonaMeta, PersonaRecipeInfo, PersonaLoadResult } from '@toolbox/bridge';
import PersonaList from './PersonaList.vue';
import PersonaWizard from './PersonaWizard.vue';
import PersonaDetail from './PersonaDetail.vue';

type View = 'empty' | 'wizard' | 'detail';

const personas = ref<PersonaMeta[]>([]);
const recipes = ref<PersonaRecipeInfo[]>([]);
const activeId = ref<string | null>(null);
const activePersona = ref<PersonaMeta | null>(null);
const activeSkillMd = ref('');
const view = ref<View>('empty');

// ── 数据加载 ───────────────────────────────────────────────

async function refreshPersonas(): Promise<void> {
  personas.value = await window.electronAPI.personaList();
  if (activeId.value && !personas.value.find(p => p.id === activeId.value)) {
    activeId.value = null;
    activePersona.value = null;
    activeSkillMd.value = '';
    view.value = 'empty';
  } else if (activeId.value) {
    const found = personas.value.find(p => p.id === activeId.value);
    if (found) activePersona.value = found;
  }
}

async function loadRecipes(): Promise<void> {
  recipes.value = await window.electronAPI.personaListRecipes();
}

onMounted(() => {
  void Promise.all([refreshPersonas(), loadRecipes()]);
});

// ── 交互 ──────────────────────────────────────────────────

function startNew(): void {
  activeId.value = null;
  activePersona.value = null;
  activeSkillMd.value = '';
  view.value = 'wizard';
}

function cancelWizard(): void {
  view.value = activeId.value ? 'detail' : 'empty';
}

async function selectPersona(id: string): Promise<void> {
  const result: PersonaLoadResult | null = await window.electronAPI.personaLoad(id);
  if (!result) return;
  activeId.value = id;
  activePersona.value = result.meta;
  activeSkillMd.value = result.skillMd;
  view.value = 'detail';
}

async function deletePersona(id: string): Promise<void> {
  await window.electronAPI.personaDelete(id);
  if (activeId.value === id) {
    activeId.value = null;
    activePersona.value = null;
    activeSkillMd.value = '';
    view.value = 'empty';
  }
  await refreshPersonas();
}

async function openRecipeDir(): Promise<void> {
  await window.electronAPI.personaOpenRecipeDir();
}

async function onWizardSaved(id: string): Promise<void> {
  await refreshPersonas();
  await selectPersona(id);
}

function onPersonaUpdated(updated: PersonaMeta): void {
  activePersona.value = updated;
  const idx = personas.value.findIndex(p => p.id === updated.id);
  if (idx >= 0) personas.value[idx] = updated;
}

async function onPersonaDeleted(): Promise<void> {
  activeId.value = null;
  activePersona.value = null;
  activeSkillMd.value = '';
  view.value = 'empty';
  await refreshPersonas();
}
</script>

<style scoped>
.persona-studio {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.studio-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-content);
  overflow: hidden;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  text-align: center;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 3.4rem;
  opacity: 0.75;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 1.15rem;
  color: var(--text-primary);
  font-weight: 600;
  margin-bottom: 6px;
}

.empty-hint {
  color: var(--text-dim);
  font-size: 0.88rem;
  margin-bottom: 20px;
  max-width: 300px;
  line-height: 1.5;
}

.cta-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 9px 22px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--transition), transform var(--transition);
}
.cta-btn:hover {
  background: var(--accent-light);
  transform: translateY(-1px);
}
</style>
