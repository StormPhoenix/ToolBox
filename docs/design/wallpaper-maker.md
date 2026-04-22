# 壁纸制作器插件设计文档

## 1. 功能概述

`wallpaper-maker` 是 ToolBox 内置插件，位于 `plugins/builtin/wallpaper-maker/`，分类为 `image`。

用户上传一张图片，从内置设备预设库中选择目标设备，在右侧预览区独立调整每个预设的裁剪位置与缩放，一键批量导出所有设备壁纸。

**典型场景：** 找到一张喜欢的图片，希望同时生成 iPhone、iPad、Mac、Windows 等多个设备的壁纸，不希望手动开 PS 或其他工具逐个裁剪。

---

## 2. 功能规格

### 2.1 图片导入

- 空状态显示导入栏，提示"拖拽图片到此处，或点击选择"。
- 点击导入区打开系统文件对话框，过滤 `.jpg / .jpeg / .png / .webp`。
- 支持拖拽单张图片到插件任意位置导入。
- 每次导入**替换**当前图片（每次只处理一张）。
- 导入后在顶部展示原始图缩略图、文件名、分辨率，并提供"更换图片"按钮。
- 图片已导入时再次拖入新图片，显示半透明遮罩提示"松开以替换当前图片"。

### 2.2 设备预设库（内置）

内置常用比例分组，每项显示"设备名 + 分辨率"：

| 分组 | 预设条目 | 分辨率 |
|---|---|---|
| iPhone | iPhone 16 Pro Max | 1320×2868 |
| iPhone | iPhone 16 Pro | 1206×2622 |
| iPhone | iPhone SE | 750×1334 |
| iPad | iPad Pro 13" | 2064×2752 |
| iPad | iPad Air 11" | 1640×2360 |
| Mac | 16" MacBook Pro | 3456×2234 |
| Mac | Studio Display 27" | 5120×2880 |
| Windows | 4K 通用 | 3840×2160 |
| Windows | 2K 通用 | 2560×1440 |
| Android | 通用手机 | 1440×3200 |

### 2.3 预设工作列表（主界面左下）

- 初始为**空列表**，无默认预设。
- 顶部 `＋` 按钮，点击后弹出**内置预设选择弹窗**，弹窗中按分组列出所有内置预设。
- 已添加到工作列表的预设在弹窗中**置灰**，不可重复添加。
- 工作列表中每个条目显示设备名 + 分辨率，支持**删除**（从列表移除，不影响内置库）。
- 点击列表中某个预设，右侧预览区切换到该预设的裁剪视图，激活项有左侧高亮边框。
- 工作列表持久化到 `localStorage`（key: `wallpaper-maker.selected-preset-ids`）。

### 2.4 裁剪预览区（主界面右下，核心区域）

- 点击左侧预设后，右侧展示该预设对应比例的**裁剪预览**，图片以 **cover 铺满**为初始状态（居中，不留黑边）。
- 每个预设的裁剪位置和缩放**独立保存**，切换预设后回来保留上次调整结果。
- 在预览区内**按住拖拽**图片，调整裁剪位置；图片不可拖出预览框边界（始终铺满）。
- 在预览区内**滚轮**缩放图片，最小为 zoom=1（cover 铺满），最大不超过原图尺寸上限。
- **双击**预览区或点击"↺ 重置"按钮，重置为默认 cover 居中状态。
- 预览框上叠加**安全区域半透明遮罩**（黑色 30% 不透明度，虚线描边），标示设备易遮挡区域。
- 提供"安全区域"开关，默认开启。
- 未导入图片时显示"请先导入图片"；已导入但无激活预设时显示"请从左侧添加并选择预设"。

**安全区遮罩配置：**

| 设备类型 | 顶部 | 底部 | 左/右 |
|---|---|---|---|
| iPhone | 7% | 5% | 0 |
| iPad | 4% | 3% | 0 |
| Mac | 3% | 8% | 0 |
| Windows | 0 | 5% | 0 |
| Android | 5% | 4% | 0 |

### 2.5 底部导出通栏

- **输出格式**：JPG / PNG / WebP（默认 JPG）。
- **质量滑块**：JPG / WebP 显示 60–100，默认 85；PNG 时隐藏。
- **输出目录**：默认桌面（空时首次导出弹窗选择），点击"…"通过系统对话框修改。
- **命名规则**：`{原文件名}_{设备id}.{ext}`，不可自定义。
- **"🎨 生成并导出"按钮**：启用条件为已导入图片且工作列表不为空；未手动调整的预设使用默认 cover 居中裁剪。
- 导出时显示进度 `N / 总数`。
- 导出完成后弹出 Toast，提供"📂 打开输出目录"快捷操作。
- 导出设置持久化到 `localStorage`（key: `wallpaper-maker.export-options`）。

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
    ├── App.vue                         # 根组件（顶部导入区 + 主体 + 底部导出栏）
    ├── components/
    │   ├── PresetPanel.vue             # 左侧：工作列表 + 添加预设弹窗
    │   ├── CropPreview.vue             # 右侧：Canvas 裁剪预览 + 安全区 overlay
    │   └── ExportBar.vue               # 底部：导出设置与执行
    ├── composables/
    │   ├── useSourceImage.ts           # 源图片状态、导入、解码
    │   ├── usePresets.ts               # 工作列表状态（内置预设选择）
    │   ├── useCropState.ts             # 每预设独立裁剪状态 + 裁剪算法
    │   └── useExport.ts                # 批量导出逻辑 + 导出选项
    └── data/
        └── builtin-presets.ts          # 内置预设表 + 安全区配置
