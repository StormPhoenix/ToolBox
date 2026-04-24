# 插件 LLM 接口规范 — 问题分析与架构方向

> 状态：问题分析阶段，方案设计待定。
> 优先级：P0，计划下阶段开发。

---

## 1. 背景

ToolBox 目前并存两套独立系统：

| 维度 | 插件系统（Plugin） | Skill 系统 |
|------|-------------------|-----------|
| 面向 | 人类用户 | LLM |
| 运行环境 | webview（独立 Chromium 渲染进程） | 主进程（Node.js） |
| 驱动方式 | UI 交互触发业务逻辑 | 声明式 SKILL.md + .cjs 脚本 |
| 接口形式 | 无（无头调用入口） | inputSchema + riskLevel |

目标是让 LLM Agent 能够调用插件提供的能力，使两套系统的能力互通。

---

## 2. 现存问题

### 2.1 进程隔离——LLM 根本碰不到插件

LLM Agent 循环运行在**主进程**，调用的是 `SkillRegistry`。插件的业务逻辑封装在 **webview 渲染进程**的 Vue 组件里，主进程没有任何入口能直接触发。

典型场景：LLM 收到用户指令"帮我合并这三个 PDF"，`pdf-merge` 插件的合并能力完全不可达，LLM 只能尝试用 `run-script` Skill 绕路写脚本模拟，不稳定也不优雅。

此外，webview 实例不一定处于运行状态，即使强行通过 IPC 发消息也无法保证可用。

### 2.2 UI 与业务逻辑深度耦合

现有插件是"UI 即业务"的模式——业务逻辑散落在 Vue 组件的事件处理里，没有独立的服务层：

```
现状：
  用户 ──→ webview UI ──→ [业务逻辑在这里] ──→ 结果
```

LLM 调用需要一个**无头（headless）接口**，如 `mergePDFs(files[], outputPath)` 这样的纯函数。现有架构中不存在这一层，要让 LLM 可调用，必须先完成逻辑下沉。

### 2.3 manifest.json 没有 LLM 工具声明

现有 `manifest.json` 只包含 UI 展示信息：

```json
{ "id": "pdf-merge", "name": "PDF 合并", "description": "...", "category": "file" }
```

Skill 系统通过 SKILL.md frontmatter 为 LLM 提供结构化的工具声明（工具名、参数 schema、风险级别、确认提示文案）。插件没有对等机制，LLM 不知道插件能做什么，也没有标准的调用入口。

### 2.4 能力重叠但两套系统互不相通

| 能力 | Skill 系统 | 插件系统 | 问题 |
|------|-----------|---------|------|
| 文件读写 | `file-ops` + `file-write` | — | — |
| 批量重命名 | 仅简单 mv | `file-rename`（功能丰富） | LLM 无法调用插件的高级逻辑 |
| 图片缩放 | 无 | `image-resize` | LLM 能理解图片内容，却无法触发图片处理 |
| PDF 操作 | 无 | `pdf-merge/split/editor` | 对 LLM 完全不可见 |

已实现的高价值能力（PDF 处理、图片缩放）对 LLM Agent 完全透明，属于能力浪费。

### 2.5 双轨改造成本高

要让一个现有插件同时支持"UI 操作"和"LLM 调用"，需要：

1. 将业务逻辑从 Vue 组件中抽取出来，下沉至主进程服务层
2. webview 通过 IPC 调用主进程服务（UI 路径）
3. LLM 通过 Skill/工具接口调用同一服务（Agent 路径）

现有所有插件均未按此模式构建，改造涉及架构调整，成本不低。

---

## 3. 架构方向

根本缺失的是**插件服务层**——一个运行在主进程、可被 UI 和 LLM 双端调用的能力中枢：

```
理想架构：

  用户 ──→ webview UI ──────┐
                             ▼
                       主进程服务层（Plugin Service）
                             ▲
  LLM  ──→ 工具接口（声明式）─┘
```

两个调用方共享同一套主进程业务逻辑，插件只负责 UI 呈现，核心逻辑下沉至主进程，并通过声明式接口向 LLM 暴露。

### 3.1 关键设计决策（待定）

以下问题在方案设计阶段需要明确：

- **工具声明格式**：复用 SKILL.md 规范还是在 manifest.json 中扩展新字段？
- **注册机制**：插件工具是否纳入现有 `SkillRegistry`，还是独立维护 `PluginToolRegistry`？
- **改造策略**：全量改造现有插件，还是定义新规范让新插件遵循、旧插件按需迁移？
- **试点插件**：建议先选择一个插件（如 `image-resize`，主进程已有 `image-resize/` 服务层）作为架构试点，验证分层可行性后再推广。

---

## 4. 参考

- 现有 Skill 系统架构：[`docs/tech/skill-system.md`](../tech/skill-system.md)
- 插件桥接机制：[`docs/plugin-bridge.md`](../plugin-bridge.md)
