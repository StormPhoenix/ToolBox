<template>
  <div class="settings-page">
    <div class="settings-header">
      <h1 class="settings-title">设置</h1>
    </div>

    <div class="settings-body">
      <!-- LLM 配置区块 -->
      <section class="settings-section">
        <div class="section-header">
          <span class="section-icon">🤖</span>
          <div>
            <h2 class="section-title">LLM 配置</h2>
            <p class="section-desc">为插件提供 AI 能力，配置后插件可调用大语言模型。</p>
          </div>
        </div>

        <!-- Provider 选择 -->
        <div class="field-group">
          <label class="field-label">Provider</label>
          <div class="provider-tabs">
            <button
              v-for="p in PROVIDERS"
              :key="p.value"
              class="provider-tab"
              :class="{ active: form.provider === p.value }"
              @click="form.provider = p.value"
            >
              {{ p.label }}
            </button>
          </div>
        </div>

        <!-- 当前 Provider 配置 -->
        <template v-if="currentProviderConfig">
          <div class="field-group">
            <label class="field-label">
              API Key
              <span v-if="hasSavedKey" class="field-hint field-hint--ok">
                ✓ 已保存，留空沿用原 key
              </span>
            </label>
            <div class="input-row">
              <input
                class="field-input"
                :type="showKey ? 'text' : 'password'"
                v-model="currentProviderConfig.apiKey"
                :placeholder="keyPlaceholder"
                autocomplete="off"
                spellcheck="false"
              />
              <button class="icon-btn" @click="showKey = !showKey" :title="showKey ? '隐藏' : '显示'">
                {{ showKey ? '🙈' : '👁' }}
              </button>
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">模型名称</label>
            <input
              class="field-input"
              type="text"
              v-model="currentProviderConfig.model"
              :placeholder="modelPlaceholder"
              spellcheck="false"
            />
          </div>

          <div class="field-group">
            <label class="field-label">
              Base URL
              <span class="field-hint">（可选，留空使用默认官方地址）</span>
            </label>
            <input
              class="field-input"
              type="text"
              v-model="currentProviderConfig.baseURL"
              :placeholder="baseURLPlaceholder"
              spellcheck="false"
            />
          </div>
        </template>

        <!-- maxTokens -->
        <div class="field-group">
          <label class="field-label">
            Max Tokens
            <span class="field-hint">（单次请求最大输出 token 数，默认 4096）</span>
          </label>
          <input
            class="field-input field-input--narrow"
            type="number"
            v-model.number="form.maxTokens"
            min="256"
            max="65536"
            step="256"
          />
        </div>

        <!-- 操作按钮 -->
        <div class="action-row">
          <button
            class="btn btn--primary"
            :disabled="saving"
            @click="handleSave"
          >
            {{ saving ? '保存中…' : '保存配置' }}
          </button>
          <button
            class="btn btn--secondary"
            :disabled="testing || !canTest"
            @click="handleTest"
          >
            {{ testing ? '测试中…' : '测试连接' }}
          </button>
          <button
            class="btn btn--secondary"
            :disabled="testingImageGen || !canTest"
            @click="handleTestImageGen"
          >
            {{ testingImageGen ? '测试中…' : '测试图像生成' }}
          </button>
        </div>

        <!-- 测试结果 -->
        <Transition name="fade">
          <div v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'fail'">
            <span class="test-icon">{{ testResult.ok ? '✓' : '✕' }}</span>
            <span>{{ testResult.ok ? '连接成功，API Key 有效' : testResult.error }}</span>
          </div>
        </Transition>

        <!-- 图像生成测试结果 -->
        <Transition name="fade">
          <div v-if="imageGenResult" class="test-result" :class="imageGenResult.ok ? 'ok' : 'fail'">
            <span class="test-icon">{{ imageGenResult.ok ? '✓' : '✕' }}</span>
            <span>{{ imageGenResult.message }}</span>
          </div>
        </Transition>

        <!-- 保存成功提示 -->
        <Transition name="fade">
          <div v-if="saveSuccess" class="test-result ok">
            <span class="test-icon">✓</span>
            <span>配置已保存</span>
          </div>
        </Transition>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted } from 'vue';
import type { LLMProviderType, LLMConfigInput } from '@toolbox/bridge';

interface ProviderFormItem {
  apiKey: string;
  model: string;
  baseURL: string;
}

