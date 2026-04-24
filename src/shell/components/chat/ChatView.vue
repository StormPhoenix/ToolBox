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
          :session-id="activeSession.id"
          :messages="messages"
          :streaming-text="streamingText"
          :is-streaming="isStreaming"
          :error-message="lastError"
          :selection-mode="selectionMode"
          :is-selected="isSelected"
          :editing-message-id="editingMessageId"
          :tool-executing="toolExecuting"
          :tool-results="toolResults"
          @dismiss-error="dismissError"
          @resend-image="onResendImage"
          @open-lightbox="onOpenLightbox"
          @toggle-select="onToggleSelect"
          @enter-selection="onEnterSelection"
          @regenerate="onRegenerate"
          @enter-editing="onEnterEditing"
          @cancel-editing="onCancelEditing"
          @submit-edit="onSubmitEdit"
        />
        <!--
          Composer 在选择态下隐藏（v-show 而非 v-if，保活草稿与附件状态）
          SelectionToolbar 在选择态下占据其位置
        -->
        <Composer
          v-show="!selectionMode"
          ref="composerRef"
          :is-streaming="isStreaming"
          :disabled="!llmAvailable"
          @submit="onSubmit"
          @abort="abort"
        />
        <SelectionToolbar
          v-if="selectionMode"
          :selected-count="selectedCount"
          :total-selectable="totalSelectable"
          :exporting="exporting"
          @select-all="onSelectAll"
          @copy="onCopySelected"
          @export-file="onExportFile"
          @cancel="exitSelection"
        />
      </template>
    </div>

    <!-- 拖拽遮罩（选择态下忽略） -->
    <div
      v-if="isDragging && activeSession && llmAvailable && !selectionMode"
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

    <!-- 轻量 toast -->
    <transition name="toast">
      <div v-if="toast" class="toast" :class="`toast-${toast.kind}`">
        <span class="toast-text">{{ toast.text }}</span>
        <button
          v-if="toast.actionLabel"
          class="toast-action"
          type="button"
          @click="onToastAction"
        >
          {{ toast.actionLabel }}
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import type {
  ChatAttachmentInput,
  ChatMessage,
  LLMConfigPublic,
} from '@toolbox/bridge';
import SessionList from './SessionList.vue';
import ChatHeader from './ChatHeader.vue';
import MessageList from './MessageList.vue';
import Composer from './Composer.vue';
import SelectionToolbar from './SelectionToolbar.vue';
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
  // tool call state
  toolExecuting,
  toolResults,
  // selection
  selectionMode,
  selectedIds,
  selectedCount,
  refreshSessions,
  selectSession,
  createSession,
  deleteSession,
  renameSession,
  clearContext,
  sendMessage,
  abort,
  dismissError,
  enterSelection,
  exitSelection,
  toggleSelect,
  selectAll,
  isSelected,
  regenerateMessage,
  editingMessageId,
  enterEditing,
  exitEditing,
  submitEdit,
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
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  if (toastTimer) clearTimeout(toastTimer);
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
  if (selectionMode.value) return; // 选择态下忽略拖拽

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

// ── 多选交互 ─────────────────────────────────────────────

const totalSelectable = computed(
  () => messages.value.filter((m) => !m.id.startsWith('pending-')).length
);

function onEnterSelection(messageId: string): void {
  if (isStreaming.value) return;
  enterSelection(messageId);
}

function onRegenerate(messageId: string): void {
  void regenerateMessage(messageId);
}

function onEnterEditing(messageId: string): void {
  enterEditing(messageId);
}

function onCancelEditing(): void {
  exitEditing();
}

function onSubmitEdit(payload: {
  targetMessageId: string;
  newText: string;
  imageRefs: import('@toolbox/bridge').LLMImageRefBlock[];
}): void {
  void submitEdit(payload.targetMessageId, payload.newText, payload.imageRefs);
}

function onToggleSelect(id: string): void {
  toggleSelect(id);
}

function onSelectAll(): void {
  selectAll();
}

function onKeydown(e: KeyboardEvent): void {
  // Esc：选择态下退出
  if (e.key === 'Escape' && selectionMode.value) {
    e.preventDefault();
    exitSelection();
    return;
  }
  // ⌘/Ctrl+A：选择态下全选（避免与系统全选冲突）
  if (
    selectionMode.value &&
    (e.metaKey || e.ctrlKey) &&
    (e.key === 'a' || e.key === 'A')
  ) {
    // 若用户正在输入框里也会拦截；选择态下 Composer 已隐藏，基本不会触发
    e.preventDefault();
    selectAll();
  }
}

// ── 多选：复制到剪贴板 ─────────────────────────────────

async function onCopySelected(done: (ok: boolean) => void): Promise<void> {
  try {
    const selected = collectSelectedInOrder();
    if (selected.length === 0) return done(false);
    const markdown = buildMarkdownForClipboard(selected);
    const html = buildHtmlForClipboard(selected);

    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(markdown);
    }
    showToast('info', `已复制 ${selected.length} 条消息`);
    done(true);
  } catch (err) {
    console.error('copy selected failed:', err);
    showToast('error', '复制失败，请重试');
    done(false);
  }
}

/** 按时间顺序收集选中消息（排除 pending） */
function collectSelectedInOrder(): ChatMessage[] {
  const set = selectedIds.value;
  return messages.value.filter((m) => set.has(m.id) && !m.id.startsWith('pending-'));
}

