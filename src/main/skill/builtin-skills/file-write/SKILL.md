---
name: file-write
description: >
  安全的文件操作：创建文件、写入文本、复制、移动/重命名、创建目录、删除到回收站，以及批量操作。
  所有操作限制在用户目录范围内，禁止操作系统目录。文件大小限制 1MB。删除操作移入回收站而非永久删除。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "✏️"
    tools:
      - name: create_text_file
        displayName: "创建文件"
        description: |
          创建一个新的文本文件。如果文件已存在，默认不覆盖（返回错误）。

          使用场景：
          - 用户说"帮我创建一个文件"
          - 用户说"帮我写一个 xxx.txt"
          - 需要保存生成的内容到文件

          安全限制：
          - 文件路径必须在用户目录下（home 及其子目录）
          - 内容大小不超过 1MB
          - 默认不覆盖已存在的文件（除非 overwrite=true）

          ⚠️ 禁止自己猜测用户名拼接路径！请先用 file-ops 的 get_path 获取真实用户目录。
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 文件的完整绝对路径
            content:
              type: string
              description: 要写入的文本内容
            encoding:
              type: string
              description: 文件编码，默认 utf-8
            overwrite:
              type: boolean
              description: 文件已存在时是否覆盖，默认 false
          required: [path, content]
        riskLevel: MODERATE
        confirmHint: "创建文件: {path}"
        scriptEntry: scripts/file-write.cjs

      - name: write_text_file
        displayName: "写入文件"
        description: |
          向已有文件写入或追加文本内容。支持 overwrite（覆盖）和 append（追加）两种模式。

          使用场景：
          - 用户说"把这段内容追加到文件末尾"
          - 用户说"更新这个文件的内容"
          - 需要向已有文件写入内容

          安全限制：
          - 文件路径必须在用户目录下
          - 内容大小不超过 1MB
          - mode=overwrite 时会完全替换文件内容
          - mode=append 时追加到文件末尾

          ⚠️ 禁止自己猜测用户名拼接路径！
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 文件的完整绝对路径
            content:
              type: string
              description: 要写入的文本内容
            mode:
              type: string
              description: "写入模式: overwrite（覆盖，默认）| append（追加到末尾）"
            encoding:
              type: string
              description: 文件编码，默认 utf-8
          required: [path, content]
        riskLevel: MODERATE
        confirmHint: "写入文件: {path}"
        scriptEntry: scripts/file-write.cjs

      - name: copy_file
        displayName: "复制文件"
        description: |
          复制文件或目录到新位置。支持单个文件复制和目录递归复制。

          使用场景：
          - 用户说"帮我把这个文件复制一份"
          - 用户说"备份一下这个文件"
          - 需要复制文件到另一个位置

          安全限制：
          - 源路径和目标路径都必须在用户目录下
          - 目标文件已存在时默认不覆盖（除非 overwrite=true）

          ⚠️ 禁止自己猜测用户名拼接路径！
        inputSchema:
          type: object
          properties:
            source:
              type: string
              description: 源文件或目录的完整绝对路径
            destination:
              type: string
              description: 目标文件或目录的完整绝对路径
            overwrite:
              type: boolean
              description: 目标已存在时是否覆盖，默认 false
          required: [source, destination]
        riskLevel: MODERATE
        confirmHint: "复制: {source} → {destination}"
        scriptEntry: scripts/file-write.cjs

      - name: move_file
        displayName: "移动文件"
        description: |
          移动或重命名文件/目录。

          使用场景：
          - 用户说"帮我把这个文件移到那个文件夹"
          - 用户说"帮我重命名这个文件"
          - 需要移动或重命名文件

          安全限制：
          - 源路径和目标路径都必须在用户目录下
          - 目标文件已存在时默认不覆盖（除非 overwrite=true）

          ⚠️ 禁止自己猜测用户名拼接路径！
        inputSchema:
          type: object
          properties:
            source:
              type: string
              description: 源文件或目录的完整绝对路径
            destination:
              type: string
              description: 目标文件或目录的完整绝对路径
            overwrite:
              type: boolean
              description: 目标已存在时是否覆盖，默认 false
          required: [source, destination]
        riskLevel: MODERATE
        confirmHint: "移动: {source} → {destination}"
        scriptEntry: scripts/file-write.cjs

      - name: create_directory
        displayName: "创建目录"
        description: |
          创建目录（支持递归创建多层目录）。

          使用场景：
          - 用户说"帮我创建一个文件夹"
          - 需要在写入文件前确保目录存在

          安全限制：
          - 路径必须在用户目录下

          ⚠️ 禁止自己猜测用户名拼接路径！
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 要创建的目录的完整绝对路径
          required: [path]
        riskLevel: MODERATE
        confirmHint: "创建目录: {path}"
        scriptEntry: scripts/file-write.cjs

      - name: delete_file
        displayName: "删除文件"
        description: |
          将文件或目录移入系统回收站（不是永久删除，可以从回收站恢复）。

          使用场景：
          - 用户说"帮我删除这个文件"
          - 用户说"清理一下这些临时文件"
          - 需要删除不再需要的文件

          安全限制：
          - 路径必须在用户目录下
          - 文件会移入回收站，不会永久删除
          - 用户可以从回收站恢复误删文件

          ⚠️ 禁止自己猜测用户名拼接路径！
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 要删除的文件或目录的完整绝对路径
          required: [path]
        riskLevel: MODERATE
        confirmHint: "删除到回收站: {path}"
        scriptEntry: scripts/file-write.cjs

      - name: batch_file_ops
        displayName: "批量文件操作"
        description: |
          在一次调用中执行多个文件操作。减少工具调用轮次，适合需要连续执行多个文件操作的场景。

          使用场景：
          - 需要同时创建多个文件
          - 需要批量复制或移动文件
          - 需要创建目录结构后再创建文件
          - 文件整理：创建分类目录 + 移动文件到对应目录

          每个操作独立执行，单个失败不影响其他操作。

          ⚠️ 禁止自己猜测用户名拼接路径！

          调用示例（整理文件到分类目录）：
          {
            "actions": [
              { "tool": "create_directory", "path": "<desktop>/文档" },
              { "tool": "create_directory", "path": "<desktop>/图片" },
              { "tool": "move_file", "source": "<desktop>/report.docx", "destination": "<desktop>/文档/report.docx" },
              { "tool": "move_file", "source": "<desktop>/photo.jpg", "destination": "<desktop>/图片/photo.jpg" }
            ]
          }
        inputSchema:
          type: object
          properties:
            actions:
              type: array
              description: "批量操作列表，按顺序执行"
              items:
                type: object
                properties:
                  tool:
                    type: string
                    description: "操作类型: create_text_file | write_text_file | copy_file | move_file | create_directory | delete_file"
                  path:
                    type: string
                    description: 文件/目录路径
                  content:
                    type: string
                    description: 文件内容（create_text_file / write_text_file 用）
                  source:
                    type: string
                    description: 源路径（copy_file / move_file 用）
                  destination:
                    type: string
                    description: 目标路径（copy_file / move_file 用）
                  overwrite:
                    type: boolean
                    description: 是否覆盖已有文件
                  mode:
                    type: string
                    description: 写入模式（write_text_file 用）
                  encoding:
                    type: string
                    description: 文件编码
          required: [actions]
        riskLevel: MODERATE
        confirmHint: "批量文件操作（{actions}）"
        scriptEntry: scripts/file-write.cjs
