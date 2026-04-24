# LLM 调试与 Prompt Dump

## 1. 概述

**PromptDumper** 是为开发者提供的调试工具，把每次 LLM 调用的**请求 + 响应**合并为一个 JSON 文件落盘，方便回看、排查、复现 bug。

核心特点：
- **覆盖所有 LLM 调用**：通过 `LLMRouter.getProvider()` 返回 `DumpingProvider` 代理，任何通过 Router 发起的调用（chat-engine Agent 循环、插件 `llmChat` / `llmGenerateImage`、连接测试）都会被自动 dump
- **单文件合并**：同一次 LLM 调用的请求 + 响应 + 耗时 + 错误信息都在一个 `.json` 里，打开一个文件即可看全貌
- **按 scene 区分来源**：调用方通过 `router.withScene('scene-name', opts)` 标注场景，dump 文件名和内容携带 scene 字段
- **零生产负担**：生产默认关闭，`dumpCall()` 首行判断直接 return，零 IO 开销
- **自动清理**：保留最近 7 天的日期目录，单日最多保留 200 份文件

---

## 2. 何时启用

| 环境 | 默认状态 | 切换方式 |
|---|---|---|
| 开发（`!app.isPackaged`） | **启用** | Settings → 开发者调试 |
| 生产（打包后） | **关闭** | Settings → 开发者调试 |

一旦用户在 Settings 手动切换，选择会被持久化到 `userData/debug-config.json`，覆盖默认值。

---

## 3. 调用架构

### 3.1 调用链路

```
chat-engine / llm-ipc / 未来其他入口
    │
    │ router.withScene('main-chat', { requestId, sessionId, iteration })
    │        .getProvider()
    │        .streamMessage(...)
    ↓
DumpingProvider（代理 LLMProvider 接口）
    │
    ├─ 消费 pendingScene 上下文
    ├─ 调用 inner.streamMessage(...) / createMessage(...) / generateImage(...)
    └─ fire-and-forget: dumpCall({ scene, request, response, durationMs, error? })
    ↓
ClaudeProvider / OpenAIProvider / GeminiProvider（真实调用）
```

### 3.2 withScene 语义

`withScene()` 设置的上下文是**单次有效**的——每次 Provider 方法调用后上下文被消费清空，下一次若未再次 `withScene()` 则 scene 回退到 `'unknown'`。

这种"单次消费"避免了异步串扰：不会出现"A 调用设置的 scene 被 B 调用的请求读走"。

### 3.3 使用示例

```typescript
// chat-engine 的 Agent 循环（每轮迭代都要 withScene 一次）
router.withScene('main-chat', { requestId, sessionId, iteration: iter });
const response = await provider.streamMessage(systemParam, llmMessages, ...);

// 插件 llm:chat IPC handler
const response = await r
  .withScene('plugin-llmchat')
  .getProvider()!
  .createMessage(system, messages);

// 插件 llm:generate-image IPC handler
const result = await r
  .withScene('plugin-image-gen')
  .getProvider()!
  .generateImage(options);

// 连接测试
await r.withScene('connection-test').getProvider()!.createMessage('', [...]);
```

---

## 4. 文件结构

```
userData/llm-dumps/
├── 2026-04-24/                               # 按日期分目录（UTC）
│   ├── 2026-04-24T12-34-56-789_main-chat_sess-a1b2c3d4_req-cdef1234_iter1.json
│   ├── 2026-04-24T12-34-58-456_main-chat_sess-a1b2c3d4_req-cdef1234_iter2.json
│   ├── 2026-04-24T12-35-01-123_plugin-llmchat.json
│   ├── 2026-04-24T12-35-05-999_plugin-image-gen.json
│   └── 2026-04-24T12-36-10-456_connection-test.json
└── 2026-04-25/
    └── ...
```

### 4.1 文件命名规则

```
{ISO 时间戳}_{scene}[_sess-{sid}][_req-{rid}][_iter{N}].json
```

**规则说明**：
- `sess-` / `req-` / `iter` 段**按需出现**：chat 场景全部有，插件场景可能只有 scene，连接测试则更简洁
- `sess` / `req` 只取前 8 位，便于区分又不过长
- ISO 时间戳中的 `:` / `.` 替换为 `-`，保证跨平台文件名合法

**串联同一 Agent 循环**：在同一目录下按 `req-{xxx}` 过滤 + 字典序排序 = 时间顺序 = 完整 Agent 循环全貌。

---

## 5. 文件内容

### 5.1 Chat 场景（`callType: 'chat'`）

