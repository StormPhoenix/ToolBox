<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ctx-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      @click.stop
    >
      <!-- 移除此页 -->
      <button class="ctx-item ctx-item--danger" @click="onRemove">
        <span class="ctx-icon">🗑</span>
        移除此页
      </button>

      <div class="ctx-divider" />

      <!-- 本页前插入 -->
      <div
        class="ctx-item ctx-item--submenu"
        @mouseenter="openSub('before')"
        @mouseleave="subHoverGuard('before')"
      >
        <span class="ctx-icon">⬆</span>
        本页前插入
        <span class="ctx-arrow">›</span>

        <div
          v-if="activeSub === 'before'"
          class="ctx-submenu"
          :class="subClass"
          @mouseenter="keepSub"
          @mouseleave="closeSub"
        >
          <button class="ctx-item" @click="onInsert('before', 'blank')">
            <span class="ctx-icon">📄</span>
            插入空白页
          </button>
          <button class="ctx-item" @click="onInsert('before', 'image')">
            <span class="ctx-icon">🖼</span>
            插入图片
          </button>
          <button class="ctx-item" @click="onInsert('before', 'pdf')">
            <span class="ctx-icon">📋</span>
            插入 PDF 页
          </button>
        </div>
      </div>

      <!-- 本页后插入 -->
      <div
        class="ctx-item ctx-item--submenu"
        @mouseenter="openSub('after')"
        @mouseleave="subHoverGuard('after')"
      >
        <span class="ctx-icon">⬇</span>
        本页后插入
        <span class="ctx-arrow">›</span>

        <div
          v-if="activeSub === 'after'"
          class="ctx-submenu"
          :class="subClass"
          @mouseenter="keepSub"
          @mouseleave="closeSub"
        >
          <button class="ctx-item" @click="onInsert('after', 'blank')">
            <span class="ctx-icon">📄</span>
            插入空白页
          </button>
          <button class="ctx-item" @click="onInsert('after', 'image')">
            <span class="ctx-icon">🖼</span>
            插入图片
          </button>
          <button class="ctx-item" @click="onInsert('after', 'pdf')">
            <span class="ctx-icon">📋</span>
            插入 PDF 页
          </button>
        </div>
      </div>
    </div>

    <!-- 点击空白关闭 -->
    <div v-if="visible" class="ctx-backdrop" @click="close" @contextmenu.prevent="close" />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

export type InsertPosition = 'before' | 'after';
export type InsertType = 'blank' | 'image' | 'pdf';

const visible = ref(false);
const x = ref(0);
const y = ref(0);
const targetIndex = ref(-1);
const activeSub = ref<InsertPosition | null>(null);

// 子菜单展开方向（向右 or 向左）
const subClass = computed(() => subDirection.value === 'left' ? 'ctx-submenu--left' : '');
const subDirection = ref<'right' | 'left'>('right');

let subCloseTimer: ReturnType<typeof setTimeout> | null = null;

const emit = defineEmits<{
  remove: [pageIndex: number];
  insert: [pageIndex: number, position: InsertPosition, type: InsertType];
}>();

function open(event: MouseEvent, pageIndex: number): void {
  event.preventDefault();
  targetIndex.value = pageIndex;

  const menuW = 180;
  const menuH = 148;
  x.value = Math.min(event.clientX, window.innerWidth - menuW - 8);
  y.value = Math.min(event.clientY, window.innerHeight - menuH - 8);

  // 判断子菜单展开方向
  subDirection.value = (x.value + menuW + 160 > window.innerWidth) ? 'left' : 'right';

  activeSub.value = null;
  visible.value = true;
}

function close(): void {
  visible.value = false;
  activeSub.value = null;
}

function openSub(pos: InsertPosition): void {
  if (subCloseTimer) { clearTimeout(subCloseTimer); subCloseTimer = null; }
  activeSub.value = pos;
}

function keepSub(): void {
  if (subCloseTimer) { clearTimeout(subCloseTimer); subCloseTimer = null; }
}

function closeSub(): void {
  subCloseTimer = setTimeout(() => { activeSub.value = null; }, 120);
}

function subHoverGuard(pos: InsertPosition): void {
  // 离开父菜单项时，给子菜单一点时间接管
  if (activeSub.value === pos) closeSub();
}

function onRemove(): void {
  emit('remove', targetIndex.value);
  close();
}

function onInsert(position: InsertPosition, type: InsertType): void {
  emit('insert', targetIndex.value, position, type);
  close();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  if (subCloseTimer) clearTimeout(subCloseTimer);
});

defineExpose({ open, close });
</script>

<style scoped>
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  background: #1e1e30;
  border: 1px solid #2d2d44;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  animation: menuIn 0.1s ease-out;
}

@keyframes menuIn {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}

.ctx-divider {
  height: 1px;
  background: #2d2d44;
  margin: 4px 0;
}

.ctx-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 5px;
  color: #e8e8f2;
  font-size: 0.85rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
  user-select: none;
}

.ctx-item:hover,
.ctx-item--submenu:hover {
  background: #2a2a40;
}

.ctx-item--danger { color: #ff7675; }
.ctx-item--danger:hover { background: rgba(231, 76, 60, 0.15); }

.ctx-icon { font-size: 0.9rem; flex-shrink: 0; }

.ctx-arrow {
  margin-left: auto;
  font-size: 0.8rem;
  color: #8888a8;
}

/* 子菜单 */
.ctx-submenu {
  position: absolute;
  left: calc(100% + 4px);
  top: -4px;
  min-width: 168px;
  background: #1e1e30;
  border: 1px solid #2d2d44;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 1001;
  animation: menuIn 0.08s ease-out;
}

.ctx-submenu--left {
  left: auto;
  right: calc(100% + 4px);
}
</style>
