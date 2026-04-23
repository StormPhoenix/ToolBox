<template>
  <Teleport to="body">
    <div class="lightbox-mask" @click.self="close">
      <!-- 工具栏 -->
      <div class="lightbox-toolbar">
        <span class="lightbox-counter">
          {{ current + 1 }} / {{ items.length }}
        </span>
        <div class="lightbox-actions">
          <button
            class="lightbox-action"
            type="button"
            title="另存为"
            @click="saveAs"
          >
            💾 另存为
          </button>
          <button
            class="lightbox-action"
            type="button"
            title="关闭 (Esc)"
            @click="close"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 左右切换按钮 -->
      <button
        v-if="items.length > 1"
        class="lightbox-arrow arrow-prev"
        type="button"
        title="上一张 (←)"
        @click="prev"
      >
        ‹
      </button>
      <button
        v-if="items.length > 1"
        class="lightbox-arrow arrow-next"
        type="button"
        title="下一张 (→)"
        @click="next"
      >
        ›
      </button>

      <!-- 主图 -->
      <img
        v-if="currentItem"
        :src="currentItem.src"
        :alt="currentItem.fileName ?? ''"
        class="lightbox-image"
        draggable="false"
        @click.stop
      />

      <!-- 文件名 -->
      <div v-if="currentItem?.fileName" class="lightbox-caption">
        {{ currentItem.fileName }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * ImageLightbox — 图片大图浏览
 *
 * 用法（ChatView 使用）：
 *   <ImageLightbox
 *     :items="[{ src, cachePath?, fileName? }, ...]"
 *     :start-index="0"
 *     @close="state = null"
 *   />
 *
 * 特性：
 *  - ESC 或点击背景 / ✕ 按钮关闭
 *  - 左右方向键或 ‹ › 按钮切换
 *  - 💾 另存为：优先 copyFile(cachePath, target)；缺失时回退 writeFile(base64)
 *  - 单图时隐藏左右按钮
 *  - Teleport 到 body，避免被父容器 overflow 裁剪
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

export interface LightboxItem {
  /** 显示用的 URL（toolbox-img:// 或 data:）*/
  src: string;
  /** 本地缓存绝对路径（若有，优先 copyFile 另存为） */
  cachePath?: string;
  /** 显示用文件名 */
  fileName?: string;
  /** 若无 cachePath，用 base64 + mediaType 兜底另存为 */
  fallbackBase64?: string;
  fallbackMediaType?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

const props = defineProps<{
  items: LightboxItem[];
  startIndex?: number;
}>();

const emit = defineEmits<{
  close: [];
}>();

const current = ref(Math.min(Math.max(0, props.startIndex ?? 0), Math.max(0, props.items.length - 1)));

const currentItem = computed<LightboxItem | null>(
  () => props.items[current.value] ?? null
);

function next(): void {
  if (current.value < props.items.length - 1) current.value++;
}
function prev(): void {
  if (current.value > 0) current.value--;
}
function close(): void {
  emit('close');
}

async function saveAs(): Promise<void> {
  const item = currentItem.value;
  if (!item) return;
  const defaultName = item.fileName || 'image.png';
  const ext = defaultName.includes('.') ? defaultName.split('.').pop() : 'png';
  const result = await window.electronAPI.showSaveDialog({
    title: '保存图片',
    defaultPath: defaultName,
    filters: [{ name: '图片', extensions: [ext!] }],
  });
  if (result.canceled || !result.filePath) return;

  try {
    if (item.cachePath) {
      // 有本地缓存路径：直接复制，零开销
      const base64 = await window.electronAPI.readFile(item.cachePath, 'base64');
      await window.electronAPI.writeFile(result.filePath, base64, 'base64');
    } else if (item.fallbackBase64) {
      await window.electronAPI.writeFile(
        result.filePath,
        item.fallbackBase64,
        'base64'
      );
    } else {
      console.warn('saveAs: 既无 cachePath 也无 fallbackBase64，无法保存');
      return;
    }
  } catch (err) {
    console.error('保存图片失败:', err);
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prev();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    next();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
.lightbox-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 72px 80px;
}

.lightbox-toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #fff;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
}

.lightbox-counter {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.8);
}

.lightbox-actions {
  display: flex;
  gap: 8px;
}

.lightbox-action {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.82rem;
  transition: background var(--transition);
}
.lightbox-action:hover {
  background: rgba(255, 255, 255, 0.22);
}

.lightbox-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  user-select: none;
}

.lightbox-caption {
  position: absolute;
  bottom: 18px;
  left: 0;
  right: 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.82rem;
  pointer-events: none;
}

.lightbox-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 64px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.9);
  font-size: 2.4rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background var(--transition);
  user-select: none;
}
.lightbox-arrow:hover {
  background: rgba(0, 0, 0, 0.6);
}
.arrow-prev {
  left: 16px;
}
.arrow-next {
  right: 16px;
}
</style>
