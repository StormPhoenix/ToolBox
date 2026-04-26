# LLM 思维角色（Persona）设计文档

> 状态：需求规格阶段，待立项实施。
> 优先级：未排期。
> Backlog 关联：本文档替代 [`docs/design/backlog.md`](backlog.md) 的「LLM 人格管理」条目。

---

## 1. 背景

Skill 系统目前支持两种形态：

| 形态 | 标志 | 注入方式 | 期望生效模式 |
|---|---|---|---|
| 工具型 Skill | `metadata.toolbox.tools[]` + `scripts/*.cjs` | LLM `tools` 参数 + system prompt 中的 `<skill_instructions>` | `agent` / `deep` |
| 纯 prompt Skill（角色卡 / 思维框架） | 仅 Markdown body，无工具声明 | system prompt 中的 `<skill_instructions>` | 任意模式（含 `chat`） |

当前 `chat-engine.ts` 中 system prompt 注入的判定为：

```ts
const enableTools = mode !== 'chat';
const tools = enableTools && registry ? registry.getLLMTools() : undefined;
const hasTools = tools && tools.length > 0;
if (hasTools && registry) {
  const skillInstructions = registry.buildSystemInstructions();
  if (skillInstructions) stableParts.push(skillInstructions);
}
```

这一实现把「是否注入 Skill instructions」与「是否传 tools 参数」绑定，导致：

- `chat` 模式下不会注入任何 Skill instructions，纯 prompt Skill 失效；
- `agent` / `deep` 模式下若用户禁用了所有工具型 Skill，纯 prompt Skill 也会一并失效；
- 多个纯 prompt Skill 同时启用时无 UI 区分，prompt 之间会互相混淆口吻 / 人设。

---

## 2. 设计目标

把 **「工具能力」** 与 **「角色 / 思维方式」** 解耦为两条互相正交的扩展轴：

- 工具能力由 `ChatMode`（`chat` / `agent` / `deep`）控制，决定是否传 `tools` 参数和保留工具往返；
- 角色 / 思维方式由独立的 **「思维角色」** 开关控制，决定是否在 system prompt 中注入某个纯 prompt Skill 的指令段。

两条轴可任意组合，例如：`chat + 苏格拉底角色`、`agent + 代码评审教练`、`deep + 无角色`。

---

## 3. 功能要点

### 3.1 Skill 类型隐式派生

不引入新的 SKILL.md 字段（保持向后兼容），由 `SkillLoader` 在装载时根据现有声明派生类型：

| 条件 | 派生类型 |
|---|---|
| `metadata.toolbox.tools[]` 非空，且至少一个工具有可加载的 `scriptEntry` | `tool` |
| 上述条件不满足，且 Markdown body 非空 | `persona` |
| 都不满足 | 加载失败（与现状一致） |

`SkillDefinition` 增加只读派生字段（命名待定）：`kind: 'tool' | 'persona'`。

### 3.2 独立的「思维角色」选择

- 与 `ChatMode` **正交**：`chat` / `agent` / `deep` 三种模式下均可使用。
- **会话级**单选状态（同一时刻一个会话至多绑定一个角色），与 `ChatSession.mode` 相同语义。
- 默认值为 **「无角色」**（即不注入任何 persona instructions）。
- 切换角色立即持久化到会话存储，下次打开该会话保持选择。

> 单选而非多选的原因：多个 persona 同时注入时，风格 / 口吻 / 自我指代规则会冲突，且 LLM 极易出现混合人设崩塌。多角色协作（圆桌、辩论）作为后续独立需求，不在本期。

### 3.3 注入路径分离

`chat-engine.ts` 的 system prompt 拼装拆为两条独立判断：

| 判断 | 触发条件 | 注入内容 |
|---|---|---|
| 工具能力注入 | `mode !== 'chat'` 且 `registry.getLLMTools()` 非空 | `tools` 参数 + 工具型 Skill 的 `<skill_instructions>` |
| 角色注入 | 会话已选中某个 `kind=persona` 的 Skill | 该 Skill 的 Markdown body 作为独立 `<persona_instructions>` 段 |

两条路径互不依赖；`chat` 模式下也能仅注入角色而不带任何工具。

### 3.4 角色与会话状态

`ChatSession` 增加字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `personaSkillName` | `string \| null` | 当前会话绑定的 persona Skill `name`；`null` 表示无角色 |

新增 IPC（命名待定）：

| IPC 通道 | 说明 |
|---|---|
| `chat:set-session-persona` | 更新会话绑定的角色，立即持久化；UI 切换时调用 |

`ChatSendInput` / `chatRegenerate` / `chatEditAndResend` **不需要** per-request 的 persona 字段——角色绑定走会话级单一来源，避免多入口分歧。

### 3.5 UI 入口

