/**
 * @toolbox/bridge
 *
 * 为插件 iframe 提供与 Shell 侧完全一致签名的 electronAPI 对象。
 * 内部通过 postMessage 将调用转发给父框架（ToolViewer.vue），
 * 由 Shell 代理调用真正的 window.electronAPI，再将结果回传。
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

// ── 内部桥接实现 ──────────────────────────────────────────────────────────

let _bridgeId = 0;

/** 生成全局唯一的请求 ID */
function nextId(): string {
  return `tb_${++_bridgeId}_${Date.now()}`;
}

/**
 * 通用桥接调用：将方法名和参数通过 postMessage 发给 Shell，等待回复。
 */
function callBridge<T>(method: string, args: unknown[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId();

    function onMessage(event: MessageEvent): void {
      const { __toolboxBridge, id: mid, result, error } = (event.data ?? {}) as Record<string, unknown>;
      if (!__toolboxBridge || mid !== id) return;
      window.removeEventListener('message', onMessage);
      if (error) reject(new Error(error as string));
      else resolve(result as T);
    }

    window.addEventListener('message', onMessage);

    window.parent.postMessage(
      { __toolboxBridge: true, id, method, args },
      '*'
    );

    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error(`[toolbox-bridge] timeout: ${method}`));
    }, 30_000);
  });
}

/**
 * 专用于 getPathForFile：File 对象不可经由普通序列化传递，
 * 直接挂在 postMessage data 的 file 字段上，Shell 侧读取后
 * 同步调用 webUtils.getPathForFile(file)。
 */
function callBridgeWithFile(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const id = nextId();

    function onMessage(event: MessageEvent): void {
      const { __toolboxBridge, id: mid, result, error } = (event.data ?? {}) as Record<string, unknown>;
      if (!__toolboxBridge || mid !== id) return;
      window.removeEventListener('message', onMessage);
      if (error) reject(new Error(error as string));
      else resolve(result as string);
    }

    window.addEventListener('message', onMessage);

    window.parent.postMessage(
      { __toolboxBridge: true, id, method: 'getPathForFile', file },
      '*'
    );

    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('[toolbox-bridge] timeout: getPathForFile'));
    }, 5_000);
  });
}

// ── 对外导出的 electronAPI 对象 ───────────────────────────────────────────

export const electronAPI: ElectronAPI = {
  getAppInfo: () =>
    callBridge('getAppInfo'),

  showOpenDialog: (options?) =>
    callBridge('showOpenDialog', [options]),

  showSaveDialog: (options?) =>
    callBridge('showSaveDialog', [options]),

  readFile: (filePath, encoding?) =>
    callBridge('readFile', [filePath, encoding]),

  writeFile: (filePath, data, encoding?) =>
    callBridge('writeFile', [filePath, data, encoding]),

  readDir: (dirPath) =>
    callBridge('readDir', [dirPath]),

  openInExplorer: (targetPath) =>
    callBridge('openInExplorer', [targetPath]),

  getPathForFile: (file) =>
    callBridgeWithFile(file),

  log: (level, tag, message) =>
    callBridge('log', [level, tag, message]),
};

// 将 electronAPI 注入到 logger 模块（解除循环依赖）
_setElectronAPI(electronAPI);