```jsonc
{
  "timestamp": "2026-04-24T12:34:56.789Z",
  "scene": "main-chat",
  "requestId": "cdef1234-...",
  "sessionId": "a1b2c3d4-...",
  "iteration": 1,
  "provider": {
    "name": "Claude (claude-sonnet-4-5)",
    "model": "claude-sonnet-4-5"
  },
  "durationMs": 2341,
  "callType": "chat",
  "request": {
    "system": [
      {
        "type": "text",
        "text": "<skill name=\"web-search\">...</skill>",
        "cache_control": { "type": "ephemeral" }    // 可见 Prompt Caching 标记
      }
    ],
    "messages": [
      { "role": "user", "content": "帮我搜一下 Node.js 最新版本" }
    ],
    "tools": [
      { "name": "web_search", "description": "...", "input_schema": {...} },
      { "name": "quick_calc", "description": "...", "input_schema": {...} }
      // ... 27 个工具
    ]
  },
  "response": {
    "content": [
      { "type": "text", "text": "我来搜索一下" },
      {
        "type": "tool_use",
        "id": "toolu_xxx",
        "name": "web_search",
        "input": { "query": "Node.js latest version" }
      }
    ],
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 11234,
      "output_tokens": 234,
      "cache_creation_input_tokens": 10000,
      "cache_read_input_tokens": 0
    }
  },
  "requestMeta": {
    "systemChars": 10234,
    "messageChars": 23,
    "toolCount": 27,
    "messageCount": 1
  }
}
```

### 5.2 图像生成场景（`callType: 'image-gen'`）

```jsonc
{
  "timestamp": "2026-04-24T12:35:05.999Z",
  "scene": "plugin-image-gen",
  "provider": { "name": "OpenAI (dall-e-3)", "model": "dall-e-3" },
  "durationMs": 18234,
  "callType": "image-gen",
  "request": {
    "options": {
      "prompt": "一只在樱花树下打盹的橘猫，吉卜力风格",
      "size": "1024x1024",
      "quality": "hd"
    }
  },
  "response": {
    "images": ["<base64 image #1>"],     // 原 base64 被替换为占位符（避免 JSON 体积爆炸）
    "revised_prompt": "A tabby cat..."
  },
  "requestMeta": {
    "prompt": "一只在樱花树下打盹的橘猫，吉卜力风格"
  }
}
```

**注意**：图像生成响应的 base64 原图在 dump 文件中被替换为 `<base64 image #N>` 占位符。原图会几 MB 到几十 MB，写进 JSON 会让文件无法阅读也无法分享。如需原图请从 Chat 消息或 Shell 层保存。

### 5.3 异常响应

LLM 抛错时同样 dump，`response` 字段为占位值，关键信息在 `error`：

```jsonc
{
  "timestamp": "2026-04-24T12:34:58.123Z",
  "scene": "main-chat",
  "requestId": "cdef1234-...",
  "iteration": 1,
  "durationMs": 500,
  "callType": "chat",
  "request": { ... },
  "response": { "content": [], "stop_reason": "end_turn" },
  "error": {
    "message": "401 authentication_error",
    "stack": "Error: 401 authentication_error\n    at ..."
  },
  "requestMeta": { ... }
}
```

---

## 6. 典型 Scene 及用途

| Scene | 来源 | 用途 |
|---|---|---|
| `main-chat` | chat-engine Agent 循环 | 主对话（带工具调用） |
| `plugin-llmchat` | `llm:chat` IPC | 插件调用的一次性 LLM 对话 |
| `plugin-image-gen` | `llm:generate-image` IPC | 插件调用的文生图 |
| `connection-test` | Settings 测试连接按钮 | 验证 API Key 可用性 |
| `unknown` | 未使用 `withScene()` | 兜底（不应发生，发生即代码漏写 withScene） |

如果未来新增 LLM 调用入口，**为它定义一个独特的 scene 字符串**，便于过滤查找。

---

## 7. 典型调试场景

### 场景 1：验证 Prompt Caching 是否命中

查看 `main-chat` 场景文件的 `response.usage.cache_read_input_tokens`：
- 首次请求：`cache_creation=10000, cache_read=0`（创建缓存）
- 后续请求（5 分钟内）：`cache_creation=0, cache_read=10000`（命中，省 90% token）

若后续请求仍 `cache_read=0`，查两次 request 的 `system[0].text` diff 定位变化点（通常是 Skill 启用状态变了）。

### 场景 2：LLM 突然不调用工具

看 response 的 `stop_reason`：`tool_use` vs `end_turn`？
看 request 的 `tools` 数组：工具还在吗？
看 request 的 `system[0].text`：Skill instructions 是否发生变化？

### 场景 3：工具调用链为什么跑很多轮

按 `req-xxx` 过滤同一 requestId 的文件，按 `iter{N}` 顺序打开，能直接看出每轮 LLM 调用了什么工具、基于什么响应继续。

