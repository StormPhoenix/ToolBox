# Persona Studio 使用指南

> **Persona Studio** 是 ToolBox 的角色工坊功能：把文章、采访、笔记、录音文稿等原始材料，通过 LLM 蒸馏为可复用的"思维角色"，并以 SKILL.md 格式持久化保存，供 Chat 及其他模块注入使用。

---

## 一、核心概念

Persona Studio 采用**工作区模型**：每个 Persona 自创建起就是一份持久化产物，所有操作（增删材料、切换配方、蒸馏、编辑 SKILL.md）即时落盘。任何时候都可以离开页面，下次返回状态完整保留；蒸馏在主进程后台异步进行，不阻塞 UI。

整个流程没有"向导"，只有一个统一的工作区视图，按需逐步完善材料、蒸馏、编辑、发布。

---

## 二、快速上手

### 1. 打开角色工坊

点击侧边栏底部的 **🎭 角色工坊**。

### 2. 点击"＋ 新建人格"

弹出**配方选择卡片**——单击选中一个配方，双击或点底部"创建"确认。点"取消"或遮罩可关闭模态而不创建任何条目。

确认后侧栏立即出现新条目，默认名称 `未命名人格 HH:mm`，自动选中并打开右侧工作区。此时 Persona 已落盘（`userData/personas/<id>/meta.json` 存在），即使关闭应用再打开也能找回。

### 3. 重命名（可选）

在侧栏 hover 该条目，点 ✎ 进入编辑模式输入新名称，回车提交（Esc 取消）。

### 4. 添加材料

工作区"材料"区底部用 **Tab 切换三种来源**（默认选中「文本」），按需混合：

- **📝 文本**：在多行文本框中输入或粘贴文字，点"添加文本"
- **📂 文件**：点"📂 选择文件…"，支持 `.txt` / `.md` / `.markdown`，可多选
- **🌐 URL**：在 URL 输入框填网址，点"抓取 URL"，系统调用主进程 `net.fetch` 抓取并提取正文

每次添加都会即时落盘到 `userData/personas/<id>/materials/source-N.txt`。删除材料即时生效，对应文件被删除。

> **材料质量建议**（从高到低）：
> 1. 当事人自己写的文章、书稿、演讲原文
> 2. 高质量一手采访或对谈记录
> 3. 当事人社交媒体的原始长文
> 4. 第三方深度分析（注意标注来源）

### 5. 切换配方（可选）

工作区头部右上角有 **🧪 配方名 ▾** 按钮，点击弹出与"新建人格"同款的卡片选择器，可随时切换配方。**切换不影响已有材料和 SKILL.md，下次蒸馏才生效**。

内置配方：

| 配方 | 适用场景 |
|---|---|
| 公众人物蒸馏 | 有大量公开作品、采访、演讲的人物，侧重思维模型与表达 DNA |
| 思想领袖蒸馏 | 哲学家、学者，侧重概念体系与认识论立场 |
| 职场关系蒸馏 | 同事、上下级，侧重沟通风格与关系互动模式 |
| 自我蒸馏 | 基于个人笔记/日记，提炼自己的思维模式 |

### 6. 蒸馏

材料区有至少 1 份材料后，"SKILL.md"区显示**✨ 开始蒸馏**按钮。点击后蒸馏立即在后台启动：

1. **并行提取**：对每份材料独立调用 LLM 压缩为摘要
2. **流式合成**：把所有摘要送入配方 prompt，流式产出 SKILL.md

工作区显示提取进度列表 + 实时合成预览。**离开页面不会取消蒸馏**——侧栏对应条目会显示旋转图标，完成后弹出全局 toast 通知，SKILL.md 自动落盘。

需要中止时点工作区的"⏹ 中止"按钮。

### 7. 审阅与编辑

蒸馏完成后，"SKILL.md"区切换为左编辑器+右预览的双栏布局。可任意修改内容，点 **💾 保存修改** 写回磁盘。

### 8. 重新蒸馏

