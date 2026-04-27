# Persona Studio 设计文档

> 状态：设计完成，待实现。
> 优先级：已立项。
> 关联文档：[persona-feature-design.md](persona-feature-design.md)（Chat 侧消费，后续集成）

---

## 1. 背景与目标

Persona Studio 是一个独立功能模块，用于将用户提交的原始材料（文本、文件、URL）通过 LLM 蒸馏为可复用的"思维角色"，并以 SKILL.md 格式持久化保存，供其他模块（如 LLM Chat 角色注入）消费。

**核心价值**：解决现有纯 prompt Skill 只能手写、无法从材料自动生成的问题，提供一条"材料 → 人格 → 角色 Skill"的完整生产链路。

**与 Chat 集成的关系**：本期只做"生产侧"（蒸馏 + 持久化），Chat 侧的"消费侧"（角色选择器、system prompt 注入）留在 [persona-feature-design.md](persona-feature-design.md) 中单独立项，两者通过 `userData/skills/` 目录解耦。

---

## 2. 架构概览

```
Phase A：材料收集（用户主导，Shell 侧）
  文本输入 / 文件上传 / URL 预取（persona:fetch-url）
        ↓
Phase B-1：并行提取（主进程，extraction-prompt.md 驱动）
  对每份材料独立调用 LLM → 压缩摘要
        ↓
Phase B-2：配方引导合成（主进程，配方 SKILL.md body 驱动）
  把所有摘要合并送入 LLM → 产出 SKILL.md 草稿（流式）
        ↓
Phase C：Review & Edit（Shell 侧，Markdown 编辑器）
        ↓
Phase D：保存（persona:save）
  写入 userData/personas/<id>/SKILL.md + meta.json
        ↓
Phase E：发布为 Skill（persona:publish，用户手动触发）
  复制到 userData/skills/<id>/SKILL.md
  → Skill 系统自动识别为 kind=persona（无 tools 声明）
  → 等待 Chat 侧集成后即可在角色选择器中使用
```

---

## 3. 配方系统（Recipe）

### 3.1 配方格式

配方采用 **SKILL.md 兼容格式**，可直接导入开源蒸馏 Skill 项目（如 `nuwa-skill`、`colleague-skill` 等）：

```markdown
---
name: "公众人物思维模型蒸馏"
description: "侧重思维框架与决策启发式，适合有大量公开作品的人物"
version: "1.0.0"
metadata:
  toolbox:
    type: "recipe"          # 标识为配方（可选，放入 persona-recipes/ 即视为配方）
    recipe:
      suitable_for:         # 可选，UI 推荐提示用
        - public-figure
        - thought-leader
---

（Markdown body = Phase B-2 合成阶段的 LLM system prompt）
你是一个人格蒸馏专家。基于以下材料摘要，为指定人物生成一份 SKILL.md...
```

**宽容解析原则**：配方 loader 只要求 `name` 字段和非空 Markdown body；未包含 `metadata.toolbox.type: recipe` 的开源 SKILL.md 放入配方目录后自动视为配方，body 直接作为合成 prompt，用户在 Review 阶段承担输出质量的把关职责。

**配方不约束输出模板**：由配方 body 的 prompt 指导 LLM 如何构建输出 SKILL.md，代码层不注入任何结构约束。合成调用时，仅在 user message 最前附加一行兜底提示：

```
（以下是材料摘要，请按配方要求进行蒸馏，输出内容将作为 SKILL.md 文件保存，请确保包含合法的 YAML frontmatter。）
```

### 3.2 配方目录

| 来源 | 路径 | 加载时机 |
|---|---|---|
| 内置配方 | `src/main/persona/builtin-recipes/<name>/SKILL.md` | 构建时 copy 到 `dist/main/persona/builtin-recipes/`，运行时加载 |
| 用户自定义 | `userData/persona-recipes/<name>/SKILL.md` | 运行时动态扫描，重启后生效 |

V1 提供 4 个内置配方：

| 配方 | 适用场景 |
|---|---|
| `public-figure` | 有公开作品、采访记录的公众人物，侧重思维模型与表达 DNA |
| `thought-leader` | 思想领袖、学者，侧重心智框架与价值观体系 |
| `colleague` | 职场同事、上下级，侧重关系互动模式与沟通风格 |
| `self` | 自我蒸馏，基于个人笔记/日记/聊天记录构建自我角色 |

---

