# 图像分辨率调整插件 — 设计文档

> 插件 ID：`image-resize` ｜ 分类：`image` ｜ 图标：🖼️ ｜ 所在：`plugins/builtin/image-resize/`

---

## 1. 功能概览

「图像分辨率调整」是一个将单张图像按指定**最大长边**等比缩放到目标尺寸并另存为的工具。核心特性：

- 拖拽或选择导入本地图片
- 展示图片基本信息与 EXIF（含 GPS）
- 用户指定最大长边 N，插件自动等比缩放（长边 ≤ N）
- 支持多种缩放算法，架构上预留 LLM 超分扩展点
- 预览区支持鼠标拖拽平移 + 滚轮缩放查看细节
- 处理结果另存为到用户指定路径，默认文件名带 `_resized` 后缀

### 1.1 目标用户场景

- 批量发图前压缩尺寸（微信、论坛、博客等场景）
- 素材归档时统一分辨率规格
- 未来：使用 LLM 超分算法对小图做高质量放大

### 1.2 V1 版本范围

- ✅ 单张图片处理
- ✅ 4 种经典缩放算法（最近邻 / 双线性 / 双三次 / Lanczos3）
- ✅ 完整 EXIF 读取与保留（含 GPS）
- ❌ 批量处理（UI 预留灰色入口，标注"即将推出"）
- ❌ LLM 超分（Provider 骨架预留，UI 显示但置灰 + TODO 标记）
- ❌ HEIC / RAW 输入
- ❌ 16-bit 色深 / 色彩管理（ICC profile）

---

## 2. UI 设计

### 2.1 布局（整体三区）

```
┌────────────────────────────────────────────────────────────────┐
│  [导入图片] [重置]                         [另存为...] [批量?]  │ ← 顶部操作条
├──────────────────┬─────────────────────────────────────────────┤
│                  │                                             │
│   左侧信息面板    │            右侧预览区（核心）                │
│   (320px 固定)   │           (flex: 1，可拖拽缩放)              │
│                  │                                             │
│  ┌ 基本信息 ───┐ │                                             │
│  │ 文件名      │ │       ┌─────────────────────────────┐      │
│  │ 大小        │ │       │                             │      │
│  │ 格式/色彩   │ │       │       处理后预览 (canvas)    │      │
│  │ 原始分辨率  │ │       │                             │      │
│  └────────────┘ │       │    ⊕ 拖拽平移 / 滚轮缩放     │      │
│                  │       │                             │      │
│  ┌ EXIF ──────┐ │       └─────────────────────────────┘      │
│  │ 相机型号    │ │        [- 缩放 100% +] [适应] [1:1]         │
│  │ 光圈/快门   │ │                                             │
│  │ ISO/焦距    │ │                                             │
│  │ 拍摄时间    │ │                                             │
│  │ GPS 坐标    │ │        结果信息:                             │
│  └────────────┘ │        ─────────                            │
│                  │        输出分辨率: 1920×1280                 │
│  ┌ 调整参数 ───┐ │        文件大小: 420 KB                      │
│  │ 最大长边     │ │        算法: Lanczos3                       │
│  │ [4000    px]│ │        耗时: 1.2 s                          │
│  │             │ │                                             │
│  │ 算法:        │ │                                             │
│  │ [Lanczos3▼]│ │                                             │
│  │ (放大时提示) │ │                                             │
│  │             │ │                                             │
│  │ 输出格式:    │ │                                             │
│  │ [JPEG ▼]    │ │                                             │
│  │ 质量 [━●━] 85│ │                                             │
│  │             │ │                                             │
│  │  [ 生成 ]   │ │                                             │
│  └────────────┘ │                                             │
└──────────────────┴─────────────────────────────────────────────┘
```

### 2.2 核心区域说明

