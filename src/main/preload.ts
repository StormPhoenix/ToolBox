import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  getAppInfo: () =>
    ipcRenderer.invoke('get-app-info'),

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

  // 系统
  openInExplorer: (targetPath: string) =>
    ipcRenderer.invoke('shell:openInExplorer', targetPath),

  // 获取拖拽/选择文件的系统路径（webUtils，仅 preload 可调用）
  getPathForFile: (file: File) =>
    webUtils.getPathForFile(file),
});
