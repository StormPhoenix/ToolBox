<template>
  <div
    class="bubble-row"
    :class="[
      `role-${message.role}`,
      {
        'selection-mode': selectionMode,
        selected: selected,
        selectable: selectionMode,
        editing: isEditing,
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

    <div class="bubble-row-body">
      <div class="bubble-line">
        <!-- ─── 编辑态：就地替换气泡内容 ─── -->
        <div v-if="isEditing" class="bubble bubble-edit">
          <!-- 只读图片缩略图（原消息中的 image_ref） -->
          <div v-if="editImageRefs.length > 0" class="edit-images">
            <div
              v-for="(img, i) in editImageRefs"
              :key="i"
              class="edit-image-cell"
              :title="img.fileName"
            >
              <img
                :src="`toolbox-img:///${img.hash}.${extOf(img.mediaType)}`"
                class="edit-image-thumb"
                alt=""
                draggable="false"
              />
            </div>
            <div class="edit-images-hint">原图将一并重发</div>
          </div>
          <textarea
            ref="editTextareaRef"
            v-model="editText"
            class="edit-textarea"
            rows="1"
            @keydown="onEditKeydown"
            @input="autoResizeEdit"
          />
          <div class="edit-actions">
            <button
              class="edit-btn edit-cancel"
              type="button"
              @click.stop="cancelEdit"
            >
              取消
            </button>
            <button
              class="edit-btn edit-submit"
              type="button"
              :disabled="!canSubmitEdit"
              @click.stop="submitEditAction"
            >
              发送
            </button>
          </div>
        </div>

        <!-- ─── 普通态 ─── -->
        <div v-else ref="bubbleRef" class="bubble" :class="{ 'bubble-fallback': isFallback }">
          <div v-if="isFallback" class="bubble-fallback-badge" title="模型未生成回复，由系统填充的占位文本">
            占位回复
          </div>
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
              <div v-if="i === 8 && overflow > 0" class="bubble-image-overflow">
                +{{ overflow }}
              </div>
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

          <MarkdownView
            v-if="message.role === 'assistant'"
            ref="markdownRef"
            :text="textContent"
          />
          <div v-else-if="textContent" class="bubble-user-text">{{ textContent }}</div>
        </div>
      </div>

      <!-- 工具栏行：编辑态下隐藏 -->
      <BubbleToolbar
        v-if="showToolbarSlot && !isEditing"
        class="bubble-toolbar-slot"
        :class="{ 'toolbar-locked': selectionMode }"
        :message="message"
        :role="message.role"
        :text-content="textContent"
        :html-provider="htmlProvider"
        @enter-selection="$emit('enter-selection', message.id)"
        @regenerate="$emit('regenerate', message.id)"
        @enter-editing="$emit('enter-editing', message.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import type { ChatMessage, LLMImageRefBlock } from '@toolbox/bridge';
import MarkdownView from './MarkdownView.vue';
import BubbleToolbar from './BubbleToolbar.vue';
import type { LightboxItem } from './ImageLightbox.vue';

const props = defineProps<{
  message: ChatMessage;
  selectionMode?: boolean;
  selected?: boolean;
  /** 当前正在编辑的消息 id（全局唯一，由 useChat 管理） */
  editingMessageId?: string | null;
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
  'regenerate': [id: string];
  'enter-editing': [id: string];
  'cancel-editing': [];
  'submit-edit': [payload: {
    targetMessageId: string;
    newText: string;
    imageRefs: LLMImageRefBlock[];
  }];
}>();

// ── 编辑态 ──────────────────────────────────────────────

const isEditing = computed(
  () => props.editingMessageId === props.message.id && props.message.role === 'user'
);

const editText = ref('');
const editTextareaRef = ref<HTMLTextAreaElement | null>(null);

/** 从原消息 content 中提取 image_ref 块（编辑时原样保留） */
const editImageRefs = computed((): LLMImageRefBlock[] => {
  if (!isEditing.value) return [];
  const c = props.message.content;
  if (typeof c === 'string') return [];
  return c.filter(
    (b): b is LLMImageRefBlock =>
      typeof b === 'object' && b !== null && (b as { type: string }).type === 'image_ref'
  );
});

const canSubmitEdit = computed(
  () => editText.value.trim().length > 0 || editImageRefs.value.length > 0
);

// 进入编辑态时初始化 editText + 自动 focus
watch(isEditing, (editing) => {
  if (editing) {
    editText.value = textContent.value;
    void nextTick(() => {
      const el = editTextareaRef.value;
      if (el) {
        autoResizeEdit();
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }
});

function autoResizeEdit(): void {
  const el = editTextareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 300) + 'px';
}

function onEditKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submitEditAction();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
}

function cancelEdit(): void {
  emit('cancel-editing');
}

function submitEditAction(): void {
  if (!canSubmitEdit.value) return;
  emit('submit-edit', {
    targetMessageId: props.message.id,
    newText: editText.value.trim(),
    imageRefs: editImageRefs.value,
  });
}

// ── 兜底占位标记 ─────────────────────────────────────────

const isFallback = computed(
  () => props.message.role === 'assistant' && props.message.fallback === true
);

// ── 内容解析 ─────────────────────────────────────────────

const textContent = computed((): string => {
  const c = props.message.content;
  if (typeof c === 'string') return c;
  return c
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
});

interface ImageItem {
  src: string;
  ref: LLMImageRefBlock | null;
  fileName: string;
  fallbackBase64?: string;
  fallbackMediaType?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

function extOf(mt: string): string {
  switch (mt) {
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'png';
  }
}

const imageItems = computed((): ImageItem[] => {
  const c = props.message.content;
  if (typeof c === 'string') return [];
  const out: ImageItem[] = [];
  for (const b of c) {
    if (typeof b === 'object' && b !== null && (b as { type: string }).type === 'image_ref') {
      const ref = b as LLMImageRefBlock;
      out.push({ src: `toolbox-img:///${ref.hash}.${extOf(ref.mediaType)}`, ref, fileName: ref.fileName });
    } else if (typeof b === 'object' && b !== null && (b as { type: string }).type === 'image') {
      const img = b as { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
      out.push({
        src: `data:${img.source.media_type};base64,${img.source.data}`,
        ref: null, fileName: 'image',
        fallbackBase64: img.source.data,
        fallbackMediaType: img.source.media_type as ImageItem['fallbackMediaType'],
      });
    }
  }
  return out;
});

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
    src: it.src, cachePath: it.ref?.cachePath, fileName: it.fileName,
    fallbackBase64: it.fallbackBase64, fallbackMediaType: it.fallbackMediaType,
  }));
  emit('open-lightbox', { items, index });
}

