<template>
  <div class="preset-panel">
    <div class="panel-header">
      <span class="panel-title">裁剪预设</span>
      <button class="btn-add" @click="openDialog" title="添加预设">＋</button>
    </div>

    <!-- 工作列表 -->
    <div class="preset-list" v-if="workingPresets.length > 0">
      <div
        v-for="preset in workingPresets"
        :key="preset.id"
        class="preset-item"
        :class="{ active: activePresetId === preset.id }"
        @click="setActivePreset(preset.id)"
      >
        <div class="preset-info">
          <span class="preset-name">{{ preset.name }}</span>
          <span class="preset-res">{{ preset.width }}×{{ preset.height }}</span>
        </div>
        <button
          class="btn-remove"
          @click.stop="onRemove(preset.id)"
          title="移除"
        >✕</button>
      </div>
    </div>

    <div class="empty-hint" v-else>
      点击 ＋ 添加设备预设
    </div>

    <!-- 添加预设弹窗 -->
    <Teleport to="body">
      <div class="dialog-backdrop" v-if="dialogVisible" @click.self="closeDialog">
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">选择设备预设</span>
            <button class="dialog-close" @click="closeDialog">✕</button>
          </div>
          <div class="dialog-body">
            <div v-for="group in PRESET_GROUPS" :key="group" class="preset-group">
              <div class="group-label">{{ group }}</div>
              <div
                v-for="p in getGroupPresets(group)"
                :key="p.id"
                class="dialog-item"
                :class="{ added: isPresetAdded(p.id) }"
                @click="onAdd(p.id)"
              >
                <span class="dialog-item-name">{{ p.name }}</span>
                <span class="dialog-item-res">{{ p.width }}×{{ p.height }}</span>
                <span class="dialog-item-badge" v-if="isPresetAdded(p.id)">已添加</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  workingPresets,
  activePresetId,
  isPresetAdded,
  addPreset,
  removePreset,
  setActivePreset,
} from '../composables/usePresets';
import { removeCropState } from '../composables/useCropState';
import { BUILTIN_PRESETS, PRESET_GROUPS, type PresetGroup } from '../data/builtin-presets';

const dialogVisible = ref(false);

function openDialog(): void {
  dialogVisible.value = true;
}

function closeDialog(): void {
  dialogVisible.value = false;
}

function getGroupPresets(group: PresetGroup) {
  return BUILTIN_PRESETS.filter(p => p.group === group);
}

function onAdd(id: string): void {
  if (isPresetAdded(id)) return;
  addPreset(id);
  // 添加后自动激活
  setActivePreset(id);
  closeDialog();
}

function onRemove(id: string): void {
  removePreset(id);
  removeCropState(id);
  // 若移除的是当前激活项，切换到第一个
  if (activePresetId.value === id) {
    const remaining = workingPresets.value;
    setActivePreset(remaining.length > 0 ? remaining[0].id : '');
  }
}
</script>

<style scoped>
.preset-panel {
  display: flex;
  flex-direction: column;
  width: 200px;
  min-width: 180px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary, #8888a8);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.btn-add {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--accent-light);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition), border-color var(--transition);
}

.btn-add:hover {
  background: var(--bg-active);
  border-color: var(--accent);
}

.preset-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.preset-list::-webkit-scrollbar { width: 4px; }
.preset-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.preset-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background var(--transition);
  border-left: 2px solid transparent;
}

.preset-item:hover {
  background: var(--bg-card-hover);
}

.preset-item.active {
  background: var(--bg-active);
  border-left-color: var(--accent);
}

.preset-info {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preset-name {
  font-size: 0.8rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preset-res {
  font-size: 0.68rem;
  color: var(--text-dim, #555570);
}

.btn-remove {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-dim, #555570);
  font-size: 0.65rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background var(--transition), color var(--transition);
  opacity: 0;
}

.preset-item:hover .btn-remove {
  opacity: 1;
}

.btn-remove:hover {
  background: rgba(255, 118, 117, 0.15);
  color: #ff7675;
}

.empty-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 0.76rem;
  color: var(--text-dim, #555570);
  padding: 24px 16px;
  line-height: 1.6;
}

/* ── 弹窗 ── */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  width: 360px;
  max-height: 520px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.dialog-title {
  font-size: 0.9rem;
  font-weight: 600;
}

.dialog-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-dim, #555570);
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition), color var(--transition);
}

.dialog-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}

.dialog-body::-webkit-scrollbar { width: 4px; }
.dialog-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.preset-group {
  margin-bottom: 4px;
}

.group-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-dim, #555570);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 6px 18px 4px;
}

.dialog-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  cursor: pointer;
  transition: background var(--transition);
}

.dialog-item:hover:not(.added) {
  background: var(--bg-card-hover);
}

.dialog-item.added {
  opacity: 0.45;
  cursor: default;
}

.dialog-item-name {
  flex: 1;
  font-size: 0.82rem;
}

.dialog-item-res {
  font-size: 0.72rem;
  color: var(--text-dim, #555570);
}

.dialog-item-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-active);
  color: var(--accent-light);
  flex-shrink: 0;
}
</style>