## 4. 提取阶段 Prompt（Phase B-1）

### 4.1 存放位置

```
src/main/persona/extraction-prompt.md   ← 源文件（开发时编辑此处）
dist/main/persona/extraction-prompt.md  ← 构建产物（运行时读取）
```

构建时由 `pnpm build:personas` 一同 copy；运行时通过 `path.join(__dirname, 'extraction-prompt.md')` 读取。开发期间可直接修改 `dist/main/persona/extraction-prompt.md`，下次 distill 调用时立即生效，无需重启 Electron。

### 4.2 Prompt 内容（初版）

```markdown
你是一个材料摘要专家。你的任务是从以下单份材料中提取关键信息，
为后续的人格合成提供素材。

请关注：
- 这个人物如何描述自己的思考方式或决策过程
- 这个人物使用的独特词汇、比喻、表达习惯
- 这个人物明确表达或隐含的价值观、信念
- 这个人物面对困境时的典型反应或立场

以自由格式输出要点，不需要结构化。
若材料与人物无关，输出"无关材料，跳过"。
```

---

## 5. 持久化结构

### 5.1 Persona 产物目录

```
userData/
  persona-recipes/              # 用户自定义配方（放入即生效，重启加载）
    <recipe-name>/
      SKILL.md

  personas/
    <persona-id>/               # id = 时间戳-slug，如 "20260427-elon-musk"
      meta.json                 # PersonaMeta（见 §5.2）
      materials/                # 原始材料本地存档
        source-0.txt            # 文本输入
        source-1.md             # URL 抓取结果（Markdown）
        source-2.txt            # 文件提取的文本内容
      extractions/              # Phase B-1 中间摘要（可选，用于调试追溯）
        source-0.txt
        source-1.txt
      SKILL.md                  # 蒸馏产物 + 用户编辑后的权威版本

  skills/
    <persona-id>/               # 发布时生成，供 Skill 系统消费
      SKILL.md                  # 从 personas/<id>/SKILL.md 复制而来
```

### 5.2 PersonaMeta 类型

```typescript
interface PersonaMeta {
  id: string;
  name: string;
  recipe_name: string;
  status: 'draft' | 'published';
  created: string;   // ISO 8601
  updated: string;   // ISO 8601
  sources: Array<{
    type: 'text' | 'file' | 'url';
    label: string;      // 文件名或 URL
    stored_as: string;  // materials/ 目录下的文件名
  }>;
}
```

代码层不感知 SKILL.md 的内容结构，内容 schema 完全由配方决定。

---

## 6. 主进程模块结构

```
src/main/persona/
  types.ts                  # PersonaMeta + Recipe 类型（轻量）
  recipe-loader.ts          # 扫描内置 + userData/persona-recipes/，宽容解析 SKILL.md
  recipe-registry.ts        # 单例，管理配方列表
  material-collector.ts     # URL 抓取（fetch）+ 文件读取 → 写 materials/
  distiller.ts              # B-1 并行提取 + B-2 配方合成；流式推送 persona:event
  persona-store.ts          # 读写 meta.json / materials/ / SKILL.md
  publisher.ts              # 发布：复制 SKILL.md → userData/skills/<id>/
  persona-ipc.ts            # 注册所有 IPC handler；initializePersonaSystem()

  extraction-prompt.md      # Phase B-1 通用提取 prompt（可直接编辑）
  builtin-recipes/
    public-figure/
      SKILL.md
    thought-leader/
      SKILL.md
    colleague/
      SKILL.md
    self/
      SKILL.md
```

`initializePersonaSystem()` 在 `app.whenReady()` 时由 `main.ts` 调用，负责初始化 RecipeRegistry 并注册所有 IPC handler，与 `initializeSkillSystem()` 并列。

---

## 7. IPC API