function onImageCellClick(index: number, e: MouseEvent): void {
  if (props.selectionMode) { e.stopPropagation(); emit('toggle-select', props.message.id); return; }
  openLightbox(index);
}

function onRowClick(): void {
  if (!props.selectionMode) return;
  if (props.message.id.startsWith('pending-')) return;
  emit('toggle-select', props.message.id);
}

function resend(ref: LLMImageRefBlock): void {
  emit('resend-image', { cachePath: ref.cachePath, hash: ref.hash, mediaType: ref.mediaType, fileName: ref.fileName });
}

// ── hover 工具栏 ─────────────────────────────────────────

const bubbleRef = ref<HTMLElement | null>(null);
const markdownRef = ref<InstanceType<typeof MarkdownView> | null>(null);

const showToolbarSlot = computed(() => {
  if (props.message.id.startsWith('pending-')) return false;
  return true;
});

function htmlProvider(): string | null {
  if (props.message.role !== 'assistant') return null;
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

.bubble-row-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.bubble-line {
  display: flex;
  width: 100%;
}
.role-user .bubble-line { justify-content: flex-end; }
.role-assistant .bubble-line { justify-content: flex-start; }

/* ── 选择态 ─────────────────────────────────── */
.bubble-row.selectable { cursor: pointer; }
.bubble-row.selectable:hover { background: rgba(108, 92, 231, 0.06); }
.bubble-row.selected { background: rgba(108, 92, 231, 0.14); }

.bubble-checkbox {
  flex: 0 0 28px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12px;
}
.checkbox-box {
  width: 16px; height: 16px; border-radius: 4px;
  border: 1.5px solid var(--border-active, #555);
  background: var(--bg-base);
  display: flex; align-items: center; justify-content: center;
  transition: background var(--transition), border-color var(--transition);
}
.checkbox-box.checked { background: var(--accent); border-color: var(--accent); }
.checkbox-tick { color: #fff; font-size: 0.68rem; line-height: 1; font-weight: 700; }

/* ── 气泡 ─────────────────────────────────── */
.bubble {
  max-width: min(760px, 88%);
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.6;
  word-break: break-word;
  min-width: 0;
}
.role-user .bubble { background: var(--accent); color: #fff; border-top-right-radius: 4px; }
.role-assistant .bubble { background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border); border-top-left-radius: 4px; }
.bubble-row.selected .bubble { box-shadow: 0 0 0 2px var(--accent); }
.bubble-user-text { white-space: pre-wrap; font-size: 0.9rem; }

/* ── 编辑态气泡 ─────────────────────────────── */
.bubble-edit {
  background: var(--bg-card) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-active, var(--accent)) !important;
  border-radius: 12px !important;
  max-width: min(760px, 88%);
  padding: 10px 14px;
}

.edit-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}
.edit-image-cell {
  width: 56px; height: 42px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.edit-image-thumb {
  width: 100%; height: 100%;
  object-fit: cover; display: block;
}
.edit-images-hint {
  font-size: 0.7rem;
  color: var(--text-dim);
}

.edit-textarea {
  width: 100%;
  resize: none;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.5;
  padding: 8px 10px;
  max-height: 300px;
  outline: none;
  transition: border-color var(--transition);
}
.edit-textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow, rgba(108, 92, 231, 0.2));
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.edit-btn {
  padding: 5px 14px;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
  border: none;
  transition: background var(--transition), color var(--transition);
}
.edit-cancel {
  background: transparent;
  color: var(--text-secondary);
}
.edit-cancel:hover { background: var(--bg-card-hover); color: var(--text-primary); }
.edit-submit {
  background: var(--accent);
  color: #fff;
}
.edit-submit:hover:not(:disabled) { background: var(--accent-light); }
.edit-submit:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── 图片网格 ───────────────────────────────────── */
.bubble-images { display: grid; gap: 4px; margin-bottom: 8px; }
.layout-1 { grid-template-columns: max-content; }
.layout-1 .bubble-image { max-width: 240px; max-height: 240px; width: auto; height: auto; }
.layout-2 { grid-template-columns: repeat(2, 180px); }
.layout-2 .bubble-image { width: 180px; height: 135px; }
.layout-grid { grid-template-columns: repeat(3, 120px); }
.layout-grid .bubble-image { width: 120px; height: 90px; }
.bubble-image-cell { position: relative; cursor: zoom-in; border-radius: 8px; overflow: hidden; line-height: 0; }
.bubble-row.selectable .bubble-image-cell { cursor: pointer; }
.bubble-image { object-fit: cover; display: block; transition: transform var(--transition); }
.bubble-image-cell:hover .bubble-image { transform: scale(1.03); }
.bubble-image-overflow { position: absolute; inset: 0; background: rgba(0,0,0,.58); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; font-weight: 600; pointer-events: none; }
.bubble-image-resend { position: absolute; bottom: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; border: none; cursor: pointer; font-size: .82rem; line-height: 1; display: flex; align-items: center; justify-content: center; padding: 0; opacity: 0; transition: opacity var(--transition), background var(--transition); }
.bubble-image-cell:hover .bubble-image-resend { opacity: 1; }
.bubble-image-resend:hover { background: rgba(0,0,0,.8); }

/* ── hover 工具栏 ─────────────────────────────── */
.bubble-row:hover .bubble-toolbar-slot:not(.toolbar-locked) { opacity: 1; pointer-events: auto; }

/* ── 兜底占位气泡（assistant 端 fallback=true） ─────── */
.bubble.bubble-fallback {
  background: var(--bg-base);
  border-style: dashed;
  border-color: var(--border);
  color: var(--text-secondary);
  position: relative;
}
.bubble.bubble-fallback :deep(p),
.bubble.bubble-fallback :deep(li) {
  color: var(--text-secondary);
}
.bubble-fallback-badge {
  display: inline-block;
  font-size: 0.68rem;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim);
  margin-bottom: 8px;
  letter-spacing: 0.02em;
  user-select: none;
}
</style>
