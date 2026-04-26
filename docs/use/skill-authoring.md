# Skill 编写指南

> 本文档教你如何为 ToolBox 编写一个新的 Skill（LLM 工具扩展）。读完照做，重启应用即可在 Chat 中被 LLM 主动调用。

> 系统原理与架构请看 [`docs/tech/skill-system.md`](../tech/skill-system.md)。本文只讲"怎么写"。

---

## 1. 五分钟速览

一个 Skill = 一个目录 + 一份 `SKILL.md` + 可选的 `.cjs` 执行脚本。

```
<skill-name>/
├── SKILL.md              # 必需：YAML frontmatter + Markdown body
└── scripts/              # 可选
    └── <name>.cjs        # 工具执行脚本
```

写完后：

- **内置 Skill**（提交进仓库）：放 `src/main/skill/builtin-skills/<skill-name>/`，跑 `pnpm build:skills` 然后重启。
- **用户级 Skill**（个人扩展）：放 `userData/skills/<skill-name>/`，**不需要构建**，重启应用即生效。Settings → 技能扩展 → "打开技能目录"按钮可直达。

> ToolBox 的 Skill 有**两种形态**：
> - **工具型 Skill**——声明 `tools` + 提供 `.cjs` 脚本，让 LLM 主动调用（本文 §2-§12 的主线）。
> - **纯 prompt Skill**——只用 SKILL.md 的 Markdown body 改变 LLM 的角色 / 思维方式，**无 `tools` 无脚本**（参见 §13）。
>
> 本文前半部分讲工具型 Skill 的写法；§13 单独讲纯 prompt Skill 的特殊注意事项与失效场景。

---

## 2. SKILL.md 必填字段一览

| 字段 | 必填 | 说明 |
|---|---|---|
| `name`（顶层） | ⭐ 必填 | Skill 唯一名，小写字母+数字+`-`/`_`，≤ 64 字符 |
| `description`（顶层） | ⭐ 必填 | 一句话告诉 LLM 这个 Skill 是干什么的 |
| `metadata.toolbox.tools[]` | 视情况 | 工具列表；不写则此 Skill 只贡献 instructions |
| `tools[].name` | ⭐ 必填 | 工具名，**全局唯一**（不可与其他 Skill 重名） |
| `tools[].description` | ⭐ 必填 | 给 LLM 看的工具说明 |
| `tools[].inputSchema` | ⭐ 必填 | 标准 JSON Schema，必须 `type: object` |
| `tools[].riskLevel` | ⭐ 必填 | `SAFE` 或 `MODERATE` |
| `tools[].displayName` | 推荐 | UI 和事件展示用 |
| `tools[].confirmHint` | **MODERATE 强烈推荐** | 弹窗描述模板，支持 `{paramName}` 占位符 |
| `tools[].scriptEntry` | 可选 | 不写时按 `scripts/<工具名>.cjs` 兜底 |
| `metadata.toolbox.emoji` | 可选 | 设置项里的图标 |
| `metadata.toolbox.version` | 可选 | 语义版本，纯标识 |

---

## 3. 文件结构与解析规则

```markdown
---
<YAML frontmatter>
---

<Markdown body：作为 instructions 注入 system prompt>
```

硬性约束（来自 `parseSkillMd` 的正则）：

- 文件**必须以 `---\n` 开头**，紧接 YAML，再以 `\n---\n` 结束 frontmatter。
- frontmatter 后留空行后写 Markdown body（可选）。
- frontmatter 用 `js-yaml` 解析，支持完整 YAML 1.2 语法。
- frontmatter 顶层的 `kebab-case` 键会自动转 `camelCase`（`risk-level` → `riskLevel`），但内置 Skill 一律推荐写 `camelCase` 保持一致。

---

## 4. 顶层字段详解

```yaml
---
name: my-skill
description: >
  一句话告诉 LLM 这个 Skill 是干什么的、何时该用。
  (≤ 1024 字符)
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🌤️"
    tools:
      - ...
---
```

### 4.1 `name`

- 校验正则：`^[a-z0-9][a-z0-9_-]*[a-z0-9]$` 或单字符 `^[a-z0-9]$`。
- 不通过会直接抛错、Skill 不被加载。
- **建议** 目录名 = `name`，方便排查。
- 全局唯一——同名时**用户级会覆盖内置**。

### 4.2 `description`

- LLM 读这一段决定"何时启用此 Skill"。
- 第一句直接说功能，配合 Markdown body 中的"使用原则"章节给出具体场景。

---

## 5. 工具定义详解（`metadata.toolbox.tools[]`）