所有方法通过 `window.electronAPI.*` 调用（Shell 侧）。

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `personaListRecipes()` | `persona:list-recipes` | 列出所有可用配方（内置 + 用户自定义） |
| `personaFetchUrl(url)` | `persona:fetch-url` | 抓取 URL → 返回 Markdown 文本（材料收集阶段用） |
| `personaDistill(input)` | `persona:distill` | 启动蒸馏，立即返回 `{ requestId }`；进度通过 `persona:event` 推送 |
| `personaDistillAbort(requestId)` | `persona:distill-abort` | 中止进行中的蒸馏 |
| `personaSave(input)` | `persona:save` | 保存/更新 SKILL.md + meta.json（status: draft） |
| `personaList()` | `persona:list` | 列出所有 persona（PersonaMeta 数组） |
| `personaLoad(id)` | `persona:load` | 加载某个 persona 的 meta + SKILL.md 文本 |
| `personaDelete(id)` | `persona:delete` | 删除 persona（同时撤销发布） |
| `personaPublish(id)` | `persona:publish` | 发布：复制 SKILL.md → `userData/skills/<id>/`，status → published |
| `personaUnpublish(id)` | `persona:unpublish` | 撤销发布：删除 `userData/skills/<id>/`，status → draft |
| `personaOpenRecipeDir()` | `persona:open-recipe-dir` | 在 Finder 打开 `userData/persona-recipes/`（不存在时自动创建） |
| `onPersonaEvent(cb)` | `persona:event`（push） | 订阅蒸馏进度事件流，返回 dispose 函数 |

### PersonaDistillInput 类型

```typescript
interface PersonaDistillInput {
  recipe_name: string;
  materials: Array<{
    type: 'text' | 'file' | 'url';
    label: string;
    content: string;   // 文本内容（URL 内容由 personaFetchUrl 预取后传入）
  }>;
}
```

### persona:event 事件类型

| event type | 说明 |
|---|---|
| `extract-start` | `{ requestId, sourceIndex, total }` 开始提取某个材料 |
| `extract-done` | `{ requestId, sourceIndex }` 某材料提取完成 |
| `synthesis-chunk` | `{ requestId, chunk: string }` 合成阶段流式输出片段 |
| `synthesis-end` | `{ requestId }` 合成完成 |
| `error` | `{ requestId, message: string }` 蒸馏出错 |
| `aborted` | `{ requestId }` 蒸馏被中止 |

---

## 8. Shell UI 设计

### 8.1 入口

侧边栏底部固定区域，与"AI 对话"和"设置"并列，使用 🎭 图标，标签"角色工坊"。

### 8.2 整体布局

两栏结构，类比 Chat 页面：

```
┌──────────────┬─────────────────────────────────────────┐
│  左栏        │  右栏（随状态切换）                      │
│  Persona 列表│                                          │
│              │  [空态]     选择或新建人格               │
│  + 新建      │  [新建流程] Step 1-5 向导                │
│              │  [详情]     已保存人格的编辑/发布         │
│  草稿 (3)    │                                          │
│  已发布 (2)  │                                          │
└──────────────┴─────────────────────────────────────────┘
```

### 8.3 新建向导（右栏 5 步）

**Step 1：选择配方**
- 卡片列表展示所有配方，含名称、描述、`suitable_for` 标签
- 用户可预览配方 SKILL.md body

**Step 2：添加材料**
- 支持三种来源（可混合）：
  - 文本框：直接粘贴文字
  - 文件上传：拖拽或点击，调用 `showOpenDialog`，读取内容
  - URL 输入：输入后点"抓取"，调用 `personaFetchUrl`，显示抓取结果预览
- 材料列表可删除单项
- 显示已添加数量，提示"建议至少提供 2 份材料"

**Step 3：蒸馏进行中**
- 进度列表：
  ```
  ✓ 提取材料 1/3（notes.txt）
  ✓ 提取材料 2/3（https://example.com）
  ⟳ 提取材料 3/3（手动输入）...
    合成中...（等待提取完成）
  ```
- 合成开始后，下方实时显示流式输出的 SKILL.md 内容（Markdown 渲染）
- 顶部提供"中止"按钮

**Step 4：Review & Edit**
- 左：可编辑的 Markdown 文本区（SKILL.md 草稿全文）
- 右：渲染后的预览（与 MarkdownView.vue 复用）
- 提示："可直接编辑左侧内容，确认无误后继续"

**Step 5：命名并保存**
- 输入框：人格名称（预填为配方从 SKILL.md frontmatter 提取的 `name`）
- 点"保存草稿"：调用 `personaSave`，进入 Persona 详情视图

### 8.4 Persona 详情视图（右栏）

```
[人格名称]                         [状态徽标：草稿 / 已发布]
配方：public-figure · 创建：2026-04-27 · 来源：3 份材料

────────────────────────────────────────
[Markdown 编辑器 + 预览]（可继续编辑 SKILL.md）
────────────────────────────────────────

[重新蒸馏]  [发布为 Skill]  [撤销发布]  [删除]
```

