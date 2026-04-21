<template>
  <!-- 右键菜单 -->
  <Teleport to="body">
    <div
      v-if="visible"
      class="ctx-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      @click.stop
    >
      <button class="ctx-item ctx-item--danger" @click="onRemove">
        <span class="ctx-icon">🗑</span>
        移除此页
      </button>
    </div>
    <!-- 点击空白关闭 -->
    <div v-if="visible" class="ctx-backdrop" @click="close" @contextmenu.prevent="close" />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const visible = ref(false);
const x = ref(0);
const y = ref(0);
const targetIndex = ref(-1);

const emit = defineEmits<{
  remove: [pageIndex: number];
}>();

function open(event: MouseEvent, pageIndex: number) {
  event.preventDefault();
  targetIndex.value = pageIndex;

  // 边界检测，防止菜单超出视口
  const menuW = 160;
  const menuH = 48;
  x.value = Math.min(event.clientX, window.innerWidth - menuW - 8);
  y.value = Math.min(event.clientY, window.innerHeight - menuH - 8);
  visible.value = true;
}

function close() {
  visible.value = false;
}

function onRemove() {
  emit('remove', targetIndex.value);
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));

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
  min-width: 160px;
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

.ctx-item {
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
}

.ctx-item:hover {
  background: #2a2a40;
}

.ctx-item--danger {
  color: #ff7675;
}

.ctx-item--danger:hover {
  background: rgba(231, 76, 60, 0.15);
}

.ctx-icon {
  font-size: 0.9rem;
}
</style>
