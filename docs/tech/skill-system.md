# Skill 系统架构文档

## 1. 概述

Skill 系统是 ToolBox 为 LLM Chat 对话提供**工具调用能力**的扩展机制。每个 Skill 是一个声明式配置 + 执行脚本的组合，Chat Engine 在 Agent 循环中会自动把启用 Skill 的工具列表传给 LLM，LLM 主动调用后由 SkillRegistry 路由执行。

### 1.1 与 IPC 层的区别

| 维度 | IPC 层（`window.electronAPI.*`） | Skill 系统 |
|---|---|---|
| 调用方 | 插件 / Shell 代码显式调用 | LLM 在对话中自主决定调用 |
| 协议 | TypeScript 接口 + 主进程 handler | `SKILL.md` 声明式 + `.cjs` 脚本执行 |
| 审批 | 无（代码层信任） | MODERATE 级别需用户弹窗确认 |
| 热更新 | 需重编译 | 用户级 Skill 放入 `userData/skills/` 重启生效 |
| 典型用途 | 文件读写、LLM 请求等基础设施 | 搜索、计算、文本处理等 AI 可调用的工具 |

### 1.2 规范兼容性

SKILL.md 的 frontmatter 格式基本沿用 [AgentSkills 开放规范](https://agentskills.io)，元数据命名空间使用 `toolbox`（区别于外部其他项目的 `clawpet` / `openclaw`）。

---

## 2. SKILL.md 规范

### 2.1 文件结构

每个 Skill 是一个目录，必须包含 `SKILL.md`：

```
skills/<skill-name>/
├── SKILL.md              # 必需：YAML frontmatter + Markdown 指令
└── scripts/
    └── <script>.cjs      # 可选：工具执行脚本
```

### 2.2 Frontmatter 字段

```yaml
---
name: web-search              # 必填：小写字母/数字/连字符，最长 64 字符
description: >                # 必填：最长 1024 字符，LLM 看到的 Skill 描述
  搜索互联网获取实时信息。...
metadata:
  toolbox:
    version: "1.0.0"          # 可选：语义版本
    emoji: "🔍"                # 可选：UI 图标
    tools:                    # 工具列表
      - name: web_search      # 工具名（全局唯一）
        displayName: "网页搜索" # UI 和 tool-executing 事件显示名
        description: |        # 给 LLM 的工具描述
          搜索互联网并返回结果摘要...
        inputSchema:          # JSON Schema 参数定义
          type: object
          properties:
            query:
              type: string
              description: 搜索关键词
          required: [query]
        riskLevel: SAFE       # SAFE | MODERATE
        confirmHint: "搜索: {query}"   # MODERATE 工具的确认弹窗描述模板
        scriptEntry: scripts/web-search.cjs   # 执行脚本路径
---

# <Skill Name>

这里是 Markdown body，作为 instructions 注入 system prompt。
```

### 2.3 Markdown Body（instructions）

`---` frontmatter 后的 Markdown 内容会被 SkillLoader 解析为 Skill 的 **instructions**。启用该 Skill 时，这部分文本会拼接进 `system prompt`，让 LLM 理解：

- 什么场景下应该使用此技能
- 多个工具的选择规则
- 和其他 Skill 的配合关系

支持两个模板变量：
- `{baseDir}` — Skill 目录的绝对路径
- `{dataDir}` — Skill 专属缓存目录 `userData/skill-data/<skillName>/`

### 2.4 scripts/*.cjs 约束

内置 Skill 脚本**必须遵守**：

1. **零 npm 依赖** — 只允许 `require('electron')` 和 Node 内置模块（`fs` / `path` / `os` / `crypto` / `https` / `child_process` 等）
2. **导出 execute 函数**：
   ```javascript
   async function execute(input, context) { ... }
   module.exports = { execute }
   ```
3. **context 字段只有 3 个**（`skillDir` / `dataDir` / `toolName`）
4. **.cjs 后缀**（避免被 `package.json` 的 `"type": "module"` 影响）

用户级 Skill（`userData/skills/`）也需遵守以上约束。

---

## 3. 内置 Skill 清单（12 个）

### 3.1 SAFE 工具（无需确认，9 个 Skill / 17 个工具）

| Skill | 工具 | 功能 |
|---|---|---|
| **web-search** 🔍 | `web_search` | DuckDuckGo 搜索，返回标题/URL/摘要（**不含正文**） |
| **web-fetch** 🌐 | `web_fetch` | 抓取一个 http/https URL 的页面正文供 LLM 阅读/总结，自动处理 GitHub 仓库主页改写到 raw README |
| **quick-calc** 🔢 | `quick_calc` | 数学表达式 / 单位换算 / 日期计算 |
| **text-transform** 🔤 | `text_transform` | JSON/Base64/URL/哈希/UUID/大小写/字数/正则 |
| **clipboard-ops** 📋 | `read_clipboard` / `write_clipboard` | 系统剪贴板读写 |
| **system-info** 💻 | `system_info` | 时间/日期/OS/内存查询 |
| **file-ops** 📂 | `list_directory` / `file_info` / `read_text_file` / `search_files` / `get_path` / `inspect_path` | 文件系统只读操作（**仅本地路径**） |
| **safe-desktop** 🔔 | `open_url` / `send_notification` / `open_directory` / `show_in_explorer` / `reveal_path` | 打开网页/通知/文件管理器（`open_url` 只在浏览器弹页面，**不返回正文**） |
| **file-download** ⬇️ | `download_file` | 下载文件到 Downloads 目录（**不用于读取网页正文**） |

### 3.2 MODERATE 工具（需用户确认，3 个 Skill / 9 个工具）

| Skill | 工具 | 功能 |
|---|---|---|
| **file-write** ✏️ | `create_text_file` / `write_text_file` / `copy_file` / `move_file` / `create_directory` / `delete_file` / `batch_file_ops` | 文件写入/删除/移动/批量操作 |
| **desktop-action** 🖥️ | `desktop_action` | 启动本地应用或打开文件夹 |
| **run-script** ⚡ | `run_script` | 执行 AI 生成的 Node.js / Shell 脚本 |

### 3.3 工具总数

- 12 个 Skill，28 个工具
- 默认全部启用，可在 Settings → 技能扩展中按 Skill 粒度禁用
- 全部零 npm 依赖，通过 `build:skills` 脚本原样拷贝到 `dist/main/skill/builtin-skills/`

---

## 4. 风险与确认体系

### 4.1 两级风险

| 级别 | 含义 | 默认行为 |
|---|---|---|
| **SAFE** | 只读 / 无副作用 / 对系统无影响 | 直接执行，不弹窗 |
| **MODERATE** | 有副作用（写文件、启动程序、执行脚本） | 弹窗等待用户决策 |

注：Skill 系统不设 DANGEROUS 级别。外部项目（如 OpenClaw/ClawPet）的 DANGEROUS 工具在 SkillLoader 中会自动归并为 MODERATE。

### 4.2 确认弹窗流程

```
┌────────────────────────────────────────────────────────┐
│ 1. LLM 返回 tool_use（stop_reason='tool_use'）          │
│ 2. chat-engine 检测工具 riskLevel                       │
│    - SAFE → 直接执行 (step 6)                           │
│    - MODERATE 且未信任 → 继续 step 3                    │
│ 3. emit 'tool-confirm-request' 事件给渲染进程           │
│ 4. 渲染进程 useChat 设置 pendingConfirm                 │
│    → ConfirmDialog.vue 弹出模态窗                       │
│ 5. 用户点击 4 个按钮之一 →                              │
│    chat:confirm-response IPC 回传决策                   │
│ 6. chat-engine 根据决策处理：                           │
│    - approved: 执行本次，下次同工具仍询问               │
│    - approved-all: 本请求剩余所有 MODERATE 工具放行     │
│    - trusted: 写入 trustedTools 永久信任                │
│    - rejected: 回注 "用户拒绝了此操作" 为 tool_result   │
│ 7. 继续 Agent 循环                                      │
└────────────────────────────────────────────────────────┘
```

### 4.3 四种决策说明

| 决策 | 作用范围 | 持久化 |
|---|---|---|
| **approved** | 仅本次调用 | 否 |
| **approved-all** | 当前用户消息的整个 Agent 循环 | 否（本轮结束失效） |
| **trusted** | 永久免确认 | 是（写入 `skill-config.json`） |
| **rejected** | 本次拒绝，工具返回错误 | 否（下次还会询问） |

### 4.4 永久信任撤销

Settings → 技能扩展底部的"已永久信任的工具"折叠区：

- 只在有信任项时显示
- 每项提供"撤销"按钮
- 撤销后下次调用该工具会重新弹窗

### 4.5 中止机制

如果用户在确认弹窗前点击 Composer 的"停止"按钮：
- `chat:abort` IPC 触发 `AbortController.abort()`
- `pendingConfirmations` 中对应的 promise 被强制 resolve 为 `'rejected'`
- 弹窗被 useChat 清空（`pendingConfirm.value = null`）
- Agent 循环退出，emit `'aborted'` 事件

**不设置超时**——用户可能思考很久，超时自动拒绝会让用户困惑。

---

## 5. 运行时架构

### 5.1 目录结构

```
src/main/skill/
├── types.ts                  # SkillManifest / SkillToolDefinition / SkillContext 等类型
├── skill-loader.ts           # SKILL.md 解析 + 目录发现 + 脚本动态 require
├── skill-registry.ts         # 注册表：toolIndex / execute / 确认判断 / 信任管理
├── skill-config.ts           # 持久化（disabled / trustedTools）读写
├── skill-ipc.ts              # IPC handlers + initializeSkillSystem
└── builtin-skills/           # 12 个内置 Skill（打包时拷贝到 dist）
    ├── web-search/
    │   ├── SKILL.md
    │   └── scripts/web-search.cjs
    ├── web-fetch/
    │   ├── SKILL.md
    │   └── scripts/web-fetch.cjs
    ├── quick-calc/
    ├── text-transform/
    ├── clipboard-ops/
    ├── system-info/
    ├── file-ops/
    ├── safe-desktop/
    ├── file-download/
    ├── file-write/
    ├── desktop-action/
    └── run-script/
```

### 5.2 SkillRegistry

单例模式，由 `main.ts` 在 `app.whenReady()` 时创建，通过 `setSharedSkillRegistry()` 注入给 chat-engine。

核心方法：

```typescript
class SkillRegistry {
  register(skill: SkillDefinition): void;
  getLLMTools(): LLMToolDef[];                         // chat-engine 每轮调用获取最新工具
  execute(toolName, input): Promise<unknown>;
  
  // 确认机制
  getToolRiskLevel(toolName): 'SAFE' | 'MODERATE' | undefined;
  requiresConfirmation(toolName): boolean;
  getToolConfirmHint(toolName, input): string | undefined;  // 渲染 {paramName} 模板
  
  // 信任管理
  addTrustedTool(toolName): void;
  removeTrustedTool(toolName): void;
  getTrustedToolDetails(): Array<{ toolName, displayName, skillName }>;
  
  // System Prompt
  buildSystemInstructions(): string;    // 拼接所有启用 Skill 的 instructions
  
  // 启用/禁用
  disableSkill(name): void;
  enableSkill(name): void;
  getSkillList(): Array<{ name, description, emoji, builtin, enabled, toolCount }>;
}
```

### 5.3 SkillLoader

发现顺序（低优先级先扫，高优先级覆盖）：
1. `dist/main/skill/builtin-skills/`（生产环境从 `resources/app.asar.unpacked/...`）
2. `userData/skills/`（用户级，可自由添加）

脚本加载使用 `createRequire(import.meta.url)` + `delete require.cache[resolved]`，支持热重载（但目前未暴露热重载 API，仅启动时扫描一次）。

### 5.4 SkillContext

**精简版**，仅 3 个字段：

```typescript
interface SkillContext {
  skillDir: string;   // Skill 目录绝对路径（只读）
  dataDir: string;    // userData/skill-data/<skillName>/（可读写，首次调用时自动创建）
  toolName: string;   // 当前被调用的工具名（同一脚本服务多个工具时用于区分）
}
```

外部项目的 SkillContext 有 20+ 字段（petId / petInteraction / memoryStore / runPowerShell 等桌宠专用），本项目全部砍掉。脚本使用这些字段会得到 `undefined`——所有移植脚本已做防御处理。

### 5.5 Agent 循环集成（chat-engine）

Chat Engine 的 `runStream()` 是一个 `while (iter < MAX_TOOL_ITERATIONS)` 循环（`MAX_TOOL_ITERATIONS = 8`）：

```
每轮迭代：
  1. tools = skillRegistry.getLLMTools()    // 动态获取（启用状态实时生效）
  2. provider.streamMessage(sys, messages, onText, signal, tools, {type:'auto'})
  3. stop_reason === 'end_turn' → 输出最终文本，持久化，退出
  4. stop_reason === 'tool_use' → 
     4.1 持久化 assistant 中间消息（toolRoundtrip=true）
     4.2 for each tool_use block:
         4.2.1 检查 requiresConfirmation() + approvedAllTools 本轮集合
         4.2.2 需要确认 → emit 'tool-confirm-request' → 等待 resolveConfirmation()
         4.2.3 emit 'tool-executing'
         4.2.4 skillRegistry.execute()
         4.2.5 emit 'tool-done'
     4.3 持久化 user(tool_result) 中间消息（toolRoundtrip=true）
     4.4 continue
  5. 最后一轮（iter === MAX_TOOL_ITERATIONS）继续传 tools，但在 system 中追加
     "工具次数已用尽，请基于已有信息直接给出最终回复" 的提示，
     引导模型用文字收尾（强制 disable tools 易导致空 content，参见 chat-engine.ts 注释）
```

`toolRoundtrip: true` 标记的中间消息在 `regenerateMessage()` 时会被一并丢弃，避免重新生成只处理最后一条 assistant。

---

## 6. 新增 Skill 步骤

> **快速上手请直接看** [`docs/use/skill-authoring.md`](../use/skill-authoring.md)（操作型指南：必填字段、完整示例、内置 vs 用户级 Skill 差异、常见坑）。
> 本节仅保留极简流程，作为架构层的速查。

### 6.1 SAFE Skill（无需确认）

以新增一个"天气查询"Skill 为例：

```
1. mkdir src/main/skill/builtin-skills/weather
2. 创建 SKILL.md：
   ---
   name: weather
   description: 查询城市天气
   metadata:
     toolbox:
       emoji: "🌤️"
       tools:
         - name: get_weather
           description: 获取指定城市的天气
           inputSchema:
             type: object
             properties:
               city: { type: string }
             required: [city]
           riskLevel: SAFE
           scriptEntry: scripts/weather.cjs
   ---
   # Weather Skill
   查询全球城市的实时天气。

3. 创建 scripts/weather.cjs：
   async function execute(input, context) {
     const { city } = input;
     // 用 https 调用天气 API
     return { city, temperature: 22, description: '晴' };
   }
   module.exports = { execute };

4. pnpm run build:skills    # 拷贝到 dist/main/skill/builtin-skills/
5. 重启应用 → Settings → 技能扩展 会自动列出 Weather
```

### 6.2 MODERATE Skill（需要确认）

和 SAFE 的唯一区别是：
- `riskLevel: MODERATE`
- 建议提供 `confirmHint` 字段（否则弹窗只显示 `displayName`）

`confirmHint` 支持 `{paramName}` 占位符，替换规则：
- `string` → 原样
- `Array` → `"N 项"`
- 其他 → `JSON.stringify`

示例：

```yaml
confirmHint: "删除文件: {path}"
# 渲染为：删除文件: C:\Users\xxx\temp.txt

confirmHint: "批量操作（{actions}）"
# 渲染为（actions 传了 5 元素数组）：批量操作（5 项）
```

### 6.3 用户级 Skill

用户可以把自己写的 Skill 放到 `userData/skills/<skill-name>/` 下，重启应用后自动加载。

Settings → 技能扩展 → "打开技能目录"按钮会直接打开此目录。

用户级 Skill 和内置 Skill 同名时，**用户级会覆盖内置**（在 SkillLoader 的 `discoverSkillDirs` 中按后扫描覆盖先扫描）。

---

## 7. 打包与部署

### 7.1 构建脚本

`scripts/copy-skills.mjs`：

```javascript
import { cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const src = resolve(__dirname, '..', 'src/main/skill/builtin-skills');
const dest = resolve(__dirname, '..', 'dist/main/skill/builtin-skills');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
```

触发方式：

| 命令 | 何时执行 |
|---|---|
| `pnpm run build:skills` | 手动触发（修改 SKILL.md 或 .cjs 后必须运行） |
| `pnpm run build` | 作为 `build:main` 后的一步自动执行 |

### 7.2 electron-builder 配置

`.cjs` 脚本必须 unpack，否则 `require()` 从 asar 内部加载可能失败：

```jsonc
{
  "asarUnpack": [
    "dist/main/skill/builtin-skills/**/*"
  ]
}
```

### 7.3 路径解析

`SkillLoader.getBuiltinSkillsDir()`：

| 环境 | 路径 |
|---|---|
| 开发（dev:main） | `dist/main/skill/builtin-skills/`（优先） |
| 开发（未 build:skills） | 回退到 `src/main/skill/builtin-skills/` |
| 生产（打包后） | `process.resourcesPath/app.asar.unpacked/dist/main/skill/builtin-skills/` |

### 7.4 Vite external

`vite.main.config.ts` 中需将 `js-yaml` 标记为 external（用于 SKILL.md 解析）：

```typescript
rollupOptions: {
  external: [
    'electron',
    'sharp',
    'exifr',
    'js-yaml',    // ← Skill 系统依赖
    ...NODE_BUILTINS,
  ],
}
```

---

## 8. 数据持久化

### 8.1 skill-config.json

路径：`userData/skill-config.json`

```jsonc
{
  "disabled": [        // 用户禁用的 Skill 名称列表
    "run-script"
  ],
  "trustedTools": [    // 用户永久信任的 MODERATE 工具名称列表
    "move_file",
    "copy_file"
  ]
}
```

### 8.2 skill-data/ 目录

路径：`userData/skill-data/<skillName>/`

每个 Skill 的专属缓存空间，通过 `context.dataDir` 访问。首次调用时自动创建。

典型用途：
- **web-search**：DuckDuckGo Cookie 持久化（`ddg-cookies.json`）+ 搜索结果缓存（`search-<hash>.json`）
- **其他 Skill**：按需自定义

Skill 卸载或更换不会自动清理此目录，用户可手动删除。

---

## 9. 相关文件索引

| 文件 | 职责 |
|---|---|
| `src/main/skill/types.ts` | 类型定义 |
| `src/main/skill/skill-loader.ts` | SKILL.md 解析 + 目录扫描 + 脚本加载 |
| `src/main/skill/skill-registry.ts` | 单例注册表 + 执行路由 + 风险判断 + 信任管理 |
| `src/main/skill/skill-config.ts` | `skill-config.json` 读写 |
| `src/main/skill/skill-ipc.ts` | IPC handlers + initializeSkillSystem |
| `src/main/chat/chat-engine.ts` | Agent 循环 + 确认拦截 + `resolveConfirmation` |
| `src/shell/components/chat/ConfirmDialog.vue` | 确认对话框 UI |
| `src/shell/components/Settings.vue` | 技能扩展 section（启用/禁用 + 信任撤销） |
| `scripts/copy-skills.mjs` | 构建期拷贝脚本 |
| `plugins/shared/bridge/src/types.ts` | `SkillListItem` / `TrustedToolItem` / ChatEvent 类型定义 |