任何时候都可以点 **🔄 重新蒸馏**，主进程从磁盘读取最新材料和配方重跑一次，新结果**直接覆盖**现有 SKILL.md（无二次确认弹窗，请提前手动保存重要编辑）。

### 9. 发布为 Skill

确认 SKILL.md 满意后，点 **SKILL.md 卡片右上角** 的 **🚀 发布为 Skill**：
- 文件复制到 `userData/skills/<人格名 slug>/SKILL.md`（**目录名基于人格名**，与内部存储 ID 解耦）
- 状态徽标变为"已发布"
- 现有 Skill 系统自动识别为 `kind=persona`

**目录名规则**：人格名经 slug 化（保留中文，空格转连字符，最长 64 字符）作为目录名。例如人格名 `费曼 思维` → 目录 `userData/skills/费曼-思维/`。

**冲突处理**：
- **同一人格反复发布**：直接覆盖更新，无弹窗
- **重命名后重发布**：自动删除旧目录、写新目录，无弹窗
- **跨人格冲突**（目标目录被另一份 Skill 占用）：弹窗提示 `目录 X 已被另一份 Skill 占用，继续发布会覆盖现有内容（不可恢复），是否确认？` —— 用户确认后强制覆盖

点 **↩ 撤销发布** 即从 `userData/skills/` 删除对应目录，状态回到草稿。

> 工作区头部右上角是配方切换按钮，与产物相关的所有操作（蒸馏 / 保存 / 发布）都集中在 SKILL.md 卡片的右上角工具栏。

### 10. 在 Finder 中查看本地文件

工作区头部 meta 行有：
- **📂 本地目录** — 打开 `userData/personas/<id>/`，可查看 `meta.json` / `materials/` / `SKILL.md`
- **🚀 Skill 目录**（仅已发布状态显示） — 打开 `userData/skills/<id>/`，存放发布出去的 SKILL.md

适合手动备份、用其他工具编辑、检查中间产物。

### 11. 在 Settings 中管理配方目录

打开 **设置 → 角色工坊** 卡片：

- **用户配方目录**：默认 `userData/persona-recipes/`，可改为任意绝对路径（输入框手动输入或点 📁 弹系统选择器）。**留空 / 点 ↺ 恢复默认**。保存后自动重新加载配方注册表，无需重启
- **已加载的配方**：列表展示当前所有配方卡片，含「内置」/「外置」徽标方便区分来源；点 🔄 重新加载 可强制重扫所有目录
- **快捷入口**：3 个"打开 X 目录"按钮一键跳转到 Personas / Skills / 用户配方根目录

> 用户配方目录是**单一目录**——不支持多目录列表。需要多套配方共享时，建议把它指向 git 仓库的本地副本，或用系统符号链接打通多个目录。

---

## 三、状态恢复与离线行为

| 场景 | 行为 |
|---|---|
| 切换到其他 Persona | 蒸馏继续后台进行，侧栏旋转图标可见 |
| 切换到其他路由 / 关闭工坊视图 | 同上 |
| 关闭整个应用 | 主进程退出，所有运行中的蒸馏被杀；下次启动后无活跃蒸馏，已完成的 SKILL.md 已落盘 |
| 重新打开角色工坊 | 自动调 `personaList` 加载所有人格 + `personaListActiveDistillations` 恢复活跃指示器 |
| 蒸馏完成 / 失败 / 中止 | 工坊视图无论是否在前台都会弹出全局 toast；侧栏旋转图标消失 |

---

## 四、草稿与已发布的区别

- **草稿**：SKILL.md 只在 `userData/personas/<id>/` 下，不对其他模块可见
- **已发布**：SKILL.md 额外存在于 `userData/skills/<id>/`，Skill 系统将其识别为 `kind=persona`（纯 prompt Skill）

> **注意**：当前版本 Chat 侧的角色选择器尚未集成（待 [persona-feature-design.md](../design/persona-feature-design.md) 实现），发布的 Skill 会出现在 Settings → 技能扩展列表中，但不会自动注入 system prompt。Chat 集成功能上线后无需修改 Persona Studio 侧任何内容。

