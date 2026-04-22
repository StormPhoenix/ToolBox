import { SharpResizeProvider } from './sharp-base';

/** Lanczos3 —— 高质量下采样默认算法 */
export class LanczosProvider extends SharpResizeProvider {
  constructor() {
    super(
      {
        id: 'lanczos',
        displayName: 'Lanczos3（推荐）',
        description: '高质量缩小照片的首选算法',
        category: 'classical',
        supportsUpscale: true,
        supportsDownscale: true,
      },
      'lanczos3'
    );
  }
}