#### 顶部操作条
- **导入图片**：打开文件对话框（`showOpenDialog`），限定支持的输入格式
- **重置**：清空当前图片，回到空状态
- **另存为**：仅在已生成预览时可点；调用 `showSaveDialog`，默认文件名 `<原名>_resized.<目标扩展名>`，默认目录为上次保存目录（本次会话内内存记忆，不持久化）
- **批量**（灰色占位）：鼠标 hover 显示"即将推出"

#### 空状态（未导入）
- 右侧预览区整个显示 Drop Zone：虚线边框 + 🖼️ 图标 + "拖拽图片到此处，或点击选择"
- 左侧信息面板所有卡片显示占位骨架

#### 导入后状态
- Drop Zone 收起；Drop Zone 顶部以 **256px 略缩图**（来自主进程 sharp 生成）替代大图标，方便用户确认导入了正确的图片
- 整个插件窗口仍接受拖拽（替换当前图片），但只显示半透明覆盖层作为反馈

#### 左侧：基本信息卡片
| 字段 | 来源 |
|---|---|
| 文件名 | path.basename |
| 文件大小 | fs.stat |
| 格式 | sharp metadata.format |
| 色彩空间 | sharp metadata.space（sRGB 等） |
| **原始分辨率**（视觉尺寸） | sharp `.rotate()` 后的 width × height |

#### 左侧：EXIF 卡片（默认展开）
- 相机型号（Make + Model）
- 光圈 / 快门 / ISO / 焦距
- 拍摄时间（DateTimeOriginal）
- **GPS 坐标（默认显示，不折叠）**：格式化为"纬度 经度"或链接到地图
- 若无 EXIF，显示"该图片不含 EXIF 信息"

#### 左侧：调整参数卡片
- **最大长边输入框**：数字输入，默认值 = 原图最长边（导入时自动填充）；单位 px
- **算法下拉**：分组展示，默认 Lanczos3
  ```
  ── 经典算法 ────
    Nearest Neighbor（最近邻）
    Bilinear（双线性）
    Bicubic（双三次）
    Lanczos3（推荐，默认）⭐
  ── AI 算法 ────
    LLM 超分（需配置）          [灰色 / TODO]
  ```
- **智能提示（算法下方小字）**：当"最大长边 > 原图长边"时显示"检测到放大操作，推荐使用 Bicubic 或 LLM 超分"
- **输出格式下拉**：JPEG / PNG / WebP / AVIF，默认**跟随原图格式**
- **质量滑杆**：仅在 JPEG/WebP/AVIF 下显示，范围 1-100，默认 85
- **生成按钮**：主色按钮，点击后进入 generating 状态

#### 右侧：预览区
- 空态：Drop Zone
- 有原图但未生成：提示"点击『生成』查看处理后的预览"
- generating 状态：大号 spinner + 文字"正在使用 Lanczos3 算法处理…"（>2s 时追加"大图处理较慢，请耐心等待"）
- 完成状态：显示处理后图像，支持拖拽/缩放
- 错误状态：统一错误面板（图标 + 标题 + 详情折叠 + 重试按钮）

预览区下方悬浮工具栏：
- 缩放百分比显示 `[- 100% +]`
- `[适应窗口]` `[1:1]` 快捷按钮

预览区右下角（或独立卡片）显示**结果信息**：
- 输出分辨率
- 实际文件大小（处理完成后精确值）
- 使用的算法
- 处理耗时

### 2.3 交互流程（状态机）

```
┌─────────┐   导入图片    ┌──────────┐
│  empty  │ ───────────▶ │ imported │
└─────────┘               └────┬─────┘
     ▲                         │ 点击生成
     │ 重置                    ▼
     │                    ┌──────────┐
     │                    │generating│ ← 参数面板置灰
     │                    └────┬─────┘
     │                         │ 成功
     │                         ▼
     │                    ┌──────────┐
     └─────────────────── │   done   │ ← 可另存为
                          └────┬─────┘
                               │ 参数变更
                               ▼
                          ┌──────────┐
                          │done+dirty│ ← 保留旧预览 + 提示"参数已修改"
                          └──────────┘
```