---

## 五、配方是什么，如何自定义

### 配方的本质

配方是一份 **SKILL.md 格式的文件**（Markdown body 即蒸馏 prompt），放入对应目录后重启应用即可被 Persona Studio 加载。

蒸馏时，配方的 Markdown body 作为 Phase B-2（合成阶段）的 LLM **system prompt** 使用，告知 LLM 如何将材料摘要转化为最终的 SKILL.md 草稿。

### 用户自定义配方目录

```
userData/persona-recipes/
  <你的配方名>/
    SKILL.md
```

点击角色工坊左栏底部的"📂 配方目录"可直接在 Finder 中打开。放入 SKILL.md 后重启应用，新配方将出现在向导的配方选择列表中。

### 导入开源蒸馏 Skill

大量开源项目（如 `nuwa-skill`、`colleague-skill`、`yourself-skill` 等）本身就是 SKILL.md 格式的蒸馏器，可以直接作为配方使用：

1. 下载开源 Skill 目录（含 `SKILL.md`）
2. 把整个目录放到 `userData/persona-recipes/` 下
3. 重启应用，配方列表中出现新条目

> Persona Studio 对配方格式**宽容解析**：只要 frontmatter 有 `name` 字段、Markdown body 非空，即可加载。开源 Skill 文件无需任何修改。

---

## 六、编写一份配方 SKILL.md

### 最小可用配方

```markdown
---
name: "我的配方"
description: "一句话说明这个配方适合什么场景"
version: "1.0.0"
---

你是一位专业的人格蒸馏师。请基于以下材料摘要，为指定人物生成一份 SKILL.md 角色文件。

输出必须包含合法的 YAML frontmatter（含 name 和 description 字段），以及描述该人物思维方式和表达风格的 Markdown body。
```

### 推荐配方结构

一份好的配方通常包含三个部分：

**① 角色定义**（告诉 LLM 它扮演什么）

```markdown
你是一位专业的人格蒸馏师，专注于提炼[某类人物]的核心思维模式。
```

**② 输出格式模板**（告诉 LLM 输出什么结构）

````markdown
请严格按照以下模板输出完整的 SKILL.md：

```
---
name: "[人物名称]-persona"
description: "[一句话描述]"
version: "1.0.0"
---

## 角色扮演规则
[...]

## [你的自定义章节]
[...]
```
````

**③ 蒸馏原则**（告诉 LLM 如何保证质量）

```markdown
## 蒸馏原则

1. 所有描述必须有材料依据，不凭空推断
2. 保留材料中有代表性的原话（加引号）
3. 明确标注哪些内容是推断而非确定事实
```

### ToolBox 扩展字段（可选）

在 frontmatter 的 `metadata.toolbox.recipe` 命名空间下，可以添加额外信息供 UI 展示：

```yaml
---
name: "我的配方"
description: "..."
version: "1.0.0"
metadata:
  toolbox:
    type: "recipe"        # 标识此文件为配方（在 persona-recipes/ 目录下可省略）
    recipe:
      suitable_for:       # 显示在配方卡片上的"适用场景"标签
        - public-figure
        - entrepreneur
---
```

`suitable_for` 仅用于 UI 展示提示，不影响蒸馏逻辑。

### 配方质量要点

| 问题 | 建议写法 |
|---|---|
| LLM 输出的 frontmatter 字段不合规 | 在模板里给出具体字段示例（如 `name: "[人物名称]-persona"`） |
| 输出内容过于泛泛 | 在原则部分明确"必须基于材料中的具体事实"、"不得使用'可能'以外的推测性语言"等约束 |
| 多份材料来源不同风格混杂 | 在合成 prompt 里说明"当材料之间有矛盾时，以更接近第一手来源的版本为准" |
| 敏感场景（真人/亲密关系）缺乏边界 | 参考内置 `colleague` 配方，在角色扮演规则中显式写入"边界声明"和"AI 标签"章节 |

