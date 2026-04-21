<template>
  <div class="mode-custom">

    <div class="segments-list" v-if="customSegments.length > 0">
      <RangeItem
        v-for="(seg, i) in customSegments"
        :key="i"
        :index="i"
        :segment="seg"
        :pageCount="pageCount"
        @remove="removeSegment(i)"
      />
    </div>

    <p class="empty-hint" v-else>暂无范围，请添加或从缩略图选中页面后提取</p>

    <button class="btn-add" @click="addEmpty">＋ 添加范围</button>

  </div>
</template>

<script setup lang="ts">
import { customSegments, addSegment, removeSegment } from '../composables/useSplitCustom';
import { pageCount } from '../composables/usePdfLoad';
import RangeItem from './RangeItem.vue';

function addEmpty(): void {
  const total = pageCount.value;
  addSegment(1, Math.max(1, total));
}
</script>

<style scoped>
.mode-custom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.segments-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.empty-hint {
  font-size: 0.78rem;
  color: #555570;
  text-align: center;
  padding: 12px 0;
}

.btn-add {
  align-self: flex-start;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px dashed #3a3a58;
  background: transparent;
  color: #8888a8;
  font-size: 0.8rem;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-add:hover {
  border-color: #6c5ce7;
  color: #a29bfe;
}
</style>
