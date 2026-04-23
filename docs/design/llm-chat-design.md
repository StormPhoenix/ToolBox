# LLM Chat 对话功能设计

> Shell 内置的 LLM 纯对话面板。V1 提供流式对话、会话管理、图片输入；
> 不包含工具调用（tool_use）。

## 1. 功能概述

| 能力 | 说明 |
|---|---|
| 会话管理 | 创建 / 切换 / 重命名 / 删除 / 清空上下文 |
| 流式对话 | 逐 token 增量渲染，支持用户中止（Esc 或 ⏹ 按钮） |
| 多模态输入 | 文本 + 图片附件（粘贴 / 文件选择）；jpg/png/gif/webp |
| Markdown 渲染 | 助手回复自动解析，代码块语法高亮 + 复制按钮 |
| 多 Provider | 复用设置中当前 LLM Provider（Claude / OpenAI / Gemini） |
| 持久化 | 会话保存在 `userData/chat-sessions/` |

明确**不做**：工具调用、MCP、记忆系统、Token 预算裁剪、二次 LLM 错误恢复、多窗口并发。

## 2. 架构

```
┌────────────────── Shell (Vue 3) ───────────────────┐
│  ChatView.vue                                       │
│    ├─ SessionList    左栏：会话列表                  │
│    ├─ ChatHeader     顶部：标题 / 模型 / 清空/设置   │
│    ├─ MessageList    消息滚动区                      │
│    │    ├─ MessageBubble   user / assistant         │
│    │    │    └─ MarkdownView                        │
│    │    └─ StreamingBubble 正在生成中                │
│    └─ Composer       输入框 + 附件 + 发送/停止       │
│                                                      │
│  composables/useChat.ts  单例状态 + 事件订阅         │
│  utils/markdown.ts       markdown-it + highlight.js │
└────────────────┬────────────────────────────────────┘
                 │ window.electronAPI.*
                 ▼
┌──────────────── 主进程 ────────────────────────────┐
│  src/main/chat/                                     │
│    ├─ types.ts            ChatMessage/Session/Event │
│    ├─ session-store.ts    原子文件 I/O + 索引       │
│    ├─ chat-engine.ts      抢占式流式引擎            │
│    └─ chat-ipc.ts         IPC handlers + 事件广播    │
│                                                      │
│  src/main/llm/                                      │
│    ├─ types.ts            LLMProvider.streamMessage │
│    └─ providers/          Claude/OpenAI/Gemini 流式 │
└──────────────────────────────────────────────────────┘
```

### 2.1 LLMProvider 扩展

所有 Provider 新增 `streamMessage(system, messages, onText, signal)` 方法：

| Provider | 流式 API | AbortSignal | SSE 失败处理 |
|---|---|---|---|
| Claude | `client.messages.stream()` + `on('text')` | `stream.abort()` | 回退 `createMessage` |
| OpenAI | `chat.completions.create({ stream: true, stream_options: { include_usage: true } })` | SDK `signal` 参数 | 直接抛错 |
| Gemini | `ai.models.generateContentStream()` | `abortSignal` config | 直接抛错 |

### 2.2 ChatEngine 流程

```
sendMessage({ sessionId, userText, attachments, onEvent })
  ├─ 抢占同 sessionId 的旧 requestId → abort()
  ├─ loadSession(sessionId)
  ├─ buildUserMessage() → appendMessages() 持久化
  └─ runStream() 异步执行：
       provider.streamMessage(
         system, llmMessages,
         delta => onEvent({ kind: 'stream-chunk', text: delta }),
         abort.signal
       )
       ├─ 成功 → appendMessages(assistant) → onEvent('stream-end')
       ├─ abort → onEvent('aborted')（不入库）
       └─ 错误 → toFriendlyError() → onEvent('error')
```

**抢占规则**：同一 session 同时只允许一个活动请求；不同 session 并行。

### 2.3 事件流

主进程通过 `webContents.send('chat:event', ChatEvent)` 向所有渲染进程广播：

