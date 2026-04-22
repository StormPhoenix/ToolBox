# 壁纸生成器插件设计文档

## 1. 功能概述

`wallpaper-maker` 是 ToolBox 内置插件，位于 `plugins/builtin/wallpaper-maker/`，分类为 `image`。

用户上传一张图片，选择一个或多个目标设备/比例，通过拖拽调整裁剪中心，一键导出适配所有所选设备的壁纸。

**典型场景：** 找到一张喜欢的图片，希望同时生成 iPhone、iPad、Mac、Windows 等多个设备的壁纸，不希望手动开 PS 或其他工具逐个裁剪。

---

## 2. 功能规格

### 2.1 图片导入

- 空状态显示大尺寸拖拽区域，提示"拖拽图片到此处，或点击选择"。
- 点击拖拽区打开系统文件对话框，过滤 `.jpg / .jpeg / .png / .webp / .heic`。
- 支持拖拽单张图片到任意位置。
- 每次导入**替换**当前图片（每次只处理一张）。
- 导入后在工作区中心展示原图，并在预设面板自动应用默认选中的设备比例。

### 2.2 设备预设

内置常用比例分组展示，每项显示"设备名 + 分辨率 + 比例"。

| 分组 | 预设条目 | 比例 | 推荐分辨率 |
|---|---|---|---|
| iPhone | iPhone 16 Pro Max | 9:19.5 | 1320×2868 |
| iPhone | iPhone 16 Pro | 9:19.5 | 1206×2622 |
| iPhone | iPhone SE | 9:16 | 750×1334 |
| iPad | iPad Pro 13" | 3:4 | 2064×2752 |
| iPad | iPad Air 11" | 41:59 | 1640×2360 |
| Mac | 16" MacBook Pro | 16:10.34 | 3456×2234 |
| Mac | Studio Display 27" | 16:9 | 5120×2880 |
| Windows | 4K 通用 | 16:9 | 3840×2160 |
| Windows | 2K 通用 | 16:9 | 2560×1440 |
| Android | 通用手机 | 9:20 | 1440×3200 |

- 每个预设条目带复选框，支持多选。
- 分组标题旁提供"全选 / 全不选"快捷操作。
- 默认选中一个最常用项（如 iPhone 16 Pro Max）。

### 2.3 自定义比例

- 预设面板底部"➕ 自定义比例"按钮，点击弹出表单：
  - 名称（必填）
  - 宽度（像素，必填，≥ 1）
  - 高度（像素，必填，≥ 1）
  - 备注（可选）
- 自定义条目展示在独立"我的预设"分组，支持编辑 / 删除。
- 自定义预设持久化到浏览器 `localStorage`，key 为 `wallpaper-maker.custom-presets`，值为 `CustomPreset[]` JSON。
- 每次打开插件时读取并合并到预设列表。

### 2.4 裁剪交互

- 主编辑区为"裁剪画布"，以当前**焦点预设**（多选时为列表第一个）的比例展示裁剪框。
- 原图按"contain"方式铺在画布上，裁剪框以**图片中心**为初始位置。
- 鼠标在画布内按住拖拽，裁剪框跟随鼠标中心点偏移，裁剪框不可超出图片边界。
- 滚轮（或缩放滑块）调整裁剪框大小，最小不低于图片短边 20%，最大不超过图片能容纳的最大尺寸。
- 双击重置为图片中心 + 默认尺寸。
- 用户调整后，所有预设**共享同一个归一化焦点**（中心点 `(fx, fy)` 取值 0–1），各自按比例独立计算裁剪矩形。

### 2.5 安全区域 overlay

- 预览缩略图和主编辑画布上，叠加**半透明遮罩**标示设备不可见 / 易被遮挡的区域。
- 遮罩为黑色、30% 不透明度，边缘虚线描边 1px。
- 每种预设有独立的 `safeArea` 配置，描述四个方向的遮挡比例：

| 设备类型 | 顶部 | 底部 | 左 / 右 |
|---|---|---|---|
| iPhone | 7%（灵动岛 / 状态栏） | 5%（Home Indicator） | 0 |
| iPad | 4% | 3% | 0 |
| Mac | 3%（菜单栏） | 8%（Dock） | 0 |
| Windows | 0 | 5%（任务栏） | 0 |
| Android | 5% | 4% | 0 |
| 自定义 | 0 | 0 | 0 |