```yaml
- name: my_tool                        # ⭐ 全局唯一
  displayName: "我的工具"
  description: |
    详细说明工具用途、使用场景、和其他工具的分工、返回结构...
  inputSchema:                         # ⭐ JSON Schema
    type: object
    properties:
      query:
        type: string
        description: 搜索关键词
      limit:
        type: number
        description: 最大返回数，默认 10
    required: [query]
  riskLevel: SAFE                      # ⭐ SAFE | MODERATE
  confirmHint: "执行: {query}"          # MODERATE 必须填
  scriptEntry: scripts/my-tool.cjs
```

### 5.1 `name`：工具名（关键）

- LLM 在 `tool_use.name` 中传回这个字符串。
- 是 `SkillRegistry.toolIndex` 的 key —— **重名会被覆盖并打 warn**。
- 推荐 `snake_case`，避开现有 28 个工具名（`web_search` / `quick_calc` / `read_clipboard` / `read_text_file` / `write_text_file` / `desktop_action` / ...）。

### 5.2 `description`：写给 LLM 的工具说明

写得好不好直接决定 LLM 调不调你的工具。建议结构：

1. 第一句：功能一句话；
2. **使用场景**：什么情况下应该调用；
3. **不要使用的场景**：避免 LLM 误用；
4. **与其他工具的分工**：如果会和现有工具混淆；
5. **返回结构**：让 LLM 知道结果怎么解读。

参考 `web-search` SKILL.md 的写法效果较好。

### 5.3 `inputSchema`：参数 Schema

校验逻辑只要求三件事：

1. `type === 'object'`；
2. 必须有 `properties`（对象）；
3. `required` 若提供必须是数组。

实务建议：

- ⭐ **每个 property 都写 `description`** —— LLM 直接靠它确定字段含义。
- 默认值不要写在 schema 里（不会被自动应用）。在脚本里处理：`const limit = input.limit ?? 10`。
- 联合参数（如 `action: a | b | c`）建议写一个字符串字段加描述清晰的枚举说明，比 `oneOf` 让 LLM 更稳定。
- `required` 只放真正必需的字段；可选字段不要塞进去。

### 5.4 `riskLevel`：两级风险

| 级别 | 含义 | 行为 |
|---|---|---|
| **`SAFE`** | 只读 / 纯计算 / 无副作用 | 直接执行，不弹窗 |
| **`MODERATE`** | 写文件 / 启动程序 / 改剪贴板 / 网络副作用 | 弹窗等待用户确认 |

判断准则：**会不会让用户事后后悔？** 会就 MODERATE。犹豫从严 → MODERATE。

> 写 `DANGEROUS` 不会报错，但会被自动归并为 `MODERATE`（项目只设两级）。

### 5.5 `confirmHint`：MODERATE 工具的弹窗描述（强烈推荐）

支持 `{paramName}` 模板，渲染规则：

| 参数实际值 | 渲染结果 |
|---|---|
| `string` | 原样 |
| `Array` | `"N 项"`（如 `"5 项"`） |
| 其他 | `JSON.stringify` |
| `undefined` / `null` | 空串 |

示例：

```yaml
confirmHint: "创建文件: {path}"                  # → 创建文件: C:\Users\me\note.txt
confirmHint: "复制: {source} → {destination}"   # → 复制: a.txt → b.txt
confirmHint: "批量文件操作（{actions}）"          # → 批量文件操作（5 项）
```

不写 `confirmHint` 时弹窗只能展示 `displayName`，体验差。

### 5.6 `scriptEntry`：脚本路径

- 相对于 Skill 目录的路径，例如 `scripts/my-tool.cjs`。
- 省略时按 `scripts/<工具名>.cjs` 兜底，**单工具 Skill** 让工具名等于文件名时可省略。
- **多工具共享同一脚本** 是常见模式（参考 `clipboard-ops` 的 `read_clipboard` / `write_clipboard`），脚本内部用 `context.toolName` 分发。

---

## 6. 脚本（.cjs）契约

```javascript
async function execute(input, context) {
  // input:   LLM 传来的 JSON 对象（按 inputSchema 解析）
  // context: { skillDir, dataDir, toolName }
  return { /* 任意可序列化对象，会 JSON.stringify 后回送 LLM */ }
}

module.exports = { execute }
```

### 6.1 硬性约束