interface SettingsForm {
  provider: LLMProviderType;
  claude: ProviderFormItem;
  openai: ProviderFormItem;
  gemini: ProviderFormItem;
  maxTokens: number;
}

const PROVIDERS: Array<{ value: LLMProviderType; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
];

const PLACEHOLDERS: Record<LLMProviderType, { key: string; model: string; baseURL: string }> = {
  openai: {
    key: 'sk-...',
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
  },
  claude: {
    key: 'sk-ant-...',
    model: 'claude-sonnet-4-5',
    baseURL: 'https://api.anthropic.com',
  },
  gemini: {
    key: 'AIza...',
    model: 'gemini-2.0-flash',
    baseURL: '',
  },
};

// ── 状态 ──────────────────────────────────────────────────

const form = reactive<SettingsForm>({
  provider: 'openai',
  claude: { apiKey: '', model: '', baseURL: '' },
  openai: { apiKey: '', model: '', baseURL: '' },
  gemini: { apiKey: '', model: '', baseURL: '' },
  maxTokens: 4096,
});

const showKey = ref(false);
const saving = ref(false);
const saveSuccess = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; error?: string } | null>(null);
const testingImageGen = ref(false);
const imageGenResult = ref<{ ok: boolean; message: string } | null>(null);

/**
 * 各 provider 是否已有持久化的 apiKey。
 * 由 `getLLMConfig` 返回的 `hasApiKey` 字段填充；`handleSave` 成功后也会同步更新。
 * 前端据此判断：用户即使留空输入框，也可点击"测试连接"（后端沿用已存 key）。
 */
const savedKeyMap = reactive<Record<LLMProviderType, boolean>>({
  claude: false,
  openai: false,
  gemini: false,
});

// ── 计算属性 ──────────────────────────────────────────────

const currentProviderConfig = computed<ProviderFormItem>(() => form[form.provider]);

const hasSavedKey = computed(() => savedKeyMap[form.provider]);

const keyPlaceholder = computed(() =>
  hasSavedKey.value ? '（留空沿用已保存的 key）' : PLACEHOLDERS[form.provider].key
);
const modelPlaceholder = computed(() => PLACEHOLDERS[form.provider].model);
const baseURLPlaceholder = computed(() => PLACEHOLDERS[form.provider].baseURL || '（使用默认地址）');

const canTest = computed(() => {
  const cfg = form[form.provider];
  // 有已保存的 key，或输入框里填了新 key
  const hasKey = cfg.apiKey.trim() !== '' || savedKeyMap[form.provider];
  return hasKey && cfg.model.trim() !== '';
});

// provider 切换时重置测试结果
watch(() => form.provider, () => {
  testResult.value = null;
  imageGenResult.value = null;
  showKey.value = false;
});

// ── 生命周期 ──────────────────────────────────────────────

onMounted(async () => {
  try {
    const config = await window.electronAPI.getLLMConfig();
    form.provider = config.provider;
    if (config.maxTokens) form.maxTokens = config.maxTokens;
    // apiKey 已脱敏，只恢复 model 和 baseURL；hasApiKey 用于前端"免重输"判断
    if (config.claude) {
      form.claude.model = config.claude.model;
      form.claude.baseURL = config.claude.baseURL ?? '';
      savedKeyMap.claude = config.claude.hasApiKey;
    }
    if (config.openai) {
      form.openai.model = config.openai.model;
      form.openai.baseURL = config.openai.baseURL ?? '';
      savedKeyMap.openai = config.openai.hasApiKey;
    }
    if (config.gemini) {
      form.gemini.model = config.gemini.model;
      form.gemini.baseURL = config.gemini.baseURL ?? '';
      savedKeyMap.gemini = config.gemini.hasApiKey;
    }
  } catch {
    // 无配置，使用默认值
  }
});

// ── 操作 ──────────────────────────────────────────────────

