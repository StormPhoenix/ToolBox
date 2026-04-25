---
name: file-download
description: >
  从互联网下载文件到本地。支持自动推断文件名、重定向跟随、大小限制。
  默认保存到系统 Downloads 目录。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "⬇️"
    tools:
      - name: download_file
        displayName: "下载文件"
        description: |
          从 URL 下载文件到本地磁盘，**仅用于把文件保存到用户电脑供后续使用**。默认保存到系统 Downloads 目录。

          ⚠️ 不要把它当作"读取网页正文"的手段：
          - 用户给了 URL 让你"总结/分析/翻译/解释"网页内容 → 请直接用 web-fetch 的 `web_fetch`
          - 不要走 download_file → read_text_file 这条绕路链路（污染 Downloads 目录、慢、且可能违反用户预期）

          适用场景：
          - 用户说"帮我下载这个文件" / "帮我把这个保存到电脑"
          - 用户需要安装包、图片、PDF、压缩包等二进制资源
          - 配合 web_search 搜到资源后下载

          参数:
          - url (必填): 要下载的文件 URL（必须是 http:// 或 https://）
          - savePath (可选): 保存路径。可以是完整路径或仅文件名（仅文件名时存到 Downloads）。不提供则自动从 URL/响应头推断文件名
          - maxSizeMB (可选): 最大允许下载大小（MB），默认 500，最大 2048
          - timeoutSec (可选): 超时秒数，默认 300（5分钟），最大 1800

          下载完成后会返回保存路径和文件大小，你应告知用户这些信息。

          如果文件较大（如 > 50MB），下载耗时较长，完成后建议配合 safe-desktop 的 send_notification 推送系统通知，
          以便用户在切换到其他窗口时也能收到提醒。
        inputSchema:
          type: object
          properties:
            url:
              type: string
              description: 要下载的文件 URL
            savePath:
              type: string
              description: "保存路径或文件名（可选，默认自动推断存到 Downloads）"
            maxSizeMB:
              type: number
              description: "最大下载大小 MB（默认 500）"
            timeoutSec:
              type: number
              description: "超时秒数（默认 300）"
          required: [url]
        riskLevel: SAFE
        scriptEntry: scripts/file-download.cjs
---

# File Download Skill

从互联网下载文件到本地磁盘的工具。

## 使用场景

- 用户说"帮我下载这个文件"并给出 URL
- 用户需要下载图片、文档、安装包等
- 配合 web_search 搜索到资源后下载

## 重要规则

1. **只接受 http/https URL**：不支持 file://、ftp:// 等协议
2. **默认存到 Downloads**：不指定 savePath 时自动存到系统下载目录
3. **自动推断文件名**：优先从 Content-Disposition 响应头提取，其次从 URL 路径提取
4. **重名自动编号**：目标文件已存在时自动添加 (1)、(2) 等后缀
5. **大小限制**：默认 500MB，超过会中断下载并删除不完整文件
6. **下载完成后告知用户**：务必告知保存路径和文件大小，方便用户找到文件

## 减少调用轮次

- 一次 download_file 调用即可完成下载，**无需先查询文件大小或检查目录**
- 如果用户没有指定保存位置，**不要**先调用 file-ops 的 `get_path` 查询 Downloads 路径，`download_file` 内部会自动处理

## 与其他技能配合

### 下载后在 Explorer 中展示
1. `download_file` url=xxx → 返回 filePath
2. `show_in_explorer` path=filePath → 定位并选中下载的文件

### 大文件下载完成后通知
1. `download_file` url=xxx → 假设耗时 60s，用户可能已切换窗口
2. `send_notification` content="xxx 下载完成，保存到 xxx" → 推送系统通知
