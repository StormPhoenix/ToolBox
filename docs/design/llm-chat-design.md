# LLM Chat 对话功能设计

> Shell 内置的 LLM Chat 面板。当前提供流式对话、会话管理、图片输入、
> 多选导出、重新生成、编辑重发，以及基于 Skill 系统的工具调用能力。

## 1. 功能概述

| 能力 | 说明 |
|---|---|
| 会话管理 | 创建 / 切换 / 重命名 / 删除 / 清空上下文 |
| 流式对话 | 逐 token 增量渲染，支持用户中止（Esc 或 ⏹ 按钮） |
| 多模态输入 | 文本 + 图片附件（粘贴 / 文件选择）；jpg/png/gif/webp |
| Markdown 渲染 | 助手回复自动解析，代码块语法高亮 + 复制按钮 |
| 多 Provider | 复用设置中当前 LLM Provider（Claude / OpenAI / Gemini） |
| 对话模式 | 三种模式（chat / agent / deep）per-request 切换，session 级持久化 |
| 工具调用 | agent / deep 模式下启用 Skill，LLM 可自动调用 SAFE / MODERATE 工具，MODERATE 工具需用户确认 |
| 对话编辑 | assistant 重新生成、user 就地编辑并重发，均通过截断后续消息实现 |
| 多选导出 | 支持多条消息合并复制为 Markdown / HTML，或导出 Markdown 文件和图片目录 |
| 持久化 | 会话保存在 `userData/chat-sessions/` |

明确**不做**：MCP、记忆系统、Token 预算裁剪、二次 LLM 错误恢复、多窗口并发、对话分支树。

## 2. 架构

```
┌────────────────── Shell (Vue 3) ───────────────────┐
│  ChatView.vue                                       │
│    ├─ SessionList    左栏：会话列表                  │
│    ├─ ChatHeader     顶部：标题 / 模型 / 清空/设置   │
│    ├─ MessageList    消息滚动区                      │
│    │    ├─ MessageBubble   user / assistant         │
│    │    │    └─ MarkdownView                        │
│    │    ├─ ToolCallBubble  工具执行状态              │
│    │    └─ StreamingBubble 正在生成中                │
│    └─ Composer       输入框 + 附件 + 发送/停止       │
│       ConfirmDialog   MODERATE 工具确认弹窗          │
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
│  src/main/skill/                                    │
│    ├─ skill-registry.ts   Skill 注册表 + 执行路由    │
│    └─ skill-ipc.ts        Skill 设置 / 信任管理 IPC  │
│                                                      │
│  src/main/llm/                                      │
│    ├─ types.ts            LLMProvider.streamMessage │
│    └─ providers/          Claude/OpenAI/Gemini 流式 │
└──────────────────────────────────────────────────────┘
```

### 2.1 LLMProvider 扩展

所有 Provider 提供 `streamMessage(system, messages, onText, signal, tools?, toolChoice?)` 方法。
纯对话时不传 tools；Chat Engine 启用 Skill 后会传入当前启用工具列表和 `tool_choice: auto`。

| Provider | 流式 API | AbortSignal | SSE 失败处理 |
|---|---|---|---|
| Claude | `client.messages.stream()` + `on('text')` | `stream.abort()` | 回退 `createMessage` |
| OpenAI | `chat.completions.create({ stream: true, stream_options: { include_usage: true } })` | SDK `signal` 参数 | 直接抛错 |
| Gemini | `ai.models.generateContentStream()` | `abortSignal` config | 直接抛错 |

### 2.2 ChatEngine 流程

```
sendMessage({ sessionId, userText, attachments, onEvent, mode })
  ├─ 抢占同 sessionId 的旧 requestId → abort()
  ├─ loadSession(sessionId)
  ├─ buildUserMessage() → appendMessages() 持久化
  └─ runStream({ mode }) 异步执行：
       ├─ prepareLLMMessages(history, mode)：
       │    ├─ mode !== 'deep' → 跳过所有 toolRoundtrip=true 的中间消息
       │    └─ image_ref 按 K=1 还原 / 历史淡出
       ├─ 构建 system blocks：
       │    ├─ session systemPrompt（所有模式）
       │    └─ Skill instructions（仅 agent / deep 模式，mode !== 'chat'）
       ├─ tools = mode !== 'chat' ? registry.getLLMTools() : undefined
       ├─ while iter < 5:
       │    ├─ provider.streamMessage(system, messages, onText, signal, tools, auto)
       │    ├─ stop_reason=end_turn/max_tokens
       │    │    └─ appendMessages(pending tool messages + assistant) → stream-end
       │    └─ stop_reason=tool_use
       │         ├─ stream-reset 清空前端中间文本
       │         ├─ 持久化 assistant tool_use 中间消息（toolRoundtrip=true）
       │         ├─ SAFE 工具直接执行；MODERATE 工具发起确认
       │         ├─ tool-executing / tool-done 事件更新 UI
       │         └─ tool_result 作为 user 中间消息回注 LLM，继续下一轮
       ├─ abort → onEvent('aborted')（不入库）
       └─ 错误 → toFriendlyError() → onEvent('error')
```

