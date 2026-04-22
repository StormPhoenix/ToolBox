/**
 * Image Resize 临时文件生命周期管理
 *
 * 目录结构：
 *   <app.getPath('temp')>/toolbox-image-resize/
 *   ├── <sessionId>/
 *   │   ├── thumb-<hash>.jpg
 *   │   └── preview-<timestamp>.<ext>
 *
 * 清理规则：
 * - 窗口关闭时通过 cleanupSession(sessionId) 删除对应目录
 * - 应用启动时调用 cleanupStale() 清理 24 小时前的残留
 * - 保存（另存为）后不删除，保留到窗口关闭
 * - 同 session 内不限制文件数量（支持未来批量处理）
 */
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../logger';

const log = createLogger('ImageResize-Temp');

const ROOT_DIR_NAME = 'toolbox-image-resize';
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000; // 24h

export class TempManager {
  private readonly root: string;

  constructor() {
    this.root = path.join(app.getPath('temp'), ROOT_DIR_NAME);
  }

  /** 返回根目录路径（测试/调试用） */
  getRoot(): string {
    return this.root;
  }

  /** 分配一个新 session 目录，返回 sessionId */
  async allocSession(): Promise<string> {
    const sessionId = crypto.randomUUID();
    const dir = path.join(this.root, sessionId);
    await fs.mkdir(dir, { recursive: true });
    return sessionId;
  }

  /** 获取某 session 的目录绝对路径（目录可能不存在） */
  getSessionDir(sessionId: string): string {
    return path.join(this.root, sessionId);
  }

  /** 确保 session 目录存在（幂等） */
  async ensureSession(sessionId: string): Promise<string> {
    const dir = this.getSessionDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** 分配一个略缩图文件路径 */
  async allocThumbnailPath(sessionId: string, inputPath: string): Promise<string> {
    const dir = await this.ensureSession(sessionId);
    const hash = crypto
      .createHash('md5')
      .update(inputPath + ':' + Date.now())
      .digest('hex')
      .slice(0, 8);
    return path.join(dir, `thumb-${hash}.jpg`);
  }

  /** 分配一个预览输出文件路径 */
  async allocPreviewPath(sessionId: string, ext: string): Promise<string> {
    const dir = await this.ensureSession(sessionId);
    const ts = Date.now();
    const safeExt = ext.replace(/^\./, '').toLowerCase();
    return path.join(dir, `preview-${ts}.${safeExt}`);
  }

  /** 删除某 session 目录（窗口关闭时调用） */
  async cleanupSession(sessionId: string): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      log.info(`session 清理: ${sessionId}`);
    } catch (err) {
      log.warn(`session 清理失败 ${sessionId}: ${(err as Error).message}`);
    }
  }

  /**
   * 清理超过 maxAgeMs（默认 24h）未修改的 session 目录。
   * 应用启动时异步调用一次，失败不影响启动。
   */
  async cleanupStale(maxAgeMs: number = DEFAULT_STALE_MS): Promise<void> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      const now = Date.now();
      let removed = 0;
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = path.join(this.root, e.name);
        try {
          const stat = await fs.stat(dir);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.rm(dir, { recursive: true, force: true });
            removed++;
          }
        } catch {
          /* 忽略单目录失败 */
        }
      }
      if (removed > 0) {
        log.info(`启动清理：移除 ${removed} 个过期 session`);
      }
    } catch (err) {
      log.warn(`启动清理失败: ${(err as Error).message}`);
    }
  }
}
