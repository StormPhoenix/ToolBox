# AGENTS.md — ToolBox 项目 LLM 开发规范

> 本文件为 AI / LLM 辅助开发本项目时的行为指南。所有 AI 代理在对本项目进行读取、修改或生成代码时，**必须**遵守以下规范。

---

## 1. 项目概述

**ToolBox** 是一个基于 **Electron + Vue 3 + TypeScript** 的跨平台桌面工具箱应用，采用插件化架构，支持内置工具和第三方插件扩展。

| 项目 | 说明 |
|------|------|
| 框架 | Electron 33+ |
| UI 框架 | Vue 3 (`<script setup>` + Composition API) |
| 语言 | TypeScript 5.7+ (strict mode) |
| 构建工具 | Vite 6 |
| 包管理器 | **pnpm**（必须，禁止 npm/yarn） |
| Node.js | >= 20 |
| 打包工具 | electron-builder |

---

## 2. 项目结构

```
ToolBox/
├── src/
│   ├── main/                         # Electron 主进程（Node.js 环境）
│   │   ├── main.ts                   # 应用入口、窗口管理、所有 IPC handlers
│   │   ├── preload.ts                # contextBridge 安全 API 暴露
│   │   └── logger.ts                 # 主进程日志工具（文件持久化、EPIPE 保护）
│   ├── renderer/                     # 启动页（Splash Screen）
│   │   ├── splash.html               # 启动页 HTML
│   │   └── splash.css                # 启动页样式
│   └── shell/                        # Shell 主界面（Vue 3 + Vite）
│       ├── index.html                # Vite 入口 HTML
│       ├── main.ts                   # Vue 应用挂载入口
│       ├── App.vue                   # 根组件（侧边栏 + 内容区布局）
│       ├── components/
│       │   ├── Sidebar.vue           # 左侧分类导航栏（支持折叠）
│       │   ├── PluginCard.vue        # 单个工具卡片
│       │   ├── ToolGrid.vue          # 工具网格列表
│       │   └── ToolViewer.vue        # webview 插件查看器
│       ├── composables/
│       │   └── usePlugins.ts         # 插件注册表状态管理 composable
│       ├── data/
│       │   └── categories.ts         # 工具分类数据定义
│       ├── types/
│       │   ├── index.ts              # PluginManifest、Category 类型
│       │   └── global.d.ts           # Window.electronAPI 全局类型声明
│       ├── utils/
│       │   └── logger.ts             # Shell 渲染进程日志工具（转发至主进程）
│       └── styles/
│           └── global.css            # 全局 CSS Variables 设计系统
├── plugins/                          # 所有插件（pnpm workspace）
│   ├── shared/                       # 插件共享库
│   │   └── bridge/                   # @toolbox/bridge — 插件通信桥接包
│   │       ├── package.json          # name: "@toolbox/bridge"（无构建步骤）
│   │       ├── tsconfig.json
│   │       └── src/
│   │           ├── types.ts          # ElectronAPI 接口【单一来源】
│   │           ├── index.ts          # electronAPI Proxy 透传 + 导出
│   │           └── logger.ts         # 插件/Shell 通用 Logger（createLogger）
│   └── builtin/                      # 内置插件
│       ├── pdf-merge/                # PDF 合并插件
│       ├── pdf-split/                # PDF 拆分插件
│       ├── pdf-editor/               # PDF 编辑插件
│       └── welcome/                  # 欢迎页插件（示例）
│           ├── manifest.json         # 插件元数据
│           ├── package.json          # 独立 npm 包
│           ├── tsconfig.json         # 插件独立 TS 配置（DOM lib + bridge paths）
│           ├── vite.config.ts        # 独立 Vite 构建配置
│           ├── src/
│           │   ├── index.html        # 插件 HTML 入口
│           │   ├── main.ts           # Vue 挂载
│           │   └── App.vue           # 插件主组件
│           └── dist/                 # 构建产物（自动生成）
├── scripts/
│   ├── build-registry.mjs           # 扫描 plugins/ 生成 plugin-registry.json
│   └── get-git-info.mjs             # 获取 git hash/branch/buildTime，供 vite 配置使用
├── dist/                             # 所有构建产物（自动生成，勿手动修改）
│   ├── main/                         # 主进程编译输出
│   ├── shell/                        # Shell Vue 构建输出
│   └── plugin-registry.json         # 插件注册表（由 build-registry 生成）
├── release/                          # electron-builder 打包输出
├── vite.main.config.ts               # 主进程 + preload 的 Vite 构建配置（含构建信息注入）
├── vite.shell.config.ts              # Shell 的 Vite 配置
├── tsconfig.json                     # TypeScript 基础配置
├── tsconfig.shell.json               # Shell TS 配置
├── package.json                      # 根项目配置
├── pnpm-workspace.yaml              # workspace：注册 plugins/**
├── pnpm-lock.yaml                    # 锁文件（必须提交 git）
├── .npmrc                            # engine-strict=true
└── AGENTS.md                         # 本文件
```