**关键规则**：
- 本版本**不支持**中途取消
- 参数变更后**不清空**已有预览，只在预览上方显示黄色条幅"参数已修改，点击生成以更新"
- 错误状态可重试，点击后回到 `generating`

### 2.4 预览图拖拽与缩放

完全在渲染进程用 `<canvas>` 实现，不引入重库。

**视图状态**：
```ts
interface ViewTransform {
  scale: number;       // 当前缩放倍率
  offsetX: number;
  offsetY: number;
}
```

**交互规则**：
| 操作 | 行为 |
|---|---|
| 滚轮 | 以**鼠标光标为锚点**缩放（zoom-to-cursor） |
| 鼠标左键拖拽 | 平移图像，光标变 `grabbing` |
| 双击 | 在「适应窗口」和「100%」之间切换 |
| `+` / `-` | 以画布中心为锚点缩放 |
| `0` | 重置视图到「适应窗口」 |
| 空格 | 按住时启用拖拽模式（避免按钮点击冲突） |

**缩放范围**：`minScale = fitToWindow`，`maxScale = 16`

**边界约束**：允许图像略微拖出视口，松手后带缓动回弹到合理范围，不做硬性限制。

**性能**：加载预览图时一次性解码为 `ImageBitmap`，每次重绘直接 `ctx.drawImage(bitmap, ...)`，避免重复解码。

---

## 3. Resize Provider 架构

这是本插件最核心的可扩展设计。借鉴项目已有的 `src/main/llm/` 结构（LLMRouter + Provider 模式），让本地算法和未来 LLM 超分共享同一套契约。

### 3.1 目录结构

```
src/main/image-resize/
├── types.ts              # 接口与类型定义
├── router.ts             # ResizeRouter — 路由 + 生命周期
├── image-ipc.ts          # registerImageResizeHandlers — 注册 IPC
├── temp-manager.ts       # 临时文件生命周期管理
├── metadata.ts           # sharp + exifr 元数据解析
└── providers/
    ├── nearest.ts        # sharp kernel: nearest
    ├── bilinear.ts       # sharp kernel: (cubic 的降级) 或 pica bilinear
    ├── bicubic.ts        # sharp kernel: cubic
    ├── lanczos.ts        # sharp kernel: lanczos3（默认）
    └── llm-upscale.ts    # 【TODO】LLM 超分 Provider 骨架
```

### 3.2 核心接口（`types.ts`）

```typescript
export type ResizeAlgorithmId =
  | 'nearest' | 'bilinear' | 'bicubic' | 'lanczos'
  | 'llm-upscale';                              // V2 扩展

export type ResizeCategory = 'classical' | 'ai';

export interface ResizeProviderInfo {
  id: ResizeAlgorithmId;
  displayName: string;
  description: string;
  category: ResizeCategory;
  available: boolean;                           // false 时 UI 置灰
  unavailableReason?: string;                   // 置灰原因（如"请配置 LLM"）
  supportsUpscale: boolean;
  supportsDownscale: boolean;
}

export interface ResizeOptions {
  algorithm: ResizeAlgorithmId;
  maxLongEdge: number;                          // 长边上限 N
  outputFormat: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;                             // 1-100，有损格式有效
  preserveExif: boolean;                        // V1 恒为 true

  // LLM Provider 可能用到的扩展字段
  llmOptions?: {
    model?: string;
    prompt?: string;
    scale?: 2 | 4;
  };
}

export interface ResizeResult {
  ok: true;
  tempOutputPath: string;                       // 临时文件路径（渲染进程通过 file:// 加载）
  width: number;
  height: number;
  byteSize: number;
  format: string;
  durationMs: number;
  actualAlgorithm: ResizeAlgorithmId;           // 实际使用（可能 fallback）
  warnings?: string[];
}

export interface ResizeError {
  ok: false;
  error: {
    code: 'DECODE_FAILED' | 'UNSUPPORTED_FORMAT' | 'DISK_FULL'
        | 'LLM_NOT_CONFIGURED' | 'LLM_API_ERROR' | 'UNKNOWN';
    message: string;                            // 用户可读的简短说明
    detail?: string;                            // 调试用详细信息（可折叠）
  };
}

export type ResizeResponse = ResizeResult | ResizeError;

export interface ResizeProvider {
  readonly info: Omit<ResizeProviderInfo, 'available' | 'unavailableReason'>;

  /** 预检：返回是否可用 + 原因（LLM 检查配置，本地算法恒为 true） */
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;

  /**
   * 核心处理方法。
   * @param inputPath  原图绝对路径
   * @param outputPath 目标临时文件路径（由 Router 分配）
   * @param options    处理选项
   */
  resize(
    inputPath: string,
    outputPath: string,
    options: ResizeOptions
  ): Promise<ResizeResult>;
}
```