**抢占规则**：同一 session 同时只允许一个活动请求；不同 session 并行。

### 2.3 事件流

主进程通过 `webContents.send('chat:event', ChatEvent)` 向所有渲染进程广播：

```ts
type ChatEvent =
  | { kind: 'stream-chunk';  requestId; text }
  | { kind: 'stream-reset';  requestId }
  | { kind: 'tool-executing'; requestId; toolName; toolDisplayName; toolInput }
  | { kind: 'tool-done'; requestId; toolName; toolDisplayName; success; summary }
  | { kind: 'tool-confirm-request'; requestId; confirmId; toolName; toolDisplayName; toolInput; confirmHint? }
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

**`ChatSession` 结构关键字段**：

```ts
interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
  messages: ChatMessage[];
  mode?: ChatMode;   // 新建会话默认 'chat'；缺失时 UI 视为 'chat'
}
```

`mode` 是会话级别的"上次使用模式"，在用户切换模式时立即持久化，下次打开会话自动恢复。

## 4. UI 布局

- 左栏 240px：会话列表，顶部"＋ 新会话"按钮，列表项 hover 显示"重命名 / 删除"操作
- 右栏 flex: 1：
  - Header：标题 · `Provider · Model` 徽章（绿点表示可用）· 清空/设置
  - MessageList：最大宽度 920px 居中，user 消息右对齐紫色，assistant 左对齐卡片色
  - ToolCallBubble：流式过程中展示当前工具执行状态和本轮工具结果摘要
  - Composer：圆角卡片，附件栏 + 多行 textarea + 发送/停止按钮
    - 底部左侧：**模式切换器**（对话 / 智能体 / 深度 三按钮分段控制器，对应 `chat / agent / deep`）
    - 底部右侧：操作提示文字
  - ConfirmDialog：MODERATE 工具执行前居中弹窗，支持拒绝 / 本次批准 / 全部批准 / 永久信任
  - SelectionToolbar：多选模式下替代 Composer，用于全选、复制、导出、取消

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
| `chat:set-session-mode` | `sessionId, mode` | `void`（切换模式时立即持久化） |
| `chat:send` | `ChatSendInput`（含 `mode?`） | `ChatSendResult`（立即返回，真实回复通过事件流推送） |
| `chat:abort` | `requestId` | `void` |
| `chat:confirm-response` | `{ confirmId, decision }` | `void` |
| `chat:resend-image-ref` | `LLMImageRefBlock` | `ChatAttachmentInput \| null` |
| `chat:export-selected` | `ChatExportInput` | `ChatExportResult` |
| `chat:regenerate` | `{ sessionId, assistantMessageId, mode? }` | `{ requestId, discardedCount }` |
| `chat:edit-and-resend` | `ChatEditAndResendInput`（含 `mode?`） | `{ requestId, userMessageId, discardedCount }` |

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
| context length / 413 | 对话过长或图片过大，自动清除最近消息中的图片引用 | false |
| 未识别 | 对话失败：`<原始错误>` | true |

错误消息通过 `chat:event { kind: 'error' }` 推送，UI 显示红色条，不入会话历史。
若错误需要剥离图片引用，主进程会更新会话，前端随后重新加载当前会话。

## 7. 与现有模块的关系

- 复用 `src/main/llm/router.ts` 的 `LLMRouter` 单例（经 `getSharedLLMRouter()` 暴露给 ChatEngine）
- 复用设置页的 LLM 配置（`llm:get-config` / `llm:set-config`）
- 复用 `src/main/skill/skill-registry.ts` 的 SkillRegistry 获取工具定义、执行工具、判断确认和永久信任
- 不与插件系统耦合：插件注册表不出现 chat 入口，Sidebar 底部独立项

## 8. 对话模式（chat / agent / deep）

### 8.0 设计原则

每次请求携带 `mode` 参数（`ChatSendInput.mode`），决定本次 LLM 调用的上下文组装方式。**持久化层永远存完整数据**（所有 toolRoundtrip 消息不因模式而丢失），仅 `prepareLLMMessages()` 的行为随 mode 变化。

| 维度 | `chat` | `agent` | `deep` |
|---|---|---|---|
| 历史 toolRoundtrip 消息 | 全部跳过 | 全部跳过 | 全部保留 |
| System：Skill instructions | 不加入 | 加入 | 加入 |
| API `tools` 参数 | `undefined` | `registry.getLLMTools()` | `registry.getLLMTools()` |
| 典型场景 | 快速问答、纯写作 | 自动工具调用（节省 token） | 需引用历史工具原始数据 |

**为什么 chat / agent 都剔除 toolRoundtrip**：

- 同 session 中已持久化的 toolRoundtrip 消息均为"已完成"状态（有对应的 final assistant 回复），LLM 已将工具信息蒸馏进最终回复，再次送入只是 token 浪费
- 当前 agent loop 的工具往返由 `runStream` 内部 `pendingMessages` 管理，不经过 `session.messages`，不受影响

**为什么需要 deep 模式**：

deep 模式保留历史 tool_use / tool_result 原始块，适合"用户追问历史工具数据细节"的场景（如"你刚才搜到的第一条链接是什么"）。代价是 token 消耗随工具调用历史线性增长。

### 8.0.1 模式持久化

```
用户在 Composer 切换模式
  └─ chatSetSessionMode(sessionId, mode) IPC
       └─ session-store.setSessionMode()   → 写入 <uuid>.json 的 mode 字段

