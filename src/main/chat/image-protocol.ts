/**
 * 自定义协议 toolbox-img://
 *
 * 让渲染进程直接通过 <img src="toolbox-img://<hash>.<ext>"> 加载
 * userData/chat-images/ 下的缓存图，避免把历史图片 base64 全部注入 UI 内存。
 *
 * 安全：
 * - 只允许文件名匹配 CACHE_FILENAME_REGEX（md5 + 白名单扩展名）
 * - resolveCachedImagePath 内部再次校验 absolute.startsWith(imagesDir)
 * - 协议不可写、不可列表化（只响应单文件 GET）
 *
 * 注册时机：`app.whenReady()` 内，必须早于 mainWindow 创建
 * （否则首次加载图片会 404，需要刷新才恢复）。
 */
import { protocol, net } from 'electron';
import { pathToFileURL } from 'url';
import { resolveCachedImagePath } from './image-cache';
import { createLogger } from '../logger';

const log = createLogger('ImageProtocol');

const SCHEME = 'toolbox-img';

/**
 * 必须在 app.whenReady() 之前调用（注册 privileged scheme）
 * 否则协议无法被标记为 secure/standard，某些浏览器特性（如 fetch CORS）会报错。
 */
export function registerImageProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * 必须在 app.whenReady() 之后调用。
 * 注册 protocol handler 将 toolbox-img:///<filename> 映射到本地文件。
 *
 * URL 形式：
 *   toolbox-img:///<md5>.<ext>        ← 推荐（三斜杠，pathname 携带）
 *   toolbox-img://<md5>.<ext>         ← 兼容（旧形式，走 hostname）
 */
export function registerImageProtocolHandler(): void {
  protocol.handle(SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      // 优先从 pathname 取（三斜杠形式）；为空时回退 hostname（旧形式）
      const rawName = url.pathname.replace(/^\/+/, '') || url.hostname || '';
      const filename = decodeURIComponent(rawName).toLowerCase();

      const abs = resolveCachedImagePath(filename);
      if (!abs) {
        log.warn(
          `协议请求被拒（非法文件名）: url=${request.url}, filename=${filename}`
        );
        return new Response(null, { status: 400 });
      }
      return net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      log.warn(`协议 handler 异常: ${(err as Error).message}`);
      return new Response(null, { status: 500 });
    }
  });
  log.info(`自定义协议已注册: ${SCHEME}://`);
}

/** 供 UI 拼 URL 用（保持和 handler 一致） */
export function buildImageURL(hash: string, mediaType: string): string {
  const ext =
    mediaType === 'image/jpeg'
      ? 'jpg'
      : mediaType === 'image/gif'
        ? 'gif'
        : mediaType === 'image/webp'
          ? 'webp'
          : 'png';
  // 使用三斜杠形式：host 为空，文件名放 pathname，
  // 避免 Chromium 对 standard scheme 的 host 规范化问题。
  return `${SCHEME}:///${hash}.${ext}`;
}
