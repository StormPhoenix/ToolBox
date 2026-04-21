import { ref } from 'vue';

export interface SplitSegment {
  start: number;
  end: number;
  /** 用户自定义文件名（不含 .pdf），为空则使用自动名 */
  customName: string;
}

export const customSegments = ref<SplitSegment[]>([]);

export function addSegment(start: number, end: number): void {
  customSegments.value.push({ start, end, customName: '' });
}

export function removeSegment(index: number): void {
  customSegments.value.splice(index, 1);
}

export function clearSegments(): void {
  customSegments.value = [];
}

/** 根据 fileBaseName 和 segment 计算最终输出文件名（含 .pdf） */
export function resolveFileName(fileBaseName: string, seg: SplitSegment): string {
  if (seg.customName.trim()) {
    const name = seg.customName.trim();
    return name.toLowerCase().endsWith('.pdf') ? name : name + '.pdf';
  }
  return `${fileBaseName}_part_${seg.start}-${seg.end}.pdf`;
}