function extractTextOf(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function imagePlaceholdersOf(msg: ChatMessage): string[] {
  if (typeof msg.content === 'string') return [];
  const out: string[] = [];
  for (const b of msg.content) {
    if (b && typeof b === 'object' && (b as { type: string }).type === 'image_ref') {
      const ref = b as {
        hash: string;
        mediaType: string;
        fileName: string;
      };
      const ext =
        ref.mediaType === 'image/jpeg'
          ? 'jpg'
          : ref.mediaType === 'image/gif'
            ? 'gif'
            : ref.mediaType === 'image/webp'
              ? 'webp'
              : 'png';
      out.push(`![${ref.fileName}](toolbox-img:///${ref.hash}.${ext})`);
    } else if (b && typeof b === 'object' && (b as { type: string }).type === 'image') {
      out.push(`![图片](pasted)`);
    }
  }
  return out;
}

function roleHeading(msg: ChatMessage): string {
  const who = msg.role === 'user' ? '🧑 你' : '🤖 助手';
  const d = new Date(msg.timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `### ${who} · ${ts}`;
}

/** 用户纯文本转 markdown 段落：段内硬换行两空格保留 */
function userTextToMd(text: string): string {
  if (!text.trim()) return '';
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return norm
    .split(/\n{2,}/)
    .map((p) => p.split('\n').join('  \n'))
    .join('\n\n');
}

function buildMarkdownForClipboard(list: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of list) {
    lines.push(roleHeading(msg));
    lines.push('');
    const imgs = imagePlaceholdersOf(msg);
    if (imgs.length > 0) {
      lines.push(imgs.join('\n\n'));
      lines.push('');
    }
    const body = extractTextOf(msg);
    if (body.trim()) {
      lines.push(msg.role === 'user' ? userTextToMd(body) : body);
      lines.push('');
    } else if (imgs.length === 0) {
      lines.push('（空消息）');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n').trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtmlForClipboard(list: ChatMessage[]): string {
  const parts: string[] = [];
  for (const msg of list) {
    parts.push(`<h3>${escapeHtml(roleHeading(msg).replace(/^###\s+/, ''))}</h3>`);
    const imgs = imagePlaceholdersOf(msg);
    for (const i of imgs) parts.push(`<p><em>${escapeHtml(i)}</em></p>`);
    const body = extractTextOf(msg);
    if (body.trim()) {
      if (msg.role === 'assistant') {
        // 粗略转义（保留换行），粘贴到富文本会得到基本结构；高保真由 text/plain 提供
        parts.push(
          `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(body)}</pre>`
        );
      } else {
        parts.push(
          body
            .replace(/\r\n/g, '\n')
            .split(/\n{2,}/)
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
            .join('')
        );
      }
    } else if (imgs.length === 0) {
      parts.push(`<p><em>（空消息）</em></p>`);
    }
    parts.push(`<hr>`);
  }
  return parts.join('');
}

// ── 多选：导出到文件 ───────────────────────────────────

const exporting = ref(false);

async function onExportFile(): Promise<void> {
  if (!activeSession.value) return;
  if (selectedCount.value === 0) return;

  const session = activeSession.value;
  const defaultStem = sanitizeStem(
    `${session.title || '对话导出'}_${timestampSlug()}`
  );

  const save = await window.electronAPI.showSaveDialog({
    title: '导出消息到 Markdown',
    defaultPath: `${defaultStem}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    buttonLabel: '导出',
  });
  if (save.canceled || !save.filePath) return;

  const orderedIds = collectSelectedInOrder().map((m) => m.id);
  if (orderedIds.length === 0) return;

  exporting.value = true;
  try {
    const result = await window.electronAPI.chatExportSelected({
      sessionId: session.id,
      messageIds: orderedIds,
      targetPath: save.filePath,
      includeMetadata: true,
    });

    showToast(
      'info',
      `已导出 ${result.messageCount} 条消息，${result.imageCount} 张图片` +
        (result.skippedImageCount > 0
          ? `（${result.skippedImageCount} 张缓存已丢失）`
          : ''),
      '打开文件夹',
      () => {
        void window.electronAPI.openInExplorer(result.dirPath);
      }
    );

    // 导出后自动退出选择态
    exitSelection();
  } catch (err) {
    console.error('export selected failed:', err);
    showToast('error', `导出失败：${(err as Error).message}`);
  } finally {
    exporting.value = false;
  }
}

function sanitizeStem(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/_{2,}/g, '_');
  return cleaned.slice(0, 80) || 'chat-export';
}

function timestampSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

// ── toast ──────────────────────────────────────────────

interface ToastState {
  kind: 'info' | 'error';
  text: string;
  actionLabel?: string;
  action?: () => void;
}
const toast = ref<ToastState | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(
  kind: 'info' | 'error',
  text: string,
  actionLabel?: string,
  action?: () => void
): void {
  toast.value = { kind, text, actionLabel, action };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, action ? 5000 : 2500);
}

function onToastAction(): void {
  toast.value?.action?.();
  toast.value = null;
  if (toastTimer) clearTimeout(toastTimer);
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

/* Toast */
.toast {
  position: absolute;
  bottom: 82px;
  left: 50%;
  transform: translateX(-50%);
  padding: 9px 16px;
  border-radius: 22px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 0.85rem;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 40;
  max-width: 560px;
}
.toast-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toast-error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}
.toast-action {
  background: transparent;
  border: 1px solid var(--border-active, var(--accent));
  color: var(--accent-light);
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 0.78rem;
  transition: background var(--transition), color var(--transition);
}
.toast-action:hover {
  background: var(--accent);
  color: #fff;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}
</style>
