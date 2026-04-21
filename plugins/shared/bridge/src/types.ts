/**
 * ElectronAPI — 单一来源类型定义
 *
 * Shell 侧：window.electronAPI（由 preload.ts 通过 contextBridge 注入）
 * 插件侧：从 @toolbox/bridge 导入的 electronAPI 对象（直接读取 window.electronAPI，
 *         插件运行在独立 BrowserWindow 中，preload 已注入）
 *
 * 两侧接口签名完全一致。
 */

// ── Electron 对话框类型（内联，避免插件依赖 electron 本体） ──────────────

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >;
  message?: string;
}

export interface OpenDialogReturnValue {
  canceled: boolean;
  filePaths: string[];
  bookmarks?: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  message?: string;
  nameFieldLabel?: string;
  showsTagField?: boolean;
  properties?: Array<
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'treatPackageAsDirectory'
    | 'showOverwriteConfirmation'
    | 'dontAddToRecent'
  >;
}

export interface SaveDialogReturnValue {
  canceled: boolean;
  filePath?: string;
  bookmark?: string;
}

// ── 应用信息 ──────────────────────────────────────────────────────────────

export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
}

// ── 目录项 ────────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDir: boolean;
  path: string;
}

// ── ElectronAPI 主接口 ────────────────────────────────────────────────────

export interface ElectronAPI {
  /** 获取应用及运行环境信息 */
  getAppInfo(): Promise<AppInfo>;

  /** 弹出文件打开对话框 */
  showOpenDialog(options?: OpenDialogOptions): Promise<OpenDialogReturnValue>;

  /** 弹出文件保存对话框 */
  showSaveDialog(options?: SaveDialogOptions): Promise<SaveDialogReturnValue>;

  /** 读取文件内容（默认 utf-8，可传 'base64'） */
  readFile(filePath: string, encoding?: BufferEncoding | 'base64'): Promise<string>;

  /** 写入文件内容（默认 utf-8，可传 'base64'） */
  writeFile(filePath: string, data: string, encoding?: BufferEncoding | 'base64'): Promise<void>;

  /** 列出目录内容 */
  readDir(dirPath: string): Promise<DirEntry[]>;

  /** 在系统资源管理器中打开路径 */
  openInExplorer(targetPath: string): Promise<void>;

  /**
   * 获取 File 对象对应的系统文件路径。
   * preload 层通过 webUtils.getPathForFile 实现。
   */
  getPathForFile(file: File): Promise<string>;

  /**
   * 将渲染进程（Shell / 插件）日志转发到主进程写文件。
   * debug 级别在调用方已过滤，不应传入此方法。
   */
  log(level: 'info' | 'warn' | 'error', tag: string, message: string): Promise<void>;

  // ── 插件窗口管理（仅 Shell 侧使用）──────────────────────────────────────

  /** 打开（或聚焦）插件独立窗口；entryPath 可省略，主进程自动推导 */
  openPlugin(pluginId: string, entryPath: string, title: string): Promise<void>;

  /** 关闭指定插件窗口 */
  closePlugin(pluginId: string): Promise<void>;

  /** 聚焦指定插件窗口 */
  focusPlugin(pluginId: string): Promise<void>;
}
