import { SharpResizeProvider } from './sharp-base';

/** 最近邻 —— 保留像素硬边缘，适合像素画 / 图标放大 */
export class NearestProvider extends SharpResizeProvider {
  constructor() {
    super(
      {
        id: 'nearest',
        displayName: 'Nearest Neighbor（最近邻）',
        description: '快速、保留像素硬边缘，适合像素画或图标',
        category: 'classical',
        supportsUpscale: true,
        supportsDownscale: true,
      },
      'nearest'
    );
  }
}
