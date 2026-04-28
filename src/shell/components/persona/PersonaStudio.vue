<template>
  <div class="persona-studio">
    <PersonaList
      :personas="personas"
      :active-id="activeId"
      :active-distillations="activeDistillations"
      @new="createPersona"
      @select="selectPersona"
      @delete="deletePersona"
      @rename="renamePersona"
      @open-recipe-dir="openRecipeDir"
    />

    <div class="studio-main">
      <!-- 空态 -->
      <div v-if="!activePersona" class="empty-state">
        <div class="empty-icon">🎭</div>
        <div class="empty-title">角色工坊</div>
        <div class="empty-hint">从材料中蒸馏思维角色，发布为可复用的 Skill</div>
        <button class="cta-btn" type="button" @click="createPersona">＋ 新建人格</button>
      </div>

      <!-- 工作区 -->
      <PersonaDetail
        v-else
        :key="activePersona.id"
        :persona="activePersona"
        :skill-md="activeSkillMd"
        :recipes="recipes"
        :is-distilling="activeDistillations.has(activePersona.id)"
        :live-events="liveEventsForActive"
        @meta-updated="onMetaUpdated"
        @skill-md-updated="onSkillMdUpdated"
      />
    </div>

    <!-- 新建：选择方式模态（新建/导入） -->
    <CreatePersonaModal
      v-if="showCreateModal"
      :recipes="recipes"
      @create-new="onCreateNew"
      @create-import="onCreateImport"
      @cancel="showCreateModal = false"
    />

    <!-- 全局 toast -->
    <transition name="toast">
      <div v-if="toast" class="toast" :class="`toast-${toast.kind}`">
        {{ toast.text }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { PersonaMeta, PersonaRecipeInfo, PersonaEvent } from '@toolbox/bridge';
import PersonaList from './PersonaList.vue';
import PersonaDetail from './PersonaDetail.vue';
import CreatePersonaModal from './CreatePersonaModal.vue';

// ── 数据 ───────────────────────────────────────────────────

const personas = ref<PersonaMeta[]>([]);
const recipes = ref<PersonaRecipeInfo[]>([]);
const activeId = ref<string | null>(null);
const activePersona = ref<PersonaMeta | null>(null);
const activeSkillMd = ref('');

// ── 全局活跃任务追踪 ─────────────────────────────────────

const activeDistillations = ref<Set<string>>(new Set());
/** 当前选中 Persona 的实时事件（仅 PersonaDetail 消费） */
const liveEventsForActive = ref<PersonaEvent[]>([]);

let disposeEventListener: (() => void) | null = null;

// ── 加载 ──────────────────────────────────────────────────

async function refreshPersonas(): Promise<void> {
  personas.value = await window.electronAPI.personaList();
  // 若当前选中已被删除，回到空态
  if (activeId.value && !personas.value.find(p => p.id === activeId.value)) {
    activeId.value = null;
    activePersona.value = null;
    activeSkillMd.value = '';
    liveEventsForActive.value = [];
  }
}

async function loadRecipes(): Promise<void> {
  recipes.value = await window.electronAPI.personaListRecipes();
}

async function loadActiveDistillations(): Promise<void> {
  const ids = await window.electronAPI.personaListActiveDistillations();
  activeDistillations.value = new Set(ids);
}

// ── 全局事件订阅 ─────────────────────────────────────────

function subscribeEvents(): void {
  disposeEventListener = window.electronAPI.onPersonaEvent((event: PersonaEvent) => {
    // 维护活跃集合
    if (event.kind === 'extract-start') {
      activeDistillations.value = new Set([
        ...activeDistillations.value,
        event.personaId,
      ]);
    } else if (
      event.kind === 'synthesis-end' ||
      event.kind === 'error' ||
      event.kind === 'aborted'
    ) {
      const next = new Set(activeDistillations.value);
      next.delete(event.personaId);
      activeDistillations.value = next;

      const meta = personas.value.find(p => p.id === event.personaId);
      const name = meta?.name ?? '人格';
      if (event.kind === 'synthesis-end') {
        showToast(
          event.truncated ? 'error' : 'info',
          event.truncated
            ? `${name} 蒸馏完成（输出已截断，请审阅）`
            : `${name} 蒸馏完成`
        );
        // 完成后刷新元数据（updated 时间已变）
        void refreshAfterDistill(event.personaId);
      } else if (event.kind === 'error') {
        showToast('error', `${name} 蒸馏失败：${event.message}`);
      } else {
        showToast('info', `${name} 蒸馏已中止`);
      }
    }

    // 转发给当前选中的 Detail（仅活跃 persona 的事件）
    if (event.personaId === activeId.value) {
      liveEventsForActive.value = [...liveEventsForActive.value, event];
    }
  });
}

async function refreshAfterDistill(personaId: string): Promise<void> {
  // 刷新整体列表保持顺序正确
  await refreshPersonas();
  // 若刚完成的就是当前选中，重新加载 SKILL.md
  if (activeId.value === personaId) {
    const result = await window.electronAPI.personaLoad(personaId);
    if (result) {
      activePersona.value = result.meta;
      activeSkillMd.value = result.skillMd;
    }
  }
}

// ── 生命周期 ─────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([refreshPersonas(), loadRecipes(), loadActiveDistillations()]);
  subscribeEvents();
});