下次打开该会话
  └─ chatLoadSession → ChatSession.mode
       └─ useChat.selectSession → sessionMode.value = session.mode ?? 'chat'
            └─ Composer 显示对应模式按钮激活态
```

- 新建会话默认 `'chat'`（最小权限原则，token 消耗最少）
- 旧会话（无 `mode` 字段）UI 侧读取时视为 `'chat'`

### 8.1 工具调用与确认

Chat Engine 在 `agent` / `deep` 模式下启用工具调用。每次请求开始时，从 SkillRegistry 动态获取当前启用工具列表，并把启用 Skill 的 instructions 拼接进 system prompt。

### 8.2 Agent 循环

```
while iter < 8:
  1. 获取 tools；最后一轮（iter === 8）继续传 tools，但在 system 中追加
     "工具次数已用尽，请基于已有信息直接给出最终回复" 的提示
  2. 调用 provider.streamMessage(...)
  3. end_turn / max_tokens →
       - 若返回 content 非空 → 持久化最终 assistant 回复
       - 若返回 content 为空（典型场景：工具用尽后模型仍试图调用却被截断）
         → 持久化兜底文案占位（带 fallback=true 标记，UI 淡色 + "占位回复" 角标）
     发送 stream-end
  4. tool_use → 执行工具，把 tool_result 回注为 user 消息，进入下一轮
```

工具中间消息会持久化为普通 `ChatMessage`，并带 `toolRoundtrip: true`。重新生成时会回溯并丢弃相关中间消息，避免只截断最终 assistant 回复导致 tool_use / tool_result 残留。

**最大轮数 8 而非更小**：`web-fetch + web-search` 等场景下，"搜索 → 抓正文 → 总结" 通常 2-3 轮即可结束；预留更多余量给模型自我纠错（如某次抓取失败重试）。

**最后一轮不强制 disable tools**：之前曾尝试过最后一轮不传 tools 强制给文本，结果模型偶尔返回 `content=[]` 造成空气泡（fallback 机制即为此而设）。改为保留 tools + 注入提示后稳定性更好。

### 8.2.1 兜底回复机制

`stop_reason === 'end_turn' / 'max_tokens'` 但 `content` 为空时，引擎会写入一条带 `fallback: true` 标记的 assistant 消息：

> 本次未能生成最终回复。可能模型已用完工具调用次数或被现有信息困住，请点击重新生成或换一种方式提问。

UI 会用淡色边框 + "占位回复" 角标渲染，且持久化保留，避免重新打开会话时 user 消息成为孤儿；`prepareLLMMessages` 仍照常带上历史，作为"上一次未生成回复"的明确信号。

### 8.2.2 中间叙述（narration）可见性

模型在每轮 `tool_use` 之前可能输出一段叙述文本（"我先搜一下"、"让我打开这个网页查看"），用于解释下一步要做什么。

`chat-engine` 在 `tool_use` 分支会发出一次 `stream-reset` 事件。前端 `useChat` 收到时会把当前 `streamingText` 归档到 `narrationsThisRequest: string[]`，再清空 streamingText。`MessageList` 把数组透传给 `ToolCallBubble`，在工具行上方按时间顺序渲染为淡色斜体文本，让用户始终能看到"模型为什么调这个工具"。

作用域：narration 仅在当前请求生命周期内可见，`stream-end / error / aborted` 时一并清空。重新打开会话不重现 narration（持久化由后端 `toolRoundtrip=true` 的 assistant 消息中的 text 块兜底，未来若需历史可见可在 `useChat` 的 messages computed 中按需展开 toolRoundtrip text）。

### 8.3 确认决策

| 决策 | 行为 |
|---|---|
| `approved` | 执行当前工具调用，下次同工具仍需确认 |
| `approved-all` | 当前请求周期内所有 MODERATE 工具免确认 |
| `trusted` | 写入永久信任配置，后续同工具免确认 |
| `rejected` | 回注错误 tool_result：`用户拒绝了此操作` |

用户在确认弹窗等待期间点击停止时，当前确认会被解析为 `rejected`，随后请求整体中止。

### 8.4 后续方向

- 工具循环检测 Hook / Overflow 预判 Hook
- Token 预算裁剪（长会话自动滑窗）
- 二次 LLM 错误恢复（角色化道歉）
- 多模型并排对比 / 模型快速切换
- 多图对比的"钉住参考图"机制

---

## 9. 图片链路健壮化

### 9.1 背景

图片链路不把 base64 长期写入会话 JSON，而是压缩后落盘并在会话中保存 `image_ref`。该设计解决的问题：

| 问题 | 现象 |
|---|---|
| 会话 JSON 体积膨胀 | 单图 4K 原图 ≈ 8MB base64，10 条消息即可让 JSON 上百 MB |
| 读写延迟高 | 切换会话一次性 `JSON.parse` 几十 MB 字符串，UI 卡顿 |
| 长会话 context 爆炸 | 所有历史图一起塞进 LLM，token 消耗不受控 |
| 无防呆 | 用户粘贴超大图直接 OOM |

### 9.2 设计

```
┌────────────── 用户 Composer ──────────────┐
│  选择 / 粘贴 / 拖拽 → base64（前端内存）    │
│  校验：单张 ≤ 10MB、单条 ≤ 6 张             │
└──────────────────┬─────────────────────────┘
                   │ chat:send（含 base64）
                   ▼
