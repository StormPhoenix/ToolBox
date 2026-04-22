import { SharpResizeProvider } from './sharp-base';

/**
 * 双线性 ——
 * sharp 原生没有独立的 bilinear kernel，这里以 cubic 近似实现，
 * 在结果 warnings 中声明，便于用户知情。
 */
export class BilinearProvider extends SharpResizeProvider {
  constructor() {
    super(
      {
        id: 'bilinear',
        displayName: 'Bilinear（双线性）',
        description: '快速预览用；本实现以 cubic 近似',
        category: 'classical',
        supportsUpscale: true,
        supportsDownscale: true,
      },
      'cubic',
      'bilinear 当前以 cubic kernel 近似实现'
    );
  }
}