- **会话内角色切换器**：建议放在 `ChatHeader` 或 `Composer` 区域，下拉式单选，列出所有 `kind=persona` 且 `enabled=true` 的 Skill，附「无角色」选项。
- **当前角色显示**：会话顶部显示当前角色名 + 一句话描述（取自 `description`），便于用户对当前对话视角有持续感知。
- **设置页区分类型**：`Settings → 技能扩展` 中给每个 Skill 标注「🛠️ 工具型 / 🎭 角色型」徽标。
- **角色型 Skill 的 enabled 开关语义**：从「该 Skill 是否对 LLM 可见」改为「该角色是否出现在角色选择器中」。

### 3.6 持久化与默认行为

- 已存在的旧会话 `personaSkillName` 缺省视为 `null`（无角色）；不做数据迁移。
- 应用启动时若用户当前会话绑定的 persona Skill 已被删除或禁用，回退为「无角色」并提示一次。
- 用户级 Skill 与内置 Skill 同名时，沿用现有「用户级覆盖内置」规则，角色选择器以覆盖后版本为准。

---

## 4. 不在本期范围

| 项目 | 原因 |
|---|---|
| 角色编辑器 UI | 角色仍通过编写 SKILL.md 维护（参见 [`docs/use/skill-authoring.md`](../use/skill-authoring.md)） |
| 多角色协作 / 圆桌 / 辩论 | 涉及多 LLM 编排，独立需求 |
| 临时一次性角色 | 与会话级单选状态模型冲突，价值待评估 |
| 跨会话的全局默认角色 | 易造成「忘记切换」型人设串扰，先观察再评估 |
| 从材料自动生成角色（书籍/文章 → Persona） | 属于上层工作流，可在角色编辑器立项后联动 |
| Persona 间的注入优先级 / 合并 | 单选模型下不存在该问题 |

---

## 5. 关联代码区域（实施时参考）

> 仅为实施时的入口提示，不构成实现方案。

| 区域 | 待办 |
|---|---|
| `src/main/skill/types.ts` | `SkillDefinition` 增加 `kind` 派生字段 |
| `src/main/skill/skill-loader.ts` | 装载时根据 tools 数量与 scriptEntry 可加载性派生 `kind` |
| `src/main/skill/skill-registry.ts` | `buildSystemInstructions()` 支持按 `kind` 过滤；新增按 persona name 取单个 Skill instructions 的方法 |
| `src/main/chat/types.ts` | `ChatSession` 增加 `personaSkillName` |
| `src/main/chat/session-store.ts` | 字段读写 + 缺省值 |
| `src/main/chat/chat-engine.ts` | 拆分工具注入与角色注入两条路径 |
| `src/main/chat/chat-ipc.ts` | 注册 `chat:set-session-persona` |
| `src/main/preload.ts` + `plugins/shared/bridge/src/types.ts` | 暴露 `chatSetSessionPersona` |
| `src/shell/components/chat/` | 角色选择器 UI、当前角色显示、Settings 类型徽标 |
| `docs/use/skill-authoring.md` | 增补「角色型 Skill 装载条件」「在 chat 模式下也会生效」等说明 |
| `AGENTS.md` §3.4 / §4 / §8.2 | 同步更新 Skill 系统描述、IPC 列表、文档索引 |

---

## 6. 风险与权衡

| 风险 | 说明 | 应对方向 |
|---|---|---|
| 命名一致性 | 「Persona / 角色 / 思维角色」需在 UI、文档、代码三处统一一种术语 | 实施前先选定，建议中文用「角色」、代码用 `persona` |
| `chat` 模式语义变化 | 现状「`chat` 模式不带任何 system 扩展」会被破坏 | 文档明确：`chat` 模式下若用户主动选择了角色，则注入对应 instructions；用户感知由其主动选择驱动，不算隐式行为 |
| persona Skill 误判 | 用户的工具型 Skill 由于 `.cjs` 加载失败导致被识别为 persona | 派生 `kind` 时严格校验「至少一个工具的 scriptEntry 可成功 require」，否则保持 `kind=tool` 但标记为 `disabledReason` |
| 角色冲突预期 | 用户期望「叠加角色」 | UI 中单选控件 + 提示文案明确「同一会话仅一个角色生效」 |
| 与未来「LLM 人格管理（自动从材料生成）」的衔接 | 自动生成的人格也作为 persona Skill 落盘，复用本期机制即可 | 自动生成器把产出物写入 `userData/skills/<name>/SKILL.md` |

---

## 7. 验收要点（实施后用于验证）

- [ ] `chat` 模式下选中某个角色，发送消息时 system prompt 包含该角色 instructions、且 `tools` 参数为空。
- [ ] `agent` 模式下选中角色 + 启用工具型 Skill，system prompt 同时包含工具 instructions 和角色 instructions，`tools` 参数包含所有启用的工具。
- [ ] `deep` 模式下选中角色，工具往返历史完整保留，角色 instructions 持续生效。
- [ ] 角色选择器列出所有 `kind=persona` 且 `enabled=true` 的 Skill；选择「无角色」时不注入任何 persona instructions。
- [ ] 切换会话时，各会话的角色选择互相独立。
- [ ] 删除 / 禁用当前角色对应的 Skill 后，会话回退为「无角色」并给出一次性提示。
- [ ] Settings → 技能扩展中工具型 / 角色型 Skill 有视觉区分。