┌────────────── 主进程 chat-engine ─────────┐
│  buildUserMessage():                        │
│    for each attachment:                     │
│      sharp 压缩（长边≤1568, EXIF 纠正）    │
│      MD5(压缩 buffer) → <hash>.<ext>       │
│      写 userData/chat-images/ (去重)        │
│      返回 imageRef { cachePath, hash, … }   │
│  ChatMessage.content 用 imageRef 存盘       │
└──────────────────┬─────────────────────────┘
                   │ 持久化到 chat-sessions/
                   │
                   │ 发送到 LLM 前：
                   ▼
┌────────────── prepareLLMMessages ─────────┐
│  最近 K=1 条含图消息的 imageRef → base64   │
│  更早的 imageRef → 文本 "[历史图片: X]"    │
└────────────────────────────────────────────┘

UI 展示：<img src="toolbox-img://<hash>.<ext>">
        自定义协议 handler 读 chat-images/ 文件
```

### 9.3 关键文件

| 文件 | 职责 |
|---|---|
| `src/main/chat/image-cache.ts` | 压缩管线 + MD5 去重 + 落盘 + 孤儿清理 + 文件名校验 |
| `src/main/chat/image-protocol.ts` | 注册 `toolbox-img://` 特权协议 + 白名单校验 |
| `src/main/chat/types.ts` | 定义 `PersistedContentBlock = LLMContentBlock \| LLMImageRefBlock` |
| `src/main/chat/chat-engine.ts` | `buildUserMessage` 调用 `storeImage`；`prepareLLMMessages` 做 K=1 淡出 |
| `plugins/shared/bridge/src/types.ts` | 暴露 `LLMImageRefBlock` 和 `chatResendImageRef` 方法 |
| `src/shell/components/chat/ImageLightbox.vue` | 大图浏览（ESC/←→/另存为） |
| `src/shell/components/chat/MessageBubble.vue` | 1/2/3+ 网格布局 + 点击 Lightbox + 重发按钮 |
| `src/shell/components/chat/Composer.vue` | 附件网格缩略图 + 限制校验 |
| `src/shell/components/chat/ChatView.vue` | 拖拽上传遮罩 + Lightbox 容器 |

### 9.4 imageRef 块定义

```ts
interface LLMImageRefBlock {
  type: 'image_ref';
  cachePath: string;   // 主进程本地绝对路径
  hash: string;        // MD5 — 也是缓存文件名 stem
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  fileName: string;    // 原始文件名（仅展示）
  byteSize: number;    // 落盘字节数
  width?: number;
  height?: number;
}
```

### 9.5 压缩策略

| 源格式 | 阈值 | 输出 |
|---|---|---|
| JPEG | 长边 > 1568 等比缩小 + `withoutEnlargement` | JPEG quality=85, mozjpeg |
| PNG / WEBP | 同上 | PNG compressionLevel=9 |
| GIF | **直通**（避免丢失动画帧） | 原样存盘 |

EXIF 方向通过 `sharp(...).rotate()` 自动纠正，避免手机横屏照片显示反转。

### 9.6 历史淡出：K = 1

