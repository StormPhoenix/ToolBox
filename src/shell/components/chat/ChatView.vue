<template>
  <div
    class="chat-view"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <SessionList
      :sessions="sessions"
      :active-id="activeSession?.id ?? null"
      @new="handleNew"
      @select="handleSelect"
      @delete="handleDelete"
      @rename="handleRename"
    />

    <div class="chat-main">
      <ChatHeader
        :session="activeSession"
        :provider-label="providerLabel"
        :model-name="modelName"
        :available="llmAvailable"
        @clear-context="clearContext"
        @open-settings="$emit('open-settings')"
      />

      <!-- LLM 未配置：空态 + CTA -->
      <div v-if="!llmAvailable" class="unconfigured">
        <div class="unconfigured-icon">🔑</div>
        <div class="unconfigured-title">LLM 尚未配置</div>
        <div class="unconfigured-hint">
          请先在设置中填写 API Key 和模型名称
        </div>
        <button class="cta-btn" type="button" @click="$emit('open-settings')">
          去设置
        </button>
      </div>

      <!-- 未选中会话 -->
      <div v-else-if="!activeSession" class="no-session">
        <div class="no-session-icon">💬</div>
        <div class="no-session-title">开启新对话</div>
        <div class="no-session-hint">点击左侧"＋ 新会话"开始</div>
        <button class="cta-btn" type="button" @click="handleNew">
          ＋ 新会话
        </button>
      </div>

      <!-- 正常对话区 -->
      <template v-else>
        <MessageList
          :messages="messages"
          :streaming-text="streamingText"
          :is-streaming="isStreaming"
          :error-message="lastError"
          @dismiss-error="dismissError"
          @resend-image="onResendImage"
          @open-lightbox="onOpenLightbox"
        />
        <Composer
          ref="composerRef"
          :is-streaming="isStreaming"
          :disabled="!llmAvailable"
          @submit="onSubmit"
          @abort="abort"
        />
      </template>
    </div>

    <!-- 拖拽遮罩 -->
    <div
      v-if="isDragging && activeSession && llmAvailable"
      class="drop-overlay"
    >
      <div class="drop-overlay-inner">
        <div class="drop-icon">📥</div>
        <div class="drop-title">释放鼠标以添加图片</div>
        <div class="drop-hint">支持 JPG / PNG / GIF / WEBP · 单张 ≤ 10MB</div>
      </div>
    </div>

    <!-- 图片 Lightbox -->
    <ImageLightbox
      v-if="lightboxState"
      :items="lightboxState.items"
      :start-index="lightboxState.startIndex"
      @close="lightboxState = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { ChatAttachmentInput, LLMConfigPublic } from '@toolbox/bridge';
import SessionList from './SessionList.vue';
import ChatHeader from './ChatHeader.vue';
import MessageList from './MessageList.vue';
import Composer from './Composer.vue';
import ImageLightbox, { type LightboxItem } from './ImageLightbox.vue';
import { useChat } from '../../composables/useChat';

defineEmits<{
  'open-settings': [];
}>();

const {
  sessions,
  activeSession,
  messages,
  streamingText,
  isStreaming,
  lastError,
  refreshSessions,
  selectSession,
  createSession,
  deleteSession,
  renameSession,
  clearContext,
  sendMessage,
  abort,
  dismissError,
} = useChat();

// ── LLM 配置状态 ─────────────────────────────────────────

const llmConfig = ref<LLMConfigPublic | null>(null);

const providerLabel = ref('');
const modelName = ref('');
const llmAvailable = ref(false);

async function reloadLLMConfig(): Promise<void> {
  try {
    const cfg = await window.electronAPI.getLLMConfig();
    llmConfig.value = cfg;
    llmAvailable.value = cfg.available;
    const p = cfg.provider;
    providerLabel.value =
      p === 'claude' ? 'Claude' : p === 'openai' ? 'OpenAI' : 'Gemini';
    modelName.value = cfg[p]?.model ?? '';
  } catch {
    llmAvailable.value = false;
  }
}

// ── 生命周期 ─────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([refreshSessions(), reloadLLMConfig()]);
  // 首次进入若有会话则默认选中第一个，否则保持未选中状态（提示用户创建）
  if (!activeSession.value && sessions.value.length > 0) {
    await selectSession(sessions.value[0].id);
  }
});