### 3.3 Router（`router.ts`）

```typescript
class ResizeRouter {
  private providers = new Map<ResizeAlgorithmId, ResizeProvider>();
  private tempManager: TempManager;

  register(provider: ResizeProvider): void;

  /** 供 UI 填充下拉菜单。对所有 provider 调用 checkAvailability() */
  async listProviders(): Promise<ResizeProviderInfo[]>;

  /**
   * 端到端处理：
   * 1. 从 tempManager 分配输出路径
   * 2. 路由到具体 provider.resize()
   * 3. 错误统一 catch，转成 ResizeError 结构
   */
  async process(
    inputPath: string,
    options: ResizeOptions,
    sessionId: string
  ): Promise<ResizeResponse>;
}
```

**初始化时注册 4 个经典 provider**，`llm-upscale` 作为 TODO 注释留在 providers 目录，可通过注释开启。

### 3.4 内置 Provider 实现要点

所有经典 Provider 均基于 `sharp`，差异仅在 `kernel` 参数与 `fit` 策略：

| Provider | sharp 配置 |
|---|---|
| nearest | `.resize({ width, height, kernel: 'nearest', fit: 'inside' })` |
| bilinear | `.resize({ width, height, kernel: 'cubic', fit: 'inside' })` ※ sharp 无独立 bilinear，降级至 cubic；可标注"实际为 cubic 近似" |
| bicubic | `.resize({ width, height, kernel: 'cubic', fit: 'inside' })` |
| lanczos | `.resize({ width, height, kernel: 'lanczos3', fit: 'inside' })` |

> **设计说明**：sharp 没有独立的 bilinear kernel。为保持算法菜单的教学性与未来扩展空间，bilinear 当前实际走 cubic，在 `ResizeResult.warnings` 中声明"bilinear 当前以 cubic 近似实现"，或直接从菜单去掉（实现时二选一，默认保留）。

**所有 Provider 的通用 sharp 管线**：
```
sharp(inputPath)
  .rotate()                              // 自动应用 EXIF Orientation
  .resize({ kernel, fit: 'inside',
            width: targetW, height: targetH,
            withoutEnlargement: false })  // 允许放大（自动判断缩小/放大）
  .toFormat(format, { quality })
  .withMetadata()                        // 保留 EXIF（含 GPS、原 thumbnail）
  .toFile(outputPath)
```

**长边计算**（主进程内，接到 options 后立即算出 target 宽高）：
```typescript
const longEdge = Math.max(origW, origH);      // 视觉尺寸（.rotate() 后）
const ratio = options.maxLongEdge / longEdge; // 可能 > 1 (放大) 或 < 1 (缩小)
const targetW = Math.round(origW * ratio);
const targetH = Math.round(origH * ratio);
```

### 3.5 LLM Upscale Provider 骨架（V2 预留，本版不实现）

