---
name: web-search
description: >
  搜索互联网获取实时信息。当你对事实不确定、需要最新信息时，应主动搜索，无需事先征求用户同意。
  使用 DuckDuckGo 搜索引擎，无需 API Key。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🔍"
    tools:
      - name: web_search
        displayName: "网页搜索"
        description: |
          搜索互联网并返回结果摘要。使用 DuckDuckGo 搜索引擎。

          核心原则：当你对某个事实不确定或不知道时，应立即调用此工具搜索，不要先问用户"是否需要搜索"。直接搜索、直接给出答案。

          使用场景：
          - 用户问你不确定或不知道的事实问题 → 直接搜索
          - 用户想了解最新新闻、事件 → 直接搜索
          - 用户问"帮我搜一下XXX" → 直接搜索
          - 需要实时信息（如最新版本号、发布日期等）→ 直接搜索

          不要搜索的情况：
          - 你已经非常确信答案
          - 纯粹的闲聊或情感交流

          注意：返回的是搜索结果摘要（标题+摘要+URL），不是完整网页内容。
        inputSchema:
          type: object
          properties:
            query:
              type: string
              description: 搜索关键词
            maxResults:
              type: number
              description: 最大返回结果数，默认 5
          required: [query]
        riskLevel: SAFE
        scriptEntry: scripts/web-search.cjs
---

# Web Search Skill

让 AI 助手能够搜索互联网获取实时信息。使用 DuckDuckGo 搜索，无需 API Key。

## 使用场景

- 用户问事实性问题且你不确定答案 → 先搜索再回答
- 用户明确要求搜索 → 直接搜索
- 需要实时/最新信息 → 搜索获取

## 使用原则

- **不确定就搜索，不要先问用户** — 这是最重要的原则。直接搜索然后给出答案
- 不要对你已经确信的知识做搜索（浪费工具调用）
- 搜索结果是摘要，引用时注明来源 URL
- 如果搜索失败（网络问题），坦诚告知用户
- 搜索关键词尽量精炼，不要用完整句子