onBeforeUnmount(() => {
  disposeEventListener?.();
  if (toastTimer) clearTimeout(toastTimer);
});

// ── 操作 ─────────────────────────────────────────────────

const showCreateModal = ref(false);

function createPersona(): void {
  showCreateModal.value = true;
}

async function onCreateNew(recipeName: string): Promise<void> {
  showCreateModal.value = false;
  try {
    const meta = await window.electronAPI.personaCreate({ recipe_name: recipeName });
    await refreshPersonas();
    await selectPersona(meta.id);
  } catch (err) {
    showToast('error', `创建失败：${(err as Error).message}`);
  }
}

async function onCreateImport(filePath: string, content: string): Promise<void> {
  showCreateModal.value = false;
  try {
    const meta = await window.electronAPI.personaCreate({
      source_type: 'imported',
      imported_from: filePath,
    });
    await window.electronAPI.personaSaveSkillMd({ id: meta.id, skillMd: content });
    await refreshPersonas();
    await selectPersona(meta.id);
  } catch (err) {
    showToast('error', `导入失败：${(err as Error).message}`);
  }
}

async function selectPersona(id: string): Promise<void> {
  const result = await window.electronAPI.personaLoad(id);
  if (!result) return;
  activeId.value = id;
  activePersona.value = result.meta;
  activeSkillMd.value = result.skillMd;
  liveEventsForActive.value = [];
}

async function deletePersona(id: string): Promise<void> {
  try {
    await window.electronAPI.personaDelete(id);
    if (activeId.value === id) {
      activeId.value = null;
      activePersona.value = null;
      activeSkillMd.value = '';
      liveEventsForActive.value = [];
    }
    // 同步活跃集合
    if (activeDistillations.value.has(id)) {
      const next = new Set(activeDistillations.value);
      next.delete(id);
      activeDistillations.value = next;
    }
    await refreshPersonas();
  } catch (err) {
    showToast('error', `删除失败：${(err as Error).message}`);
  }
}

async function renamePersona(id: string, newName: string): Promise<void> {
  try {
    const meta = await window.electronAPI.personaRename(id, newName);
    onMetaUpdated(meta);
  } catch (err) {
    showToast('error', `重命名失败：${(err as Error).message}`);
  }
}

async function openRecipeDir(): Promise<void> {
  await window.electronAPI.personaOpenRecipeDir();
}

function onMetaUpdated(meta: PersonaMeta): void {
  if (activeId.value === meta.id) activePersona.value = meta;
  const idx = personas.value.findIndex(p => p.id === meta.id);
  if (idx >= 0) {
    const next = [...personas.value];
    next[idx] = meta;
    // 按 updated 重排
    next.sort((a, b) => b.updated.localeCompare(a.updated));
    personas.value = next;
  }
}

function onSkillMdUpdated(content: string): void {
  activeSkillMd.value = content;
}

// ── Toast ─────────────────────────────────────────────────

interface ToastState { kind: 'info' | 'error'; text: string; }
const toast = ref<ToastState | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(kind: 'info' | 'error', text: string): void {
  toast.value = { kind, text };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = null; }, 3000);
}
</script>

<style scoped>
.persona-studio {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  position: relative;
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

/* Toast */
.toast {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 9px 18px;
  border-radius: 22px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 0.85rem;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  z-index: 50;
  max-width: 560px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toast-error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}
.toast-enter-active, .toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}
</style>
