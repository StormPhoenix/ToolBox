import { computed, ref } from 'vue';
import { pageCount } from './usePdfLoad';
import type { SplitSegment } from './useSplitCustom';

export const averageN = ref(1);

/** 平均拆分生成的分段列表 */
export const averageSegments = computed<SplitSegment[]>(() => {
  const total = pageCount.value;
  const n = Math.max(1, Math.floor(averageN.value));
  if (total === 0 || n === 0) return [];

  const segments: SplitSegment[] = [];
  let start = 1;
  while (start <= total) {
    const end = Math.min(start + n - 1, total);
    segments.push({ start, end, customName: '' });
    start = end + 1;
  }
  return segments;
});