```typescript
// src/main/image-resize/providers/llm-upscale.ts
/**
 * TODO [V2]: 基于 LLM 的图像超分 Provider。
 *
 * 实现思路：
 * - checkAvailability() 调用 electronAPI.getLLMConfig()，检查 apiKey 是否配置；
 *   未配置时返回 { available: false, reason: '请先在设置中配置 LLM' }
 * - resize() 通过现有的 LLMRouter 调用多模态模型（如 gemini-2.x-pro-vision）
 *   或专用超分 API，将图像 buffer 作为输入，返回处理后的 buffer
 * - 由于 LLM 处理可能耗时数十秒，需要在 ResizeResult.warnings 中声明实际使用的模型
 */
export class LLMUpscaleProvider implements ResizeProvider { /* TODO */ }
```

### 3.6 新增算法的扩展指南（供后续开发）

添加新算法只需 3 步，**前端零改动**：

1. 在 `src/main/image-resize/providers/` 新建 `<id>.ts`，实现 `ResizeProvider` 接口
2. 在 `router.ts` 的初始化处 `router.register(new XxxProvider())`
3. 在 `types.ts` 的 `ResizeAlgorithmId` 联合类型中加入新 id

UI 的算法下拉菜单通过 `image-resize:list-providers` IPC 动态获取，自动显示新算法。

---

## 4. 临时文件生命周期

### 4.1 目录结构

```
<app.getPath('temp')>/toolbox-image-resize/
├── <sessionId>/                    # UUID v4，每个插件窗口会话一个目录
│   ├── thumb-<hash>.jpg            # 导入时生成的 256px 略缩图
│   ├── preview-<timestamp>.<ext>   # 每次"生成"产出一个预览
│   └── ...
```

每个插件 webview 窗口打开时由主进程分配一个 `sessionId`（UUID），渲染进程通过 `image-resize:parse-metadata` 第一次调用时返回给渲染进程；后续所有 IPC 均带上 `sessionId`。

### 4.2 清理规则

| 时机 | 行为 |
|---|---|
| 插件 webview 关闭 | 监听 `webContents.on('destroyed')`，删除对应 `sessionId` 目录 |
| 应用启动时 | 扫描 `toolbox-image-resize/` 下所有子目录，删除修改时间早于 **24 小时前**的残留 |
| 用户点击「另存为」成功后 | **不删除**，保留到窗口关闭（允许用户换路径再保存） |
| 同 session 内新的"生成" | **不删除**历史预览文件，以时间戳区分。未来批量场景下会产生大量预览文件，不做数量限制 |

### 4.3 实现要点（`temp-manager.ts`）

```typescript
class TempManager {
  private root = path.join(app.getPath('temp'), 'toolbox-image-resize');

  async allocSession(): Promise<string>;                   // 返回 sessionId
  async allocOutputPath(sessionId, ext): Promise<string>;  // 生成 preview-<ts>.<ext>
  async cleanupSession(sessionId: string): Promise<void>;
  async cleanupStale(maxAgeMs = 24 * 3600 * 1000): Promise<void>;  // 启动时调用
}
```

`cleanupStale` 在主进程 `app.whenReady()` 后立即异步调用一次，失败不影响启动。

---

## 5. EXIF 与元数据处理

### 5.1 元数据读取（`metadata.ts`）

```typescript
async function parseMetadata(inputPath: string): Promise<{
  basic: {
    filename: string;
    byteSize: number;
    format: string;
    colorSpace: string;
    width: number;      // 纠正 Orientation 后的视觉宽
    height: number;     // 纠正 Orientation 后的视觉高
  };
  exif: Record<string, unknown> | null;   // exifr 完整解析结果
  thumbnailPath: string;                  // 主进程生成的 256px 略缩图
}>
```

**流程**：
1. `sharp(inputPath).rotate().metadata()` 获取视觉尺寸与基本信息
2. `exifr.parse(inputPath, { gps: true, xmp: true, iptc: true })` 解析完整 EXIF
3. `sharp(inputPath).rotate().resize(256, 256, { fit: 'inside' }).toFile(thumbPath)` 生成略缩图

### 5.2 EXIF 输出规则（V1 固定行为）