| 约束 | 原因 |
|---|---|
| 后缀必须 `.cjs` | 避免被 `package.json` 的 `"type":"module"` 影响 |
| 导出 `execute` 或 `default` 函数 | loader 按这两个名字找入口 |
| 必须 `async` 或返回 Promise | chat-engine 用 `await` 调用 |
| **内置 Skill：禁止 `require` 第三方 npm 包** | 只能用 `electron` 和 Node 内置模块（`fs` / `path` / `os` / `https` / `child_process` 等） |

> 用户级 Skill 没有这个限制，但仍受限于运行环境（无 node_modules 时第三方包加载失败需要自行处理）。

### 6.2 `context` 三个字段

| 字段 | 含义 |
|---|---|
| `skillDir` | Skill 目录绝对路径（只读，用来读 `SKILL.md` 同目录的资源） |
| `dataDir` | `userData/skill-data/<skillName>/`，可读写，首次调用自动创建 |
| `toolName` | 当前被调用的工具名（同脚本服务多工具时用于分发） |

### 6.3 返回值约定

- 返回**任意可序列化对象**（推荐 `{ success: true, ... }` 结构化对象）。
- chat-engine 会 `JSON.stringify` 后塞进 `tool_result`。
- 失败可以 `return { success: false, error: '...' }`，也可以 `throw`——抛出会被捕获并标记 `is_error: true`。

### 6.4 多工具共享脚本范式

```javascript
async function execute(input, context) {
  switch (context.toolName) {
    case 'read_clipboard':  return readClipboard(input)
    case 'write_clipboard': return writeClipboard(input)
    default:
      return { success: false, error: `未知工具: ${context.toolName}` }
  }
}
module.exports = { execute }
```

---

## 7. Markdown body：写给 LLM 的 instructions

frontmatter 之外的 Markdown 内容会被包在 `<skill name="...">...</skill>` 标签里拼进 system prompt。建议结构：

- 顶层使用原则（什么时候应该主动调用）；
- 多个工具之间的选择规则；
- 与其他 Skill 的协作工作流；
- 典型场景示例。

支持两个模板变量（运行时替换）：

| 变量 | 替换为 |
|---|---|
| `{baseDir}` | Skill 目录绝对路径 |
| `{dataDir}` | `userData/skill-data/<skillName>/` |

> Skill 不带工具时，可以省略 `tools` 字段，只用 instructions 调整 LLM 行为。

---

## 8. 完整示例

### 8.1 SAFE 单工具

`src/main/skill/builtin-skills/weather/SKILL.md`：

```markdown
---
name: weather
description: >
  查询全球城市的实时天气。当用户询问天气、温度、降水时主动调用，
  无需先征求用户同意。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🌤️"
    tools:
      - name: get_weather
        displayName: "查询天气"
        description: |
          查询指定城市的实时天气。返回温度、湿度、天气描述、风速。

          使用场景：
          - 用户问"今天 XX 的天气怎么样"
          - 用户问"明天上海冷不冷"
          - 需要根据天气给出建议（如"要不要带伞"）

          返回结构：
          - city: string
          - temperature: number（摄氏度）
          - description: string（如 "晴" / "多云"）
          - humidity: number（0-100）
        inputSchema:
          type: object
          properties:
            city:
              type: string
              description: 城市名（中文或英文均可），如 "北京" "Shanghai"
          required: [city]
        riskLevel: SAFE
        scriptEntry: scripts/weather.cjs
---

# Weather Skill

查询全球城市的实时天气。

## 使用原则

- **不确定就直接查，不要先问用户**
- 用户给了城市名直接查，不要追问"你要查今天还是明天"
- 查不到时坦诚告知（"该城市未找到"），不要伪造数据
```

`scripts/weather.cjs`：

```javascript
const https = require('https')

async function execute(input, context) {
  const { city } = input
  if (!city) return { success: false, error: '缺少 city 参数' }

  return {
    success: true,
    city,
    temperature: 22,
    description: '晴',
    humidity: 45,
  }
}

module.exports = { execute }
```

### 8.2 MODERATE 多工具（共享脚本）

`src/main/skill/builtin-skills/note-writer/SKILL.md`：