- **重新蒸馏**：用当前已存的材料 + 配方重新跑 Phase B-1/B-2，产出覆盖现有 SKILL.md 草稿
- **发布为 Skill**：调用 `personaPublish`，状态变为"已发布"，徽标更新
- **撤销发布**：调用 `personaUnpublish`，从 `userData/skills/` 删除，状态回到"草稿"
- **删除**：同时撤销发布，删除整个 `userData/personas/<id>/` 目录

---

## 9. 构建系统

### 9.1 新增构建步骤

| 命令 | 说明 |
|---|---|
| `pnpm build:personas` | 拷贝 `src/main/persona/builtin-recipes/` 和 `extraction-prompt.md` → `dist/main/persona/` |

在根 `package.json` 全量构建命令中，`build:personas` 插入在 `build:main` 之后。

### 9.2 asar 解包配置

在 `electron-builder.json5` 的 `asarUnpack` 数组增加：

```json
"dist/main/persona/builtin-recipes/**/*",
"dist/main/persona/extraction-prompt.md"
```

原因：`.md` 文件需要在运行时被 `fs.readFile` 读取，不能打包进 asar。

---

## 10. 与现有系统的集成点

### 10.1 LLM 调用

`distiller.ts` 通过现有 `LLMRouter`（`src/main/llm/router.ts`）发起调用，复用已有的 Provider 路由和 DumpingProvider 代理（prompt dump 自动覆盖蒸馏调用）。

调用时设置 scene：
```typescript
router.withScene('persona-extract', { requestId });
router.withScene('persona-synthesis', { requestId });
```

### 10.2 Skill 系统

发布后的 `userData/skills/<id>/SKILL.md` 由现有 `SkillLoader` 自动扫描，无工具声明 → `kind=persona`。Chat 侧的消费（角色选择器注入）留待 `persona-feature-design.md` 实现，Persona Studio 侧无需任何改动。

### 10.3 新增 IPC 三步骤（参照 AGENTS.md §4）

1. `src/main/persona/persona-ipc.ts` — 注册所有 `persona:*` handler
2. `src/main/preload.ts` — 在 `contextBridge` 中暴露 `persona*` 方法（均返回 `Promise`）；`onPersonaEvent` 注册为 push listener
3. `plugins/shared/bridge/src/types.ts` — `ElectronAPI` 接口增加 `persona*` 方法签名

---

## 11. 不在本期范围（Backlog）

| 项目 | 说明 |
|---|---|
| **Chat 角色选择器集成** | 待 `persona-feature-design.md` 实现；发布的 SKILL.md 天然满足 `kind=persona` 条件，届时无需改动 Persona Studio |
| **配方自定义提取 prompt** | 在 `RECIPE.md` frontmatter 增加可选字段覆盖全局 `extraction-prompt.md` |
| **增量补材料** | 对已有 Persona 追加材料后触发局部重蒸馏，产出 diff 供用户合并 |
| **快照与版本回退** | `snapshots/` 子目录 + 回退操作 |
| **多输出模式** | 一次蒸馏同时产出 perspective / ask / rewrite 三种变体 Skill |

---

## 12. 验收要点

- [ ] 配方列表显示所有内置配方 + `userData/persona-recipes/` 中的用户配方
- [ ] URL 材料：输入 URL 后点"抓取"，主进程完成 fetch，UI 显示抓取内容预览
- [ ] 蒸馏进度：Phase B-1 逐个材料完成时更新进度列表；Phase B-2 流式输出实时显示
- [ ] 中止蒸馏：点"中止"后当前调用停止，UI 回到 Step 2（材料收集）
- [ ] Review 阶段：Markdown 编辑器可正常编辑，预览实时刷新
- [ ] 保存：`userData/personas/<id>/SKILL.md` 和 `meta.json` 写入正确
- [ ] 发布：`userData/skills/<id>/SKILL.md` 存在，`meta.json.status = 'published'`
- [ ] 撤销发布：`userData/skills/<id>/` 目录被删除，status 回到 `draft`
- [ ] 删除：`userData/personas/<id>/` 整个目录删除，同时撤销发布
- [ ] 重新蒸馏：用已存材料重跑，SKILL.md 草稿被覆盖，Review 阶段重新打开
- [ ] 开源 SKILL.md 放入 `userData/persona-recipes/` 后出现在配方列表中
- [ ] `extraction-prompt.md` 修改后下次蒸馏立即生效