// 切回视图时重新拉取配置（用户可能刚改过设置）
watch(activeSession, () => {
  // no-op，仅用于响应式刷新
});

// ── 交互 ─────────────────────────────────────────────────

async function handleNew(): Promise<void> {
  await createSession();
}

async function handleSelect(id: string): Promise<void> {
  await selectSession(id);
}

async function handleDelete(id: string): Promise<void> {
  await deleteSession(id);
}

async function handleRename(id: string, title: string): Promise<void> {
  await renameSession(id, title);
}

async function onSubmit(payload: {
  text: string;
  attachments: ChatAttachmentInput[];
}): Promise<void> {
  // 每次发送前刷新一次配置（用户可能切了 provider）
  await reloadLLMConfig();
  if (!llmAvailable.value) return;
  await sendMessage(payload.text, payload.attachments);
}

// ── 拖拽上传 ─────────────────────────────────────────────

const isDragging = ref(false);
let dragCounter = 0;

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer?.types?.includes('Files');
}

function onDragEnter(e: DragEvent): void {
  if (!hasFiles(e)) return;
  dragCounter++;
  isDragging.value = true;
}

function onDragOver(e: DragEvent): void {
  if (hasFiles(e) && e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
}

function onDragLeave(): void {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) isDragging.value = false;
}

const composerRef = ref<InstanceType<typeof Composer> | null>(null);
const SUPPORTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function onDrop(e: DragEvent): Promise<void> {
  dragCounter = 0;
  isDragging.value = false;
  if (!activeSession.value || !llmAvailable.value) return;

  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
    SUPPORTED.includes(f.type)
  );
  if (files.length === 0) return;

  const atts: ChatAttachmentInput[] = [];
  for (const file of files) {
    try {
      const base64 = await readFileAsBase64(file);
      atts.push({
        name: file.name,
        mediaType: file.type as ChatAttachmentInput['mediaType'],
        base64,
      });
    } catch (err) {
      console.error('读取拖拽文件失败:', err);
    }
  }
  if (atts.length > 0) {
    composerRef.value?.addAttachments(atts);
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf('base64,');
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    reader.readAsDataURL(file);
  });
}

// ── "重新发送此图" 回调 ─────────────────────────────────

async function onResendImage(ref: {
  cachePath: string;
  hash: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  fileName: string;
}): Promise<void> {
  const att = await window.electronAPI.chatResendImageRef(ref);
  if (!att) {
    console.warn('chatResendImageRef 返回 null：缓存已丢失');
    return;
  }
  composerRef.value?.addAttachments([att]);
}

// ── Lightbox ─────────────────────────────────────────────

const lightboxState = ref<{
  items: LightboxItem[];
  startIndex: number;
} | null>(null);

function onOpenLightbox(params: { items: LightboxItem[]; index: number }): void {
  lightboxState.value = { items: params.items, startIndex: params.index };
}

defineExpose({ reloadLLMConfig });
</script>

<style scoped>
.chat-view {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-content);
}

/* 未配置态 & 未选中会话态 */
.unconfigured,
.no-session {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  text-align: center;
  color: var(--text-secondary);
}

.unconfigured-icon,
.no-session-icon {
  font-size: 3.2rem;
  opacity: 0.75;
  margin-bottom: 16px;
}

.unconfigured-title,
.no-session-title {
  font-size: 1.1rem;
  color: var(--text-primary);
  margin-bottom: 6px;
  font-weight: 600;
}

.unconfigured-hint,
.no-session-hint {
  color: var(--text-dim);
  font-size: 0.88rem;
  margin-bottom: 18px;
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

/* 拖拽遮罩 */
.drop-overlay {
  position: absolute;
  inset: 0;
  background: rgba(108, 92, 231, 0.18);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* 不拦截 drop 事件 */
  z-index: 20;
}

.drop-overlay-inner {
  padding: 28px 44px;
  background: var(--bg-card);
  border: 2px dashed var(--accent);
  border-radius: 16px;
  color: var(--text-primary);
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}

.drop-icon {
  font-size: 2.4rem;
  margin-bottom: 10px;
}

.drop-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 4px;
}

.drop-hint {
  font-size: 0.8rem;
  color: var(--text-dim);
}
</style>
