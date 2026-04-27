# Persona Studio 设计文档

> 状态：已实现。
> 关联文档：[persona-feature-design.md](persona-feature-design.md)（Chat 侧消费，后续集成）

---

## 1. 背景与目标

Persona Studio 是一个独立功能模块，用于将用户提交的原始材料（文本、文件、URL）通过 LLM 蒸馏为可复用的"思维角色"，并以 SKILL.md 格式持久化保存，供其他模块（如 LLM Chat 角色注入）消费。

**核心价值**：解决现有纯 prompt Skill 只能手写、无法从材料自动生成的问题，提供一条"材料 → 人格 → 角色 Skill"的完整生产链路。

**与 Chat 集成的关系**：本期只做"生产侧"（蒸馏 + 持久化），Chat 侧的"消费侧"（角色选择器、system prompt 注入）留在 [persona-feature-design.md](persona-feature-design.md) 中单独立项，两者通过 `userData/skills/` 目录解耦。

---

## 2. 架构概览（工作区模型）

Persona Studio 采用**工作区模型**：每个 Persona 自创建起就是一份持久化产物，所有操作（增删材料、切换配方、蒸馏、编辑 SKILL.md）即时落盘，离开页面再返回时状态完整保留。

```
[+ 新建人格]
   │
   ├─→ persona:create 立即创建占位（写 meta.json，不写 SKILL.md）
   │     status: 'draft'，名称默认"未命名人格 HH:mm"，配方默认第一个内置
   │
   ▼
[Persona 工作区] ◄────── 侧栏列表立即出现，可重命名、可点入
   │
   │  材料区（即时落盘）
   │    persona:add-material        添加文本/文件/URL
   │    persona:remove-material     删除单份材料
   │
   │  配方区
   │    persona:set-recipe          切换配方（不影响材料/SKILL.md）
   │
   │  蒸馏（异步，不阻塞 UI）
   │    persona:distill             启动后立即返回 requestId
   │      Phase B-1：对每份材料并行调 LLM → 压缩摘要
   │      Phase B-2：把摘要送入配方 system prompt → 流式产出 SKILL.md
   │      完成后自动 saveSkillMd 落盘
   │    persona:event               事件携带 personaId，前端全局订阅
   │
   │  SKILL.md 编辑（蒸馏完成后可手动调整）
   │    persona:save-skill-md       保存编辑器内容
   │
   ▼
[发布]
   persona:publish    复制 SKILL.md → userData/skills/<id>/
                      meta.status → 'published'
```

**离开页面/返回时的状态恢复（V1）**：
- 所有数据落盘 → 返回时 `persona:list` + `persona:load` 即可恢复完整状态
- 蒸馏在后台继续运行 → `persona:list-active-distillations` 启动时拉取活跃集合，UI 据此显示侧栏旋转图标
- 实时进度（百分比、流式片段）需要在 PersonaDetail 视图打开期间订阅事件才能展示；离开后再回，进度动画丢失但 SKILL.md 完成后自动落盘可见

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

