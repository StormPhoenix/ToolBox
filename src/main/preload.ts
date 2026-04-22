import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  getAppInfo: () =>
    ipcRenderer.invoke('get-app-info'),

  // 插件 webview 所需的 preload 绝对路径
  getPreloadPath: () =>
    ipcRenderer.invoke('get-preload-path'),

  // 文件对话框
  showOpenDialog: (options?: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:showOpenDialog', options),

  showSaveDialog: (options?: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('dialog:showSaveDialog', options),

  // 文件系统
  readFile: (filePath: string, encoding?: BufferEncoding) =>
    ipcRenderer.invoke('fs:readFile', filePath, encoding),

  writeFile: (filePath: string, data: string, encoding?: BufferEncoding) =>
    ipcRenderer.invoke('fs:writeFile', filePath, data, encoding),

  readDir: (dirPath: string) =>
    ipcRenderer.invoke('fs:readDir', dirPath),

  renameFile: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke('fs:renameFile', oldPath, newPath),

  // 系统
  openInExplorer: (targetPath: string) =>
    ipcRenderer.invoke('shell:openInExplorer', targetPath),

  // 获取拖拽/选择文件的系统路径（webUtils，仅 preload 可调用）
  // 包为 Promise 以与 ElectronAPI 接口统一（bridge 侧也是 Promise<string>）
  getPathForFile: (file: File) =>
    Promise.resolve(webUtils.getPathForFile(file)),

  // 渲染进程日志转发（Shell / 插件 → 主进程写文件）
  log: (level: 'info' | 'warn' | 'error', tag: string, message: string) =>
    ipcRenderer.invoke('logger:log', level, tag, message),
});
