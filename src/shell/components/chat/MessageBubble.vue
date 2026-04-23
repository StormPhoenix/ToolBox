<template>
  <div class="bubble-row" :class="[`role-${message.role}`]">
    <div class="bubble">
      <!-- 图片网格（仅 user 消息会有） -->
      <div
        v-if="imageItems.length > 0"
        class="bubble-images"
        :class="layoutClass"
      >
        <div
          v-for="(item, i) in visibleImages"
          :key="i"
          class="bubble-image-cell"
          @click="openLightbox(i)"
        >
          <img :src="item.src" class="bubble-image" alt="" draggable="false" />
          <!-- 最后一格：超出 9 张显示 +N -->
          <div v-if="i === 8 && overflow > 0" class="bubble-image-overflow">
            +{{ overflow }}
          </div>
          <!-- 重新发送按钮（仅 image_ref 有 cachePath 时才显示） -->
          <button
            v-if="item.ref"
            class="bubble-image-resend"
            type="button"
            title="重新发送此图"
            @click.stop="resend(item.ref)"
          >
            ⟳
          </button>
        </div>
      </div>

      <!-- 文本内容：assistant 走 Markdown，user 走纯文本 -->
      <MarkdownView v-if="message.role === 'assistant'" :text="textContent" />
      <div v-else-if="textContent" class="bubble-user-text">{{ textContent }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage, LLMImageRefBlock } from '@toolbox/bridge';
import MarkdownView from './MarkdownView.vue';
import type { LightboxItem } from './ImageLightbox.vue';

const props = defineProps<{
  message: ChatMessage;
}>();

const emit = defineEmits<{
  'open-lightbox': [params: { items: LightboxItem[]; index: number }];
  'resend-image': [ref: {
    cachePath: string;
    hash: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    fileName: string;
  }];
}>();

// ── 内容解析 ─────────────────────────────────────────────

/** 从 content 中提取纯文本 */
const textContent = computed((): string => {
  const c = props.message.content;
  if (typeof c === 'string') return c;
  return c
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
});

interface ImageItem {
  /** 展示 URL（toolbox-img:// 或 data:） */
  src: string;
  /** 完整引用（仅 image_ref 块有） */
  ref: LLMImageRefBlock | null;
  /** 文件名 */
  fileName: string;
  /** 运行时 base64（仅 image 块），供 Lightbox 无 cachePath 时兜底 */
  fallbackBase64?: string;
  fallbackMediaType?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/** 扩展名推断（toolbox-img 协议用） */
function extOf(mt: string): string {
  switch (mt) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}

/** 从 content 中提取图片列表（image_ref 优先走 toolbox-img 协议，否则走 data URL） */
const imageItems = computed((): ImageItem[] => {
  const c = props.message.content;
  if (typeof c === 'string') return [];
  const out: ImageItem[] = [];
  for (const b of c) {
    if (
      typeof b === 'object' &&
      b !== null &&
      (b as { type: string }).type === 'image_ref'
    ) {
      const ref = b as LLMImageRefBlock;
      out.push({
        src: `toolbox-img:///${ref.hash}.${extOf(ref.mediaType)}`,
        ref,
        fileName: ref.fileName,
      });
    } else if (
      typeof b === 'object' &&
      b !== null &&
      (b as { type: string }).type === 'image'
    ) {
      const img = b as {
        type: 'image';
        source: { type: 'base64'; media_type: string; data: string };
      };
      out.push({
        src: `data:${img.source.media_type};base64,${img.source.data}`,
        ref: null,
        fileName: 'image',
        fallbackBase64: img.source.data,
        fallbackMediaType:
          img.source.media_type as ImageItem['fallbackMediaType'],
      });
    }
  }
  return out;
});

// ── 网格布局 ─────────────────────────────────────────────

/** 布局类名：1 张、2 张、3+ 张（最多展示 9 张，超出显示 +N） */
const layoutClass = computed(() => {
  const n = imageItems.value.length;
  if (n === 1) return 'layout-1';
  if (n === 2) return 'layout-2';
  return 'layout-grid';
});

const visibleImages = computed(() => imageItems.value.slice(0, 9));
const overflow = computed(() => Math.max(0, imageItems.value.length - 9));

// ── 点击交互 ─────────────────────────────────────────────

function openLightbox(index: number): void {
  const items: LightboxItem[] = imageItems.value.map((it) => ({
    src: it.src,
    cachePath: it.ref?.cachePath,
    fileName: it.fileName,
    fallbackBase64: it.fallbackBase64,
    fallbackMediaType: it.fallbackMediaType,
  }));
  emit('open-lightbox', { items, index });
}

function resend(ref: LLMImageRefBlock): void {
  emit('resend-image', {
    cachePath: ref.cachePath,
    hash: ref.hash,
    mediaType: ref.mediaType,
    fileName: ref.fileName,
  });
}
</script>

<style scoped>
.bubble-row {
  display: flex;
  width: 100%;
  margin: 6px 0;
}

.role-user {
  justify-content: flex-end;
}

.role-assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: min(760px, 88%);
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.role-user .bubble {
  background: var(--accent);
  color: #fff;
  border-top-right-radius: 4px;
}

.role-assistant .bubble {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
}

.bubble-user-text {
  white-space: pre-wrap;
  font-size: 0.9rem;
}

/* ── 图片网格 ───────────────────────────────────── */

.bubble-images {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
}

.layout-1 {
  /* 让网格单元格宽度跟随图片实际渲染宽度，避免竖图时 cell 留出空白（露出深色背景） */
  grid-template-columns: max-content;
}
.layout-1 .bubble-image {
  max-width: 240px;
  max-height: 240px;
  width: auto;
  height: auto;
}

.layout-2 {
  grid-template-columns: repeat(2, 180px);
}
.layout-2 .bubble-image {
  width: 180px;
  height: 135px;
}

.layout-grid {
  grid-template-columns: repeat(3, 120px);
}
.layout-grid .bubble-image {
  width: 120px;
  height: 90px;
}

.bubble-image-cell {
  position: relative;
  cursor: zoom-in;
  border-radius: 8px;
  overflow: hidden;
  line-height: 0;
}

.bubble-image {
  object-fit: cover;
  display: block;
  transition: transform var(--transition);
}
.bubble-image-cell:hover .bubble-image {
  transform: scale(1.03);
}

/* "+N" 遮罩（最后一格） */
.bubble-image-overflow {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.58);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: 600;
  pointer-events: none;
}

/* 重发按钮：仅 hover 时显现 */
.bubble-image-resend {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  transition: opacity var(--transition), background var(--transition);
}
.bubble-image-cell:hover .bubble-image-resend {
  opacity: 1;
}
.bubble-image-resend:hover {
  background: rgba(0, 0, 0, 0.8);
}
</style>