async function handleSave(): Promise<void> {
  saving.value = true;
  saveSuccess.value = false;
  testResult.value = null;
  try {
    const input: LLMConfigInput = {
      provider: form.provider,
      maxTokens: form.maxTokens,
    };
    for (const key of ['claude', 'openai', 'gemini'] as const) {
      const cfg = form[key];
      input[key] = {
        apiKey: cfg.apiKey.trim() || undefined,
        model: cfg.model.trim() || undefined,
        baseURL: cfg.baseURL.trim() || undefined,
      };
    }
    await window.electronAPI.setLLMConfig(input);

    // 同步"已保存 key"状态：
    // 1. 本次提交了新 key 的 provider，标记为已保存
    // 2. 已保存过 key 的 provider 继续保留（后端会沿用原值）
    for (const key of ['claude', 'openai', 'gemini'] as const) {
      if (form[key].apiKey.trim() !== '') {
        savedKeyMap[key] = true;
      }
    }
    // 清空输入框中的真 key（避免用户来回切换看到明文/密文）
    for (const key of ['claude', 'openai', 'gemini'] as const) {
      form[key].apiKey = '';
    }
    showKey.value = false;

    saveSuccess.value = true;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
  } finally {
    saving.value = false;
  }
}

async function handleTest(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  imageGenResult.value = null;
  try {
    if (hasUnsavedChanges()) {
      await handleSave();
    }
    const result = await window.electronAPI.testLLMConnection();
    testResult.value = result;
  } finally {
    testing.value = false;
  }
}

async function handleTestImageGen(): Promise<void> {
  testingImageGen.value = true;
  imageGenResult.value = null;
  testResult.value = null;
  try {
    if (hasUnsavedChanges()) {
      await handleSave();
    }
    await window.electronAPI.llmGenerateImage({
      prompt: 'A small red circle on a white background',
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    });
    imageGenResult.value = { ok: true, message: '图像生成成功，当前 Provider 支持图像生成能力' };
  } catch (err) {
    const msg = (err as Error).message || '未知错误';
    imageGenResult.value = { ok: false, message: msg };
  } finally {
    testingImageGen.value = false;
  }
}

/** 表单是否相对已保存配置有改动（任一 provider 填了新 apiKey 即算改动） */
function hasUnsavedChanges(): boolean {
  for (const key of ['claude', 'openai', 'gemini'] as const) {
    if (form[key].apiKey.trim() !== '') return true;
  }
  return false;
}
</script>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.settings-header {
  padding: 24px 32px 0;
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
  flex-shrink: 0;
}

.settings-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

/* ── Section ── */
.settings-section {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 640px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.section-icon {
  font-size: 1.5rem;
  line-height: 1;
  margin-top: 2px;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.section-desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ── Field ── */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-hint {
  font-weight: 400;
  color: var(--text-dim);
}

.field-hint--ok {
  color: var(--success, #00b894);
  margin-left: 6px;
}

.field-input {
  width: 100%;
  background: var(--bg-content);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: border-color var(--transition);
  font-family: 'Menlo', 'Consolas', monospace;
}

.field-input:focus {
  border-color: var(--accent);
}

.field-input--narrow {
  width: 140px;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.input-row .field-input {
  flex: 1;
}

.icon-btn {
  background: var(--bg-content);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 9px 10px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-secondary);
  transition: background var(--transition), border-color var(--transition);
  flex-shrink: 0;
}

.icon-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--accent);
}

/* ── Provider Tabs ── */
.provider-tabs {
  display: flex;
  gap: 8px;
}

.provider-tab {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-content);
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}

.provider-tab:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.provider-tab.active {
  background: var(--bg-active);
  color: var(--accent-light);
  border-color: var(--border-active);
}

/* ── Buttons ── */
.action-row {
  display: flex;
  gap: 12px;
  padding-top: 4px;
}

.btn {
  padding: 9px 20px;
  border-radius: var(--radius-sm);
  border: none;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity var(--transition), background var(--transition);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--accent);
  color: #fff;
}

.btn--primary:not(:disabled):hover {
  background: var(--accent-light);
}

.btn--secondary {
  background: var(--bg-content);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.btn--secondary:not(:disabled):hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
  border-color: var(--accent);
}

/* ── Test Result ── */
.test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
}

.test-result.ok {
  background: rgba(0, 184, 148, 0.1);
  border: 1px solid rgba(0, 184, 148, 0.3);
  color: var(--success);
}

.test-result.fail {
  background: rgba(225, 112, 85, 0.1);
  border: 1px solid rgba(225, 112, 85, 0.3);
  color: var(--danger);
}

.test-icon {
  font-weight: 700;
  font-size: 0.9rem;
}

/* ── Transition ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