```

### 3.2 核心数据模型

```typescript
interface Preset {
  id: string;
  name: string;
  group: 'iPhone' | 'iPad' | 'Mac' | 'Windows' | 'Android';
  width: number;
  height: number;
  safeArea: SafeArea;
}

interface SafeArea {
  top: number;    // 0–1
  bottom: number;
  left: number;
  right: number;
}

interface SourceImage {
  fileName: string;    // 不含扩展名
  bitmap: ImageBitmap;
  width: number;
  height: number;
  dataUrl: string;     // 用于 <img> 缩略图
}

interface CropState {
  cx: number;   // 中心点 x，归一化 0–1，初始 0.5
  cy: number;   // 中心点 y，归一化 0–1，初始 0.5
  zoom: number; // 缩放系数，1 = cover 铺满，> 1 放大
}

interface ExportOptions {
  format: 'jpg' | 'png' | 'webp';
  quality: number;   // 60–100，PNG 忽略
  outputDir: string;
}
```

### 3.3 裁剪算法（`computeCropRect`）

```
给定：
  图片尺寸 (W, H)
  预设比例 r = preset.width / preset.height
  裁剪状态 { cx, cy, zoom }

1. 计算 cover 铺满时的裁剪尺寸 (sw, sh)：
     若 W/H >= r: sh = H, sw = sh * r
     否则:        sw = W, sh = sw / r

2. 应用缩放：sw /= zoom, sh /= zoom

3. 中心像素：(px, py) = (cx * W, cy * H)

4. 左上角（clamp 防止越界）：
     sx = clamp(px - sw/2, 0, W - sw)
     sy = clamp(py - sh/2, 0, H - sh)

5. 绘制：
     ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, preset.width, preset.height)
```

### 3.4 依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `vue` | `^3.5.x` | UI 框架 |
| `@toolbox/bridge` | `workspace:*` | 访问 Electron 系统能力 |

无额外图像处理依赖，全部使用浏览器原生 `Canvas` / `OffscreenCanvas` / `ImageBitmap`。

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

仅使用 `localStorage`（webview 内独立作用域）：

| Key | 值 | 说明 |
|---|---|---|
| `wallpaper-maker.selected-preset-ids` | `string[]` | 工作列表中的预设 id |
| `wallpaper-maker.export-options` | `ExportOptions` | 上次的导出设置 |

### 3.7 构建配置

`vite.config.ts`：`root: 'src'`、`base: './'`、`outDir: '../dist'`，无需特殊 chunk 拆分。

---

## 4. UI 布局

```
┌─────────────────────────────────────────────────────────┐
│  顶部：图片导入区（缩略图 / 空状态拖拽提示）              │  ~62px
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  左侧        │  右侧：裁剪预览区                         │
│  预设工作    │  ┌─ 工具条：设备名 · 安全区开关 · 重置 ──┐ │
│  列表        │  │                                      │ │
│  （＋添加）  │  │   Canvas 裁剪预览                    │ │
│              │  │   （拖拽 / 滚轮缩放 / 双击重置）       │ │
│  200px       │  └──────────────────────────────────────┘ │
│              │                                          │
├──────────────┴──────────────────────────────────────────┤
│  底部导出通栏：格式 | 质量 | 输出目录 | 🎨 生成并导出     │  ~48px
└─────────────────────────────────────────────────────────┘
```

---

## 5. 交互流程

```
用户打开插件
    │
    ├─ 顶部：点击 / 拖拽导入图片
    │         │
    │         ▼
    │    显示缩略图，可"更换图片"
    │
    ├─ 左侧：点击 ＋ → 弹窗选择设备 → 添加到工作列表
    │         │
    │         ▼
    │    点击工作列表中的预设 → 右侧切换预览
    │         │
    │         ▼
    │    拖拽调整裁剪位置 / 滚轮缩放 / 双击重置
    │
    └─ 底部：选择格式/质量/目录 → 点击"生成并导出"
                │
                ▼
            逐个预设：computeCropRect → OffscreenCanvas.drawImage
                │
                ▼
            convertToBlob → base64 → electronAPI.writeFile
                │
                ▼
            进度更新 → 完成 Toast → 打开输出目录
```
