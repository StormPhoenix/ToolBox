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
│   │   └── preload.ts                # contextBridge 安全 API 暴露
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
│       │   └── ToolViewer.vue        # iframe 插件查看器
│       ├── composables/
│       │   └── usePlugins.ts         # 插件注册表状态管理 composable
│       ├── data/
│       │   └── categories.ts         # 工具分类数据定义
│       ├── types/
│       │   ├── index.ts              # PluginManifest、Category 类型
│       │   └── global.d.ts           # Window.electronAPI 全局类型声明
│       └── styles/
│           └── global.css            # 全局 CSS Variables 设计系统
├── plugins/                          # 所有插件（pnpm workspace）
│   └── builtin/                      # 内置插件
│       └── welcome/                  # 欢迎页插件（示例）
│           ├── manifest.json         # 插件元数据
│           ├── package.json          # 独立 npm 包
│           ├── vite.config.ts        # 独立 Vite 构建配置
│           ├── src/
│           │   ├── index.html        # 插件 HTML 入口
│           │   ├── main.ts           # Vue 挂载
│           │   └── App.vue           # 插件主组件
│           └── dist/                 # 构建产物（自动生成）
├── scripts/
│   └── build-registry.mjs           # 扫描 plugins/ 生成 plugin-registry.json
├── dist/                             # 所有构建产物（自动生成，勿手动修改）
│   ├── main/                         # 主进程编译输出
│   ├── shell/                        # Shell Vue 构建输出
│   └── plugin-registry.json         # 插件注册表（由 build-registry 生成）
├── release/                          # electron-builder 打包输出
├── vite.shell.config.ts              # Shell 的 Vite 配置
├── tsconfig.json                     # TypeScript 基础配置
├── tsconfig.main.json                # 主进程 TS 配置
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

| 角色 | 目录 | 运行环境 | 模块系统 |
|------|------|----------|----------|
| **主进程** | `src/main/main.ts` | Node.js | CommonJS |
| **预加载脚本** | `src/main/preload.ts` | 隔离沙箱 | CommonJS |
| **Shell（主界面）** | `src/shell/` | Chromium + Vue 3 | ES Modules |
| **插件** | `plugins/<scope>/<id>/` | iframe 隔离 Chromium | ES Modules |

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
3. **执行时**：用户点击工具卡片 → `ToolViewer` 在 `<iframe>` 中加载插件 `dist/index.html`
4. **iframe 路径**：`../../plugins/builtin/<id>/dist/<entry>`（相对于 `dist/shell/index.html`）

### 3.4 Electron 安全规则（强制）

- `nodeIntegration: false`、`contextIsolation: true` — 所有窗口必须
- 跨进程通信 **只能** 通过 `contextBridge` + `ipcMain.handle` / `ipcRenderer.invoke`
- iframe `sandbox` 属性：`allow-scripts allow-same-origin allow-forms allow-modals`
- HTML 必须包含 `Content-Security-Policy` meta 标签

---

## 4. IPC API 完整列表

所有 API 通过 `window.electronAPI.*` 调用，定义在 `src/shell/types/global.d.ts`。

| 方法 | IPC 通道 | 说明 |
|------|----------|------|
| `getAppInfo()` | `get-app-info` | 获取应用/环境信息 |
| `showOpenDialog(options?)` | `dialog:showOpenDialog` | 打开文件选择对话框 |
| `showSaveDialog(options?)` | `dialog:showSaveDialog` | 打开文件保存对话框 |
| `readFile(path, encoding?)` | `fs:readFile` | 读取文件内容 |
| `writeFile(path, data, encoding?)` | `fs:writeFile` | 写入文件 |
| `readDir(path)` | `fs:readDir` | 列出目录内容 |
| `openInExplorer(path)` | `shell:openInExplorer` | 在资源管理器中打开 |

**新增 IPC 通道三步骤：**
1. `src/main/main.ts` — `ipcMain.handle('channel', handler)`
2. `src/main/preload.ts` — `contextBridge.exposeInMainWorld` 中添加方法
3. `src/shell/types/global.d.ts` — `ElectronAPI` 接口添加类型

---

## 5. 构建系统

### 5.1 构建命令

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装所有依赖（含 workspace 插件） |
| `pnpm build:main` | 编译主进程 TypeScript → `dist/main/` |
| `pnpm build:shell` | Vite 构建 Shell → `dist/shell/` |
| `pnpm build:plugins` | 构建所有插件 → 各插件 `dist/` |
| `pnpm build:registry` | 生成 `dist/plugin-registry.json` |
| `pnpm build` | 全量构建（上述四步顺序执行） |
| `pnpm start` | 全量构建 + 启动 Electron |
| `pnpm dev:main` | 监听编译主进程 |
| `pnpm dev:shell` | Vite dev server（Shell，端口 5173） |

### 5.2 开发模式

- 启动 `pnpm run dev:main`（监听主进程编译）
- 启动 `pnpm run dev:shell`（Vite dev server @ `http://localhost:5173`）
- 主进程中 `--dev` 参数会让 mainWindow 加载 `http://localhost:5173` 并开启 DevTools

### 5.3 新增插件步骤

1. 创建目录：`plugins/builtin/<id>/`
2. 创建 `manifest.json`（参考 §3.2 格式）
3. 创建 `package.json`（需包含 `"build": "vite build"` 脚本）
4. 创建 `vite.config.ts`：`root` 指向 `src/`，`outDir` 指向 `dist/`，`base: './'`
5. 创建 `src/index.html`、`src/main.ts`、`src/App.vue`
6. 运行 `pnpm install` 注册到 workspace
7. 运行 `pnpm build:plugins && pnpm build:registry` 更新注册表

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

## 8. 禁止操作

- ❌ 手动修改 `dist/` 或任何插件的 `dist/` 目录
- ❌ 使用 `npm` 或 `yarn`（必须用 `pnpm`）
- ❌ 在任何窗口中启用 `nodeIntegration: true`
- ❌ 绕过 `contextBridge` 直接在渲染进程使用 Node.js
- ❌ 修改 `pnpm-lock.yaml`（除非刻意升级依赖）
- ❌ 删除 `.codebuddy/` 目录

## 9. 重要提醒

- ⚠️ `pnpm-workspace.yaml` 中 `allowBuilds.electron: true` — 必须保持，否则 Electron 无法安装
- ⚠️ 插件 `vite.config.ts` 必须设置 `base: './'` — 否则 iframe 加载时资源路径错误
- ⚠️ 新增插件后必须重新运行 `pnpm build:registry` — 否则注册表不会包含新插件
- ⚠️ Shell 的 `dist/shell/index.html` 由 Vite 构建输出，`main.ts` 中的 `"main"` 字段指向 `dist/main/main.js`