**配方不约束输出模板**：由配方 body 的 prompt 指导 LLM 如何构建输出 SKILL.md，代码层不直接注入结构模板。但合成阶段会在 system 与 user 两端各自注入"运行约束 + 输出契约"双重锁定段，覆盖外部 agentic 配方（如 nvwa-skill）描述的多步流程指令，迫使 LLM 直接产出最终 SKILL.md 而非过程报告。详见 [§10.4 蒸馏鲁棒性](#104-蒸馏鲁棒性)。

### 3.2 配方目录

| 来源 | 路径 | 加载时机 |
|---|---|---|
| 内置配方 | `src/main/persona/builtin-recipes/<name>/SKILL.md` | 构建时 copy 到 `dist/main/persona/builtin-recipes/`，运行时加载 |
| 用户级配方（默认） | `userData/persona-recipes/<name>/SKILL.md` | 运行时动态扫描，无配置时使用 |
| 用户级配方（自定义） | 由 `userData/persona-config.json` 中 `customRecipeDir` 指定的绝对路径 | 在 Settings → 角色工坊中切换；保存后立即重新加载注册表 |

**用户级配方目录是单一目录**（不支持多目录列表）。配置变更时 `RecipeRegistry.replaceAll()` 热重载，无需重启。同名配方按"用户级覆盖内置"规则。

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

构建时由 `pnpm build:personas` 一同 copy；运行时通过 `path.join(__dirname, 'persona', 'extraction-prompt.md')` 读取（recipe-loader 和 distiller 均被 Vite 打包进 `dist/main/main-XXX.js`，`__dirname` 解析为 `dist/main/`，需拼上 `persona/` 子目录）。开发期间可直接修改 `dist/main/persona/extraction-prompt.md`，下次 distill 调用时立即生效，无需重启 Electron。

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
    <persona-id>/               # id = "<YYYYMMDD>-<8 位 uuid>"，如 "20260427-a1b2c3d4"
                                # 与展示名彻底解耦，重命名不影响目录路径
      meta.json                 # PersonaMeta（见 §5.2），创建时即写入
      materials/                # 原始材料本地存档（添加材料时即时落盘）
        source-0.txt            # 文本输入
        source-1.md             # URL 抓取结果（Markdown）
        source-2.txt            # 文件提取的文本内容
      SKILL.md                  # 仅在首次蒸馏完成后写入；不存在 ⇒ "未蒸馏过"

  skills/
    <slug>/                     # 发布目录名 = slugify(persona.name)
                                # 与 Persona 内部 id 解耦；冲突时弹确认后覆盖
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
  /**
   * 当前已发布到 userData/skills/ 下的目录名。
   * 仅 status='published' 时有值；用于撤销发布时精确删除并支持发布目录命名解耦于 persona id。
   * 旧数据可能没有此字段，unpublish 时按 persona.id fallback 删除（向下兼容）。
   */
  published_dir?: string;
}
```

代码层不感知 SKILL.md 的内容结构，内容 schema 完全由配方决定。

### 5.3 发布冲突处理（4 种场景）

发布目录名 = `slugify(persona.name)`（保留中文、空格转 `-`、最长 64 字符）。

| 场景 | 检测条件 | 行为 | 是否弹窗 |
|---|---|---|---|
| **A. 首次发布** | 目标目录不存在 + meta 无 published_dir | 直接写入，记录 published_dir | 否 |
| **B. 重发布同一 persona** | 目标目录 == 当前 published_dir | 直接覆盖，更新内容 | 否 |
| **C. 重命名后重发布** | 目标目录与 published_dir 不同，新目标不存在 | 删除旧 published_dir + 写新目录 | 否 |
| **D. 跨 persona 冲突** | 目标目录存在但不属于当前 persona | 返回 `directory_taken`；前端弹确认后再调 `publish(id, {overwrite:true})` 强制覆盖 | 是 |

撤销发布优先按 `meta.published_dir` 删除；缺失时按 `persona.id` fallback（兼容旧数据）。

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

### 7.1 配方与材料

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `personaListRecipes()` | `persona:list-recipes` | 列出所有可用配方（内置 + 用户自定义） |
| `personaFetchUrl(url)` | `persona:fetch-url` | 抓取 URL → 返回 Markdown 文本（材料收集用） |
| `personaOpenRecipeDir()` | `persona:open-recipe-dir` | 在 Finder 打开 `userData/persona-recipes/`（不存在时自动创建） |

### 7.2 Persona 生命周期

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `personaCreate(input)` | `persona:create` | 创建占位 Persona，返回 PersonaMeta；name/recipe_name 留空时使用默认值 |
| `personaList()` | `persona:list` | 列出所有 Persona（按 updated 降序） |
| `personaLoad(id)` | `persona:load` | 加载 Persona 详情（meta + SKILL.md 文本，文件不存在时为空字符串） |
| `personaRename(id, newName)` | `persona:rename` | 重命名 |
| `personaSetRecipe(id, recipeName)` | `persona:set-recipe` | 切换关联配方（不影响材料/SKILL.md） |
| `personaDelete(id)` | `persona:delete` | 删除 Persona（同时撤销发布） |

### 7.3 材料即时操作

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `personaAddMaterial(input)` | `persona:add-material` | 追加单份材料，返回更新后的 PersonaMeta |
| `personaRemoveMaterial(id, sourceIndex)` | `persona:remove-material` | 删除指定 index 的材料 |

### 7.4 SKILL.md 编辑与蒸馏

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `personaSaveSkillMd(input)` | `persona:save-skill-md` | 保存 SKILL.md 文本编辑（不触发蒸馏） |
| `personaDistill({id})` | `persona:distill` | 启动蒸馏，主进程从磁盘读最新材料和配方；返回 `{requestId}` |
| `personaDistillAbort(requestId)` | `persona:distill-abort` | 中止指定蒸馏 |
| `personaListActiveDistillations()` | `persona:list-active-distillations` | 返回当前正在进行的 personaId 数组（启动时恢复 UI 指示器） |

### 7.5 发布与目录

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `personaPublish(id, options?)` | `persona:publish` | 发布 SKILL.md → `userData/skills/<slug>/`；返回结构化结果 `PersonaPublishResult`。冲突场景 D 时返回 `{ok:false, reason:'directory_taken', dir, slug}`，前端弹确认后传 `{overwrite:true}` 强制覆盖；SKILL.md 为空时返回 `{ok:false, reason:'no_skill_md'}` |
| `personaUnpublish(id)` | `persona:unpublish` | 删除已发布目录（按 meta.published_dir，缺失时 fallback 用 persona id），status → draft |
| `personaOpenDir(id, target)` | `persona:open-dir` | 在资源管理器中打开 Persona 目录；`target='persona'` → `userData/personas/<id>/`，`target='published'` → `userData/skills/<published_dir>/`；目录不存在时返回 `{ok:false, error}` |
| `personaOpenBaseDir(which)` | `persona:open-base-dir` | 打开根目录：`'personas'` / `'skills'` / `'recipes'`（`recipes` 按当前 customRecipeDir 配置定位）；不存在时自动创建 |

### 7.6 配置

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `personaGetConfig()` | `persona:get-config` | 读取配置（含 `customRecipeDir` / `defaultRecipeDir` / `effectiveRecipeDir`） |
| `personaSetConfig(config)` | `persona:set-config` | 更新配置；保存后自动 mkdir + 重新加载注册表，返回 `{effectiveRecipeDir}` |
| `personaReloadRecipes()` | `persona:reload-recipes` | 强制重新扫描所有配方目录，返回 `{count}` |

### 7.7 事件订阅

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `onPersonaEvent(cb)` | `persona:event`（push） | 订阅蒸馏进度事件流，返回 dispose 函数 |

事件类型（**所有事件携带 `personaId`**，前端可全局订阅按 id 路由）：

| event kind | 字段 | 说明 |
|---|---|---|
| `extract-start` | `{ requestId, personaId, sourceIndex, total }` | 开始提取某份材料 |
| `extract-done` | `{ requestId, personaId, sourceIndex }` | 某份材料提取完成 |
| `synthesis-chunk` | `{ requestId, personaId, chunk }` | 合成阶段流式输出片段 |
| `continuation-start` | `{ requestId, personaId, round, max }` | 因 max_tokens 截断进入续写阶段（`round ≥ 2`）。详见 [§10.4.1](#1041-max_tokens-续写循环) |
| `synthesis-end` | `{ requestId, personaId, truncated }` | 合成完成（SKILL.md 已自动落盘）。`truncated=true` 表示达到最大续写轮次仍未自然结束，输出可能不完整 |
| `error` | `{ requestId, personaId, message }` | 蒸馏出错 |
| `aborted` | `{ requestId, personaId }` | 蒸馏被中止 |

---

## 8. Shell UI 设计（工作区模型）

### 8.1 入口

侧边栏底部固定区域，与"AI 对话"和"设置"并列，使用 🎭 图标，标签"角色工坊"。

### 8.2 整体布局

两栏结构：

```
┌──────────────┬─────────────────────────────────────────┐
│  左栏        │  右栏                                    │
│  Persona 列表│                                          │
│              │  [空态]     选择或新建人格               │
│  + 新建      │  [工作区]   选中条目时进入               │
│              │                                          │
│  已发布 (n)  │                                          │
│  草稿 (m)    │                                          │
│              │                                          │
│  📂 配方目录 │                                          │
└──────────────┴─────────────────────────────────────────┘
```

### 8.3 新建流程

点击 "+ 新建人格" 弹出配方选择模态（`RecipePickerModal.vue`）：
- 卡片网格展示所有可用配方（含名称、描述、`suitable_for` 标签、内置徽标）
- 单击卡片选中，双击或点底部"创建"确认
- 点击"取消"或遮罩关闭模态，无副作用

确认后调 `persona:create` 创建占位 PersonaMeta：
- `name`：默认 `未命名人格 HH:mm`（可在侧栏 inline 重命名）
- `recipe_name`：用户在模态中选定
- `status: 'draft'`，无材料、无 SKILL.md

新条目立即出现在侧栏「草稿」组，自动选中并打开工作区。

### 8.4 侧栏列表项

每个 PersonaItem 包含：
- 旋转图标（仅当该 Persona 处于活跃蒸馏中）
- 名称（点击 ✎ 进入 inline 编辑模式，回车提交，Esc 取消）
- 配方标签 + 材料数
- hover 显示重命名 / 删除按钮

### 8.5 工作区视图（PersonaDetail）

```
┌────────────────────────────────────────────────┐
│ [Name]                  [🧪 公众人物蒸馏 ▾]     │
│ [draft] · 更新于 17:42 · 📂 本地目录             │
│   (已发布时还会出现 · 🚀 Skill 目录)             │
├────────────────────────────────────────────────┤
│ 材料 (3)                                        │
│  ▸ [文本] 这是一段关于费曼思维方式的笔记…  [×]  │
│  ▸ [文件] notes.md                          [×] │
│  ▸ [URL]  example.com/article               [×] │
│                                                 │
│  [文本输入框]                  [添加文本]        │
│  [📂 选择文件] [URL 输入]      [抓取 URL]        │
├────────────────────────────────────────────────┤
│ SKILL.md   [蒸馏控制] [💾 保存修改] [🚀 发布]   │
│                                                 │
│  情况 A：未蒸馏过                               │
│   尚未生成 SKILL.md。添加材料后点击「开始蒸馏」  │
│                                                 │
│  情况 B：蒸馏中                                  │
│   ✓ 提取 example.com                            │
│   ⟳ 提取 notes.md                              │
│   · 合成中… / 续写中 2/5（max_tokens 触发时）   │
│   [实时预览（流式）]                            │
│                                                 │
│  情况 C：已有 SKILL.md                           │
│   [⚠️ 输出可能被截断（条件出现）]                │
│   [Markdown 编辑器 │ 实时预览]                  │
├────────────────────────────────────────────────┤
│                              [🗑 删除此人格]     │
└────────────────────────────────────────────────┘
```

**布局要点**：
- **头部右上角**：配方切换按钮（`🧪 配方名 ▾`），点击弹出 `RecipePickerModal` 卡片选择器
- **头部 meta 行**：状态徽标 + 更新时间 + 📂 本地目录链接（已发布时额外有 🚀 Skill 目录链接），用于在 Finder 中打开本地存储位置
- **材料区添加输入**：用 Tab 切换三种来源（📝 文本 / 📂 文件 / 🌐 URL），默认选中「文本」。每个 Tab 内空间独立，文本框多行、URL 单行带错误提示、文件 Tab 居中放置大号选择按钮
- **SKILL.md 卡片右上角**：把全部产物相关操作集中在此——蒸馏控制（开始 / 重新蒸馏 / 中止）、保存修改、发布 / 撤销发布
- **材料 label**：文本类型显示内容前 30 字符（截断后省略号），文件显示文件名，URL 显示 hostname

**关键 UX 特性**：
- 材料区永久可见，蒸馏完成后仍可增删材料并重新蒸馏
- 配方切换不影响已有材料和 SKILL.md，下次蒸馏才生效
- 蒸馏在主进程异步进行，离开 PersonaDetail 视图（切换到其他 Persona 或其他路由）不会取消，完成后 SKILL.md 自动落盘
- 重新蒸馏不弹二次确认（用户责任，蒸馏前手动备份 SKILL.md 即可）
- 蒸馏完成 / 失败 / 中止时由 PersonaStudio 顶层弹全局 toast；蒸馏完成且发生截断时 toast 改为 `error` 颜色文案 "<name> 蒸馏完成（输出已截断，请审阅）"
- **续写中进度展示**：当 LLM 因 max_tokens 截断进入续写阶段时（`continuation-start` 事件），合成中标签变为 "续写中 X/5"，继续累加流式片段。详见 [§10.4.1](#1041-max_tokens-续写循环)
- **截断警告条**：本次蒸馏达到最大续写轮次仍未结束（`synthesis-end.truncated=true`）时，已蒸馏 SKILL.md 编辑器顶部显示黄色可关闭警告条，提示"输出可能被截断 / 调高 maxTokens 后重新蒸馏 / 或手动补全"。切换 persona 或启动新蒸馏时自动清除

### 8.6 状态恢复

`PersonaStudio.vue` 顶层在 `onMounted` 时：
1. `personaList()` 拉取所有 Persona
2. `personaListRecipes()` 拉取配方
3. `personaListActiveDistillations()` 拉取当前正在蒸馏的 personaId 集合
4. `onPersonaEvent` 全局订阅事件，根据事件 kind 维护 `activeDistillations: Set<string>`

侧栏 PersonaItem 根据 `activeDistillations.has(id)` 显示旋转图标。当前选中 Persona 的事件会被转发给 `PersonaDetail` 用于展示进度。

### 8.7 配方选择器复用

`RecipePickerModal.vue` 同时被两处使用：

| 触发位置 | 调用 IPC | 取消语义 |
|---|---|---|
| `+ 新建人格` | `persona:create` | 关闭模态，不创建任何 Persona |
| 头部 `🧪 配方名 ▾` | `persona:set-recipe` | 关闭模态，保留原配方 |

模态接受 `currentRecipe` 用于预选当前配方，单击卡片选中、双击或底部"确定"按钮提交。

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

### 10.4 蒸馏鲁棒性

合成阶段（Phase B-2）针对两类常见鲁棒性问题做了内置处理，全部集中在 `src/main/persona/distiller.ts` 的 `synthesize()` 函数中。

#### 10.4.1 max_tokens 续写循环

**问题**：长输出配方（特别是 nvwa-skill 这类详尽 SKILL.md 模板）在单次 LLM 调用下可能被 Provider 的 `max_tokens` 截断，导致 frontmatter 不完整、结构残缺、SKILL.md 无法解析。各主流 Provider 单次输出硬上限：Claude 8192、GPT-4o 16384、Gemini 8192。

**机制**：`synthesize()` 内部为 do-while 循环——每轮调用完成后检查 `response.stop_reason`：

| stop_reason | 行为 |
|---|---|
| `end_turn` | 正常结束，退出循环 |
| `max_tokens` 且 `round < 5` | 把本轮 assistant 响应加入 messages 历史，追加 `CONTINUATION_PROMPT` 作为新 user 消息，进入下一轮 |
| `max_tokens` 且 `round == 5` | 视为截断，`synthesis-end` 携带 `truncated=true` 退出 |

**关键常量**（均在 `distiller.ts` 顶部声明，便于后续重构）：

| 常量 | 值 | 说明 |
|---|---|---|
| `MAX_SYNTHESIS_ROUNDS` | 5 | 首轮 + 续写轮次合计上限。5 × 当前 maxTokens 通常足以覆盖绝大多数 SKILL.md 长度需求 |
| `CONTINUATION_PROMPT` | 见代码 | 续写指令文案，明确"不要重复 / 不重新输出 frontmatter / 不要客套 / 直接以原文断点处的下一个字符开始" |

**与 abort 的协作**：每轮调用前检查 `signal.aborted`，并把 `signal` 透传给 `streamMessage`。用户中止时立即终止当前轮，不会启动下一轮续写。

**截断后的 UI 反馈**：

- `continuation-start` 事件：UI 在合成中标签上显示 "续写中 X/5"
- `synthesis-end.truncated=true`：编辑器顶部显示黄色截断警告条（详见 §8.5）；全局 toast 改为 error 颜色

#### 10.4.2 双重锁定 prompt（覆盖 agentic 配方）

**问题**：外部生态中存在大量为 agentic 宿主（Claude Code / OpenClaw 等）设计的 Skill 配方，它们假设具备多轮对话、subagent 派生、`WebSearch` / `bash` / 文件读写等工具调用、用户检查点确认等能力（典型案例：[`nvwa-skill`](https://github.com/xmg2024/nvwa-skill)）。这类配方放入 ToolBox 的"单次离线蒸馏"环境时，LLM 会按配方流程输出"执行过程报告"（Phase 0/1/1.5/2/2.5 中间产物、目录创建描述、subagent 模拟输出等）而非最终 SKILL.md，导致蒸馏完全不可用。

**机制**：`synthesize()` 入口对 system prompt 与 user message 各做一次"约束追加"——双重锁定：

| 注入位置 | 常量 | 作用 |
|---|---|---|
| **system prompt 末尾**（在配方 body 之后） | `SYNTHESIS_SYSTEM_CONSTRAINT` | 利用"最近指令"原则覆盖配方原本的 Phase 流程描述。声明无对话能力、无工具调用、无文件副作用、单次完整输出、材料即全部输入 |
| **user message 末尾**（在 `extractionText` 之后） | `SYNTHESIS_USER_CONTRACT` | 作为 LLM 准备生成前最后看到的指令（最强位置）。要求"第一个非空字符必须是 `-`"作为可验证的格式锚点，禁止前置说明 / 过程描述 / 工具调用模拟 |

```typescript
const systemPrompt = recipeBody + SYNTHESIS_SYSTEM_CONSTRAINT;
const userMessage = preamble + extractionText + SYNTHESIS_USER_CONTRACT;
```

**与续写循环的关系**：
- 续写时 `messages` 数组追加 assistant 历史 + `CONTINUATION_PROMPT`，**不再追加 `SYNTHESIS_USER_CONTRACT`**（避免重复约束干扰续写"接字"语义）
- system prompt 在所有轮次保持不变（始终包含 `SYNTHESIS_SYSTEM_CONSTRAINT`）

**已知有损权衡**：双重锁定迫使 LLM 跳过 agentic 配方设计的 Phase 1.5 / Phase 2.5 等检查点，蒸馏质量天然受限。对于复杂的 agentic 配方，建议用户在原宿主（Claude Code 等）执行完整流程后，把成品 SKILL.md 直接放入 `userData/skills/<id>/` 由 Skill 系统消费，而非通过 Persona Studio 蒸馏。详见 [`docs/design/backlog.md`](backlog.md) 的"agentic 配方运行模式扩展"条目。

#### 10.4.3 Dump 文件按轮次区分

每轮续写在主进程通过 `LLMRouter.getProvider('persona-synthesis', { requestId, iteration: round })` 获取 `DumpingProvider` 实例，dump 文件名由 PromptDumper 按 iteration 自动区分：

```
userData/llm-dumps/2026-04-27/
  2026-04-27T15-40-14-661_persona-synthesis_req-0405d570_iter1.json
  2026-04-27T15-43-22-077_persona-synthesis_req-0405d570_iter2.json
  2026-04-27T15-46-28-121_persona-synthesis_req-0405d570_iter3.json
