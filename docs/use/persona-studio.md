# Persona Studio 使用指南

> **Persona Studio** 是 ToolBox 的角色工坊功能：把文章、采访、笔记、录音文稿等原始材料，通过 LLM 蒸馏为可复用的"思维角色"，并以 SKILL.md 格式持久化保存，供 Chat 及其他模块注入使用。

---

## 一、快速上手（五分钟走通全流程）

### 1. 打开角色工坊

点击侧边栏底部的 **🎭 角色工坊**，进入 Persona Studio。

### 2. 点击"＋ 新建人格"

右侧区域将展示五步向导。

### 3. 选择配方（Step 1）

配方决定了蒸馏方式和输出风格。内置提供四种：

| 配方 | 适用场景 |
|---|---|
| 公众人物蒸馏 | 有大量公开作品、采访、演讲的人物，侧重思维模型与表达 DNA |
| 思想领袖蒸馏 | 哲学家、学者，侧重概念体系与认识论立场 |
| 职场关系蒸馏 | 同事、上下级，侧重沟通风格与关系互动模式 |
| 自我蒸馏 | 基于个人笔记/日记，提炼自己的思维模式 |

点击配方卡片选中，点击"下一步"。

### 4. 添加材料（Step 2）

支持三种材料来源混合使用：

- **文本粘贴**：把文章摘录、采访记录、演讲文稿粘贴进文本框，点"添加"
- **本地文件**：点"选择文件"，支持 `.txt` / `.md` 格式
- **URL 抓取**：填入网址后点"抓取"，系统自动提取正文

建议至少提供 **2 份以上**材料，材料越多、越第一手，蒸馏效果越好。

> **材料优先级建议**（从高到低）：
> 1. 当事人自己写的文章、书稿、演讲原文
> 2. 高质量的一手采访或对谈记录
> 3. 当事人社交媒体的原始长文
> 4. 第三方深度分析（注意标注来源）

### 5. 开始蒸馏（Step 3）

点击"开始蒸馏 ✨"后，系统分两个阶段处理：

1. **并行提取**：对每份材料独立调用 LLM，压缩提取关键信息，提取结果只保存在本地中间文件
2. **流式合成**：把所有摘要汇总，按配方 prompt 生成完整的 SKILL.md 草稿

进度列表实时更新，合成阶段在列表下方流式显示生成内容。如需中止，点"中止"按钮即可。

### 6. 审阅与编辑（Step 4）

蒸馏完成后进入 Markdown 双栏编辑器：

- **左侧**：SKILL.md 全文，可直接编辑任意内容
- **右侧**：实时渲染预览

常见需要手工调整的地方：

- frontmatter 里的 `name` 字段（格式建议：`人物名-persona`，小写+连字符）
- 核心思维模型的描述精度
- 表达 DNA 中的惯用短语（可补充典型原话）

### 7. 命名并保存（Step 5）

填写人格名称（例如"费曼思维"、"苏格拉底模式"），点"保存草稿"。

保存完成后，自动跳转到**人格详情页**。

---

## 二、管理已保存的人格

### 人格详情页操作

| 操作 | 说明 |
|---|---|
| 编辑 SKILL.md | 左侧编辑器直接修改，点"💾 保存修改"写回磁盘 |
| 🔄 重新蒸馏 | 用已存档的材料 + 配方重新跑一遍，产出覆盖当前草稿（需手动保存） |
| 🚀 发布为 Skill | 将 SKILL.md 复制到 `userData/skills/<id>/`，Skill 系统自动识别 |
| ↩ 撤销发布 | 从 `userData/skills/` 删除对应目录，回到草稿状态 |
| 🗑 删除 | 同时撤销发布并删除所有文件，不可恢复 |

### 草稿与已发布的区别

- **草稿**：SKILL.md 只保存在 `userData/personas/` 下，不对任何模块可见
- **已发布**：SKILL.md 额外存在于 `userData/skills/<id>/`，Skill 系统将其识别为 `kind=persona`（纯 prompt Skill）

> **注意**：当前版本 Chat 侧的角色选择器尚未集成（待后续版本实现），发布的 Skill 目前会出现在 Settings → 技能扩展 列表中，但不会自动注入 system prompt。Chat 集成功能立项后将无需修改 Persona Studio 侧的任何内容。

---

## 三、配方是什么，如何自定义

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

## 四、编写一份配方 SKILL.md

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

## 五、extraction-prompt.md 的作用与调整

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

## 六、文件存储位置总览

| 路径 | 内容 |
|---|---|
| `userData/personas/<id>/meta.json` | 人格元数据（id / 名称 / 配方 / 状态 / 时间戳 / 材料索引） |
| `userData/personas/<id>/materials/` | 已存档的原始材料文本（每份材料一个文件） |
| `userData/personas/<id>/SKILL.md` | 蒸馏产物（用户编辑后的权威版本） |
| `userData/skills/<id>/SKILL.md` | 发布后的 Skill 文件（Skill 系统扫描此路径） |
| `userData/persona-recipes/` | 用户自定义配方目录 |
| `dist/main/persona/builtin-recipes/` | 内置配方（随应用分发） |
| `dist/main/persona/extraction-prompt.md` | 提取阶段通用 prompt（可直接编辑调试） |

---

## 七、常见问题

**Q：蒸馏出来的内容质量很差怎么办？**

A：依次检查以下几点：
1. 材料是否足够第一手？二手汇总类文章信噪比低
2. 是否提供了足够数量的材料（建议 3 份以上）
3. 当前配方是否匹配被蒸馏的对象类型（公众人物 vs 职场同事 vs 自我）
4. 可以尝试在 Step 4 手动补充/修改 SKILL.md 内容，或切换配方后重新蒸馏

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
1. 通过 Persona Studio 向导，Step 4 直接把自己写的 SKILL.md 内容粘进编辑器，跳过蒸馏直接保存
2. 或者直接把 SKILL.md 放入 `userData/skills/<name>/`，Skill 系统会自动加载（但不经过 Persona Studio 管理，不会出现在角色工坊列表中）