```markdown
---
name: note-writer
description: >
  在用户的 Documents/notes 目录下创建/追加 Markdown 笔记。
  所有写入操作需要用户确认。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "📝"
    tools:
      - name: create_note
        displayName: "新建笔记"
        description: |
          在 Documents/notes 下创建一个新的 .md 笔记文件。
          如果同名笔记已存在，返回错误（不覆盖）。
        inputSchema:
          type: object
          properties:
            title:
              type: string
              description: 笔记标题，会作为文件名（自动加 .md 后缀）
            content:
              type: string
              description: 笔记 Markdown 正文
          required: [title, content]
        riskLevel: MODERATE
        confirmHint: "新建笔记: {title}"
        scriptEntry: scripts/note-writer.cjs

      - name: append_note
        displayName: "追加笔记"
        description: |
          在已有笔记末尾追加一段内容（自动加时间戳分隔）。
        inputSchema:
          type: object
          properties:
            title:
              type: string
              description: 已有笔记的标题（不含 .md）
            content:
              type: string
              description: 要追加的内容
          required: [title, content]
        riskLevel: MODERATE
        confirmHint: "追加到笔记: {title}"
        scriptEntry: scripts/note-writer.cjs
---

# Note Writer Skill

帮用户管理本地 Markdown 笔记。**所有写入需用户确认**。

## 使用原则

- 用户说"记一下""新建笔记""加个备忘"时调用 `create_note`
- 用户说"追加到 XX 笔记"时调用 `append_note`
- **不要主动写入笔记**——只在用户明确要求时才调用
```

`scripts/note-writer.cjs`：

```javascript
const fs = require('fs')
const path = require('path')
const os = require('os')

const NOTES_DIR = path.join(os.homedir(), 'Documents', 'notes')

async function execute(input, context) {
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true })
  }

  switch (context.toolName) {
    case 'create_note':  return createNote(input)
    case 'append_note':  return appendNote(input)
    default:
      return { success: false, error: `未知工具: ${context.toolName}` }
  }
}

function createNote({ title, content }) {
  const file = path.join(NOTES_DIR, `${title}.md`)
  if (fs.existsSync(file)) {
    return { success: false, error: '同名笔记已存在' }
  }
  fs.writeFileSync(file, content, 'utf-8')
  return { success: true, path: file }
}

function appendNote({ title, content }) {
  const file = path.join(NOTES_DIR, `${title}.md`)
  if (!fs.existsSync(file)) {
    return { success: false, error: '笔记不存在' }
  }
  fs.appendFileSync(
    file,
    `\n\n---\n${new Date().toISOString()}\n${content}`,
    'utf-8'
  )
  return { success: true, path: file }
}

module.exports = { execute }
```

---

## 9. 内置 Skill vs 用户级 Skill ⭐

两类 Skill 的 SKILL.md 格式完全相同，区别仅在**位置、构建步骤、是否能依赖第三方包**：

| 维度 | 内置 Skill | 用户级 Skill |
|---|---|---|
| 存放位置 | `src/main/skill/builtin-skills/<name>/` | `userData/skills/<name>/` |
| 进入仓库 | ✅ 提交进 git | ❌ 仅本机 |
| 构建步骤 | **必须** `pnpm build:skills` | ❌ 不需要 |
| 生效方式 | 重启应用 | 重启应用 |
| 第三方 npm 包 | ❌ 禁止 `require` | ⚠️ 不推荐（运行时无法保证依赖存在） |
| 同名时优先级 | 低 | **高（覆盖内置）** |
| 设置项展示 | `builtin: true` 标记 | `builtin: false` |
| 卸载方式 | 删除目录 + 重新构建 | 直接删除目录后重启 |

### 9.1 用户级 Skill 路径速查

不同操作系统下 `userData` 实际位置：

| 平台 | 路径 |
|---|---|
| Windows | `%APPDATA%\toolbox\skills\` |
| macOS | `~/Library/Application Support/toolbox/skills/` |
| Linux | `~/.config/toolbox/skills/` |

⭐ **最快的打开方式**：应用内打开 Settings → 技能扩展 → 点击 **"打开技能目录"** 按钮（不存在会自动创建）。

### 9.2 用户级 Skill 的典型用法

- **覆盖内置 Skill 的 instructions**：放一个同名 Skill，只改 Markdown body 调整 LLM 行为。
- **接入私有 API**：写一个 `scripts/<x>.cjs` 调用你公司的内部 HTTP 接口。
- **本地工作流自动化**：基于你机器上特定路径、目录、命令的小工具。

### 9.3 用户级 Skill 编写注意事项

1. **路径限制**：脚本里 `require` 不要假设 `node_modules` 存在；只用 Node 内置模块或 `electron` 最稳。
2. **不会被打包**：用户级 Skill 完全独立于应用更新，重装应用也不会丢失。
3. **覆盖内置时谨慎**：要么完整复制原 SKILL.md 再修改，要么明确只想替换 instructions，不要遗漏 `tools` 字段。
4. **数据目录隔离**：每个 Skill 的 `dataDir` 是 `userData/skill-data/<skillName>/`，用户级和内置同名时**会共享同一个目录**——这是设计上"无缝替换"的代价，自行注意数据兼容性。

---

## 10. 编写完之后的步骤

### 10.1 内置 Skill

```bash
# 1. 拷贝 SKILL.md + scripts/ 到 dist/main/skill/builtin-skills/
pnpm build:skills