`prepareLLMMessages` 从消息尾部倒序扫描，只对**最近 1 条"含图消息"**的 `imageRef` 还原为 `LLMImageBlock`，更早的替换为：

```
[历史图片: screenshot.png]
```

**为什么选 K=1 而不是 K>1**：

多张图同时送给 LLM 时存在**视觉注意力串扰**（cross-image attention leakage）——
模型容易把用户当前的问题错答成历史图片的内容。例如：连续发图 A / B / C 并在 C 下问
"描述这张图"，LLM 可能描述 A 或 B。

K=1 让最新一条 user 消息里只有本次上传的图，LLM 的"这张图"指代明确无歧义。
历史 assistant 文本与占位 `[历史图片: X]` 仍保留，追问"上次那张图是什么来着"
这类纯文本话题不会丢失上下文。

**边界**：一条消息里的多张图作为整体处理（要么全还原、要么全降级）。

**文件丢失**：缓存丢失时占位文本为 `[历史图片: X（缓存已丢失）]`。

**context 超限错误**：LLM 报 `context_length` 时，`stripLastUserImages` 把最后
一条 user 消息的所有 `imageRef` 替换为 `[历史图片: X（因上下文超限已移除）]`，
避免同一张坏图反复触发错误。

**重发兜底**：气泡 hover 显示 `⟳` 按钮 → `chat:resend-image-ref` → 读缓存 → 塞入
Composer 附件列表，用户可搭配新 prompt 重新发送，此时这张图就重新成为"当前图"。

**扩展方向**：如需"多图对比"场景，建议引入"钉住参考图"机制（`imageRef.pinned?: boolean`），
而不是盲目放大 K 值。

### 9.7 toolbox-img:// 自定义协议

- `app.whenReady()` **之前** 调用 `registerImageProtocolSchemes()` 将协议声明为 privileged（secure/standard/corsEnabled）
- `app.whenReady()` **之后** 调用 `registerImageProtocolHandler()`
- URL 格式：`toolbox-img://<md5>.<ext>`
- 文件名必须匹配 `/^[a-f0-9]{32}\.(png|jpe?g|gif|webp)$/`，且解析后绝对路径必须以 `userData/chat-images/` 为前缀

UI 层 `<img :src="toolbox-img://${hash}.${ext}">` 零 base64 内存占用，切换会话即时。

### 9.8 上限与错误恢复

| 场景 | 处理 |
|---|---|
| 单张 > 10MB | Composer 弹警告条，拒绝入列 |
| 单条 > 6 张 | 同上；拖拽/粘贴/选择均生效 |
| LLM 返回 `context_length / 413` | `stripLastUserImages` 剥离最后一条 user 的 imageRef，UI 显示"已清除图片引用"提示 |
| 缓存文件丢失 | `loadImageBase64` 返回 null → 降级为 `[图片: X（文件已丢失）]` |
| 启动时存在孤儿 | `cleanOrphanImages` 扫描所有会话 JSON，删除未引用的文件 |

### 9.9 UI 交互

| 功能 | 操作 |
|---|---|
| 拖拽上传 | 整个 ChatView 响应 drag；drop 时遮罩消失，图片注入 Composer |
| Lightbox | 点击消息气泡任一图 → 全屏；ESC 关闭，←/→ 切换，`💾 另存为` |
| 重发此图 | 气泡 hover 显示 `⟳` 按钮 |
| 附件网格 | Composer 附件区 72×56 网格，hover 显示 `✕` 移除 |
| 消息网格 | 1 张 → 240×180；2 张 → 180×135×2；3+ 张 → 120×90 grid(3)，超过 9 张末格显示 `+N` |

### 9.10 已明确不做

- 按不同 Provider 差异化压缩阈值（统一 1568）
- 原图备份（`<hash>.orig.*`）
- 视觉模型独立切换
- 截图工具输入
- 图片编辑 / 旋转 / 裁剪

---

## 10. 多选合并导出

### 10.1 需求

当会话非生成态时，用户可对多条已落库的消息批量选中，并：

1. 合并复制为 Markdown（文本 + HTML 双份剪贴板）
2. 合并导出为 Markdown 文件（含图片副本子目录）

同时每条已落库消息单独具备：hover 展示复制按钮、一键复制单条气泡内容。

### 10.2 入口与交互

| 触发 | 行为 |
|---|---|
| hover 消息气泡 | 气泡下方浮出 `BubbleToolbar`（复制 · 多选 两个图标） |
| 点击 **复制** icon | 该条消息写入剪贴板（text/plain + text/html），icon 切换 ✓ 1s 后复原；**不**进入选择模式 |
| 点击 **多选** icon（checklist）| 进入选择模式，预选中触发条；底部 `SelectionToolbar` 替换 `Composer` 位置 |
| 选择模式下点击气泡整行 | 切换该条选中状态；图片点击不开 Lightbox、改为切换选中 |
| `⌘/Ctrl + A` | 全选（仅选择模式下） |
| `Esc` | 退出选择模式 |
| SelectionToolbar "取消" | 同上 |