---

## 3. 核心架构

### 3.1 进程模型

| 角色 | 目录 | 运行环境 | 模块系统 | 构建工具 |
|------|------|----------|----------|----------|
| **主进程** | `src/main/main.ts` | Node.js | CommonJS | Vite (`vite.main.config.ts`) |
| **预加载脚本** | `src/main/preload.ts` | 隔离沙箱 | CommonJS | Vite (`vite.main.config.ts`) |
| **Shell（主界面）** | `src/shell/` | Chromium + Vue 3 | ES Modules | Vite (`vite.shell.config.ts`) |
| **插件** | `plugins/<scope>/<id>/` | webview 独立 Chromium 渲染进程 | ES Modules | Vite（各插件独立配置） |

### 3.2 插件系统

**核心原则：每个工具是一个独立的 Vite 项目（插件）。**

```
plugins/
└── <scope>/          # builtin（内置）或第三方
    └── <plugin-id>/
        ├── manifest.json    # 必须：插件元数据
        ├── package.json     # 必须：含 "build" 脚本
        ├── vite.config.ts   # 必须：构建配置
        └── src/             # 源码
            ├── index.html   # 入口 HTML（Vite root）
            ├── main.ts      # Vue 挂载
            └── App.vue      # 主组件
```

**`manifest.json` 结构（必须遵守）：**

```json
{
  "id": "plugin-id",            // 唯一标识，与目录名一致
  "name": "工具名称",
  "description": "工具描述",
  "category": "file",           // all / file / dev / image / system / text
  "icon": "📁",                 // emoji 或 SVG icon 名
  "entry": "index.html",        // 相对于 dist/ 的入口文件
  "version": "1.0.0",
  "builtin": true               // 内置插件为 true，第三方为 false
}
```

### 3.3 插件运行机制

1. **构建时**：`pnpm build:registry` 扫描所有 `manifest.json` → 生成 `dist/plugin-registry.json`
2. **运行时**：Shell 启动后通过 `fetch` 加载 `plugin-registry.json`，填充侧边栏和工具列表
3. **执行时**：用户点击工具卡片 → `ToolViewer` 在 `<webview>` 中加载插件 `dist/index.html`
4. **webview 路径**：`../../plugins/builtin/<id>/dist/<entry>`（相对于 `dist/shell/index.html`）
5. **preload 注入**：`ToolViewer` 通过 `get-preload-path` IPC 获取 preload 绝对路径，设置到 `<webview preload="...">` 属性，插件内 `window.electronAPI` 直接可用

### 3.4 Electron 安全规则（强制）

- `nodeIntegration: false`、`contextIsolation: true` — 所有窗口必须
- 跨进程通信 **只能** 通过 `contextBridge` + `ipcMain.handle` / `ipcRenderer.invoke`
- `webviewTag: true` — 仅 mainWindow 启用，用于插件渲染
- HTML 必须包含 `Content-Security-Policy` meta 标签

