# Plugin Bridge — `@toolbox/bridge`

> 本文档记录插件 API 访问层的设计决策、实现细节与接入方式。

---

## 1. 架构概述

ToolBox 的插件运行在 `<webview>` 中。Electron 支持为 `<webview>` 指定独立的 `preload` 脚本，preload 脚本会被直接注入到 webview 的渲染进程，因此 **插件内 `window.electronAPI` 直接可用**，无需任何中间层。

```
┌─────────────────────────────────────────────────┐
│  主进程 main.ts (Node.js)                         │
│  ipcMain.handle('fs:readFile', ...)              │
└──────────────────┬──────────────────────────────┘
                   │  Electron IPC
┌──────────────────▼──────────────────────────────┐
│  preload.js（contextIsolation 沙箱）              │
│  contextBridge → window.electronAPI             │
│  ↑ 同时注入 Shell 和 webview                     │
└──────┬───────────────────────┬──────────────────┘
       │ 直接注入               │ 直接注入（webview preload）
┌──────▼──────────┐   ┌────────▼──────────────────┐
│  Shell 渲染进程  │   │  插件 webview 渲染进程      │
│  src/shell/     │   │  plugins/builtin/<id>/     │
│  window.        │   │  window.electronAPI 直接   │
│  electronAPI ✓  │   │  可用，无需桥接             │
└─────────────────┘   └───────────────────────────┘
```

Shell 的 `ToolViewer.vue` 在挂载时通过 `get-preload-path` IPC 获取 preload 脚本的绝对路径，并将其设置为 `<webview preload="...">` 属性。

---

## 2. `@toolbox/bridge` 包

### 2.1 位置与结构

```
plugins/shared/bridge/
├── package.json          # name: "@toolbox/bridge", main: "src/index.ts"
├── tsconfig.json
└── src/
    ├── types.ts          # ElectronAPI 接口（单一来源）
    ├── index.ts          # electronAPI 导出（Proxy 透传 window.electronAPI）
    └── logger.ts         # createLogger 实现
```

**无独立构建步骤**：`main` 字段指向 `src/index.ts`，由各插件的 Vite 在构建时直接 bundle。

### 2.2 类型单一来源

`ElectronAPI` 接口的**唯一定义**在 `plugins/shared/bridge/src/types.ts`：

| 消费方 | 方式 |
|---|---|
| 插件（`@toolbox/bridge` 用户） | `import type { ElectronAPI } from '@toolbox/bridge'` |
| Shell（`global.d.ts`） | `import type { ElectronAPI } from '@toolbox/bridge'`，挂到 `Window` |
| preload（实现侧） | 无需显式 import，实现与接口对齐即可 |

### 2.3 `electronAPI` 导出实现

`index.ts` 通过 `Proxy` 将所有方法调用透传给运行时的 `window.electronAPI`：

```typescript
export const electronAPI: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop: string) {
    const api = (window as any).electronAPI;
    if (!api) throw new Error('[toolbox-bridge] window.electronAPI is not available');
    return api[prop].bind(api);
  },
});
```

这样插件代码与 Shell 侧的 `window.electronAPI` 调用完全等价，且共用同一套类型签名。

---

## 3. IPC 通道完整列表

所有通道均通过 `ipcMain.handle` 注册，返回值经由 `contextBridge` 暴露给渲染进程：

| IPC 通道 | 说明 |
|---|---|
| `get-app-info` | 获取应用/环境信息 |
| `get-preload-path` | 返回 preload 脚本的绝对路径（供 webview preload 属性使用） |
| `dialog:showOpenDialog` | 打开文件选择对话框 |
| `dialog:showSaveDialog` | 打开文件保存对话框 |
| `fs:readFile` | 读取文件内容 |
| `fs:writeFile` | 写入文件 |
| `fs:readDir` | 列出目录内容 |
| `shell:openInExplorer` | 在资源管理器中打开 |
| `logger:log` | 渲染进程/插件日志转发到主进程写文件 |

---

## 4. 插件接入方式

### 4.1 新插件接入 `@toolbox/bridge`

**第一步**：在插件的 `package.json` 添加依赖：

```json
{
  "dependencies": {
    "@toolbox/bridge": "workspace:*"
  }
}
```

**第二步**：在插件根目录添加 `tsconfig.json`：

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
import { electronAPI, createLogger } from '@toolbox/bridge';

const log = createLogger('MyPlugin');

const info = await electronAPI.getAppInfo();
const result = await electronAPI.showOpenDialog({ properties: ['openFile'] });
const content = await electronAPI.readFile('/path/to/file', 'utf-8');
```

### 4.2 调用签名参考

```typescript
electronAPI.getAppInfo()                              → Promise<AppInfo>
electronAPI.showOpenDialog(options?)                  → Promise<OpenDialogReturnValue>
electronAPI.showSaveDialog(options?)                  → Promise<SaveDialogReturnValue>
electronAPI.readFile(filePath, encoding?)             → Promise<string>
electronAPI.writeFile(filePath, data, encoding?)      → Promise<void>
electronAPI.readDir(dirPath)                          → Promise<DirEntry[]>
electronAPI.openInExplorer(targetPath)                → Promise<void>
electronAPI.getPathForFile(file)                      → Promise<string>
```

---

## 5. 新增 API 步骤

1. `src/main/main.ts` — 添加 `ipcMain.handle('channel', handler)`
2. `src/main/preload.ts` — `contextBridge.exposeInMainWorld` 中添加方法（返回 `Promise`）
3. `plugins/shared/bridge/src/types.ts` — `ElectronAPI` 接口添加方法签名

`src/shell/types/global.d.ts` 和 `plugins/shared/bridge/src/index.ts` 无需修改（前者直接 re-export bridge 类型，后者通过 Proxy 自动透传新方法）。

---

## 6. `getPathForFile` 说明

在 webview 架构下，`getPathForFile` 与其他方法完全一致——preload 已注入 webview，可直接调用：

```typescript
// 插件侧（webview 内）
const path = await electronAPI.getPathForFile(file);
```

preload 中 `webUtils.getPathForFile` 被包装为 `Promise.resolve(...)` 以保持所有方法签名统一为 `Promise<T>`。

---

## 7. 已知限制

| 限制 | 说明 |
|---|---|
| 大二进制数据 | `readFile` 返回 base64 字符串而非 `ArrayBuffer`，大文件需在插件侧手动转换 |
| 无权限声明 | 当前所有插件可调用全部 API，未来可在 `manifest.json` 添加 `permissions` 字段并在主进程 handler 校验 |
| webview preload 路径 | 必须为绝对 `file://` 路径，由 Shell 通过 `get-preload-path` IPC 动态获取，dev/prod 均正确 |
