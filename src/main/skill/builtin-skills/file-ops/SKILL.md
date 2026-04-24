---
name: file-ops
description: >
  安全的文件系统只读操作。列出目录内容、查看文件信息、读取文本文件、搜索文件、获取系统路径。
  这些操作不会修改任何文件，全部 SAFE 级别，无需用户确认。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "📂"
    tools:
      - name: list_directory
        displayName: "列出目录"
        description: |
          列出指定目录下的文件和子目录。返回每个条目的名称、类型（文件/目录）、大小和修改时间。

          使用场景：
          - 用户问"我的桌面/下载目录有什么文件"
          - 需要了解某个目录的内容
          - 查看文件夹结构

          注意：路径中不要猜测用户名，如果需要用户主目录路径请先用 get_path 工具获取。

          支持 depth 参数递归列出子目录内容（默认 1 只列当前层，最大 5），
          减少逐层调用 list_directory 的需要。
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 要列出的目录的绝对路径
            showHidden:
              type: boolean
              description: 是否显示隐藏文件（以 . 开头的文件），默认 false
            depth:
              type: number
              description: 递归深度（1=只列当前层，2=包含子目录内容，最大 5），默认 1
          required: [path]
        riskLevel: SAFE
        scriptEntry: scripts/file-ops.cjs

      - name: file_info
        displayName: "文件信息"
        description: |
          获取单个文件或目录的详细信息：大小、创建时间、修改时间、类型、权限等。
          也可用于检查某个路径是否存在。

          使用场景：
          - 用户想知道某个文件的大小、修改日期
          - 检查某个文件或目录是否存在
          - 查看文件类型
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 文件或目录的绝对路径
          required: [path]
        riskLevel: SAFE
        scriptEntry: scripts/file-ops.cjs

      - name: read_text_file
        displayName: "读取文件"
        description: |
          读取文本文件的内容。支持常见文本格式（.txt, .md, .json, .csv, .log, .xml, .html, .js, .ts, .py 等）。
          对于大文件可以指定只读取前 N 行。

          使用场景：
          - 用户想查看某个配置文件的内容
          - 读取日志文件
          - 查看文本文件的具体内容

          安全限制：最大读取 1MB 的文件内容，超出部分会被截断。
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 文本文件的绝对路径
            maxLines:
              type: number
              description: 最多读取的行数，默认不限制（但总大小不超过 1MB）
            encoding:
              type: string
              description: 文件编码，默认 utf-8。支持 utf-8, gbk, ascii, latin1 等
          required: [path]
        riskLevel: SAFE
        scriptEntry: scripts/file-ops.cjs

      - name: search_files
        displayName: "搜索文件"
        description: |
          在指定目录中递归搜索文件。支持按文件名关键词、扩展名和大小条件搜索。

          使用场景：
          - 用户问"帮我找找电脑上有没有某个文件"
          - 按扩展名搜索特定类型的文件
          - 查找大文件

          注意：搜索深度默认最大 5 层，结果最多返回 100 条，避免对整个磁盘进行深度搜索导致超时。
        inputSchema:
          type: object
          properties:
            directory:
              type: string
              description: 要搜索的根目录的绝对路径
            keyword:
              type: string
              description: 文件名关键词（不区分大小写的模糊匹配）
            extensions:
              type: string
              description: 限定文件扩展名，多个用逗号分隔，如 ".jpg,.png,.gif"
            minSize:
              type: number
              description: 最小文件大小（字节）
            maxSize:
              type: number
              description: 最大文件大小（字节）
            maxDepth:
              type: number
              description: 最大搜索深度，默认 5
            maxResults:
              type: number
              description: 最大返回结果数，默认 100
          required: [directory]
        riskLevel: SAFE
        scriptEntry: scripts/file-ops.cjs

      - name: get_path
        displayName: "获取路径"
        description: |
          获取常用系统路径。避免猜测用户名来拼接路径，始终用此工具获取真实路径。

          使用场景：
          - 需要知道用户的桌面、下载、文档等目录在哪里
          - 获取用户主目录路径
          - 获取系统临时目录路径

          支持批量查询：传入 names 数组可一次获取多个路径，如 names=["home","desktop","downloads"]，
          避免为每个路径单独调用一次。
        inputSchema:
          type: object
          properties:
            name:
              type: string
              description: "单个路径名称: home | desktop | downloads | documents | music | pictures | videos | temp"
            names:
              type: array
              items:
                type: string
              description: "批量查询多个路径（优先于 name），如 [\"home\", \"desktop\", \"downloads\"]"
          required: []
        riskLevel: SAFE
        scriptEntry: scripts/file-ops.cjs

      - name: inspect_path
        displayName: "探测路径"
        description: |
          万能路径探测工具：传入任意路径，自动判断类型并返回最有用的信息。
          - 路径不存在 → 返回 exists=false
          - 路径是目录 → 返回目录内容列表（等效 list_directory）
          - 路径是文本文件 → 返回文件信息 + 内容预览（前 200 行）
          - 路径是二进制文件 → 返回文件信息（不含内容）

          这是一个组合工具，可以替代 file_info + read_text_file 或 file_info + list_directory 的两步调用，
          一次调用即可获得完整信息。当你不确定路径是文件还是目录时，优先使用此工具。
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 要探测的文件或目录的绝对路径
            maxPreviewLines:
              type: number
              description: 文本文件预览的最大行数，默认 200
          required: [path]
        riskLevel: SAFE
        scriptEntry: scripts/file-ops.cjs
