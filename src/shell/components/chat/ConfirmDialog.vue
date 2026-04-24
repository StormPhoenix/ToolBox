<template>
  <Teleport to="body">
    <div v-if="confirm" class="confirm-overlay" @click.self="onReject">
      <div class="confirm-dialog" role="dialog" aria-modal="true">
        <div class="confirm-header">
          <span class="confirm-icon">⚠️</span>
          <h3 class="confirm-title">需要你的确认</h3>
        </div>

        <div class="confirm-body">
          <div class="confirm-action">
            AI 想要执行：<strong>{{ confirm.toolDisplayName }}</strong>
          </div>
          <div v-if="confirm.confirmHint" class="confirm-hint">
            {{ confirm.confirmHint }}
          </div>
          <details class="confirm-params">
            <summary>查看参数</summary>
            <pre class="confirm-params-pre">{{ formatInput(confirm.toolInput) }}</pre>
          </details>
        </div>

        <div class="confirm-footer">
          <button class="btn btn-reject" @click="onReject">
            拒绝
          </button>
          <button class="btn btn-approve" @click="onApprove" ref="approveBtnRef">
            本次批准
          </button>
          <button class="btn btn-approve-all" @click="onApproveAll">
            全部批准
          </button>
          <button
            class="btn btn-trust"
            @click="onTrust"
            title="永久信任此工具，可在设置 → 技能扩展中撤销"
          >
            永久信任
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

const props = defineProps<{
  confirm: {
    confirmId: string;
    toolName: string;
    toolDisplayName: string;
    toolInput: unknown;
    confirmHint?: string;
  } | null;
}>();

const emit = defineEmits<{
  (
    e: 'respond',
    decision: 'approved' | 'approved-all' | 'trusted' | 'rejected'
  ): void;
}>();

const approveBtnRef = ref<HTMLButtonElement | null>(null);

function onApprove() {
  emit('respond', 'approved');
}
function onApproveAll() {
  emit('respond', 'approved-all');
}
function onTrust() {
  emit('respond', 'trusted');
}
function onReject() {
  emit('respond', 'rejected');
}

function formatInput(input: unknown): string {
  if (input === null || input === undefined) return '(无参数)';
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

// 弹窗出现时自动聚焦"本次批准"按钮（默认操作）
watch(
  () => props.confirm,
  async (next) => {
    if (next) {
      await nextTick();
      approveBtnRef.value?.focus();
    }
  }
);
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadein 0.15s ease;
}

@keyframes fadein {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.confirm-dialog {
  width: min(520px, calc(100vw - 48px));
  background: var(--bg-card, #222);
  color: var(--text-primary, #eee);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  animation: slideup 0.2s ease;
}

@keyframes slideup {
  from {
    transform: translateY(10px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border, #333);
}

.confirm-icon {
  font-size: 1.3rem;
}

.confirm-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary, #eee);
}

.confirm-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.confirm-action {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-primary, #eee);
}

.confirm-action strong {
  color: var(--accent-light, #6aa);
}

.confirm-hint {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-secondary, #aaa);
  padding: 8px 10px;
  background: var(--bg-content, rgba(255, 255, 255, 0.03));
  border-radius: 6px;
  border-left: 3px solid var(--accent, #4a9eff);
  word-break: break-all;
}

.confirm-params {
  font-size: 0.8125rem;
}

.confirm-params summary {
  cursor: pointer;
  color: var(--text-secondary, #aaa);
  user-select: none;
  padding: 4px 0;
}

.confirm-params summary:hover {
  color: var(--text-primary, #eee);
}

.confirm-params-pre {
  margin: 6px 0 0;
  padding: 10px 12px;
  background: var(--bg-code, rgba(0, 0, 0, 0.3));
  border-radius: 6px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 0.8125rem;
  color: var(--text-secondary, #aaa);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.confirm-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border, #333);
}

.btn {
  padding: 7px 16px;
  border-radius: 6px;
  border: 1px solid var(--border, #333);
  background: var(--bg-content, transparent);
  color: var(--text-secondary, #aaa);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover {
  background: var(--bg-card-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, #eee);
}

.btn-reject {
  color: var(--text-dim, #888);
}

.btn-approve {
  background: var(--accent, #4a9eff);
  border-color: var(--accent, #4a9eff);
  color: #fff;
  font-weight: 600;
}

.btn-approve:hover {
  background: var(--accent-light, #6ab);
  border-color: var(--accent-light, #6ab);
  color: #fff;
}

.btn-approve-all,
.btn-trust {
  font-size: 0.8125rem;
}
</style>