---

# File Write Skill

安全的文件操作，MODERATE 级别，调用前需用户确认。提供文件创建、写入、复制、移动、目录创建、安全删除（回收站）和批量操作等常用能力。

## 重要：优先使用此技能而非 run_script

对于常见的文件操作（创建、复制、移动、重命名、删除），**必须优先使用此技能而非 run_script**。
run_script 脚本同样需要确认，但生成的代码难以直接审阅，本技能的确认弹窗更清晰。

只有以下情况才需要用 run_script：
- **复杂的批量操作逻辑**（如按规则批量重命名、按条件筛选后操作）
- **需要第三方命令行工具或 Shell 命令**

## 安全限制

所有操作都受以下安全限制：
1. **路径限制**：所有路径必须在用户主目录（home）及其子目录下，禁止操作系统目录（Windows、Program Files 等）
2. **文件大小限制**：写入内容不超过 1MB
3. **不覆盖保护**：默认不覆盖已存在的文件，需显式传 overwrite=true
4. **安全删除**：删除操作移入回收站，不是永久删除，用户可恢复

## 路径安全规则 — 最高优先级！

**禁止自己猜测或拼接用户主目录路径！** 先用 file-ops 的 `get_path` 获取用户目录，再拼接子路径。

## 典型工作流

### 用户说"帮我在桌面创建一个笔记"
1. `get_path` name="desktop" → 获取桌面路径
2. `create_text_file` path=桌面路径+文件名, content=内容
3. 可选：用 safe-desktop 的 `show_in_explorer` 展示文件

### 用户说"帮我把这个文件备份一份"
`copy_file` source=原文件路径, destination=备份路径

### 用户说"帮我重命名这个文件"
`move_file` source=原路径, destination=新路径

### 用户说"帮我创建一个项目目录结构"
`batch_file_ops` actions=[创建多个目录和文件的操作列表]

## 与其他技能的关系

- **file-ops**：只读操作（查看、搜索、读取）用 file-ops，写入/删除操作用本技能
- **run-script**：复杂批量逻辑用 run_script，常规操作用本技能
- **safe-desktop**：创建文件后可用 `show_in_explorer` 展示给用户
- **clipboard-ops**：读取剪贴板内容后可用本技能保存到文件