---

## 七、extraction-prompt.md 的作用与调整

**Phase B-1（提取阶段）**使用一份固定的通用 prompt，对每份材料独立做关键信息压缩。这份 prompt 不属于配方的一部分，而是系统级的基础设施。

文件位置：

```
dist/main/persona/extraction-prompt.md   ← 运行时读取
src/main/persona/extraction-prompt.md    ← 源文件（开发时修改此处）
```

**如何在不修改代码的情况下调整提取行为：**

1. 直接编辑 `dist/main/persona/extraction-prompt.md`
2. 下次点击"开始蒸馏"时立即生效，无需重启 Electron
3. 需要持久化到源码时，同步修改 `src/main/persona/extraction-prompt.md` 并运行 `pnpm build:personas`

提取 prompt 的编写原则：

- 保持**中性**：不针对特定人物家族，对所有材料通用
- 关注**行为特征**而非评价：引导 LLM 提取"他说了什么/怎么做"而非"他是个什么人"
- 允许"跳过"：对与人物无关的材料，允许输出"无关材料，跳过"，避免强行填充

---

## 八、文件存储位置总览

| 路径 | 内容 |
|---|---|
| `userData/personas/<id>/meta.json` | 人格元数据（id 为 `<YYYYMMDD>-<8 位 uuid>`，与展示名解耦） |
| `userData/personas/<id>/materials/` | 已存档的原始材料文本（每份材料一个文件） |
| `userData/personas/<id>/SKILL.md` | 蒸馏产物（用户编辑后的权威版本） |
| `userData/skills/<人格名 slug>/SKILL.md` | 发布后的 Skill 文件（目录名 = slug 化后的人格名） |
| `userData/persona-recipes/` | 用户自定义配方目录 |
| `dist/main/persona/builtin-recipes/` | 内置配方（随应用分发） |
| `dist/main/persona/extraction-prompt.md` | 提取阶段通用 prompt（可直接编辑调试） |

---

## 九、常见问题

**Q：蒸馏出来的内容质量很差怎么办？**

A：依次检查以下几点：
1. 材料是否足够第一手？二手汇总类文章信噪比低
2. 是否提供了足够数量的材料（建议 3 份以上）
3. 当前配方是否匹配被蒸馏的对象类型（公众人物 vs 职场同事 vs 自我）
4. 在工作区直接编辑 SKILL.md 修复局部问题，或在头部下拉切换配方后点 🔄 重新蒸馏

**Q：URL 抓取失败怎么办？**

A：常见原因：
- 目标网站有反爬机制（如需 JavaScript 渲染的 SPA）
- 网络超时（默认 30s）
- 内容类型非文本（如 PDF）

解决办法：手动复制页面正文，用"文本粘贴"方式添加材料。

**Q：如何使用开源的蒸馏配方？**

A：以 GitHub 上的 `nuwa-skill` 为例：
1. 下载其 `SKILL.md` 文件（或整个目录）
2. 在 `userData/persona-recipes/` 下新建 `nuwa-skill/` 目录
3. 把 `SKILL.md` 放入其中
4. 重启应用，配方列表中出现"nuwa-skill"

**Q：发布的 Skill 能在 Chat 中用来设定角色吗？**

A：Chat 侧的角色选择器功能（系统 prompt 注入）尚在规划中（见 `docs/design/persona-feature-design.md`）。发布后的 Skill 会出现在 Settings → 技能扩展 列表中，当前还不会自动注入对话。该功能实现后，已发布的人格无需任何修改即可直接使用。

**Q：我可以把自己写的 SKILL.md 直接作为人格用吗？**

A：可以，两种方式：
1. 在角色工坊点 ＋ 新建人格创建占位，跳过添加材料和蒸馏，直接在 SKILL.md 编辑器中粘贴自己写的内容并保存，再点发布
2. 或者直接把 SKILL.md 放入 `userData/skills/<name>/`，Skill 系统会自动加载（但不经过 Persona Studio 管理，不会出现在角色工坊列表中）
