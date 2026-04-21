import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';

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

// ─── 应用生命周期 ────────────────────────────────────────────

app.whenReady().then(() => {
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
