# Plugin Bridge — `@toolbox/bridge`

> 本文档记录了插件通信层的重构背景、设计决策、实现细节与注意事项。

---

## 1. 背景与问题

ToolBox 的插件运行在 `<iframe>` 中。Electron 的 `preload.ts` 只注入给它所属 `BrowserWindow` 的顶层页面（Shell），**iframe 有独立的 `window` 对象，preload 不会重新注入**，因此插件侧 `window.electronAPI` 始终为 `undefined`。

重构前，每个插件需要自己手写 postMessage 胶水代码才能访问系统能力：

```typescript
// 重构前（plugins/builtin/pdf-editor/src/composables/usePdf.ts）
window.parent.postMessage({ __toolboxBridge: true, id, method, args }, '*');
window.addEventListener('message', (e) => { /* 匹配 id，resolve/reject */ });
```

这种方式存在以下问题：

- 每个插件各自维护一份 bridge 实现，违反 DRY 原则
- 无 TypeScript 类型，调用侧需要 `@ts-ignore`
- `ElectronAPI` 接口分散在 Shell 和各插件内，维护成本高
- `getPathForFile` 因跨 realm `instanceof` 检查失败导致返回 `undefined` 的隐藏 Bug

---

## 2. 整体通信架构

```
┌─────────────────────────────────────────────────┐
│  主进程 main.ts (Node.js)                         │
│  ipcMain.handle('fs:readFile', ...)              │
└──────────────────┬──────────────────────────────┘
                   │  Electron IPC
┌──────────────────▼──────────────────────────────┐
│  preload.ts（contextIsolation 沙箱）              │
│  contextBridge → window.electronAPI             │
└──────────────────┬──────────────────────────────┘
                   │  直接调用（同一 BrowserWindow）
┌──────────────────▼──────────────────────────────┐
│  Shell（src/shell/）— BrowserWindow 渲染进程      │
│  ToolViewer.vue：监听 message，代理转发           │
└──────────────────┬──────────────────────────────┘
                   │  window.parent.postMessage
┌──────────────────▼──────────────────────────────┐
│  插件（plugins/builtin/<id>/）— iframe           │
│  import { electronAPI } from '@toolbox/bridge'  │
└─────────────────────────────────────────────────┘
```

Shell 是唯一能访问 Electron 能力的渲染进程，插件的所有系统调用必须经由 Shell 代理。

---

## 3. `@toolbox/bridge` 包

### 3.1 位置与结构

```
plugins/shared/bridge/
├── package.json          # name: "@toolbox/bridge", main: "src/index.ts"
├── tsconfig.json
└── src/
    ├── types.ts          # ElectronAPI 接口（单一来源）
    └── index.ts          # callBridge 实现 + electronAPI 导出对象
```

包位于 `plugins/shared/bridge/`，符合 `pnpm-workspace.yaml` 的 `plugins/**` 通配，自动注册为 workspace 包。

**无独立构建步骤**：`main` 字段指向 `src/index.ts`，由各插件的 Vite 在构建时直接 bundle，无需额外 `build` 脚本。

### 3.2 类型单一来源

`ElectronAPI` 接口的**唯一定义**在 `plugins/shared/bridge/src/types.ts`：

| 消费方 | 方式 |
|---|---|
| 插件（`@toolbox/bridge` 用户） | `import type { ElectronAPI } from '@toolbox/bridge'` |
| Shell（`global.d.ts`） | `import type { ElectronAPI } from '@toolbox/bridge'`，挂到 `Window` |
| preload（实现侧） | 无需显式 import，实现与接口对齐即可 |

所有 Electron 对话框相关类型（`OpenDialogOptions`、`SaveDialogReturnValue` 等）也在 `types.ts` 中内联定义，**bridge 包本身不依赖 electron 运行时**，仅将 `electron` 列为 devDependency 供类型参考。

### 3.3 `getPathForFile` 的统一签名

| 实现层 | 原签名 | 新签名 |
|---|---|---|
| `preload.ts`（`webUtils`） | `(file: File) => string`（同步） | `(file: File) => Promise<string>` |
| `@toolbox/bridge` | — | `(file: File) => Promise<string>` |