**hover 工具栏**不是独立 bubble，而是作为消息行下方的一段"隐形占位"融入背景：

- 无背景 / 无边框 / 无阴影，纯线条图标；单个 icon hover 时仅通过颜色由 `--text-dim` 变为 `--text-primary` 反馈，**不加**圆形/方形底
- 工具栏行始终占位 24px 高度（+ 4px 上边距），默认 `opacity: 0 + pointer-events: none`，不会引起布局抖动
- hover 触发：**`.bubble-row:hover`** 时显现；hover 区域横跨 `MessageList` 内容区（920px max-width）左右两端，即气泡行 + 工具栏占位行的完整整行横条
- user 气泡的工具栏右对齐贴气泡右下；assistant 气泡的工具栏左对齐贴气泡左下

**流式气泡、错误条、乐观 pending 消息**均不渲染工具栏（也不占位）。

### 10.3 状态模型

状态位于 `composables/useChat.ts` 全局单例：

```ts
selectionMode: Ref<boolean>;
selectedIds:   Ref<Set<string>>;    // 消息 id 集合（克隆替换触发响应式）
selectedCount: ComputedRef<number>;
enterSelection(preselectId?): void;
exitSelection(): void;
toggleSelect(id): void;
selectAll(): void;
isSelected(id): boolean;
```

自动退出场景（watch）：
- `activeSession.id` 变化（切换/删除会话）
- `currentRequestId` 从 null 变为非空（开始流式生成）

### 10.4 剪贴板格式

**单条复制**与**选中合并复制**共享同一套格式策略：

- `text/plain`：原始 Markdown
  - assistant 文本原样（保留代码围栏）
  - user 文本按段分隔，段内换行用行尾两空格保留
  - 图片降级为占位 `![fileName](toolbox-img://hash.ext)`
- `text/html`：粘贴到富文本编辑器的兜底
  - assistant 文本包在 `<pre>` 中粗略转义
  - user 文本按段拆为 `<p>…</p>`
  - 图片以斜体占位文本出现

### 10.5 Markdown 文件导出

提供 IPC：`chat:export-selected`

```ts
chatExportSelected(input: {
  sessionId: string;
  messageIds: string[];   // 主进程按会话时间序重排，忽略点选顺序
  targetPath: string;     // 用户 showSaveDialog 选定的 .md 路径
  includeMetadata?: boolean; // 默认 true
}): Promise<{
  filePath: string; dirPath: string;
  messageCount: number; imageCount: number; skippedImageCount: number;
}>;
```

主进程 `src/main/chat/exporter.ts` 流程：

```
showSaveDialog → targetPath = "<dir>/<stem>.md"
                 │
                 ▼
主进程新建 <dir>/<stem>/ 子目录：
  ├── <stem>.md          主文件
  └── images/            图片副本
      └── <hash>.<ext>   从 chat-images/<hash>.<ext> 复制
```

