---
name: run-script
description: >
  执行 AI 生成的脚本来完成复杂任务（批量重命名、数据处理、系统自动化等）。
  仅在 file-write 的 batch_file_ops 无法满足需求时使用（如需要复杂逻辑、条件判断、第三方工具）。
  文件整理（创建目录+移动文件）请优先用 file-write 的 batch_file_ops。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "⚡"
    tools:
      - name: run_script
        displayName: "执行脚本"
        description: |
          生成并执行 Node.js 脚本或 Shell 命令来完成复杂任务。适用于批量重命名、数据处理、系统自动化等需要编程逻辑的场景。

          ⚠️ 文件整理（按类型创建目录+移动文件）请优先用 file-write 技能的 batch_file_ops 工具，无需脚本。
          仅当 file-write 无法满足需求时（如复杂条件判断、正则匹配重命名、第三方命令行工具）才使用本工具。

          脚本在独立子进程中执行，执行前会请求用户确认。脚本可以使用 Node.js 内置模块（fs, path, os, child_process 等）。
          必须在 description 参数中用自然语言清晰说明脚本将要执行的操作。
        inputSchema:
          type: object
          properties:
            language:
              type: string
              enum: [javascript, shell]
              description: "脚本语言：javascript（Node.js 脚本）或 shell（系统命令）"
            code:
              type: string
              description: 要执行的脚本代码
            description:
              type: string
              description: >
                用自然语言描述这段脚本将要做什么（会展示给用户确认）。
                必须包含：操作的文件/目录范围、具体动作、预期结果
            timeout:
              type: number
              description: 执行超时时间（毫秒），默认 360000（6分钟），最大 600000（10分钟）
          required: [language, code, description]
        riskLevel: MODERATE
        confirmHint: "{description}（{language}）"
        scriptEntry: scripts/run-script.cjs
---

# Run Script Skill

执行 AI 生成的脚本来完成用户的复杂任务。ToolBox 的通用能力引擎，让 AI 能够完成各种需要编程逻辑的操作。

## 重要：优先使用 file-ops 和 file-write 技能

对于**只读的文件操作**（列目录、查文件信息、读文件内容、搜索文件、获取系统路径），**必须优先使用 file-ops 技能**。
对于**常见的文件写入操作**（创建文件、写入文本、复制、移动/重命名、创建目录、删除到回收站），**必须优先使用 file-write 技能**。
file-write 还支持 `batch_file_ops` 批量操作，一次调用完成多个文件操作。

只有以下情况才需要用 run_script：
- file-ops / file-write 不支持的**复杂逻辑**（如按规则批量重命名、数据处理、格式转换）
- 需要**第三方命令行工具**或 **Shell 命令**

## 使用场景

当用户请求涉及以下类型的任务时，应使用 run_script 工具：

- ~~文件查询~~ → **请改用 file-ops 技能的 list_directory / file_info / search_files 工具**
- ~~文件整理（按类型分类到文件夹）~~ → **请改用 file-write 技能的 batch_file_ops 工具**
- **批量重命名**：根据规则批量修改文件名（需要复杂的名称生成逻辑）
- **文件查找**：递归搜索符合条件的文件并汇报结果
- **数据处理**：读取 CSV/JSON 文件、统计分析、格式转换
- **系统自动化**：清理临时文件、备份指定目录、检查磁盘空间
- **文本处理**：批量替换文件内容、合并文件、提取信息

## 代码生成规范

1. 使用 `console.log()` 输出执行结果和进度信息，这些输出会返回给你用于生成回复
2. 使用 `try/catch` 包裹所有关键操作，确保错误被捕获并报告
3. 操作文件前先用 `fs.existsSync()` 检查路径是否存在
4. 对于破坏性操作（删除、覆盖、移动），在 description 中明确列出受影响的文件
5. 优先使用 Node.js 内置模块（fs, path, os, child_process），不要 require 第三方 npm 包
6. 代码必须是完整可执行的，不要依赖外部变量或上下文
7. 使用 `path.join()` 构建路径，确保跨平台兼容
8. 处理大量文件时，输出处理进度（如"已处理 10/30 个文件"）

## description 撰写规范

description 参数会展示给用户确认，必须用简洁的自然语言说明：
- 操作的文件/目录范围（具体路径）
- 具体要执行的动作（移动、复制、删除、重命名等）
- 预期的结果（文件会被移到哪里、会创建什么文件夹等）
- 如有破坏性操作，明确标注

## 常见任务示例

### 批量重命名
用户说"把这个文件夹里的照片按日期重命名"时：
1. 读取目标目录中的图片文件
2. 获取文件的修改时间
3. 按"YYYY-MM-DD_序号"格式重命名
4. 输出重命名映射

### 查找文件
用户说"帮我找找电脑上所有大于100MB的文件"时：
1. 递归扫描指定目录
2. 筛选符合条件的文件
3. 按大小排序并输出列表

## 安全注意事项

- 此技能的风险级别为 **MODERATE**，所有脚本执行前需要用户确认
- 脚本在独立子进程中执行，有超时保护（默认 6 分钟，最大 10 分钟）
- 涉及删除操作时，建议先列出将被删除的文件让用户确认，再执行删除
- 不要生成访问网络、下载文件或修改系统设置的脚本，除非用户明确要求
- 不要生成需要管理员权限的操作
