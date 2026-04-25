---
name: web-fetch
description: >
  抓取一个 http/https URL 的页面内容并返回纯文本正文，用于让 LLM 阅读、总结或分析网页/在线文档。
  这是分析任意 URL 内容时的首选工具，避免使用 web_search（只有摘要）+ download_file + read_text_file 这种绕路链路。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🌐"
    tools:
      - name: web_fetch
        displayName: "读取网页"
        description: |
          抓取一个 http/https URL 的页面内容并返回纯文本正文。

          核心用途：
          - 用户给了一个 URL 让你"总结/分析/翻译/解释/对比"网页内容 → **直接调用此工具**
          - 用户问"这篇文章讲了什么"并附 URL → **直接调用此工具**
          - web_search 拿到候选链接后，需要进一步阅读某条内容 → **直接调用此工具**

          不要用：
          - 不要为了分析网页内容而去 download_file + read_text_file，请直接用 web_fetch
          - 不要为了让用户查看网页而调用 web_fetch，应该用 safe-desktop 的 open_url 在浏览器中打开
          - 不要用于二进制文件（图片/视频/压缩包）下载，请用 download_file

          智能改写：
          - 传入 GitHub 仓库主页 URL（github.com/owner/repo 或 .../tree/...）会自动改读 raw README，
            因为 GitHub 网页本身是 SPA，纯 HTTP GET 拿不到正文。

          返回值结构：
          { success, url, finalUrl, status, contentType, title, text, byteSize, truncated, fromCache }
          - text 已做 HTML→纯文本 转换 + 截断到约 50KB
          - 失败时返回 { success: false, error, suggestion? }

          安全限制：
          - 仅允许 http/https，拦截 localhost / 内网 IP
          - 仅允许文本类 Content-Type（text/*、application/json/xml/xhtml）
          - 单次响应最大 512KB，超时 15s，最多跟随 5 次重定向
        inputSchema:
          type: object
          properties:
            url:
              type: string
              description: 要抓取的网页 URL（必须是 http:// 或 https:// 开头）
            maxChars:
              type: number
              description: 返回正文最大字符数，默认 50000，最大 200000
          required: [url]
        riskLevel: SAFE
        scriptEntry: scripts/web-fetch.cjs
---

# Web Fetch Skill

让 AI 助手能够直接读取一个 URL 的页面正文，用于总结、分析、翻译、解释网页内容。

## 与其它 Skill 的分工

| 场景 | 应该用 |
|---|---|
| 用户问"帮我总结/分析这个网页 <url>" | `web_fetch` |
| 用户问"帮我搜一下 XXX 信息" | `web_search` 拿候选链接，必要时再 `web_fetch` 读取某条 |
| 用户说"帮我打开这个网址给我看看" | `safe-desktop` 的 `open_url`（在浏览器中弹出，不返回内容） |
| 用户说"帮我下载这个文件到电脑" | `file-download` 的 `download_file` |
| 想读本地文件 | `file-ops` 的 `read_text_file` |

## 使用原则

- **总结网页 = 直接 `web_fetch`**，不要先 `web_search` 同一 URL 再绕路
- 不确定网页是否能抓取时也直接试一次，失败会返回明确错误
- 失败时坦诚告知用户，不要反复重试同一 URL
- 抓到正文后基于内容回答即可，不需要把整段正文复述给用户
- 对 GitHub 仓库主页直接传 `https://github.com/owner/repo`，工具会自动改读 README

## 已知限制

- 不能执行页面 JavaScript，纯 SPA 站点（如 Twitter、未做 SSR 的应用）可能拿不到正文
- 不解析 PDF / Office 文档，需要文本类 Content-Type
- 受网站反爬策略影响时（如 Cloudflare 验证），会返回 HTTP 403/429 等错误
