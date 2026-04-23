/**
 * @toolbox/bridge
 *
 * 插件可通过此包访问与 Shell 侧完全一致签名的 electronAPI 对象。
 *
 * 插件运行在 <webview> 中，Electron 通过 preload 脚本直接向 webview 注入
 * window.electronAPI，因此无需 postMessage 中间层，直接透传即可。
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
  // LLM 类型
  LLMProviderType,
  LLMMessageContent,
  LLMMessage,
  LLMChatOptions,
  LLMChatResult,
  LLMConfigPublic,
  LLMConfigInput,
  LLMTestResult,
} from './types';

export { createLogger } from './logger';
export type { Logger } from './logger';

// ── LLM 辅助工具 ──────────────────────────────────────────────────────────
export {
  inferImageMediaType,
  buildImageMessage,
  buildMultiImageMessage,
} from './llm-helpers';
export type { ImageMediaType } from './llm-helpers';

// ── electronAPI 直连 webview 内注入的 window.electronAPI ──────────────────

/**
 * 插件侧 electronAPI：直接引用 preload 注入的 window.electronAPI。
 *
 * - 在 <webview> 环境中，Electron 的 preload 脚本被注入，
 *   window.electronAPI 与 Shell 侧完全一致，可直接调用。
 * - 若在非 Electron 环境（如浏览器测试）中访问，会抛出友好错误。
 */
export const electronAPI: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop: string) {
    const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
    if (!api) {
      throw new Error(
        `[toolbox-bridge] window.electronAPI is not available. ` +
        `Make sure the plugin is running inside an Electron webview with preload injected.`
      );
    }
    const method = api[prop as keyof ElectronAPI];
    if (typeof method !== 'function') {
      throw new Error(`[toolbox-bridge] electronAPI.${prop} is not a function`);
    }
    return method.bind(api);
  },
});