---

## 4. IPC API 完整列表

所有 API 通过 `window.electronAPI.*` 调用（Shell 侧），或通过 `import { electronAPI } from '@toolbox/bridge'` 调用（插件侧，底层透传 webview 内的 `window.electronAPI`）。接口类型定义的**单一来源**为 `plugins/shared/bridge/src/types.ts`，由 `src/shell/types/global.d.ts` re-export 到全局。

| 方法 | IPC 通道 | 说明 |
|------|----------|------|
| `getAppInfo()` | `get-app-info` | 获取应用/环境信息，含构建期注入的 `gitHash`、`gitBranch`、`buildTime` |
| `getPreloadPath()` | `get-preload-path` | 获取 preload 脚本绝对路径（供 webview 使用） |
| `showOpenDialog(options?)` | `dialog:showOpenDialog` | 打开文件选择对话框 |
| `showSaveDialog(options?)` | `dialog:showSaveDialog` | 打开文件保存对话框 |
| `readFile(path, encoding?)` | `fs:readFile` | 读取文件内容 |
| `writeFile(path, data, encoding?)` | `fs:writeFile` | 写入文件 |
| `readDir(path)` | `fs:readDir` | 列出目录内容 |
| `openInExplorer(path)` | `shell:openInExplorer` | 在资源管理器中打开 |
| `getPathForFile(file)` | —（preload `webUtils`） | 获取 File 对象的系统路径 |
| `log(level, tag, message)` | `logger:log` | 渲染进程/插件日志转发到主进程写文件 |
| `getPluginStats()` | `get-plugin-stats` | 获取插件注册表统计（total / builtin / categories） |

**新增 IPC 通道三步骤：**
1. `src/main/main.ts` — `ipcMain.handle('channel', handler)`
2. `src/main/preload.ts` — `contextBridge.exposeInMainWorld` 中添加方法（返回 `Promise`）
3. `plugins/shared/bridge/src/types.ts` — `ElectronAPI` 接口添加方法签名


> `src/shell/types/global.d.ts` 和 `plugins/shared/bridge/src/index.ts` 均无需修改：前者直接 re-export bridge 类型，后者通过 Proxy 自动透传新方法。

详细说明见 [`docs/plugin-bridge.md`](docs/plugin-bridge.md)。

---

## 5. 构建系统

### 5.1 构建命令

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装所有依赖（含 workspace 插件） |
| `pnpm build:main` | Vite 构建主进程 + preload → `dist/main/` |
| `pnpm build:shell` | Vite 构建 Shell → `dist/shell/` |
| `pnpm build:plugins` | 构建所有插件 → 各插件 `dist/` |
| `pnpm build:registry` | 生成 `dist/plugin-registry.json` |
| `pnpm build` | 全量构建（上述四步顺序执行） |
| `pnpm start` | 全量构建 + 启动 Electron |
| `pnpm dev:main` | Vite watch 模式构建主进程（热重编译） |
| `pnpm dev:shell` | Vite dev server（Shell，端口 5173） |

### 5.2 开发模式

- 启动 `pnpm run dev:main`（监听主进程编译）
- 启动 `pnpm run dev:shell`（Vite dev server @ `http://localhost:5173`）
- 主进程中 `--dev` 参数会让 mainWindow 加载 `http://localhost:5173` 并开启 DevTools

### 5.3 新增插件步骤

1. 创建目录：`plugins/builtin/<id>/`
2. 创建 `manifest.json`（参考 §3.2 格式）
3. 创建 `package.json`（需包含 `"build": "vite build"` 脚本，**依赖加入 `"@toolbox/bridge": "workspace:*"`**）
4. 创建 `tsconfig.json`（参考已有插件，配置 DOM lib 和 `@toolbox/bridge` paths）
5. 创建 `vite.config.ts`：`root` 指向 `src/`，`outDir` 指向 `dist/`，`base: './'`
6. 创建 `src/index.html`、`src/main.ts`、`src/App.vue`
7. 运行 `pnpm install` 注册到 workspace（同时建立 `@toolbox/bridge` link）
8. 运行 `pnpm build:plugins && pnpm build:registry` 更新注册表

