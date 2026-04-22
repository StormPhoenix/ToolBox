<script setup lang="ts">
import { computed } from 'vue';
import type {
  ResizeAlgorithmId,
  ResizeOutputFormat,
  ResizeProviderInfo,
} from '@toolbox/bridge';

const props = defineProps<{
  providers: ResizeProviderInfo[];
  algorithm: ResizeAlgorithmId;
  maxLongEdge: number;
  outputFormat: ResizeOutputFormat;
  quality: number;
  /** 原图最大长边，用于判断放大/缩小 */
  originalLongEdge: number;
  /** 面板是否禁用（generating 时禁用） */
  disabled: boolean;
  /** 是否已导入图片 */
  hasImage: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:algorithm', v: ResizeAlgorithmId): void;
  (e: 'update:maxLongEdge', v: number): void;
  (e: 'update:outputFormat', v: ResizeOutputFormat): void;
  (e: 'update:quality', v: number): void;
  (e: 'generate'): void;
}>();

const isLossyFormat = computed(
  () => props.outputFormat === 'jpeg' || props.outputFormat === 'webp' || props.outputFormat === 'avif'
);

const isUpscale = computed(() => {
  if (!props.hasImage || !props.originalLongEdge) return false;
  return props.maxLongEdge > props.originalLongEdge;
});

// 分组展示：classical / ai
const classicalProviders = computed(() =>
  props.providers.filter((p) => p.category === 'classical')
);
const aiProviders = computed(() =>
  props.providers.filter((p) => p.category === 'ai')
);

function onSelectAlgorithm(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as ResizeAlgorithmId;
  emit('update:algorithm', v);
}

function onMaxEdgeInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) emit('update:maxLongEdge', n);
}

function onFormatChange(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as ResizeOutputFormat;
  emit('update:outputFormat', v);
}

function onQualityInput(e: Event): void {
  const n = parseInt((e.target as HTMLInputElement).value, 10);
  if (Number.isFinite(n)) emit('update:quality', n);
}

const currentProvider = computed(() =>
  props.providers.find((p) => p.id === props.algorithm)
);

const generateDisabled = computed(() => {
  if (props.disabled) return true;
  if (!props.hasImage) return true;
  if (!currentProvider.value?.available) return true;
  if (!props.maxLongEdge || props.maxLongEdge <= 0) return true;
  return false;
});
</script>

<template>
  <div class="card">
    <div class="card-title">调整参数</div>

    <div class="group">
      <label class="label">最大长边 (px)</label>
      <input
        type="number"
        min="1"
        :value="maxLongEdge"
        :disabled="disabled || !hasImage"
        @input="onMaxEdgeInput"
      />
      <div class="hint" v-if="hasImage">
        原图长边 {{ originalLongEdge }} px ·
        <span v-if="isUpscale" class="hint-up">本次为放大</span>
        <span v-else class="hint-down">本次为缩小</span>
      </div>
    </div>

    <div class="group">
      <label class="label">算法</label>
      <select :value="algorithm" :disabled="disabled" @change="onSelectAlgorithm">
        <optgroup label="经典算法">
          <option
            v-for="p in classicalProviders"
            :key="p.id"
            :value="p.id"
            :disabled="!p.available"
          >
            {{ p.displayName }}{{ p.available ? '' : ' (不可用)' }}
          </option>
        </optgroup>
        <optgroup v-if="aiProviders.length" label="AI 算法">
          <option
            v-for="p in aiProviders"
            :key="p.id"
            :value="p.id"
            :disabled="!p.available"
          >
            {{ p.displayName }}{{ p.available ? '' : ' (不可用)' }}
          </option>
        </optgroup>
      </select>
      <div v-if="currentProvider" class="hint">
        {{ currentProvider.description }}
      </div>
      <div v-if="isUpscale" class="hint hint-warn">
        检测到放大操作，推荐使用 Bicubic 或 LLM 超分
      </div>
    </div>

    <div class="group">
      <label class="label">输出格式</label>
      <select :value="outputFormat" :disabled="disabled" @change="onFormatChange">
        <option value="jpeg">JPEG</option>
        <option value="png">PNG</option>
        <option value="webp">WebP</option>
        <option value="avif">AVIF</option>
      </select>
    </div>

    <div v-if="isLossyFormat" class="group">
      <label class="label">
        质量
        <span class="quality-val">{{ quality }}</span>
      </label>
      <input
        type="range"
        min="1"
        max="100"
        :value="quality"
        :disabled="disabled"
        @input="onQualityInput"
      />
    </div>

    <button
      class="primary generate-btn"
      :disabled="generateDisabled"
      @click="$emit('generate')"
    >
      {{ disabled ? '处理中…' : '生成' }}
    </button>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-secondary);
}

.quality-val {
  color: var(--accent-light);
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
}

.hint {
  font-size: 11px;
  color: var(--text-dim);
}

.hint-up {
  color: var(--warning);
}

.hint-down {
  color: var(--text-secondary);
}

.hint-warn {
  color: var(--warning);
}

.generate-btn {
  padding: 10px;
  font-size: 14px;
  font-weight: 500;
  margin-top: 4px;
}
</style>
