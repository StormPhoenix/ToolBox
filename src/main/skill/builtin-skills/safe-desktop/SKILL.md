---
name: safe-desktop
description: >
  安全的桌面交互操作：在浏览器中打开网页、在文件资源管理器中浏览目录或定位文件、发送系统通知。
  全部 SAFE 级别，无需用户确认。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🔔"
    tools:
      - name: open_url
        displayName: "打开网页"
        description: |
          在用户默认浏览器中打开一个网页链接。安全限制：仅允许 http/https 协议，拦截 localhost 和内网 IP 地址。

          使用场景：
          - 用户说"帮我打开 xxx 网站"
          - 搜索到有用链接后帮用户打开
          - 需要在浏览器中查看某个页面
        inputSchema:
          type: object
          properties:
            url:
              type: string
              description: 要打开的网页 URL（必须是 http:// 或 https:// 开头）
          required: [url]
        riskLevel: SAFE
        scriptEntry: scripts/safe-desktop.cjs

      - name: send_notification
        displayName: "发送通知"
        description: |
          发送一条桌面系统通知。纯展示操作，不会打开任何程序或链接。

          使用场景：
          - 长任务（搜索、下载、分析）完成后通知用户，尤其适合用户可能已经切走到其他窗口时
          - 提醒用户注意某些事项

          注意：不要在每次普通对话回复后都发通知，只在任务耗时较长（> 5 秒）或结果重要时使用。
        inputSchema:
          type: object
          properties:
            title:
              type: string
              description: 通知标题（可选，默认 "ToolBox"）
            content:
              type: string
              description: 通知正文内容
          required: [content]
        riskLevel: SAFE
        scriptEntry: scripts/safe-desktop.cjs

      - name: open_directory
        displayName: "打开目录"
        description: |
          在文件资源管理器中打开一个目录进行浏览。只允许打开目录，不能打开文件或可执行程序。

          使用场景：
          - 用户说"帮我打开下载目录"
          - 用户想浏览某个文件夹的内容
          - 下载文件完成后展示下载目录

          ⚠️ 路径要求：
          - path 必须是**目录的完整绝对路径**（不是文件路径）
          - 如果传入的是文件路径会报错，请改用 show_in_explorer
          - 禁止自己猜测用户名拼接路径！请先用 file-ops 的 get_path 获取真实用户目录

          ⚠️ 与 show_in_explorer 的区别：
          - open_directory：打开一个目录浏览其内容（目标是目录）
          - show_in_explorer：定位到某个具体文件并选中它（目标是文件）
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 要打开的目录的完整绝对路径。必须是目录路径，不是文件路径。
          required: [path]
        riskLevel: SAFE
        scriptEntry: scripts/safe-desktop.cjs

      - name: show_in_explorer
        displayName: "定位文件"
        description: |
          在文件资源管理器中打开文件所在目录并自动选中该文件。使用 Electron 原生的 shell.showItemInFolder API，安全可靠。仅做视觉展示，不会执行、修改或删除任何文件。

          使用场景：
          - 下载文件后在 Explorer 中展示给用户看
          - 帮用户找到文件后定位到该文件

          ⚠️ 路径要求：
          - path 必须是**文件的完整绝对路径**（不是目录路径）
          - 如果只想打开目录浏览，请改用 open_directory
          - 禁止自己猜测用户名拼接路径！请先用 file-ops 的 get_path 获取真实用户目录

          💡 如果不确定路径是文件还是目录，请使用 `reveal_path` 工具，它会自动判断并调用正确的方式。
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 要在文件管理器中定位的文件的完整绝对路径。必须是文件路径，不是目录路径。
          required: [path]
        riskLevel: SAFE
        scriptEntry: scripts/safe-desktop.cjs

      - name: reveal_path
        displayName: "智能展示"
        description: |
          智能路径展示工具：传入任意路径，自动判断是文件还是目录，调用正确的方式在 Explorer 中打开。
          - 路径是目录 → 等效 open_directory（打开目录浏览）
          - 路径是文件 → 等效 show_in_explorer（打开所在目录并选中文件）
          - 路径不存在 → 返回错误

          使用场景：
          - 当你有一个路径但不确定或不在乎它是文件还是目录时，直接用 reveal_path
          - 替代"先 file_info 判断类型，再决定调 open_directory 还是 show_in_explorer"的两步流程

          ⚠️ 禁止自己猜测用户名拼接路径！请先用 file-ops 的 get_path 获取真实用户目录
        inputSchema:
          type: object
          properties:
            path:
              type: string
              description: 要在文件管理器中展示的文件或目录的完整绝对路径
          required: [path]
        riskLevel: SAFE
        scriptEntry: scripts/safe-desktop.cjs
---

# Safe Desktop Skill

安全的桌面交互操作，全部 SAFE 级别，无需用户确认。

## 工具清单

- `open_url` — 在默认浏览器中打开网页链接（仅 http/https）
- `send_notification` — 发送系统通知，纯信息展示
- `open_directory` — 打开目录浏览（只允许目录，不能打开文件/程序）
- `show_in_explorer` — 在文件管理器中定位并选中某个具体文件
- `reveal_path` — **智能展示**：自动判断路径是文件还是目录，用正确方式打开（推荐）

## 使用原则

五个操作都是 SAFE 级别：
- `open_url` 只能打开网页链接（http/https），拦截 localhost 和内网 IP
- `send_notification` 只弹一个通知气泡，不打开任何东西
- `open_directory` 只能打开目录（会验证路径确实是目录），不能打开文件或可执行程序
- `show_in_explorer` 只打开文件所在目录并选中文件，不执行/修改/删除任何文件
- `reveal_path` 自动判断后调用 `open_directory` 或 `show_in_explorer`

## open_directory vs show_in_explorer vs reveal_path

- **打开目录浏览**（用户说"帮我打开下载目录"） → `open_directory` path=目录路径
- **定位到具体文件**（用户说"帮我找到那个文件"） → `show_in_explorer` path=文件路径
- **不确定是文件还是目录**（或不想判断） → `reveal_path` path=路径 （自动选择正确方式）

## 典型工作流

### 用户要求"打开下载目录"
1. 用 file-ops 的 `get_path` name="downloads" 获取下载目录
2. 用 `open_directory` path=下载目录路径 → 打开 Explorer 浏览

### 下载文件后展示给用户
1. 用 file-download 的 `download_file` 下载文件
2. 用 `show_in_explorer` path=下载后的文件路径 → 在 Explorer 中定位并选中
3. 可选：用 `send_notification` content="已下载 xxx" 通知用户

### 长任务完成后通知
- 搜索/下载/分析等耗时操作完成后，用 `send_notification` 推一条桌面通知
- 尤其适合用户可能已经切换到其他窗口时

## 路径要求

**禁止自己猜测或拼接用户主目录路径！** 先用 file-ops 的 `get_path` 获取用户目录，再拼接子路径。
