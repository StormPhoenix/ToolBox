# LLM 框架架构文档

## 1. 概述

ToolBox LLM 支持在主进程实现，通过 IPC 暴露给 Shell 和所有插件。插件无需感知底层 Provider 细节，由用户在 Settings 中统一配置。

支持 Provider：Claude（Anthropic）、OpenAI（及兼容格式第三方服务）、Gemini（Google）。

配置存储在 `app.getPath('userData')/llm-config.json`。

---

## 2. 目录结构

```
src/main/llm/
├── types.ts              # 统一类型（Provider 接口、配置类型、IPC 入出参）
├── router.ts             # LLMRouter — Provider 生命周期管理
├── llm-ipc.ts            # IPC handler 注册（registerLLMHandlers）
└── providers/
    ├── claude.ts         # ClaudeProvider（@anthropic-ai/sdk）
    ├── openai.ts         # OpenAIProvider（openai SDK）
    └── gemini.ts         # GeminiProvider（@google/genai）
```

---

## 3. IPC API

| 方法（electronAPI.*） | IPC 通道 | 说明 |
|---|---|---|
| `llmChat(messages, options?)` | `llm:chat` | 单次非流式调用，返回 `{ text, usage? }` |
| `getLLMConfig()` | `llm:get-config` | 获取当前配置（脱敏，apiKey 掩码） |
| `setLLMConfig(config)` | `llm:set-config` | 更新配置（可部分更新） |
| `testLLMConnection()` | `llm:test-connection` | 测试连通性，返回 `{ ok, error? }` |

---

## 4. 插件调用示例

```typescript
import { electronAPI } from '@toolbox/bridge';

// 纯文本调用
const result = await electronAPI.llmChat(
  [{ role: 'user', content: '帮我分析这个文件名：report_2024_final_v2.xlsx' }],
  { system: '你是一个文件重命名助手，请提供简洁的重命名建议。' }
);
console.log(result.text);

// 带图片（先读文件为 base64）
const b64 = await electronAPI.readFile('/path/to/image.png', 'base64');
const visionResult = await electronAPI.llmChat([{
  role: 'user',
  content: [
    { type: 'text', text: '描述这张图片的内容' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }
  ]
}]);
```

---

## 5. 配置结构

```typescript
// userData/llm-config.json
{
  "provider": "openai",          // 当前激活的 provider
  "openai": {
    "apiKey": "sk-...",
    "baseURL": "https://api.example.com/v1",  // 可选，用于第三方兼容服务
    "model": "gpt-4o"
  },
  "claude": { "apiKey": "...", "model": "claude-sonnet-4-5" },
  "gemini": { "apiKey": "...", "model": "gemini-2.0-flash" },
  "maxTokens": 4096
}
```

`getLLMConfig()` 返回脱敏版本：`apiKey` 替换为 `****xxxx`（末4位可见），并为每个 provider 附带 `hasApiKey: boolean` 标记是否已持久化 key。前端 Settings 页据此判断"即使输入框留空也可点击测试连接"，实现免重输体验。

`setLLMConfig()` 只更新传入的字段；`apiKey` 传空字符串或不传均保留原值。

---

## 6. 架构分层

```
插件 / Shell
    ↓ electronAPI.llmChat(...)
preload.ts（ipcRenderer.invoke）
    ↓ IPC
llm-ipc.ts（ipcMain.handle）
    ↓
LLMRouter（getProvider()）
    ↓
ClaudeProvider / OpenAIProvider / GeminiProvider
    ↓
各 SDK（@anthropic-ai/sdk / openai / @google/genai）
```

内部消息格式以 Anthropic 格式为标准，OpenAI 和 Gemini Provider 各自负责转换。

---

## 7. 新增 Provider

1. 在 `src/main/llm/providers/` 下新建文件，实现 `LLMProvider` 接口（`createMessage` + `capabilities`）
2. 在 `src/main/llm/types.ts` 的 `ProviderType` 联合类型中添加新值
3. 在 `src/main/llm/router.ts` 的 `createProvider` switch 中添加对应 case
4. 在 `LLMConfig` 中添加对应配置字段
5. 更新 `bridge/src/types.ts` 的 `LLMProviderType` 和 `LLMConfigInput`