---

# File Ops Skill

安全的文件系统只读操作，无需用户确认即可执行。提供目录列表、文件信息查询、文本文件读取、文件搜索和系统路径获取等基础能力。

## 使用原则

这个技能覆盖了大部分"查看/查询"类的文件操作，全部是 SAFE 级别，不会修改、删除或移动任何文件。
当用户的请求只涉及"看看"、"查查"、"找找"这类只读操作时，**优先使用此技能**。

## 路径安全规则 — 最高优先级！

你不知道用户的 Windows 系统用户名！用户的名字、昵称、称呼，和 Windows 系统用户名完全无关！
**禁止自己构造任何 `C:\Users\...` 开头的路径！** 唯一的获取方式是先调用 `get_path` 获取真实路径，再拼接子路径。
涉及用户目录的操作必须先获取真实路径，绝对不能跳过 `get_path` 直接猜测路径！

## 工具清单

- `get_path` — 获取系统路径（home, desktop, downloads 等），**所有涉及用户目录的操作都应先调用此工具**。支持 `names` 批量查询。
- `list_directory` — 列出目录内容（文件名、类型、大小、修改时间），支持 `depth` 递归
- `file_info` — 查看单个文件/目录的详细信息，或检查路径是否存在
- `read_text_file` — 读取文本文件内容
- `search_files` — 递归搜索文件（按名称、扩展名、大小）
- `inspect_path` — **万能路径探测**：自动判断路径是文件/目录/不存在，一次返回完整信息（含内容预览）

## 减少调用轮次的原则

**优先使用合并能力**：
- 需要多个系统路径？→ `get_path` names=["home","desktop","downloads"] **一次拿全**
- 需要看目录层级？→ `list_directory` depth=2 **一次递归两层**
- 不确定路径是什么？→ `inspect_path` **一次探测+预览**
- 已知路径要看内容？→ 直接 `read_text_file`，不需要先 `file_info`

## 典型工作流

### 用户问"我桌面上有什么文件"
1. `get_path` name="desktop" → 获取桌面路径
2. `list_directory` path=桌面路径 → 列出所有文件

### 用户问"帮我查查我的桌面和下载目录里有什么"
1. `get_path` names=["desktop","downloads"] → **一次获取两个路径**
2. `list_directory` path=桌面路径
3. `list_directory` path=下载路径

### 用户问"帮我找找有没有叫 xxx 的文件"
1. `get_path` name="home" → 获取主目录
2. `search_files` directory=主目录 keyword="xxx" → 递归搜索

### 用户问"这个文件里写了什么"
直接 `inspect_path` path=文件路径 → **一次返回文件信息 + 内容预览**
