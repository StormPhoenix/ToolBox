/**
 * ElectronAPI — 单一来源类型定义
 *
 * Shell 侧：window.electronAPI（由 preload.ts 通过 contextBridge 注入）
 * 插件侧：从 @toolbox/bridge 导入的 electronAPI 对象（内部走 postMessage）
 *
 * 两侧接口签名完全一致，插件无需感知通信细节。
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
  /** 构建时的 git commit 短 hash，不可用时为 'unknown' */
  gitHash: string;
  /** 构建时的 git branch 名，不可用时为 'unknown' */
  gitBranch: string;
  /** 构建时间 ISO 8601 字符串 */
  buildTime: string;
}

// ── 目录项 ────────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDir: boolean;
  path: string;
}

// ── 插件统计 ──────────────────────────────────────────────────────────────

export interface PluginStats {
  total: number;
  builtin: number;
  categories: number;
}

// ── ElectronAPI 主接口 ────────────────────────────────────────────────────

export interface ElectronAPI {
  /** 获取应用及运行环境信息 */
  getAppInfo(): Promise<AppInfo>;

  /** 获取插件 webview 所需的 preload 脚本绝对路径（仅 Shell 侧使用） */
  getPreloadPath(): Promise<string>;

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
   * preload 层通过 webUtils.getPathForFile 实现（同步）；
   * bridge 层通过 postMessage 异步获取，统一为 Promise<string>。
   */
  getPathForFile(file: File): Promise<string>;

  /** 重命名文件（或移动到同目录下的新名） */
  renameFile(oldPath: string, newPath: string): Promise<void>;

  /**
   * 将渲染进程（Shell / 插件）日志转发到主进程写文件。
   * debug 级别在调用方已过滤，不应传入此方法。
   */
  log(level: 'info' | 'warn' | 'error', tag: string, message: string): Promise<void>;

  /** 获取插件注册表统计信息（总数、内置数、分类数） */
  getPluginStats(): Promise<PluginStats>;
}
