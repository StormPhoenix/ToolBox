import { ref } from 'vue';
import { electronAPI } from '@toolbox/bridge';

export interface SourceImage {
  fileName: string;      // 不含扩展名
  bitmap: ImageBitmap;
  width: number;
  height: number;
  dataUrl: string;       // 用于 <img> 预览缩略图
}

export const sourceImage = ref<SourceImage | null>(null);

async function loadFromPath(filePath: string, fileName: string): Promise<void> {
  const base64 = await electronAPI.readFile(filePath, 'base64');
  const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mime =
    ext === 'png' ? 'image/png' :
    ext === 'webp' ? 'image/webp' :
    'image/jpeg';
  const dataUrl = `data:${mime};base64,${base64}`;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });

  const bitmap = await createImageBitmap(img);
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');

  sourceImage.value = {
    fileName: nameWithoutExt,
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    dataUrl,
  };
}

export async function importFromDialog(): Promise<void> {
  const result = await electronAPI.showOpenDialog({
    title: '选择图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const filePath = result.filePaths[0];
  const fileName = filePath.split(/[\\/]/).pop() ?? 'image.jpg';
  await loadFromPath(filePath, fileName);
}

export async function importFromDrop(event: DragEvent): Promise<void> {
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) return;
  const filePath = await electronAPI.getPathForFile(file);
  await loadFromPath(filePath, file.name);
}

export function clearImage(): void {
  sourceImage.value?.bitmap.close();
  sourceImage.value = null;
}
