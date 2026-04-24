---
name: text-transform
description: >
  文本处理工具箱：JSON 格式化、Base64 编解码、URL 编解码、哈希计算、字数统计、正则提取、UUID 生成、大小写转换。
  全部 SAFE 级别操作，无需用户确认。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🔤"
    tools:
      - name: text_transform
        displayName: "文本处理"
        description: |
          文本处理瑞士军刀，支持多种常用文本操作：

          action 可选值：
          - format_json: 格式化或压缩 JSON。参数: input, indent(默认2), compress(bool,压缩模式)
          - base64_encode: Base64 编码。参数: input
          - base64_decode: Base64 解码。参数: input
          - url_encode: URL 编码。参数: input
          - url_decode: URL 解码。参数: input
          - hash: 计算哈希值。参数: input, algorithm(md5/sha256/sha512，默认md5)
          - word_count: 统计字数/词数/行数/字符数。参数: input
          - regex_extract: 正则提取匹配内容。参数: input, pattern, flags(默认"g")
          - uuid: 生成 UUID v4。无需 input 参数
          - case_convert: 大小写/命名风格转换。参数: input, to(upper/lower/capitalize/camel/snake/kebab)

          SAFE 级别工具，无需确认弹窗。
        inputSchema:
          type: object
          properties:
            action:
              type: string
              description: "操作类型: format_json | base64_encode | base64_decode | url_encode | url_decode | hash | word_count | regex_extract | uuid | case_convert"
            input:
              type: string
              description: 要处理的文本内容
            indent:
              type: number
              description: "JSON 缩进空格数（format_json 时使用），默认 2"
            compress:
              type: boolean
              description: "是否压缩 JSON（format_json 时使用），默认 false"
            algorithm:
              type: string
              description: "哈希算法（hash 时使用）: md5 | sha256 | sha512，默认 md5"
            pattern:
              type: string
              description: "正则表达式（regex_extract 时使用）"
            flags:
              type: string
              description: "正则标志（regex_extract 时使用），默认 g"
            to:
              type: string
              description: "目标格式（case_convert 时使用）: upper | lower | capitalize | camel | snake | kebab"
          required: [action]
        riskLevel: SAFE
        scriptEntry: scripts/text-transform.cjs
---

# Text Transform Skill

文本处理工具箱，覆盖开发者和日常用户的常见文本操作需求。全部 SAFE 级别。

## 使用原则

当用户需要以下文本操作时，**优先使用此技能**：
- 格式化/压缩 JSON
- Base64 编解码
- URL 编解码
- 计算文本哈希
- 统计字数
- 正则提取
- 生成 UUID
- 大小写转换

## 与 clipboard-ops 配合

常见工作流：
1. `read_clipboard` 读取用户复制的文本
2. `text_transform` 处理（如 format_json、base64_decode）
3. 如需写回，`write_clipboard` 写入剪贴板
