<template>
  <div
    class="bubble-row"
    :class="[
      `role-${message.role}`,
      {
        'selection-mode': selectionMode,
        selected: selected,
        selectable: selectionMode,
      },
    ]"
    @click="onRowClick"
  >
    <!-- 选择模式下最左侧的 checkbox 列 -->
    <div v-if="selectionMode" class="bubble-checkbox" aria-hidden="true">
      <span class="checkbox-box" :class="{ checked: selected }">
        <span v-if="selected" class="checkbox-tick">✓</span>
      </span>
    </div>

    <div class="bubble-hover-zone">
      <div ref="bubbleRef" class="bubble">
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
            @click="onImageCellClick(i, $event)"
          >
            <img :src="item.src" class="bubble-image" alt="" draggable="false" />
            <!-- 最后一格：超出 9 张显示 +N -->
            <div v-if="i === 8 && overflow > 0" class="bubble-image-overflow">
              +{{ overflow }}
            </div>
            <!-- 重新发送按钮（仅非选择态 + image_ref 有 cachePath 时才显示） -->
            <button
              v-if="item.ref && !selectionMode"
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
        <MarkdownView
          v-if="message.role === 'assistant'"
          ref="markdownRef"
          :text="textContent"
        />
        <div v-else-if="textContent" class="bubble-user-text">{{ textContent }}</div>
      </div>

      <!-- hover 工具栏（选择态与流式气泡不显示；乐观 pending 消息也不显示） -->
      <BubbleToolbar
        v-if="showToolbar"
        class="bubble-toolbar-slot"
        :message="message"
        :role="message.role"
        :text-content="textContent"
        :html-provider="htmlProvider"
        @enter-selection="$emit('enter-selection', message.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChatMessage, LLMImageRefBlock } from '@toolbox/bridge';
import MarkdownView from './MarkdownView.vue';
import BubbleToolbar from './BubbleToolbar.vue';
import type { LightboxItem } from './ImageLightbox.vue';

const props = defineProps<{
  message: ChatMessage;
  /** 当前是否处于选择模式 */
  selectionMode?: boolean;
  /** 该条消息是否已被选中 */
  selected?: boolean;
}>();

const emit = defineEmits<{
  'open-lightbox': [params: { items: LightboxItem[]; index: number }];
  'resend-image': [ref: {
    cachePath: string;
    hash: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    fileName: string;
  }];
  'toggle-select': [id: string];
  'enter-selection': [id: string];
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

function onImageCellClick(index: number, e: MouseEvent): void {
  // 选择模式下，点击图片单元格 = 切换整行选中，不开 Lightbox
  if (props.selectionMode) {
    e.stopPropagation(); // 让 .bubble-row @click 接管
    emit('toggle-select', props.message.id);
    return;
  }
  openLightbox(index);
}

function onRowClick(): void {
  if (!props.selectionMode) return;
  // pending 乐观消息不允许选中（id 以 pending- 开头）
  if (props.message.id.startsWith('pending-')) return;
  emit('toggle-select', props.message.id);
}

function resend(ref: LLMImageRefBlock): void {
  emit('resend-image', {
    cachePath: ref.cachePath,
    hash: ref.hash,
    mediaType: ref.mediaType,
    fileName: ref.fileName,
  });
}

// ── hover 工具栏 ─────────────────────────────────────────

const bubbleRef = ref<HTMLElement | null>(null);
const markdownRef = ref<InstanceType<typeof MarkdownView> | null>(null);

/** 工具栏可见性：选择态 / pending 乐观消息 → 隐藏 */
const showToolbar = computed(() => {
  if (props.selectionMode) return false;
  if (props.message.id.startsWith('pending-')) return false;
  return true;
});

/**
 * 为剪贴板 text/html 分支提供 assistant 渲染后的 HTML；
 * user 气泡传 null，让工具栏退化为 <p> 包裹纯文本。
 */
function htmlProvider(): string | null {
  if (props.message.role !== 'assistant') return null;
  // MarkdownView 内部容器 .markdown-body
  const root = (markdownRef.value as unknown as { $el?: HTMLElement })?.$el;
  if (!root) return null;
  return root.innerHTML || null;
}
</script>

<style scoped>
.bubble-row {
  display: flex;
  width: 100%;
  margin: 6px 0;
  padding: 4px 4px;
  border-radius: 10px;
  transition: background var(--transition);
}

.role-user {
  justify-content: flex-end;
}

.role-assistant {
  justify-content: flex-start;
}

/* ── 选择态 ─────────────────────────────────── */
.bubble-row.selectable {
  cursor: pointer;
}
.bubble-row.selectable:hover {
  background: rgba(108, 92, 231, 0.06);
}
.bubble-row.selected {
  background: rgba(108, 92, 231, 0.14);
}

/* checkbox 列 */
.bubble-checkbox {
  flex: 0 0 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.checkbox-box {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid var(--border-active, #555);
  background: var(--bg-base);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition), border-color var(--transition);
}
.checkbox-box.checked {
  background: var(--accent);
  border-color: var(--accent);
}
.checkbox-tick {
  color: #fff;
  font-size: 0.68rem;
  line-height: 1;
  font-weight: 700;
}

/* ── hover zone：包裹气泡 + 工具栏，保证 hover 连续 ─────── */
.bubble-hover-zone {
  position: relative;
  display: inline-flex;
  max-width: min(760px, 88%);
}

.bubble {
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.6;
  word-break: break-word;
  flex: 1;
  min-width: 0;
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

/* 选中气泡：加一圈描边 */
.bubble-row.selected .bubble {
  box-shadow: 0 0 0 2px var(--accent);
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
.bubble-row.selectable .bubble-image-cell {
  cursor: pointer;
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

/* ── hover 工具栏：进入 hover-zone 时显现 ───────── */
.bubble-hover-zone:hover .bubble-toolbar-slot {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
</style>
