export {};

interface ElectronAPI {
  // 应用信息
  getAppInfo: () => Promise<{
    name: string;
    version: string;
    electronVersion: string;
    nodeVersion: string;
    platform: string;
  }>;
  // 文件对话框
  showOpenDialog: (options?: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
  showSaveDialog: (options?: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
  // 文件系统
  readFile:  (filePath: string, encoding?: BufferEncoding) => Promise<string>;
  writeFile: (filePath: string, data: string, encoding?: BufferEncoding) => Promise<void>;
  readDir:   (dirPath: string) => Promise<{ name: string; isDir: boolean; path: string }[]>;
  // 系统
  openInExplorer: (targetPath: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