**在插件中调用系统能力：**

```typescript
import { electronAPI } from '@toolbox/bridge';

// 与 Shell 侧 window.electronAPI 完全一致的签名
const result = await electronAPI.showOpenDialog({ properties: ['openFile'] });
```

---

## 6. 设计系统

### 6.1 CSS Variables（`src/shell/styles/global.css`）

```css
:root {
  --bg-base:       #0d0d14;   /* 应用背景 */
  --bg-sidebar:    #111118;   /* 侧边栏背景 */
  --bg-content:    #0f0f17;   /* 内容区背景 */
  --bg-card:       #1a1a28;   /* 卡片背景 */
  --bg-card-hover: #1f1f30;   /* 卡片悬停 */
  --bg-active:     #1e1b3a;   /* 激活项背景 */

  --text-primary:   #e8e8f2;
  --text-secondary: #8888a8;
  --text-dim:       #555570;

  --accent:        #6c5ce7;   /* 主强调色（紫色）*/
  --accent-light:  #a29bfe;
  --accent-glow:   rgba(108, 92, 231, 0.25);

  --border:        #1e1e30;
  --border-active: #6c5ce7;

  --sidebar-width:     220px;
  --sidebar-collapsed:  64px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --transition: 0.18s ease;
}
```

**插件内部**如需与 Shell 风格保持一致，在插件的全局 CSS 中复制以上变量。

### 6.2 样式规范

- 禁止内联样式，所有样式写入 `.css` 文件或 `<style scoped>`
- 颜色/圆角/间距必须引用 CSS Variables
- 动画使用 CSS transition / @keyframes，不用 JS 动画

---

## 7. TypeScript 规范

- **严格模式**：`"strict": true`，所有代码必须通过
- **禁止 `any`**：除非有充分理由，否则禁止使用
- **函数必须有返回类型标注**
- `interface` 用于 API/数据类型，`type` 用于工具类型
- Shell 使用 `tsconfig.shell.json`（ES Modules + DOM lib）
- 主进程使用 `tsconfig.main.json`（CommonJS）

---

## 8. 文档规范（Documentation Map）

### 8.1 文档目录结构

所有文档文件**必须**放在 `docs/` 目录下，按类型分类：

| 类型 | 目录 | 举例 |
|---|---|---|
| 需求 / 产品设计 | `docs/design/` | 功能规格、交互设计、系统设计方案 |
| 技术 / 架构 | `docs/tech/` | 架构设计、技术决策、性能优化 |
| 使用指南 | `docs/use/` | 用户手册、操作指引、FAQ |

新建文档时，先确定类别再放入对应子目录，并在该子目录的 `index.md` 中登记。

### 8.2 当前文档索引

| 路径 | 类型 | 内容 |
|---|---|---|
| `README.md` | 概述 | 项目简介、快速上手 |
| `docs/plugin-bridge.md` | 技术 | `@toolbox/bridge` 与 webview 插件 API 访问说明 |

> 新增文档后请在此表登记。

### 8.3 文档编写风格

文档**只描述当前状态**，不保留历史演变痕迹：

- **删除**已被替代的旧方案描述，不保留"历史参考"
- **不使用**"从 X 迁移到 Y"、"原先使用 X，现在使用 Y"等过渡性表述
- **不保留**新旧方案对比表
- **不**在行内标记"已完成"或"已解决"——风险消失则直接删除，计划项实现则从"未来规划"节移除
- 直接描述当前实现，无需说明它是何时变成这样的

### 8.4 每次功能完成后的文档同步

**每次功能或修复完成后**，提交前必须执行以下四步：

#### 第一步：冲突检查 — 修正过时描述