# 2. 重启应用
pnpm start

# 或开发模式：
pnpm dev:main      # 终端 A
pnpm dev:shell     # 终端 B
```

⚠️ **必须 `pnpm build:skills`**——`AGENTS.md §9` 列入"禁止跳过"的步骤。否则 dist 仍是旧版本，运行时不会感知新 Skill。

### 10.2 用户级 Skill

```bash
# 不需要任何构建命令
# 1. 编辑 userData/skills/<your-skill>/SKILL.md
# 2. 重启应用
```

### 10.3 验证生效

启动后：

1. **Settings → 技能扩展** 列表应该出现新 Skill（带 emoji + description）。
2. 默认启用，可在面板里关闭。
3. 在 Chat 里用一句直接触发的话测试（如 "今天北京天气怎么样"）。
4. MODERATE 工具第一次调用会弹确认框；勾"永久信任"后写入 `userData/skill-config.json`。

---

## 11. 常见坑

| 现象 | 原因 | 修法 |
|---|---|---|
| Settings 看不到新 Skill | 忘了 `pnpm build:skills`（仅内置） | 跑一遍构建脚本后重启 |
| 启动日志报 `name 格式无效` | 含大写或空格 | 改成 `kebab-case` 或 `snake_case` |
| 启动日志报 `frontmatter 缺少必填字段` | `---` 上下分隔符没换行 / 缺空行 | 严格遵守 `---\n...\n---\n` |
| 启动日志说工具脚本不存在 | `scriptEntry` 路径写错或没拷贝 | 路径相对 Skill 目录；跑 `build:skills` |
| LLM 调了工具但参数不对 | `inputSchema` 没写 `description` | 给每个 property 都加 description |
| MODERATE 弹窗描述空白 | 没写 `confirmHint` | 加 `confirmHint`，用 `{paramName}` 模板 |
| 工具名重名警告 | 与已有工具撞了 | 改 `name`；或确认你确实想覆盖（用户级 Skill 故意覆盖内置） |
| 脚本能加载但 `mod.execute` 报错 | 用了 `export default` ESM 写法 | 改回 CJS：`module.exports = { execute }` |
| 生产打包后 Skill 跑不起来 | `electron-builder.json5` 的 `asarUnpack` 缺失 | 默认已配 `dist/main/skill/builtin-skills/**/*`；自定义子目录需补规则 |
| 工具看似执行但 LLM 没收到结果 | 脚本忘了 `return`，只 `console.log` | 必须 `return` 一个对象，否则 LLM 拿到 `undefined` |
| 多工具共享脚本时调用串了 | 没用 `context.toolName` 分发 | 在 `execute` 入口 `switch (context.toolName)` |
| 纯 prompt Skill 在 chat 模式下"失效" | chat 模式不注入 skill instructions（chat-engine 的 `hasTools` 检查） | 切到 agent / deep 模式；详见 §13 |
| 纯 prompt Skill 看不出效果 | 用户消息未命中触发词且与 description 适用领域无关 | 显式点名（"用 X 视角分析…"），或重新润色 description 的"触发词"段 |

---

## 12. 编写 Checklist

提交（或测试）前快速过一遍：

- [ ] 目录名 = `name` 字段，全部小写
- [ ] frontmatter 上下都有 `---`，紧接 Markdown body
- [ ] `description` 一句话说清 Skill 用途
- [ ] 每个工具都有 `name` / `description` / `inputSchema` / `riskLevel`
- [ ] `inputSchema.properties` 的每个字段都带 `description`
- [ ] `riskLevel: MODERATE` 的工具配了 `confirmHint`，验证过 `{paramName}` 替换
- [ ] `scriptEntry` 指向真实 `.cjs` 文件，文件中 `module.exports = { execute }`
- [ ] 多工具共享脚本时 `execute` 内部按 `context.toolName` 分发
- [ ] Markdown body 写明：何时该用、何时不该用、和其他 Skill 的分工
- [ ] 内置 Skill 跑过 `pnpm build:skills`；用户级 Skill 直接重启验证
- [ ] 若是纯 prompt Skill：已在 §13 走过"激活模式 / 角色身份卡 / 触发词 / 自我标识"四要素 Checklist

---

## 13. 纯 prompt Skill 模式（角色卡 / 思维框架）

> 这种 Skill **不声明 `tools`、不写 `.cjs` 脚本**——SkillLoader 把它的 `tools` 设为空数组，`toolIndex` 不增加任何条目，但它的 Markdown body 仍会通过 `buildSystemInstructions()` **拼进 system prompt**，从而改变 LLM 的回答风格和思维路径。
>
> 典型用途：让 LLM 以"某领域专家"或"某种思维框架"的视角回答用户。整份 SKILL.md 是写给 LLM 的角色卡 / 系统提示扩展，没有任何代码逻辑。

### 13.1 与工具型 Skill 的差异

| 维度 | 工具型 | 纯 prompt 型 |
|---|---|---|
| frontmatter `metadata.toolbox.tools` | 必填 | **不写** |
| `scripts/*.cjs` | 必有 | **不需要**（即使有也仅为外部辅助，loader 不读） |
| 写入 `toolIndex` | ✅ | ❌ 0 条 |
| Settings 显示 `toolCount` | > 0 | **0** |
| LLM 与之交互 | `tool_use` / `tool_result` 主动调用 | LLM 不"调用"它，只是被它"塑形" |
| 触发方式 | LLM 觉得需要时主动调 | 用户消息命中触发词或场景时 LLM 自我切换风格 |
| 风险弹窗 | 需 `riskLevel` | 无概念 |

简单概括：**工具型 = 扩展能力（行动）；纯 prompt 型 = 扩展认知（思考）**。

### 13.2 最小骨架

```markdown
---
name: my-perspective                # ⭐ 唯一必须遵守的字段
description: |
  一句话说清角色定位、能力边界、**触发词**、适用场景、局限。
  描述写得越清晰，LLM 越能在合适时机自动激活。
---

# <角色名> · <一句话定位>

## 角色扮演规则

激活此 Skill 时：
- 第一人称回答 / 使用 <角色专属称呼>
- 用 <角色风格> 的语气和措辞表达
- 首次激活时说明："我以 <角色> 的思维框架与你讨论，基于公开资料提炼，供参考。"
  后续不再重复

## 身份卡

我是 XXX，...（第一人称自我介绍）

## 核心心智模型

### 1. <模型名>
**一句话**：...
**框架**：...
**应用**：...
**局限**：...

### 2. ...

## 决策启发式

1. ...
2. ...

## 反模式（绝对不做）

- 不会做 X
- 不会用 Y 风格
```

frontmatter 顶层只有 `name` + `description` 两个字段；连 `metadata` 节都可以省略。

### 13.3 ⚠️ 起作用的硬性条件（chat-engine 决定）

纯 prompt Skill 的 instructions 注入**有前置门槛**：

```typescript
// chat-engine.ts
const tools = enableTools && registry ? registry.getLLMTools() : undefined;
const hasTools = tools && tools.length > 0;
...
if (hasTools && registry) {
  const skillInstructions = registry.buildSystemInstructions();
  if (skillInstructions) stableParts.push(skillInstructions);
}
```

**只有当 `hasTools === true` 时 instructions 才会进 system prompt。** 三种情况会让纯 prompt Skill"哑火"：

| 失效场景 | 触发条件 | 修法 |
|---|---|---|
| **chat 模式** | Composer 选了"对话"模式（`mode === 'chat'`） | 切到 agent / deep 模式 |
| **工具型 Skill 全被禁用** | Settings 里把 12 个内置 Skill 全关了 | 至少留一个工具型 Skill 启用 |
| **该 Skill 自己被禁用** | Settings 里关掉了它 | 重新启用 |

> 实际使用中默认启用 `web-search`、`quick-calc` 等工具型 Skill 已足够让 `hasTools=true`，所以一般用户不会遇到前两种问题。但**chat 模式下纯 prompt Skill 系统性失效**这点要写在使用文档里告诉用户。

### 13.4 ⚠️ LLM 端能否激活的因素

即便 instructions 进入 system prompt，是否真切换风格还由 LLM 自己决定。激活强度按用户消息和 SKILL.md 触发词的语义距离呈现连续光谱：

| 强度 | 用户消息样本 | LLM 行为 |
|---|---|---|
| **强激活** | 显式点名："用 `<角色>` 的视角分析…"、"`<触发词>` 会怎么看？" | 完整切换：第一人称 + 框架词汇 + 角色化称呼 |
| **中激活** | 描述的问题正好落在该 Skill 的"适用场景"里，但未点名 | 部分采纳框架，但保留正常 AI 口吻 |
| **弱激活** | 问题领域沾边但偏离核心 | 影响有限，可能借鉴一两个概念 |
| **不激活** | 与 description 完全无关（如闲聊、纯技术问题） | 完全不触动 |

强激活的两条充分条件：

1. 用户消息**显式包含 description 中声明的触发词**。
2. 用户消息描述的问题**领域与 description 适用场景高度契合**。

### 13.5 编写要点（四要素）

成熟的纯 prompt Skill 通常包含以下四个关键要素：

#### ① description 必须包含"触发词"段

```yaml
description: |
  <角色 / 框架的一句话定位>。
  触发词：「关键词1」「关键词2」「用 X 视角分析」「X 会怎么看」
  适用场景：<列出 3-5 个明确场景>。
  局限：<说明本 Skill 不擅长什么场景>。
  素材来源：<可选，列出参考资料以增加可信度>。
```

⭐ description 是 LLM 决定是否激活的**主要依据**，建议固定结构：

- 一句话定位
- **触发词**（明确列出关键词，让 LLM 做精确匹配）
- 适用场景
- **局限**（防止 LLM 在不合适场景误激活）
- 素材来源（增加可信度，便于 LLM 引用）

#### ② Markdown body 第一节必须是"激活规则"

```markdown
## 角色扮演规则

激活此 Skill 时：
- 以 <角色> 的第一人称思考和回应
- 用 <核心框架> 分析问题，不给笼统答案
- 使用 <角色专属表达方式 / 称呼>
- 遇到问题先 <核心动作>，再 <后续动作>
- ...
```

⭐ 关键词是 **"激活此 Skill 时：..."** —— 让 LLM 明白这套行为是**条件化的**，不是无条件覆盖原本人格。这能避免 LLM 在闲聊或不相关话题中也强行切换角色。

#### ③ 自我标识机制（首次激活时打招呼）

```markdown
- 首次激活时说明："我以 <角色> 的思维框架与你讨论问题，基于公开资料提炼，
  仅供参考，非本人观点。" 后续不再重复
```

⭐ 这是给 LLM 的**自我感知协议**：检测到自己进入角色 → 主动告知用户 → 用户感知到切换 → 后续对话连贯。少了这步，用户会困惑"AI 怎么突然换风格了？"。

#### ④ 反模式 / 边界声明

```markdown
## 反模式（绝对不做）

- 不会 <典型错误风格 1>
- 不会 <典型错误风格 2>
- 不会 <脱离 description 适用场景的行为>
```

⭐ 显式列出"不做什么"比"做什么"对 LLM 更管用——它能直接抑制错误风格。

### 13.6 实务建议

| 建议 | 原因 |
|---|---|
| **一次只启用 1–2 个纯 prompt Skill** | system prompt 长度爆炸会稀释每个 Skill 的注意力；多角色冲突也让 LLM 难以决策 |
| **触发词尽量具体、独占** | 通用词（"分析"、"决策"）容易让 Skill 在不该激活时激活 |
| **description 标注"局限"** | 收窄 LLM 的激活范围，避免在闲聊场景误触发 |
| **多角色场景显式点名** | 不要指望 LLM 自动从多个 Skill 中选择；用"用 X 视角分析…"显式触发 |
| **不要写 `metadata.toolbox.emoji` 之外的工具元数据** | 没有工具就不需要这些字段；写了反而让阅读者误解 |
| **配合 prompt dump 验证** | 在 Settings → 调试 打开 LLM dump，看 system prompt 是否真的包含 `<skill name="...">` 块 |

### 13.7 验证方法

#### 看 prompt dump（最准确）

`AGENTS.md §10` 提到的 LLM dump 落盘到 `userData/llm-dumps/YYYY-MM-DD/`。打开任一 dump 文件检查：

- system prompt 中**是否含**你新加 Skill 的 `<skill name="xxx">...</skill>` 块？
  - 否 → 注入失败（多半是 §13.3 的三种场景之一，或 frontmatter 解析失败）。
  - 是 → 注入成功，进入下一步。
- LLM response 是否出现 SKILL.md 中规定的特征词、风格、结构？
  - 是 → 激活成功。
  - 否 → 触发词与用户消息距离过远（参考 §13.4 调整）。

#### 反向对比测试

1. 启用状态下问一个测试问题，记录回答。
2. Settings 关掉该 Skill。
3. 问完全相同的问题。
4. 比较两次回答的风格、用词、结构差异。

如果两次完全无差，说明 Skill 没起作用；明显差异则证明有效。

### 13.8 ⚠️ 数据目录冲突提醒

纯 prompt Skill 不会用到 `dataDir`，但如果**同名内置 Skill** 存在（用户级覆盖内置的场景），两边共享同一个 `userData/skill-data/<skillName>/` 目录——这是 Registry 的设计，不区分版本。一般纯 prompt Skill 不写文件所以无影响，但要避免同名带工具的内置 Skill 被纯 prompt 用户级 Skill 替换后导致数据残留。

### 13.9 完整示例（极简范例）

下面是一个完全虚构的"代码评审教练"纯 prompt Skill，演示四要素的完整组合。

`userData/skills/code-review-coach/SKILL.md`：

```markdown
---
name: code-review-coach
description: |
  代码评审教练：以严格但建设性的代码评审者视角审阅代码，关注可读性、健壮性、命名、边界条件。
  触发词：「评审这段代码」「review 一下」「帮我挑错」「这段代码有什么问题」「请用评审视角」
  适用场景：代码片段评审、PR 模拟评审、新人代码指导、设计 review。
  局限：不擅长性能调优的微观度量、不替代真实静态分析工具、不进行业务逻辑正确性的领域判断。
---

# Code Review Coach

## 角色扮演规则

激活此 Skill 时：
- 以资深工程师的第一人称给出评审意见
- 按"必须修 / 建议修 / 可选优化"三档输出，每条意见配一句解释为什么
- 优先指出**边界条件、错误处理、命名清晰度、可测试性**这四类问题
- 给出修改建议时附最小化的改后代码片段，而不是大段重写
- 首次激活说："我以代码评审者的视角看这段代码——指出的问题不一定都得改，但都值得想一想。"

## 评审优先级

1. 必须修：导致崩溃 / 数据错乱 / 安全漏洞 / 边界条件未处理
2. 建议修：命名歧义 / 错误信息含混 / 重复代码 / 缺少必要日志
3. 可选优化：风格偏好 / 进一步抽象的可能性 / 性能微调

## 输出结构

每次评审按下面顺序输出：
1. 一句话总评（"整体可读，但有 1 处必须修 + 2 处建议修"）
2. 必须修条目（带行号 / 引用片段 + 原因 + 修改建议）
3. 建议修条目
4. 可选优化条目（如果有）
5. 一条鼓励性的收尾

## 反模式

- ❌ 不一上来就长篇重写整段代码
- ❌ 不只说"这里不好"而不给出可执行的修改方向
- ❌ 不用居高临下或贬损的措辞
- ❌ 不超出代码片段范围去推测项目架构
```

放进 `userData/skills/code-review-coach/`，重启应用：

- Settings → 技能扩展会出现这条记录，`toolCount: 0`，emoji 为空。
- 在 agent 模式下贴一段代码并说"用评审视角看一下"，LLM 会按规则切换风格。
- 在 chat 模式下，instructions 不会被注入（参考 §13.3）。

### 13.10 编写 Checklist（纯 prompt 专用）

- [ ] frontmatter 仅含 `name` + `description`，**不写** `metadata.toolbox.tools`
- [ ] 没有 `scripts/` 目录（或目录里没有 `.cjs`）
- [ ] description 中**显式列出触发词**段落
- [ ] description 中**说明局限**段落（防止误激活）
- [ ] body 第一节是 `## 角色扮演规则`，使用"激活此 Skill 时：..."措辞
- [ ] 包含**自我标识机制**（首次激活时打招呼）
- [ ] 包含 `## 反模式` 节列出禁忌
- [ ] 一次只启用 1–2 个角色型 Skill 测试
- [ ] 用 prompt dump 验证 `<skill name="...">` 块确实出现在 system prompt 中
- [ ] 在 agent / deep 模式下测试激活效果（chat 模式下不会注入）

---

## 14. 相关参考

| 资源 | 内容 |
|---|---|
| [`docs/tech/skill-system.md`](../tech/skill-system.md) | 系统架构、Agent 循环、确认弹窗 IPC、打包策略 |
| `src/main/skill/types.ts` | 全部类型定义 |
| `src/main/skill/skill-loader.ts` | SKILL.md 解析与脚本加载逻辑 |
| `src/main/skill/builtin-skills/web-search/SKILL.md` | SAFE 单工具典型样例 |
| `src/main/skill/builtin-skills/clipboard-ops/SKILL.md` | 多工具共享脚本样例 |
| `src/main/skill/builtin-skills/file-write/SKILL.md` | MODERATE 多工具 + `confirmHint` 模板样例 |
| `src/main/skill/builtin-skills/quick-calc/SKILL.md` | 复杂 `inputSchema` 联合参数样例 |