- 提供开关"显示安全区域"，默认开启。

### 2.6 实时预览

- 右侧"预览"面板显示所有**已选预设**的缩略图，缩略图按实际比例展示，高度统一（如 120px）。
- 缩略图顶部显示设备名，底部显示目标分辨率。
- 裁剪焦点或缩放变化时，所有缩略图实时更新（每帧 `requestAnimationFrame` 节流）。

### 2.7 导出设置

底部操作栏可配置：

- **输出格式**：JPG / PNG / WebP（默认 JPG）。
- **质量**：JPG / WebP 显示滑块 60–100，默认 85；PNG 无此项。
- **输出目录**：默认桌面，点击"…"按钮通过系统对话框选择。
- **命名规则**：固定 `{原文件名}_{设备标识}.{ext}`，不暴露自定义（MVP 简化）。

导出设置持久化到 `localStorage`，key 为 `wallpaper-maker.export-options`。

### 2.8 导出执行

- "🎨 生成并导出"按钮。
- 启用条件：已导入图片 且 至少选中一个预设。
- 执行流程：
  1. 依次遍历每个选中预设。
  2. 渲染进程内用 `OffscreenCanvas` 将原图按焦点和缩放裁剪、缩放到目标分辨率。
  3. 通过 `canvas.convertToBlob` 导出为目标格式的二进制。
  4. 通过 `electronAPI.writeFile` 以 base64 写入输出目录。
- 进度条显示 `已导出 N / 总数`。
- 完成后弹出 Toast，提供"打开输出目录"快捷操作。

### 2.9 其他交互

- 顶栏"更换图片"按钮：清空当前图片和焦点状态，回到空状态。
- 图片已导入时再次拖入新图片，显示半透明遮罩提示"松开以替换当前图片"。
- 所有滑块 / 输入框变更即时生效，无需手动"应用"。

---

## 3. 技术设计

### 3.1 目录结构

```
plugins/builtin/wallpaper-maker/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── index.html
    ├── main.ts
    ├── App.vue                         # 主视图（三栏布局）
    ├── components/
    │   ├── PresetPanel.vue             # 左侧：预设分组、自定义
    │   ├── CropCanvas.vue              # 中间：裁剪画布 + 安全区 overlay
    │   ├── PreviewPanel.vue            # 右侧：多设备缩略图
    │   ├── PresetEditorDialog.vue      # 自定义预设表单
    │   └── ExportBar.vue               # 底部：导出设置与执行
    ├── composables/
    │   ├── useSourceImage.ts           # 源图片状态、导入、解码
    │   ├── useCropFocus.ts             # 归一化焦点 + 缩放状态
    │   ├── usePresets.ts               # 预设列表（内置 + 自定义）
    │   ├── useCustomPresetsStorage.ts  # localStorage 读写
    │   └── useExport.ts                # 批量导出逻辑
    └── data/
        └── builtin-presets.ts          # 内置预设表 + 安全区配置
```

### 3.2 核心数据模型

```typescript
/** 设备/比例预设 */
interface Preset {
  id: string;              // 唯一 id，如 "iphone-16-pro-max"
  name: string;            // 显示名
  group: 'iPhone' | 'iPad' | 'Mac' | 'Windows' | 'Android' | 'Custom';
  width: number;           // 目标分辨率宽（px）
  height: number;          // 目标分辨率高（px）
  safeArea: SafeArea;      // 安全区遮罩比例，0–1
  builtin: boolean;        // 是否内置
}

interface SafeArea {
  top: number;             // 0–1
  bottom: number;
  left: number;
  right: number;
}

/** 源图片 */
interface SourceImage {
  fileName: string;        // 不含扩展的原始文件名
  bitmap: ImageBitmap;     // 解码后的 bitmap，供 Canvas 绘制
  width: number;
  height: number;
}

/** 裁剪焦点（所有预设共享） */
interface CropFocus {
  cx: number;              // 中心点 x，归一化 0–1
  cy: number;              // 中心点 y，归一化 0–1
  zoom: number;            // 缩放系数，1 = 默认填满，>1 放大
}

/** 导出设置 */
interface ExportOptions {
  format: 'jpg' | 'png' | 'webp';
  quality: number;         // 60–100，PNG 忽略
  outputDir: string;       // 绝对路径
}
```

