import { SharpResizeProvider } from './sharp-base';

/** 双三次 —— 通用场景，放大效果优于 Lanczos */
export class BicubicProvider extends SharpResizeProvider {
  constructor() {
    super(
      {
        id: 'bicubic',
        displayName: 'Bicubic（双三次）',
        description: '通用照片缩放，放大时推荐',
        category: 'classical',
        supportsUpscale: true,
        supportsDownscale: true,
      },
      'cubic'
    );
  }
}
