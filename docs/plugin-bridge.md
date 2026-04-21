# Plugin Bridge — `@toolbox/bridge`

> 本文档记录插件通信层的设计决策、实现细节与使用方法。

---

## 1. 整体架构

每个插件运行在主进程创建的**独立 `BrowserWindow`** 中，与 Shell 使用同一份 `preload.js`，`window.electronAPI` 由 `contextBridge` 直接注入。插件可像 Shell 一样使用全部 Electron 能力，无需任何中间层。

```
┌─────────────────────────────────────────────────┐
│  主进程 main.ts (Node.js)                        │
│  ipcMain.handle('fs:readFile', ...)              │
│  ipcMain.handle('plugin:open', ...)              │
└──────────┬──────────────────────┬───────────────┘
           │  Electron IPC        │  Electron IPC
┌──────────▼──────────┐  ┌───────▼───────────────┐
│  preload.js（沙箱）  │  │  preload.js（沙箱）    │
│  → window.elAPI     │  │  → window.elAPI        │
└──────────┬──────────┘  └───────┬───────────────┘
           │ 直接调用              │ 直接调用
┌──────────▼──────────┐  ┌───────▼───────────────┐
│  Shell BrowserWindow │  │  插件 BrowserWindow    │
│  （主界面）          │  │  （每个插件独立窗口）   │
└─────────────────────┘  └───────────────────────┘
```

### 插件窗口生命周期

1. 用户点击工具卡片 → Shell 调用 `window.electronAPI.openPlugin(id, entryPath, title)`
2. 主进程收到 `plugin:open` IPC → 创建 `BrowserWindow`，加载插件 `dist/index.html`
3. 插件窗口持有独立渲染进程，`window.electronAPI` 由 `preload.js` 注入，可直接使用
4. 同一插件二次点击时，主进程检测到窗口已存在，直接聚焦而不重复创建
5. 关闭插件窗口时，主进程从 `pluginWindows` Map 中移除记录

---

## 2. `@toolbox/bridge` 包

### 2.1 位置与结构

```
plugins/shared/bridge/
├── package.json          # name: "@toolbox/bridge", main: "src/index.ts"
├── tsconfig.json
└── src/
    ├── types.ts          # ElectronAPI 接口（单一来源）
    ├── index.ts          # electronAPI Proxy 导出
    └── logger.ts         # createLogger 工具
```

**无独立构建步骤**：`main` 字段指向 `src/index.ts`，由各插件的 Vite 在构建时直接 bundle。

### 2.2 `electronAPI` 实现

`index.ts` 导出的 `electronAPI` 对象是 `window.electronAPI` 的 Proxy 代理，在属性访问时懒读取，兼容模块加载早于 `DOMContentLoaded` 的场景：

```typescript
export const electronAPI: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop: string) {
    const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
    if (!api) throw new Error(`[toolbox/bridge] window.electronAPI 未就绪（${prop}）`);
    const value = (api as Record<string, unknown>)[prop];
    return typeof value === 'function' ? value.bind(api) : value;
  },
});
```

### 2.3 类型单一来源

`ElectronAPI` 接口的**唯一定义**在 `plugins/shared/bridge/src/types.ts`：

| 消费方 | 方式 |
|---|---|
| 插件 | `import type { ElectronAPI } from '@toolbox/bridge'` |
| Shell（`global.d.ts`） | re-export bridge 类型，挂到 `Window` |
| preload（实现侧） | 无需显式 import，实现与接口对齐即可 |

所有 Electron 对话框相关类型（`OpenDialogOptions`、`SaveDialogReturnValue` 等）在 `types.ts` 中内联定义，**bridge 包本身不依赖 electron 运行时**。

---

## 3. 插件接入方式

### 3.1 新插件接入 `@toolbox/bridge`

**第一步**：在插件的 `package.json` 添加依赖：

```json
{
  "dependencies": {
    "@toolbox/bridge": "workspace:*"
  }
}
```

**第二步**：在插件根目录添加 `tsconfig.json`（IDE 类型检查用）：

```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "paths": {
      "@toolbox/bridge": ["../../../plugins/shared/bridge/src/index.ts"]
    }
  },
  "include": ["src/**/*"]
}
```

**第三步**：运行 `pnpm install` 注册 workspace link。

**第四步**：在插件代码中直接 import 使用：

```typescript
import { electronAPI } from '@toolbox/bridge';
import type { AppInfo, OpenDialogOptions } from '@toolbox/bridge';

const info = await electronAPI.getAppInfo();
const result = await electronAPI.showOpenDialog({ properties: ['openFile'] });
const content = await electronAPI.readFile('/path/to/file', 'utf-8');
```

### 3.2 调用签名参考

```typescript
electronAPI.getAppInfo()                              → Promise<AppInfo>
electronAPI.showOpenDialog(options?)                  → Promise<OpenDialogReturnValue>
electronAPI.showSaveDialog(options?)                  → Promise<SaveDialogReturnValue>
electronAPI.readFile(filePath, encoding?)             → Promise<string>
electronAPI.writeFile(filePath, data, encoding?)      → Promise<void>
electronAPI.readDir(dirPath)                          → Promise<DirEntry[]>
electronAPI.openInExplorer(targetPath)                → Promise<void>
electronAPI.getPathForFile(file)                      → Promise<string>
electronAPI.log(level, tag, message)                  → Promise<void>
```

---

## 4. 新增 API 步骤

1. `src/main/main.ts` — 添加 `ipcMain.handle('channel', handler)`
2. `src/main/preload.ts` — `contextBridge.exposeInMainWorld` 中添加方法（返回 `Promise`）
3. `plugins/shared/bridge/src/types.ts` — `ElectronAPI` 接口添加方法签名

`bridge/index.ts` 的 Proxy 实现会自动代理新增方法，**无需修改**。
`src/shell/types/global.d.ts` 无需修改（直接 re-export bridge 类型）。

---

## 5. 已知限制

| 限制 | 说明 |
|---|---|
| 独立窗口模式 | 插件以独立窗口运行，不嵌入 Shell 界面，适合工具类场景 |
| 大二进制数据 | `readFile` 返回 base64 字符串而非 `ArrayBuffer`，大文件需在插件侧手动转换 |
| 无权限声明 | 当前所有插件可调用全部 API，未来可在 `manifest.json` 添加 `permissions` 字段并在主进程校验 |
