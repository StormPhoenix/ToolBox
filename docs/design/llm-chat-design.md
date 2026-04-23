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

---

## 9. V1.1 — 图片链路健壮化（已落地）

### 9.1 背景

V1 把图片 base64 直接塞进会话 JSON，随消息一起送入 LLM。问题：

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
| `src/main/chat/types.ts` | 新增 `PersistedContentBlock = LLMContentBlock \| LLMImageRefBlock` |
| `src/main/chat/chat-engine.ts` | `buildUserMessage` 调用 `storeImage`；`prepareLLMMessages` 做 K=1 淡出 |
| `plugins/shared/bridge/src/types.ts` | 新增 `LLMImageRefBlock` 和 `chatResendImageRef` 方法 |
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

**未来可选**：如需"多图对比"场景，建议引入"钉住参考图"机制（`imageRef.pinned?: boolean`），
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

### 9.9 UI 新增交互

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