```ts
type ChatEvent =
  | { kind: 'stream-chunk';  requestId; text }
  | { kind: 'stream-end';    requestId; text; assistantMessageId; usage? }
  | { kind: 'error';         requestId; message; recoverable }
  | { kind: 'aborted';       requestId };
```

渲染进程 `useChat` 订阅该通道，仅处理 `requestId === currentRequestId` 的事件。

## 3. 存储布局

```
userData/
└── chat-sessions/
    ├── index.json              # SessionIndexEntry[]
    └── <uuid>.json             # ChatSession
```

**原子写**：先写 `<file>.tmp-<timestamp>` 再 `rename`，避免中途崩溃导致文件损坏。

**索引分离**：启动时只读 `index.json` 渲染列表，按需加载单会话完整数据。

**自动命名**：会话标题默认"新会话"，首条 user 消息发送后取前 20 字（超出以 `…` 结尾）。

## 4. UI 布局

- 左栏 240px：会话列表，顶部"＋ 新会话"按钮，列表项 hover 显示"重命名 / 删除"操作
- 右栏 flex: 1：
  - Header：标题 · `Provider · Model` 徽章（绿点表示可用）· 清空/设置
  - MessageList：最大宽度 920px 居中，user 消息右对齐紫色，assistant 左对齐卡片色
  - Composer：圆角卡片，附件栏 + 多行 textarea + 发送/停止按钮

**快捷键**：
- `Enter` 发送
- `Shift + Enter` 换行
- `Esc` 停止生成（流式中）

**滚动**：默认自动滚底；用户手动向上滚动时暂停，并在流式中显示"↓ 新消息"按钮。

**Markdown 流式渲染**：使用 `requestAnimationFrame` 合批，避免每个 chunk 都重 parse。

## 5. IPC 通道

### Invoke

| 通道 | 入参 | 出参 |
|---|---|---|
| `chat:list-sessions` | — | `SessionIndexEntry[]` |
| `chat:load-session` | `id` | `ChatSession \| null` |
| `chat:create-session` | `title?` | `ChatSession` |
| `chat:delete-session` | `id` | `void` |
| `chat:rename-session` | `id, title` | `void` |
| `chat:clear-context` | `id` | `void` |
| `chat:send` | `ChatSendInput` | `ChatSendResult`（立即返回，真实回复通过事件流推送） |
| `chat:abort` | `requestId` | `void` |

### Push

| 通道 | 载荷 |
|---|---|
| `chat:event` | `ChatEvent`（见 §2.3） |

## 6. 错误处理

错误分类（`chat-engine.ts` 的 `toFriendlyError`）：

| 错误类型 | 提示文案 | recoverable |
|---|---|---|
| 401 / authentication | API Key 无效或已过期 | false |
| timeout / 网络 | 网络连接失败 | true |
| 429 / rate limit | 请求过于频繁 | true |
| 5xx / overloaded | 服务端暂时繁忙 | true |
| context length | 对话超出上下文，请清空或新建 | false |
| 未识别 | 对话失败：`<原始错误>` | true |

错误消息通过 `chat:event { kind: 'error' }` 推送，UI 显示红色条，不入会话历史。

## 7. 与现有模块的关系

- 复用 `src/main/llm/router.ts` 的 `LLMRouter` 单例（经 `getSharedLLMRouter()` 暴露给 ChatEngine）
- 复用设置页的 LLM 配置（`llm:get-config` / `llm:set-config`）
- 不与插件系统耦合：插件注册表不出现 chat 入口，Sidebar 底部独立项

## 8. V2 演进方向（非 V1 范围）

- Agent Loop + 工具调用（参考外部项目 `agent-loop.ts`）
- 工具确认弹窗（approved / approved-all / trusted / rejected）
- 工具循环检测 Hook / Overflow 预判 Hook
- Token 预算裁剪（长会话自动滑窗）
- 二次 LLM 错误恢复（角色化道歉）
- 多模型并排对比 / 模型快速切换
- 导出会话为 Markdown
