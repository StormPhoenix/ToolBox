# PDF 合并插件设计文档

## 1. 功能概述

`pdf-merge` 是 ToolBox 内置插件，位于 `plugins/builtin/pdf-merge/`，分类为 `file`。

用户可将多个 PDF 文件按自定义顺序和页码范围合并为一个新 PDF 文件。

---

## 2. 功能规格

### 2.1 文件导入

- 点击顶栏"添加文件"按钮，弹出系统文件对话框，支持多选（`multiSelections`），过滤 `.pdf` 格式。
- 支持将 PDF 文件拖拽到插件窗口任意位置，支持同时拖入多个文件。
- 每次导入为**追加**，不清空已有列表。
- 导入后自动用 `pdfjs-dist` 解析总页数，默认页码范围设为全部页（`1 – 总页数`）。

### 2.2 顺序调整

- 文件列表以卡片形式展示，每张卡片左侧有拖拽把手（`⠿`）。
- 使用 `sortablejs` 实现拖拽排序，动画时长 150ms，拖拽期间高亮被拖动卡片。
- 排序结果直接反映到合并顺序。

### 2.3 页码范围选择

- 每张卡片底部提供"起始页 / 终止页"两个数字输入框（1-based）。
- 失焦时自动 clamp：`startPage` 钳制到 `[1, endPage]`，`endPage` 钳制到 `[startPage, pageCount]`。
- 提供"全选"快捷按钮，一键恢复 `1 – 总页数`。
- 范围非法时（如起始 > 终止，或超出总页数）卡片边框变红，显示提示文字，合并按钮禁用。

### 2.4 合并执行

- 底部操作栏显示"🔗 合并并保存"按钮。
- 启用条件：文件数 ≥ 2 且所有文件页码范围合法。
- 点击后弹出系统保存对话框，默认文件名 `merged.pdf`。
- 用户确认路径后，在渲染进程内使用 `pdf-lib` 按列表顺序和页码范围拼接，最终通过 `electronAPI.writeFile` 以 base64 写入。
- 完成后弹出 Toast，提供"在文件管理器中显示"快捷操作。

### 2.5 其他交互

- 顶栏"清空"按钮：清空当前文件列表。
- 文件数 < 2 时，操作栏提示"至少需要 2 个文件"。
- 有文件时拖入新文件，显示半透明遮罩提示"松开以添加文件"。

---

## 3. 技术设计

### 3.1 目录结构

```
plugins/builtin/pdf-merge/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── index.html
    ├── main.ts
    ├── App.vue                        # 主视图
    ├── components/
    │   └── FileList.vue               # 可拖拽文件列表
    └── composables/
        ├── usePdfFiles.ts             # 文件列表状态、导入、校验
        └── useMergeExecute.ts         # 合并执行逻辑
```

### 3.2 核心数据模型

```typescript
interface PdfFileItem {
  id: string;          // 唯一 id（供 SortableJS key 使用）
  filePath: string;    // 系统文件路径
  fileName: string;    // 显示文件名
  pageCount: number;   // 总页数
  startPage: number;   // 起始页（1-based）
  endPage: number;     // 终止页（1-based）
  bytes: Uint8Array;   // 文件原始字节，供 pdf-lib 使用
}
```

### 3.3 依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `pdfjs-dist` | `^4.9.155` | 渲染进程解析 PDF 获取总页数 |
| `pdf-lib` | `^1.17.1` | 渲染进程按页范围拼接、生成输出 PDF |
| `sortablejs` | `^1.15.6` | 文件列表拖拽排序 |
| `@toolbox/bridge` | `workspace:*` | 访问 Electron 系统能力（文件对话框、读写文件） |

### 3.4 IPC 使用情况

PDF 读取和合并完全在渲染进程内完成，**无需新增 IPC 通道**，复用现有 API：

| 调用 | 用途 |
|---|---|
| `electronAPI.showOpenDialog` | 选择 PDF 文件（多选） |
| `electronAPI.readFile(path, 'base64')` | 读取 PDF 字节 |
| `electronAPI.showSaveDialog` | 选择输出路径 |
| `electronAPI.writeFile(path, base64, 'base64')` | 写入合并结果 |
| `electronAPI.openInExplorer(dir)` | 在文件管理器中显示输出目录 |

### 3.5 构建配置

`vite.config.ts` 通过 `manualChunks` 将大依赖独立分包，避免主 chunk 过大：

```
pdfjs-dist  → assets/pdfjs-*.js    (~364 KB)
pdf-lib     → assets/pdflib-*.js   (~430 KB)
sortablejs  → assets/sortable-*.js (~37 KB)
```

---

## 4. 交互流程

```
用户打开插件
    │
    ├─ 空状态 ──→ 点击 / 拖拽导入 PDF（支持多文件）
    │                │
    │                ▼
    │           文件列表（卡片）
    │           ├─ 拖拽把手调整顺序
    │           ├─ 起始页 / 终止页输入
    │           ├─ "全选"重置范围
    │           └─ "✕"删除单个文件
    │
    └─ 底部操作栏
        ├─ 文件数 < 2 → 提示，按钮禁用
        ├─ 存在无效范围 → 提示，按钮禁用
        └─ 满足条件 → 点击"合并并保存"
                          │
                          ▼
                     系统保存对话框
                          │
                     渲染进程 pdf-lib 合并
                          │
                     写入文件 → Toast 提示 → 可在文件管理器打开
```
