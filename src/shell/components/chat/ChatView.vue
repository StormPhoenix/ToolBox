<template>
  <div class="chat-view">
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
        />
        <Composer
          :is-streaming="isStreaming"
          :disabled="!llmAvailable"
          @submit="onSubmit"
          @abort="abort"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { ChatAttachmentInput, LLMConfigPublic } from '@toolbox/bridge';
import SessionList from './SessionList.vue';
import ChatHeader from './ChatHeader.vue';
import MessageList from './MessageList.vue';
import Composer from './Composer.vue';
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

defineExpose({ reloadLLMConfig });
</script>

<style scoped>
.chat-view {
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
</style>
