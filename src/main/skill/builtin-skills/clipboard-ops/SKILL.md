---
name: clipboard-ops
description: >
  读取和写入系统剪贴板内容。当用户说"帮我看看我复制的内容"、"翻译我复制的"、"格式化我复制的JSON"时，
  先用 read_clipboard 获取剪贴板中的文本，再做后续处理。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "📋"
    tools:
      - name: read_clipboard
        displayName: "读取剪贴板"
        description: |
          读取系统剪贴板中的内容。返回剪贴板中的文本、HTML 或图片信息。

          使用场景：
          - 用户说"帮我看看我复制的内容"
          - 用户说"翻译我复制的文字"
          - 用户说"格式化我复制的JSON"
          - 用户说"分析我复制的代码"
          - 任何涉及"我复制了""我刚拷贝的""剪贴板里的"的请求

          返回内容：
          - type: text/html/image/empty
          - text: 剪贴板中的纯文本（如有）
          - html: 剪贴板中的 HTML 内容预览（如有，截取前 2000 字符）
          - image: 图片元信息（宽高、大小），不含图片数据本身
        inputSchema:
          type: object
          properties: {}
          required: []
        riskLevel: SAFE
        scriptEntry: scripts/clipboard-ops.cjs

      - name: write_clipboard
        displayName: "写入剪贴板"
        description: |
          将文本写入系统剪贴板。用于将处理结果（如翻译、格式化后的文本）放入剪贴板供用户粘贴使用。

          使用场景：
          - 格式化 JSON 后写回剪贴板
          - 翻译完成后将结果放入剪贴板
          - 用户说"帮我复制这个"

          注意：只在用户明确要求"复制到剪贴板""放到剪贴板"时才写入，
          不要未经请求就覆盖用户的剪贴板内容。
        inputSchema:
          type: object
          properties:
            text:
              type: string
              description: 要写入剪贴板的文本内容
          required: [text]
        riskLevel: SAFE
        scriptEntry: scripts/clipboard-ops.cjs
---

# Clipboard Ops Skill

读取和写入系统剪贴板，让 AI 能够直接处理用户复制的内容。

## 使用原则

- 用户提到"我复制的""剪贴板""拷贝的"等关键词时，**主动调用 `read_clipboard`**
- `write_clipboard` 仅在用户明确要求时使用，避免意外覆盖剪贴板
- 如果剪贴板为空，告诉用户"剪贴板里没有内容"

## 典型工作流

### 用户说"翻译我复制的内容"
1. `read_clipboard` → 获取文本
2. 直接翻译并回复（如用户要求"翻译后放回剪贴板"再用 `write_clipboard`）

### 用户说"格式化我复制的JSON"
1. `read_clipboard` → 获取文本
2. 用 text-transform 的 `text_transform` action=format_json 格式化
3. 如用户要求，用 `write_clipboard` 写回剪贴板
