/**
 * Image Resize IPC Handlers
 *
 * 注册 4 个通道：
 *   image-resize:list-providers   列出算法
 *   image-resize:parse-metadata   解析元数据 + 生成略缩图，分配 sessionId
 *   image-resize:process          执行处理
 *   image-resize:save-as          另存为（复制临时文件到用户指定路径）
 *
 * 同时处理：
 *   - sessionId 与 webContents 的绑定：webview 销毁时清理对应 session
 *   - 启动时异步清理过期 session（>24h）
 */
import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  ParseMetadataResult,
  ResizeOptions,
  ResizeProviderInfo,
  ResizeResponse,
  SupportedInputExt,
} from './types';
import { SUPPORTED_INPUT_EXTENSIONS } from './types';
import { TempManager } from './temp-manager';
import { createDefaultRouter, ResizeRouter } from './router';
import { parseMetadata, generateThumbnail } from './metadata';
import { createLogger } from '../logger';

const log = createLogger('ImageResize-IPC');

// ─── 模块级单例 ────────────────────────────────────────────
let tempManager: TempManager | null = null;
let router: ResizeRouter | null = null;

/** sessionId → webContentsId 映射，用于 webContents 销毁时清理 */
const sessionOwners = new Map<string, number>();

function getTempManager(): TempManager {
  if (!tempManager) tempManager = new TempManager();
  return tempManager;
}

function getRouter(): ResizeRouter {
  if (!router) router = createDefaultRouter(getTempManager());
  return router;
}

function isSupportedExt(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return (SUPPORTED_INPUT_EXTENSIONS as readonly string[]).includes(ext);
}

// ─── IPC 注册 ──────────────────────────────────────────────

export function registerImageResizeHandlers(): void {
  // 启动后异步清理过期 session（失败不影响启动）
  app.whenReady().then(() => {
    getTempManager().cleanupStale().catch(() => {/* noop */});
  });

  // ── image-resize:list-providers ────────────────────────
  ipcMain.handle(
    'image-resize:list-providers',
    async (): Promise<ResizeProviderInfo[]> => {
      return getRouter().listProviders();
    }
  );

  // ── image-resize:parse-metadata ────────────────────────
  ipcMain.handle(
    'image-resize:parse-metadata',
    async (e, filePath: string): Promise<ParseMetadataResult> => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('无效的文件路径');
      }
      if (!isSupportedExt(filePath)) {
        const err = new Error(`不支持的图片格式: ${path.extname(filePath)}`);
        (err as Error & { code?: string }).code = 'UNSUPPORTED_FORMAT';
        throw err;
      }

      const tm = getTempManager();
      const sessionId = await tm.allocSession();

      // 绑定 session 到 webContents；webview 销毁时清理
      const wcId = e.sender.id;
      sessionOwners.set(sessionId, wcId);
      e.sender.once('destroyed', () => {
        // 清理该 webContents 拥有的所有 session
        for (const [sid, owner] of sessionOwners) {
          if (owner === wcId) {
            sessionOwners.delete(sid);
            tm.cleanupSession(sid).catch(() => {/* noop */});
          }
        }
      });

      const { basic, exif } = await parseMetadata(filePath);
      const thumbPath = await tm.allocThumbnailPath(sessionId, filePath);
      await generateThumbnail(filePath, thumbPath);

      log.info(
        `parse-metadata: ${basic.filename} ${basic.width}x${basic.height} ` +
          `session=${sessionId}`
      );

      return {
        sessionId,
        basic,
        exif,
        thumbnailPath: thumbPath,
      };
    }
  );

  // ── image-resize:process ───────────────────────────────
  ipcMain.handle(
    'image-resize:process',
    async (
      _e,
      inputPath: string,
      options: ResizeOptions,
      sessionId: string
    ): Promise<ResizeResponse> => {
      if (!inputPath || !sessionId) {
        return {
          ok: false,
          error: { code: 'UNKNOWN', message: '参数缺失' },
        };
      }
      if (!isSupportedExt(inputPath)) {
        return {
          ok: false,
          error: {
            code: 'UNSUPPORTED_FORMAT',
            message: `不支持的图片格式: ${path.extname(inputPath)}`,
          },
        };
      }
      // 简单的 options 校验
      const maxEdge = Number(options?.maxLongEdge);
      if (!Number.isFinite(maxEdge) || maxEdge < 1) {
        return {
          ok: false,
          error: { code: 'UNKNOWN', message: '最大长边必须为正整数' },
        };
      }

      return getRouter().process(inputPath, options, sessionId);
    }
  );

  // ── image-resize:save-as ───────────────────────────────
  ipcMain.handle(
    'image-resize:save-as',
    async (
      _e,
      tempPath: string,
      targetPath: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        if (!tempPath || !targetPath) {
          return { ok: false, error: '参数缺失' };
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.copyFile(tempPath, targetPath);
        log.info(`save-as: ${tempPath} -> ${targetPath}`);
        return { ok: true };
      } catch (err) {
        const msg = (err as Error).message || '保存失败';
        log.warn(`save-as failed: ${msg}`);
        return { ok: false, error: msg };
      }
    }
  );

  log.info('Image Resize IPC handlers 已注册');
}

// 防止 TS 把 SupportedInputExt 当作未使用（便于未来外部复用）
export type { SupportedInputExt };
