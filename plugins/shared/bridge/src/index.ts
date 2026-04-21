/**
 * @toolbox/bridge
 *
 * 为插件提供 electronAPI 访问入口。
 * 插件运行在独立 BrowserWindow 中，preload.js 已注入 window.electronAPI，
 * 此模块直接将其导出，插件无需感知 Electron 细节。
 *
 * 使用方式：
 *   import { electronAPI } from '@toolbox/bridge';
 *   const info = await electronAPI.getAppInfo();
 */

import type { ElectronAPI } from './types';

export type { ElectronAPI } from './types';
export type {
  AppInfo,
  DirEntry,
  FileFilter,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from './types';

export { createLogger } from './logger';
export type { Logger } from './logger';

import { _setElectronAPI } from './logger';

// ── electronAPI 直接代理 window.electronAPI ───────────────────────────────
//
// 插件窗口由主进程以独立 BrowserWindow 创建，使用与 Shell 相同的 preload.js，
// 因此 window.electronAPI 已由 contextBridge 注入，可直接使用。
// 使用 Proxy 实现懒访问：模块加载时 window.electronAPI 可能尚未就绪，
// 实际调用时（DOMContentLoaded 后）已完成注入。

export const electronAPI: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop: string) {
    const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
    if (!api) {
      throw new Error(
        `[toolbox/bridge] window.electronAPI 未就绪（属性：${prop}）。` +
        '请确保插件由主进程以独立 BrowserWindow 打开，且使用了正确的 preload.js。'
      );
    }
    const value = (api as unknown as Record<string, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(api);
    }
    return value;
  },
});

// 将 electronAPI 注入到 logger 模块（解除循环依赖）
_setElectronAPI(electronAPI);