### 3.3 裁剪算法

对每个预设独立计算裁剪矩形：

```
给定：
  图片尺寸 (W, H)
  焦点 (cx, cy) ∈ [0,1]²
  缩放 zoom ≥ 1
  预设比例 r = preset.width / preset.height

1. 计算默认裁剪尺寸 (cw, ch)：
     若 W/H ≥ r: ch = H, cw = ch * r
     否则:       cw = W, ch = cw / r
2. 应用缩放：cw /= zoom, ch /= zoom
3. 计算裁剪中心像素：(px, py) = (cx * W, cy * H)
4. 计算裁剪矩形左上角：
     x = clamp(px - cw/2, 0, W - cw)
     y = clamp(py - ch/2, 0, H - ch)
5. 绘制到 OffscreenCanvas(preset.width, preset.height)：
     ctx.drawImage(bitmap, x, y, cw, ch, 0, 0, preset.width, preset.height)
```

### 3.4 依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `vue` | `^3.5.x` | UI 框架 |
| `@toolbox/bridge` | `workspace:*` | 访问 Electron 系统能力 |

**无额外图像处理依赖**。HEIC 解码依赖浏览器是否原生支持；若 Electron/Chromium 不支持 HEIC 输入，第一版文档明确标注"HEIC 支持视 Chromium 版本而定，不承诺兼容"，后续版本再评估引入 `heic2any`。

### 3.5 IPC 使用情况

完全复用现有 API，**无需新增 IPC 通道**：

| 调用 | 用途 |
|---|---|
| `electronAPI.showOpenDialog` | 选择源图片 |
| `electronAPI.showOpenDialog({ properties: ['openDirectory'] })` | 选择输出目录 |
| `electronAPI.readFile(path, 'base64')` | 读取源图片字节 |
| `electronAPI.writeFile(path, base64, 'base64')` | 写入导出壁纸 |
| `electronAPI.openInExplorer(dir)` | 在文件管理器中打开输出目录 |
| `electronAPI.getPathForFile(file)` | 拖拽导入时获取 File 的系统路径 |

### 3.6 持久化

仅使用 `localStorage`（webview 内独立作用域），不占用主进程存储：

| Key | 值 | 说明 |
|---|---|---|
| `wallpaper-maker.custom-presets` | `Preset[]`（仅 `group = 'Custom'`） | 用户自定义预设 |
| `wallpaper-maker.selected-preset-ids` | `string[]` | 上次选中的预设 id 列表 |
| `wallpaper-maker.export-options` | `ExportOptions` | 上次的导出设置 |

### 3.7 构建配置

`vite.config.ts` 标准模板：`root: 'src'`、`base: './'`、`outDir: '../dist'`，无需特殊 chunk 拆分（依赖很少）。

---

## 4. 交互流程

```
用户打开插件
    │
    ├─ 空状态 ──→ 点击 / 拖拽导入图片
    │                │
    │                ▼
    │         三栏编辑界面
    │         ├─ 左：预设面板
    │         │   ├─ 分组复选框 + 全选 / 全不选
    │         │   └─ 自定义预设（增 / 改 / 删）
    │         ├─ 中：裁剪画布
    │         │   ├─ 拖拽调整焦点
    │         │   ├─ 滚轮 / 滑块调整缩放
    │         │   ├─ 双击重置
    │         │   └─ 半透明安全区遮罩（可开关）
    │         └─ 右：预览缩略图（所选预设实时）
    │
    └─ 底部导出栏
        ├─ 选择格式 / 质量 / 输出目录
        ├─ 未导入图片 或 未选预设 → 按钮禁用
        └─ 点击"生成并导出"
                │
                ▼
            逐个预设计算裁剪 → 绘制到 OffscreenCanvas
                │
                ▼
            convertToBlob → base64 → electronAPI.writeFile
                │
                ▼
            进度条更新 → 完成 Toast → 打开输出目录
```
