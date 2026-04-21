<template>
  <div class="mode-average">
    <div class="field-row">
      <label class="field-label">每</label>
      <input
        class="num-input"
        type="number"
        min="1"
        :max="pageCount"
        v-model.number="averageN"
        @input="clampN"
      />
      <label class="field-label">页拆分为一份</label>
    </div>
    <p class="hint" v-if="pageCount > 0">
      共 {{ averageSegments.length }} 份
    </p>
  </div>
</template>

<script setup lang="ts">
import { averageN, averageSegments } from '../composables/useSplitAverage';
import { pageCount } from '../composables/usePdfLoad';

function clampN(): void {
  const total = pageCount.value;
  if (averageN.value < 1) averageN.value = 1;
  if (total > 0 && averageN.value > total) averageN.value = total;
}
</script>

<style scoped>
.mode-average {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-label {
  font-size: 0.85rem;
  color: #e8e8f2;
  white-space: nowrap;
}

.num-input {
  width: 64px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid #1e1e30;
  background: #0d0d14;
  color: #e8e8f2;
  font-size: 0.85rem;
  text-align: center;
  outline: none;
}

.num-input:focus {
  border-color: #6c5ce7;
}

.hint {
  font-size: 0.78rem;
  color: #8888a8;
}
</style>
