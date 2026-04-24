---
name: desktop-action
description: >
  启动本地应用程序或打开文件夹（需用户确认）。当用户说"帮我打开某个软件"、"启动 XXX 程序"、
  "运行 XXX"时使用此技能。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🖥️"
    tools:
      - name: desktop_action
        displayName: "启动应用"
        description: |
          打开本地应用程序或文件夹。

          ⚠️ 打开网页链接请改用 safe-desktop 的 open_url（SAFE 级别，无需确认）。
          ⚠️ 发送系统通知请改用 safe-desktop 的 send_notification（SAFE 级别，无需确认）。
          ⚠️ 在文件管理器中定位文件请改用 safe-desktop 的 show_in_explorer（SAFE 级别，无需确认）。

          ⚠️ open_app 打开用户目录时的强制规则：
          1. 你不知道用户的 Windows 系统用户名！用户的名字/昵称和系统用户名无关！
          2. 禁止自己写出任何 C:\\Users\\... 开头的路径！
          3. 必须先用 file-ops 的 get_path 获取用户目录路径
          4. 只有固定的非用户目录路径（如 C:\\Program Files\\App\\app.exe）才可以直接写
        inputSchema:
          type: object
          properties:
            action:
              type: string
              description: "操作类型: open_app"
            content:
              type: string
              description: >
                应用/文件夹路径。打开用户目录时，
                此值必须来自 file-ops 的 get_path 的输出结果，
                禁止自己编写 C:\\Users\\... 路径
            actions:
              type: array
              description: "批量操作（优先于单个 action/content），一次确认执行多个操作"
              items:
                type: object
                properties:
                  action:
                    type: string
                  content:
                    type: string
          required: []
        riskLevel: MODERATE
        confirmHint: "启动应用: {content}"
        scriptEntry: scripts/desktop-action.cjs
---

# Desktop Action Skill

执行需要用户确认的桌面操作：启动本地应用程序或打开文件夹。

## 重要：优先使用 safe-desktop 技能

以下操作已拆分到 `safe-desktop` 技能（SAFE 级别，无需用户确认）：
- **打开网页** → 使用 `open_url`
- **发送通知** → 使用 `send_notification`
- **在 Explorer 中定位文件** → 使用 `show_in_explorer`
- **打开目录浏览** → 使用 `open_directory`

只有以下操作需要使用本技能：
- **启动应用/打开文件夹** → `action: open_app`

## 路径要求

**`open_app` 的 content 必须是完整绝对路径**。

**禁止自己猜测或拼接用户主目录路径！** 用户告诉你的名字、昵称和 Windows 系统用户名完全无关。

正确做法：先用 file-ops 的 `get_path` 获取用户目录路径，再拼接子路径。

只有明确已知的固定路径（如 `C:\Program Files\App\app.exe`）才可以直接写入 content。

## 安全说明

此技能的风险级别为 **MODERATE**，所有操作执行前需要用户确认。
这是因为 `open_app` 可以启动任意本地程序，存在安全风险。