- `.rotate()` 自动纠正并清除 Orientation 标记 → 避免方向错误
- `.withMetadata()` 保留所有其他 EXIF 字段（含 GPS、相机信息、**原 EXIF thumbnail**）
- **EXIF thumbnail 不覆盖**：保留原始数据（用户明确决策，此细节不处理）
- ICC profile 本版暂不处理

### 5.3 GPS 信息展示

- 默认**展开显示**（不折叠）
- 格式化为 `纬度 31.2304°N, 经度 121.4737°E`
- 未来可考虑附一个"在地图中查看"链接（V2）

---

## 6. 新增 IPC 通道

按 AGENTS.md §4「新增 IPC 三步骤」规范，本插件需新增 **4 个 IPC**。

### 6.1 通道清单

| IPC 通道 | 方法签名 | 说明 |
|---|---|---|
| `image-resize:list-providers` | `listResizeProviders(): Promise<ResizeProviderInfo[]>` | 返回算法列表 + 可用性 |
| `image-resize:parse-metadata` | `parseImageMetadata(filePath: string): Promise<ParseMetadataResult>` | 解析元数据 + 生成略缩图，返回 sessionId |
| `image-resize:process` | `resizeImage(inputPath: string, options: ResizeOptions, sessionId: string): Promise<ResizeResponse>` | 端到端处理，返回临时输出路径 |
| `image-resize:save-as` | `saveResizedImage(tempPath: string, targetPath: string): Promise<{ ok: boolean; error?: string }>` | 将临时文件复制到用户指定路径 |

### 6.2 返回类型

```typescript
interface ParseMetadataResult {
  sessionId: string;                      // 新建 / 复用的 session
  basic: { /* ... 见 §5.1 */ };
  exif: Record<string, unknown> | null;
  thumbnailPath: string;
}
```

### 6.3 接入规范（三步骤）

1. **`src/main/main.ts`**：引入 `registerImageResizeHandlers(ipcMain)` 并在 `app.whenReady()` 后调用
2. **`src/main/preload.ts`**：在 `contextBridge.exposeInMainWorld` 的 `electronAPI` 对象中追加 4 个方法（全部返回 Promise）
3. **`plugins/shared/bridge/src/types.ts`**：在 `ElectronAPI` 接口追加 4 个方法签名
   - 同时导出 `ResizeAlgorithmId`、`ResizeOptions`、`ResizeResponse`、`ResizeProviderInfo`、`ParseMetadataResult` 等类型供插件使用

渲染进程调用样例：
```typescript
import { electronAPI } from '@toolbox/bridge';

const meta = await electronAPI.parseImageMetadata(filePath);
const providers = await electronAPI.listResizeProviders();
const result = await electronAPI.resizeImage(filePath, options, meta.sessionId);
if (result.ok) {
  // result.tempOutputPath 可以用 file:// 协议在 <img> 或 canvas 中加载
}
```

---

## 7. 错误处理与用户反馈

### 7.1 错误分类

| code | 触发场景 | 用户提示 |
|---|---|---|
| `DECODE_FAILED` | sharp 解码失败（损坏图片） | "图片解码失败，可能文件已损坏" |
| `UNSUPPORTED_FORMAT` | 扩展名在白名单外 | "不支持的图片格式：xxx" |
| `DISK_FULL` | 写临时文件 ENOSPC | "磁盘空间不足，请清理后重试" |
| `LLM_NOT_CONFIGURED` | V2：LLM 未配置 | "请先在设置中配置 LLM" |
| `LLM_API_ERROR` | V2：LLM API 失败 | "LLM 调用失败：<原因>" |
| `UNKNOWN` | 其他 | "处理失败，详情：<message>" |

### 7.2 UI 呈现

失败时预览区替换为统一错误面板：

```
    ⚠️
  处理失败
  ────────
  图片解码失败，可能文件已损坏

  [▼ 查看详情]
  ─────────
  [ 重试 ]   [ 重新选择图片 ]
```

点击「查看详情」展开 `error.detail`（sharp 原始错误栈，便于排查）。

### 7.3 日志