扫描与本次变更相关的所有文档，检查是否存在与新实现冲突的内容。常见冲突模式：

- 架构图或数据流描述中引用了已删除/重命名的模块
- 技术栈表格中列出了已移除的依赖或过时的版本
- 功能描述与当前行为不符（默认值、参数名、API 签名）
- 代码引用（文件路径、函数名、类型名）已被重命名或删除

发现冲突则**就地修正**，不留过时内容。

#### 第二步：设计文档同步

若本次实现改变了功能的设计（新的交互流程、数据模型变更、系统行为改变、能力增减），更新 `docs/design/` 中对应的设计文档。

#### 第三步：任务文档生命周期

检查本次工作是否有对应的任务/计划文档（`docs/` 下命名含 `*-plan.md`、`*-design.md`、`*-refactor-plan.md` 的文件）。若**该文档中的所有任务均已完成**：

1. **删除任务文档** — 它已完成使命
2. **新建或更新技术文档**（`docs/tech/`）记录最终架构/设计决策
3. **新建或更新使用文档**（`docs/use/`）（如果影响用户侧功能）
4. **更新索引** — 从对应 `index.md` 移除已删文档，添加新文档，并更新 §8.2 文档索引表

若任务文档仍有待完成项，保留文档但标记已完成的条目。

#### 第四步：重点检查文档

以下文档最可能需要更新：

| 文档 | 何时需要更新 |
|---|---|
| `AGENTS.md`（本文件） | 项目结构、文档索引、IPC 列表、开发规范发生变化 |
| `docs/plugin-bridge.md` | webview 插件 API 访问层接口、接入方式变化 |

---

## 9. 禁止操作

- ❌ 手动修改 `dist/` 或任何插件的 `dist/` 目录
- ❌ 使用 `npm` 或 `yarn`（必须用 `pnpm`）
- ❌ 在任何窗口中启用 `nodeIntegration: true`
- ❌ 绕过 `contextBridge` 直接在渲染进程使用 Node.js
- ❌ 修改 `pnpm-lock.yaml`（除非刻意升级依赖）
- ❌ 删除 `.codebuddy/` 目录

## 10. 重要提醒

- ⚠️ `pnpm-workspace.yaml` 中 `allowBuilds.electron: true` — 必须保持，否则 Electron 无法安装
- ⚠️ 插件 `vite.config.ts` 必须设置 `base: './'` — 否则 webview 加载时资源路径错误
- ⚠️ 新增插件后必须重新运行 `pnpm build:registry` — 否则注册表不会包含新插件
- ⚠️ Shell 的 `dist/shell/index.html` 由 Vite 构建输出，`main.ts` 中的 `"main"` 字段指向 `dist/main/main.js`
- ⚠️ **主进程和 preload 均由 `vite.main.config.ts` 构建**（双入口 CJS），`electron` 和所有 Node 内置模块已 external，不会被打包
- ⚠️ **构建期信息（git hash/branch/buildTime）通过 `vite.main.config.ts` 的 `define` 注入**，在主进程代码中以 `__GIT_HASH__`、`__GIT_BRANCH__`、`__BUILD_TIME__` 全局常量形式使用，由 `get-app-info` IPC 返回
- ⚠️ **插件可直接使用 `window.electronAPI`**，webview 内 preload 已注入；也可通过 `@toolbox/bridge` 的 `electronAPI` 对象访问（推荐，有类型安全）
- ⚠️ **`ElectronAPI` 接口的唯一来源是 `plugins/shared/bridge/src/types.ts`** — 禁止在其他位置重复定义，`src/shell/types/global.d.ts` 只做 re-export
- ⚠️ **新增 IPC 方法后只需更新 `types.ts`**，`index.ts` 的 Proxy 会自动透传，无需手动添加
- ⚠️ **preload 中所有 `ElectronAPI` 方法必须返回 `Promise`** — 包括同步实现也需包为 `Promise.resolve(...)`，以保证签名一致性