```

便于事后排查"哪一轮的续写出了问题"。Phase B-1 的提取调用同一 requestId 但不传 iteration（每份材料并行调用，无序），dump 文件名仅含 requestId 和时间戳。

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

### 创建与列表
- [ ] 点 "+ 新建人格" 立即在侧栏出现 `未命名人格 HH:mm` 占位条目
- [ ] 同一人在侧栏 hover 后可点 ✎ 进入 inline 重命名，回车提交、Esc 取消
- [ ] 列表按"已发布 / 草稿"分组，按 updated 降序

### 材料管理（即时落盘）
- [ ] 添加文本/文件/URL 后立即出现在材料列表中，关闭再打开应用仍存在
- [ ] URL 抓取失败时显示错误信息，不影响其他操作
- [ ] 删除材料即时生效，对应 `materials/source-N.txt` 文件被删除

### 配方
- [ ] 头部配方下拉显示所有可用配方，切换后立即落盘
- [ ] 配方目录中存在但 meta 引用了不存在的配方时，下拉显示"<name>（不存在）"占位选项
- [ ] 用户级 SKILL.md 放入 `userData/persona-recipes/` 后重启应用出现在列表中

### 蒸馏与离开/返回
- [ ] 蒸馏开始后立即返回，UI 显示提取/合成进度
- [ ] 离开 PersonaDetail 视图（切到其他 Persona 或其他路由），蒸馏继续在后台进行
- [ ] 离开期间侧栏对应条目显示旋转图标
- [ ] 返回 PersonaDetail 时若仍在蒸馏中应继续展示进度（事件继续推送）；若已完成则展示成品 SKILL.md
- [ ] 蒸馏完成 / 失败 / 中止时全局 toast 弹出对应消息
- [ ] 应用重启后 `personaListActiveDistillations()` 返回空（V1 不做 crash recovery）

### 鲁棒性（max_tokens 续写 + 双重锁定）
- [ ] 长输出场景下，LLM 触发 `stop_reason='max_tokens'` 后自动续写至多 5 轮，输出文本连续无断裂
- [ ] 续写期间合成中标签变为 "续写中 X/5"，流式 chunk 持续累加到同一份预览中
- [ ] 续写过程中点击"中止"立即终止，不会启动下一轮
- [ ] 5 轮仍未结束时 `synthesis-end.truncated=true`，编辑器顶部出现黄色截断警告条，全局 toast 用 error 颜色显示
- [ ] 截断警告条可手动关闭；切换 persona 或启动新蒸馏时自动消失
- [ ] 用 nvwa-skill 等 agentic 配方蒸馏，输出第一个非空字符为 `-`（YAML frontmatter 起始），不出现 "# 蒸馏中"、"## Phase X"、"已创建 .claude/skills/..." 等过程描述
- [ ] dump 目录 `userData/llm-dumps/<date>/` 下，每轮续写产生独立文件名 `_iter1.json` / `_iter2.json` / ...

### SKILL.md 编辑与发布
- [ ] 蒸馏完成后 `userData/personas/<id>/SKILL.md` 写入；侧栏材料数和更新时间刷新
- [ ] 编辑器内容修改后"保存修改"按钮启用；点击后写入文件、按钮变灰
- [ ] 发布：`userData/skills/<id>/SKILL.md` 存在，meta.status=published
- [ ] 撤销发布：`userData/skills/<id>/` 删除，status 回到 draft
- [ ] 删除人格：`userData/personas/<id>/` 整个目录删除，同时撤销发布

### 开发期支持
- [ ] 修改 `dist/main/persona/extraction-prompt.md` 后下次蒸馏立即生效（缓存重置由首次读取触发）