所有错误均通过 `@toolbox/bridge` 的 `logger.ts` 转发到主进程持久化：
```typescript
logger.error('image-resize', `resize failed: ${error.message}`, error.detail);
```

---

## 8. 输入 / 输出格式

### 8.1 输入白名单

JPEG, PNG, WebP, GIF（仅首帧）, BMP, AVIF, SVG（光栅化处理）。

HEIC / RAW **本版不支持**，检测到扩展名匹配时返回 `UNSUPPORTED_FORMAT` 错误。

### 8.2 输出格式

| 格式 | 质量参数 | 说明 |
|---|---|---|
| JPEG | 1-100 | 有损，适合照片 |
| PNG | — | 无损，保留透明 |
| WebP | 1-100 | 有损/无损可选，本版走有损 |
| AVIF | 1-100 | 有损，压缩率高但编码慢 |

**默认值**：跟随输入格式；若输入是 GIF / BMP / SVG / HEIC 等非直接对应格式，fallback 为 JPEG（非透明）或 PNG（透明）。

### 8.3 导入方式

- **拖拽**：`dragover` / `drop` 事件，用 `webUtils.getPathForFile(file)` 拿绝对路径
- **点击选择**：`electronAPI.showOpenDialog({ filters: [...] })`
- **非本地文件**（来自浏览器拖拽等）：`getPathForFile` 返回空 → 提示"请从本地文件系统拖入图片"

---

## 9. 持久化策略

**本版全部不持久化**：
- 算法、输出格式、质量等参数每次打开插件都重置为默认值
- 最大长边默认填充原图的最长边（视觉尺寸）
- 另存为目录仅本次会话内内存记忆

---

## 10. 未来规划

| 功能 | 版本 | 简述 |
|---|---|---|
| LLM 超分 Provider | V2 | 接入现有 LLMRouter，调用多模态模型做超分 |
| 批量处理 | V2 | 多图队列、命名规则、进度条、失败重试 |
| HEIC 输入 | V2 | 主进程加入 libheif 支持（或限定 macOS 系统解码） |
| 色彩管理 | V3 | ICC profile 嵌入与转换 |
| RAW 输入 | V3 | 基于 dcraw / libraw |
| 16-bit / HDR | V3 | PNG 16-bit、AVIF HDR |

---

## 11. 已知限制

- ICC profile 不处理，嵌入 Adobe RGB 等广色域 profile 的图片输出后色彩可能偏色
- HEIC / RAW 不支持
- EXIF thumbnail 不更新，在部分文件管理器中可能显示过时略缩图
- bilinear 算法由 sharp cubic 近似实现（若保留于菜单中，将在 warnings 中声明）

---

## 附：文件清单预览（实现时）

```
新增：
  src/main/image-resize/
    types.ts
    router.ts
    image-ipc.ts
    temp-manager.ts
    metadata.ts
    providers/{nearest,bilinear,bicubic,lanczos,llm-upscale}.ts
  plugins/builtin/image-resize/
    manifest.json
    package.json
    tsconfig.json
    vite.config.ts
    src/
      index.html
      main.ts
      App.vue
      components/
        DropZone.vue
        InfoPanel.vue
        ExifPanel.vue
        ParamsPanel.vue
        PreviewCanvas.vue
        ResultInfo.vue
      composables/
        useImageSession.ts        # 封装 parseMetadata + resize + saveAs 流程
        useCanvasViewport.ts      # 预览区拖拽/缩放逻辑
      types.ts

修改：
  src/main/main.ts                # 注册 handlers + 启动清理
  src/main/preload.ts             # 暴露 4 个新方法
  plugins/shared/bridge/src/types.ts  # ElectronAPI 接口扩展
  AGENTS.md                       # §4 IPC 列表、§8.2 文档索引
  docs/design/index.md            # 登记本文档

依赖：
  根 package.json 新增：
    sharp (主进程)
    exifr (主进程)
  plugins/builtin/image-resize/package.json：
    vue, @toolbox/bridge
```