preload 侧改为 `Promise.resolve(webUtils.getPathForFile(file))`，使所有 `ElectronAPI` 方法统一为 `Promise<T>` 签名。

---

## 4. postMessage 协议

### 4.1 请求格式（插件 → Shell）

```typescript
// 普通方法
window.parent.postMessage({
  __toolboxBridge: true,   // 协议标识
  id: string,              // 唯一请求 ID（"tb_<n>_<timestamp>"）
  method: string,          // electronAPI 方法名
  args: unknown[],         // 参数列表
}, '*');

// getPathForFile 专用（File 对象不能通过 args 序列化传递）
window.parent.postMessage({
  __toolboxBridge: true,
  id: string,
  method: 'getPathForFile',
  file: File,              // File 对象直接挂在 data 上，走结构化克隆
}, '*');
```

### 4.2 响应格式（Shell → 插件）

```typescript
// 成功
frame.contentWindow.postMessage({
  __toolboxBridge: true,
  id: string,              // 与请求 id 一致
  result: unknown,         // 返回值
}, '*');

// 失败
frame.contentWindow.postMessage({
  __toolboxBridge: true,
  id: string,
  error: string,           // 错误消息
}, '*');
```

超时保护：普通方法 **30 秒**，`getPathForFile` **5 秒**。

### 4.3 Shell 代理（`ToolViewer.vue`）

Shell 在 `onMounted` 时监听 `message` 事件，收到带 `__toolboxBridge` 标识且来源为当前 iframe 的消息后：

1. 从 `window.electronAPI` 取对应方法
2. `await` 调用（所有方法统一异步）
3. 通过 `frame.contentWindow.postMessage` 回传结果

**关键实现注意**：

- **来源验证**：`event.source !== frame.contentWindow` 时直接忽略，防止其他 frame 伪造请求
- **`getPathForFile` 的跨 realm 问题**：来自 iframe 的 `File` 对象与 Shell 的 `File` 构造函数不同 realm，`instanceof File` 恒为 `false`。改用 duck typing 检查：
  ```typescript
  typeof file.name === 'string' && typeof file.size === 'number'
  ```
- **必须 `await` `getPathForFile`**：preload 已改为返回 `Promise`，漏掉 `await` 会导致 Promise 对象被结构化克隆为空对象，插件收到 `undefined`

---

## 5. 插件接入方式

### 5.1 新插件接入 `@toolbox/bridge`

**第一步**：在插件的 `package.json` 添加依赖：

```json
{
  "dependencies": {
    "@toolbox/bridge": "workspace:*"
  }
}
```

**第二步**：在插件根目录添加 `tsconfig.json`（IDE 类型检查用，Vite 构建不依赖）：

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

// 与 Shell 侧 window.electronAPI 完全一致的调用体验
const info = await electronAPI.getAppInfo();
const result = await electronAPI.showOpenDialog({ properties: ['openFile'] });
const content = await electronAPI.readFile('/path/to/file', 'utf-8');
```

### 5.2 调用签名参考

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

## 6. 新增 API 步骤（含 bridge 同步）

原有流程（3 步）扩展为 4 步：

1. `src/main/main.ts` — 添加 `ipcMain.handle('channel', handler)`
2. `src/main/preload.ts` — `contextBridge.exposeInMainWorld` 中添加方法（返回 `Promise`）
3. `plugins/shared/bridge/src/types.ts` — `ElectronAPI` 接口添加方法签名
4. `plugins/shared/bridge/src/index.ts` — `electronAPI` 对象添加对应方法（调用 `callBridge`）

`src/shell/types/global.d.ts` 无需修改（它直接 re-export bridge 的类型）。

---

## 7. 已知限制

| 限制 | 说明 |
|---|---|
| `postMessage` 性能 | 每次调用有序列化/反序列化开销，不适合高频（>100次/秒）调用 |
| 大二进制数据 | `readFile` 返回 base64 字符串而非 `ArrayBuffer`，大文件需在插件侧手动转换 |
| 无权限声明 | 当前所有插件可调用全部 API，未来可在 `manifest.json` 添加 `permissions` 字段并在 Shell 代理层校验 |
| `File` 传递限制 | 只有 `getPathForFile` 支持传 `File` 对象；其他方法的参数必须可被结构化克隆 |
