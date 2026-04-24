---
name: system-info
description: 查询系统信息（时间、日期、操作系统、内存等）。当用户询问时间、日期、系统信息时使用此技能。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "💻"
    tools:
      - name: system_info
        displayName: "系统信息"
        description: |
          获取当前系统信息，包括时间、日期、操作系统、内存使用情况。

          query 参数支持：
          - time: 当前时间
          - date: 当前日期和星期
          - os: 操作系统、架构、主机名
          - memory: 总内存、可用内存、应用内存
          - all: 以上所有信息的完整合集（推荐：一次调用获取全部）

          重要：当需要多项信息时，直接使用 query="all" 一次获取全部，
          不要逐项调用 time、date、os、memory（浪费工具调用）。
        inputSchema:
          type: object
          properties:
            query:
              type: string
              description: "要查询的信息类型: time | date | os | memory | all"
          required: [query]
        riskLevel: SAFE
        scriptEntry: scripts/system-info.cjs
---

# System Info Skill

查询当前系统的各项信息，包括时间、日期、操作系统和内存使用情况。

## 使用场景

- 用户询问当前时间或日期
- 用户想了解操作系统信息
- 用户想查看内存使用状况

## 工具参数

`query` 参数支持以下值：
- `time` — 当前时间
- `date` — 当前日期和星期
- `os` — 操作系统、架构、主机名
- `memory` — 总内存、可用内存、应用内存
- `all` — **以上所有信息的完整合集**（推荐：一次调用获取全部，避免多次分项查询）

**重要**：当需要多项信息时，请直接使用 `query: "all"` 一次获取全部，不要逐项调用。