**为什么建子目录而不是直接 .md + 同级 images/**：多次导出到同一目录不会互相污染 `images/` 目录。

**图片复制**：
- 以 hash 为文件名，目标存在则复用（天然幂等）
- `cachePath` 读取失败（文件丢失）则记为 `skippedImageCount`，Markdown 内降级为 `> 图片缺失：<fileName>`

**Markdown 结构**：

```markdown
# <会话标题>

> 导出时间：YYYY-MM-DD HH:mm
> 模型：<provider · model>
> 共 N 条消息（🧑 u / 🤖 a）

---

### 🧑 你 · YYYY-MM-DD HH:mm

![photo.png](./images/ab12cd...ef.png)

用户文本（段内硬换行用两空格保留）。

---

### 🤖 助手 · YYYY-MM-DD HH:mm

助手的 Markdown 内容原样嵌入，保留代码围栏：

```ts
const x = 1;
```

---
```

文件名净化：非法字符（`\ / : * ? " < > |` + 控制字符）替换为 `_`，截断 ≤ 80 字符。

### 10.6 边界与错误恢复

| 场景 | 处理 |
|---|---|
| 切会话 / 删会话 | 自动退出选择模式（watch 监听 id 变化） |
| 开始新的流式生成 | 自动退出（watch `currentRequestId`） |
| 选中 pending 乐观消息 | 整行点击/图片点击 均忽略（id 以 `pending-` 开头） |
| 选中 0 条 | 复制 / 导出按钮禁用 |
| 缓存图片丢失 | Markdown 占位 `> 图片缺失：<name>`，导出流程不阻塞，统计入 `skippedImageCount` |
| 导出成功 | toast 显示消息/图片数，附"打开文件夹"按钮 → `openInExplorer` |
| 导出失败 | toast 显示红色错误条 |

### 10.7 组件改动清单

| 文件 | 职责 |
|---|---|
| 【新】`src/main/chat/exporter.ts` | Markdown 序列化 + 图片复制 + 子目录创建 |
| `src/main/chat/chat-ipc.ts` | 注册 `chat:export-selected` |
| `src/main/preload.ts` | 暴露 `chatExportSelected` |
| `plugins/shared/bridge/src/types.ts` / `index.ts` | 提供 `ChatExportInput` / `ChatExportResult` + API 签名 |
| `src/shell/composables/useChat.ts` | 选择状态 + actions + 自动退出 watch |
| 【新】`src/shell/components/chat/BubbleToolbar.vue` | hover 工具栏（复制 + 多选） |
| 【新】`src/shell/components/chat/SelectionToolbar.vue` | 底部工具栏（全选/复制/导出/取消） |
| `src/shell/components/chat/MessageBubble.vue` | hover-zone + 选择态样式 + 整行点击切换 |
| `src/shell/components/chat/MessageList.vue` | 透传 selection props；选择态下隐藏流式气泡与错误条 |
| `src/shell/components/chat/ChatView.vue` | 挂载 SelectionToolbar、`v-show` 保活 Composer、键盘监听、toast、导出流程 |

### 10.8 待 P1 追加

- `Shift + 点击` 区间选择 / 反选按钮
- 导出为 JSON（备份语义）
- 元信息开关（时间/模型头是否写入）
- 更丰富的复制视觉反馈（除 icon 切换外加入 toast）

---

## 11. 重新生成 assistant 消息

### 11.1 功能

assistant 气泡 hover 工具栏提供"⟲ 重新生成"按钮。点击后：

1. 截断该条 assistant 消息（含）及会话末尾所有后续消息（严格丢弃）
2. 基于截断后的上下文重新调用 LLM 流式生成
3. 新 assistant 回复追加到会话末尾

### 11.2 按钮矩阵

| 按钮     | user 气泡 | assistant 气泡 |
|----------|-----------|----------------|
| 📋 复制  | ✓         | ✓              |
| ⟲ 重新生成 | ✗       | ✓              |
| ☑︎ 多选  | ✓         | ✓              |

### 11.3 确认策略

- 目标 assistant 是最后一条消息 → 直接执行，无 confirm
- 目标之后还有消息 → `confirm("将丢弃后续 N 条消息并重新生成此回答，无法撤销。继续？")`
- 不做撤销重新生成

### 11.4 禁用条件

| 条件 | 行为 |
|---|---|
| `isStreaming === true` | 按钮 disabled（tooltip "生成中，稍后再试"） |
| 目标 assistant 是会话首条消息（idx === 0） | 主进程抛错，前端不做特殊校验（极端情况） |
| 选择模式下 | 整个工具栏透明不可交互 |

### 11.5 IPC

```ts
chatRegenerate(input: {
  sessionId: string;
  assistantMessageId: string;
}): Promise<{
  requestId: string;
  discardedCount: number;
}>;
```

主进程 `chat-engine.ts` 提供 `regenerateMessage()` 入口：
1. 抢占同 session 旧请求
2. `session.messages = session.messages.slice(0, idx)` 截断 + `saveSession`
3. 复用 `runStream()` 启动流式生成
4. 事件流复用 `chat:event`（与 `sendMessage` 完全一致）

### 11.6 渲染进程流程

`useChat.regenerateMessage(assistantMessageId)`:
1. 前置：`!isStreaming` + `activeSession` 存在
2. 查找 idx；若 `tailCount > 0` 且用户取消 confirm → 返回
3. 乐观截断前端消息数组（UX 即时）
4. 调用 `chatRegenerate` IPC → 拿到 `requestId`
5. `currentRequestId = requestId` → 后续由 `handleChatEvent` 处理 stream-chunk / stream-end

### 11.7 边界场景

| 场景 | 处理 |
|---|---|
| 正在重新生成时用户发新消息（Composer） | 走现有"抢占同 session 旧请求"逻辑 |
| 重新生成返回 error / aborted | 复用现有事件流处理；截断不回滚（用户语义是"重来"） |
| 丢弃的消息含图片 image_ref | 不主动清理，依赖启动时 `cleanOrphanImages()` |
| 模型已切换 | 使用当前配置的 provider/model（功能特性，非 bug） |

### 11.8 改动清单

| 文件 | 改动 |
|---|---|
| `src/main/chat/chat-engine.ts` | 提供 `regenerateMessage()` |
| `src/main/chat/chat-ipc.ts` | 注册 `chat:regenerate` |
| `src/main/preload.ts` | 暴露 `chatRegenerate` |
| `plugins/shared/bridge/src/types.ts` / `index.ts` | `ChatRegenerateInput` / `ChatRegenerateResult` + API 签名 |
| `src/shell/composables/useChat.ts` | `regenerateMessage()` + confirm |
| `src/shell/components/chat/BubbleToolbar.vue` | assistant 多一个 ⟲ 按钮；inject `useChat` 的 `isStreaming` 控制禁用 |
| `src/shell/components/chat/MessageBubble.vue` | 透传 `regenerate` 事件 |
| `src/shell/components/chat/MessageList.vue` | 透传 `regenerate` 事件 |
| `src/shell/components/chat/ChatView.vue` | 监听 `@regenerate` → `useChat.regenerateMessage` |

---

## 12. 编辑并重发 user 消息

### 12.1 功能

user 气泡 hover 工具栏提供"✎ 编辑"按钮。点击后：

1. 气泡就地变成 inline textarea（原地编辑），初始值为原消息纯文本
2. 原消息中的图片以只读缩略图展示在 textarea 上方（提示"原图将一并重发"）
3. 用户修改文本后点"发送"或 Enter → 截断该 user 消息（含）及之后所有消息，
   用修改后文本 + 原 imageRef 构造新 user 消息，启动 LLM 流式生成
4. Esc 或点"取消"退出编辑态

### 12.2 按钮矩阵

| 按钮     | user 气泡 | assistant 气泡 |
|----------|-----------|----------------|
| 📋 复制  | ✓         | ✓              |
| ✎ 编辑  | ✓         | ✗              |
| ⟲ 重新生成 | ✗       | ✓              |
| ☑︎ 多选  | ✓         | ✓              |

### 12.3 编辑态规则

| 规则 | 描述 |
|---|---|
| 同一时间只允许一条编辑 | 切换编辑另一条 → 前一条自动退出（无 confirm） |
| 图片保留 | 原消息 `image_ref` 块原样传给主进程，不走压缩管线 |
| 丢弃后续 | 无二次确认，直接丢弃 |
| 流式中禁用 | 编辑按钮 disabled（`isStreaming`） |
| 选择模式互斥 | 进入编辑 → 先退出选择模式；选择模式下工具栏不可交互 |
| 自动退出 | 切换会话 / 开始流式生成 → 自动退出编辑态 |

### 12.4 IPC

```ts
chatEditAndResend(input: {
  sessionId: string;
  targetMessageId: string;
  newText: string;
  imageRefs?: LLMImageRefBlock[];   // 原图引用，直接复用缓存
}): Promise<{
  requestId: string;
  userMessageId: string;
  discardedCount: number;
}>;
```

主进程 `chat-engine.ts` 提供 `editAndResend()` 入口：
1. 截断 `session.messages.slice(0, idx)` + saveSession
2. 拼 `text` + `imageRef` 为新 `PersistedContentBlock[]`（不走 `storeImage` 压缩，imageRef 已落盘）
3. `appendMessages(sessionId, [newUserMsg])`
4. 复用 `runStream()` 启动流式生成

### 12.5 编辑态 UI

编辑态下 `.bubble` 被 `.bubble-edit` 替换：
- 上方：只读图片缩略图网格（56×42，不可删不可加）+ 提示文字"原图将一并重发"
- 中间：`textarea`（自动 resize，最大 300px，`Enter` 发送 / `Shift+Enter` 换行 / `Esc` 取消）
- 下方：取消（ghost） + 发送（accent）按钮，右对齐
- 工具栏行在编辑态下不渲染（`v-if="!isEditing"`）

### 12.6 改动清单

| 文件 | 改动 |
|---|---|
| `src/main/chat/chat-engine.ts` | 提供 `editAndResend()` |
| `src/main/chat/chat-ipc.ts` | 注册 `chat:edit-and-resend` |
| `src/main/preload.ts` | 暴露 `chatEditAndResend` |
| `plugins/shared/bridge/src/types.ts` / `index.ts` | `ChatEditAndResendInput` / `ChatEditAndResendResult` + API 签名 |
| `src/shell/composables/useChat.ts` | `editingMessageId` / `enterEditing` / `exitEditing` / `submitEdit` + 自动退出 watch |
| `src/shell/components/chat/BubbleToolbar.vue` | user 气泡提供 ✎ 编辑按钮 |
| `src/shell/components/chat/MessageBubble.vue` | 编辑态 inline textarea + 只读缩略图 + 取消/发送 |
| `src/shell/components/chat/MessageList.vue` | 透传 `editingMessageId` prop + 编辑相关事件 |
| `src/shell/components/chat/ChatView.vue` | 监听编辑事件 → `useChat` 方法 |