### 场景 4：插件调用 LLM 的问题

过滤 `plugin-llmchat` / `plugin-image-gen` 开头的文件，看插件传的 system / messages / options 是否合理。

### 场景 5：用户反馈 bug 复现

让用户开启 Settings → 开发者调试 → 重现 bug → 打开调试日志目录 → 整个日期目录发给开发者。开发者拿到后可完整还原对话上下文。

---

## 8. 运行时架构

### 8.1 模块清单

| 文件 | 职责 |
|---|---|
| `src/main/llm/debug-config.ts` | 配置持久化（`userData/debug-config.json`） + 环境感知默认值 |
| `src/main/llm/prompt-dumper.ts` | 核心 dump 器：单文件写盘、命名、清理、按日分目录 |
| `src/main/llm/dumping-provider.ts` | LLMProvider 代理：拦截 4 个方法 + 自动 `dumpCall` |
| `src/main/llm/router.ts` | LLMRouter：`getProvider()` 返回 DumpingProvider；提供 `withScene()` API |
| `src/main/llm/llm-ipc.ts` | IPC handlers：`debug:get-config` / `debug:set-config` / `debug:open-dump-dir`（与 llm 相关 IPC 合并） |
| `src/main/main.ts` | 启动时调用 `initializePromptDumper()` |
| `src/shell/components/Settings.vue` | UI 开关 + 打开目录按钮 |

### 8.2 性能影响

- **未启用时**：`dumpCall()` 首行判断 `cachedEnabled` 直接 return，零 IO
- **启用时**：每次 LLM 调用额外写 1 个 JSON 文件（~20-50 KB），**异步 fire-and-forget 不阻塞主流程**（用 `void` 触发），实测 < 5 ms
- 启动时**异步**清理过期目录（保留最近 7 天），不影响启动速度

### 8.3 自动清理策略

| 策略 | 触发时机 | 行为 |
|---|---|---|
| **日期过期** | 应用启动时异步清理 | 删除超过 7 天的日期目录 |
| **单日上限** | 每次 `dumpCall` 后异步检查 | 单日文件数 > `maxFilesPerDay`（默认 200）时删除最旧的 |

按文件名字典序排序 = 按时间顺序排序（文件名以 ISO 时间戳开头）。

---

## 9. 安全与隐私

### 9.1 不做脱敏

Dump 内容**原样保存**，包括：
- 用户粘贴的代码（可能含 API Key）
- `file-ops.read_text_file` 读取的文件内容
- 剪贴板内容

理由：
1. 调试必须看到原始内容才能复现问题
2. 文件存在用户本地 `userData/llm-dumps/`，不上传任何地方
3. 用户可随时关闭 dump 或手动删除目录

### 9.2 UI 层警告

Settings 开关下方有醒目警告：

> ⚠️ 会把对话完整内容写入磁盘，包含你粘贴的任何代码 / 文件 / 剪贴板内容。仅建议调试时开启。

### 9.3 分享 dump 文件时的注意事项

把 dump 文件发给他人前，自行检查：
- `request.messages[].content` 里是否有密码、API Key、其他敏感信息
- `response.content[].text` 里是否包含 LLM 复述的敏感信息

建议用专用测试对话复现问题，避免污染正常会话。

### 9.4 图像数据处理

图像生成场景的 response base64 原图会被替换为占位符 `<base64 image #N>`，不会写入 dump 文件。原因：
- base64 单张图几 MB，写进 JSON 会让文件无法阅读
- 分享时避免体积问题
- 原图如需保留，Chat 消息本身已经通过 image_ref 机制持久化

---

## 10. 数据持久化

### 10.1 debug-config.json

路径：`userData/debug-config.json`

```jsonc
{
  "promptDump": {
    "enabled": true,          // 是否启用 dump
    "maxFilesPerDay": 200     // 单日最多保留文件数
  }
}
```

### 10.2 llm-dumps/ 目录

路径：`userData/llm-dumps/YYYY-MM-DD/*.json`

首次 dump 时自动创建。全部文件可以手动删除，不影响应用运行。

---

## 11. 未来可扩展点

当前实现刻意保持简洁，如果有更复杂需求可以考虑：

- **前端 Debug 面板**：应用内直接浏览 dump 记录（不用打开文件管理器）
- **场景粒度开关**：对不同 scene 独立开关（如只想看 main-chat 不想看插件）
- **dump 搜索**：主进程提供按 keyword / scene / sessionId / 日期范围筛选的 IPC
- **自动脱敏选项**：UI 里加"安全模式"复选框，正则替换常见 API Key 格式

V1 不做——先让简单方案跑起来，真出现需求再扩展。
