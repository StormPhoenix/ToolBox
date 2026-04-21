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

// 尽早初始化管道保护（在任何 console 调用之前）
initPipeGuard();

const log = createLogger('Main');

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

/** 已打开的插件窗口：pluginId → BrowserWindow */
const pluginWindows = new Map<string, BrowserWindow>();

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
      webviewTag: false,
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

// 应用信息
ipcMain.handle('get-app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  platform: process.platform,
}));

// 文件对话框
ipcMain.handle('dialog:showOpenDialog', (e, options: Electron.OpenDialogOptions) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? mainWindow!;
  return dialog.showOpenDialog(win, options);
});

ipcMain.handle('dialog:showSaveDialog', (e, options: Electron.SaveDialogOptions) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? mainWindow!;
  return dialog.showSaveDialog(win, options);
});

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

// 日志转发（渲染进程 / 插件 → 主进程写文件）
ipcMain.handle(
  'logger:log',
  (_e, level: 'info' | 'warn' | 'error', tag: string, message: string) => {
    writeRendererLog(level, tag, message);
  }
);

// ── 插件窗口管理 ─────────────────────────────────────────────

/**
 * 打开（或聚焦）一个插件独立窗口。
 * @param pluginId  插件唯一标识
 * @param entryPath 插件 dist/index.html 的绝对路径（可选，不传则由主进程自动推导）
 * @param title     窗口标题
 */
ipcMain.handle(
  'plugin:open',
  (_e, pluginId: string, entryPath: string, title: string) => {
    // 若窗口已存在则直接聚焦
    const existing = pluginWindows.get(pluginId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return;
    }

    // 若调用方未传入绝对路径，则由主进程根据约定目录推导
    const resolvedPath = entryPath || path.join(
      __dirname, '..', '..', 'plugins', 'builtin', pluginId, 'dist', 'index.html'
    );

    const win = new BrowserWindow({
      width: 1100,
      height: 780,
      minWidth: 720,
      minHeight: 500,
      title,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // 隐藏默认菜单栏
    win.setMenuBarVisibility(false);

    win.loadFile(resolvedPath);

    pluginWindows.set(pluginId, win);

    win.on('closed', () => {
      pluginWindows.delete(pluginId);
    });

    log.info(`插件窗口已打开：${pluginId}`);
  }
);

/** 关闭指定插件窗口（如果已打开） */
ipcMain.handle('plugin:close', (_e, pluginId: string) => {
  const win = pluginWindows.get(pluginId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
});

/** 聚焦指定插件窗口（如果已打开） */
ipcMain.handle('plugin:focus', (_e, pluginId: string) => {
  const win = pluginWindows.get(pluginId);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// ─── 应用生命周期 ────────────────────────────────────────────

app.whenReady().then(() => {
  cleanOldLogs();
  printStartupBanner();
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
