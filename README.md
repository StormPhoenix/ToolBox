# 🧰 ToolBox

一个基于 **Electron + TypeScript** 的桌面端应用项目。

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **TypeScript** - 类型安全的 JavaScript 超集
- **pnpm** - 快速、节省磁盘空间的包管理器

## 环境要求

- **Node.js** >= 20
- **pnpm** >= 8

## 项目结构

```
ToolBox/
├── src/
│   ├── main/           # 主进程代码
│   │   ├── main.ts     # 主进程入口
│   │   └── preload.ts  # 预加载脚本
│   └── renderer/       # 渲染进程代码
│       ├── index.html   # 页面模板
│       ├── styles.css   # 样式
│       ├── renderer.ts  # 渲染进程逻辑
│       └── global.d.ts  # 全局类型声明
├── dist/               # 编译输出（自动生成）
├── release/            # 打包输出（自动生成）
├── tsconfig.json       # TypeScript 基础配置
├── tsconfig.main.json  # 主进程 TS 配置
├── tsconfig.renderer.json # 渲染进程 TS 配置
└── package.json
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式（编译 + 启动）
pnpm start

# 仅监听文件变化编译
pnpm dev

# 构建
pnpm build

# 打包成可分发的安装包
pnpm dist
```

## 脚本说明

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 监听文件变化并自动编译 |
| `pnpm build` | 编译所有 TypeScript 文件 |
| `pnpm start` | 编译并启动 Electron 应用 |
| `pnpm pack` | 编译并打包为目录（不生成安装包） |
| `pnpm dist` | 编译并打包为可分发的安装包 |

## 架构说明

- **主进程** (`src/main/main.ts`): 控制应用生命周期、创建窗口、处理系统级操作
- **预加载脚本** (`src/main/preload.ts`): 通过 `contextBridge` 安全地暴露 API 给渲染进程
- **渲染进程** (`src/renderer/`): 负责 UI 展示和用户交互，通过 `window.electronAPI` 与主进程通信

## License

MIT
