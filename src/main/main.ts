import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  initPipeGuard,
  cleanOldLogs,
  printStartupBanner,
  createLogger,
  writeRendererLog,
} from './logger';
import { registerLLMHandlers } from './llm/llm-ipc';

// 构建期由 vite.main.config.ts define 注入的全局常量
declare const __GIT_HASH__: string;
declare const __GIT_BRANCH__: string;
declare const __BUILD_TIME__: string;

// 尽早初始化管道保护（在任何 console 调用之前）
initPipeGuard();

const log = createLogger('Main');

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

const SPLASH_MIN_DURATION = 2500;
const isDev = process.argv.includes('--dev');

// ─── 窗口管理 ───────────────────────────────────────────────

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 360,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWindow.loadFile(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'splash.html')
  );

  splashWindow.once('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    titleBarStyle: 'default',
    show: false,
  });

  // 构建产物加载 dist/shell/index.html；开发模式走 Vite dev server
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'shell', 'index.html'));
  }

  const splashShownAt = Date.now();

  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - splashShownAt;
    const remaining = Math.max(0, SPLASH_MIN_DURATION - elapsed);
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, remaining);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ───────────────────────────────────────────

// 插件 webview 所需的 preload 绝对路径（webview.preload 只接受 file:// 路径）
ipcMain.handle('get-preload-path', () =>
  path.join(__dirname, 'preload.js')
);

// 应用信息（含构建期注入的 git 信息）
ipcMain.handle('get-app-info', () => ({
  name:            app.getName(),
  version:         app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion:     process.versions.node,
  platform:        process.platform,
  gitHash:         __GIT_HASH__,
  gitBranch:       __GIT_BRANCH__,
  buildTime:       __BUILD_TIME__,
}));

// 文件对话框
ipcMain.handle('dialog:showOpenDialog', (_e, options: Electron.OpenDialogOptions) =>
  dialog.showOpenDialog(mainWindow!, options)
);

ipcMain.handle('dialog:showSaveDialog', (_e, options: Electron.SaveDialogOptions) =>
  dialog.showSaveDialog(mainWindow!, options)
);

// 文件系统
ipcMain.handle('fs:readFile', async (_e, filePath: string, encoding: BufferEncoding | 'base64' = 'utf-8') => {
  return fs.readFile(filePath, { encoding: encoding as BufferEncoding });
});

ipcMain.handle('fs:writeFile', async (_e, filePath: string, data: string, encoding: BufferEncoding | 'base64' = 'utf-8') => {
  await fs.writeFile(filePath, data, { encoding: encoding as BufferEncoding });
});

ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    isDir: e.isDirectory(),
    path: path.join(dirPath, e.name),
  }));
});

// 系统
ipcMain.handle('shell:openInExplorer', (_e, targetPath: string) =>
  shell.openPath(targetPath)
);

ipcMain.handle('fs:renameFile', async (_e, oldPath: string, newPath: string) => {
  await fs.rename(oldPath, newPath);
});

// 日志转发（渲染进程 / 插件 → 主进程写文件）
ipcMain.handle(
  'logger:log',
  (_e, level: 'info' | 'warn' | 'error', tag: string, message: string) => {
    writeRendererLog(level, tag, message);
  }
);

// 插件统计（供 welcome 插件等使用）
ipcMain.handle('get-plugin-stats', async () => {
  try {
    const registryPath = path.join(__dirname, '..', 'plugin-registry.json');
    const raw = await fs.readFile(registryPath, 'utf-8');
    const plugins = JSON.parse(raw) as Array<{ builtin?: boolean; category?: string }>;
    const total = plugins.length;
    const builtin = plugins.filter(p => p.builtin).length;
    const categories = new Set(plugins.map(p => p.category).filter(Boolean)).size;
    return { total, builtin, categories };
  } catch {
    return { total: 0, builtin: 0, categories: 0 };
  }
});

// ─── 应用生命周期 ────────────────────────────────────────────

app.whenReady().then(() => {
  cleanOldLogs();
  printStartupBanner();
  registerLLMHandlers();
  log.info('应用初始化完成');

  createSplashWindow();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
