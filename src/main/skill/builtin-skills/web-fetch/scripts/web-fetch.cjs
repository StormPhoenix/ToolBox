/**
 * web-fetch 工具脚本
 *
 * 抓取一个 http/https URL 的页面内容并返回纯文本正文，
 * 用于让 LLM 直接阅读 / 总结 / 分析网页内容。
 *
 * 设计要点：
 * 1. 仅用 Node 内置模块（http/https/url/zlib/path/fs/crypto），无第三方依赖
 * 2. SSRF 防护：拦截 localhost / 内网 IP，仅允许 http/https
 * 3. 跟随重定向（最多 5 次），支持 gzip/deflate/br 解压
 * 4. Content-Type 白名单，二进制类型直接拒绝
 * 5. 自适应 charset（默认 utf-8，识别 Content-Type / meta charset）
 * 6. HTML → 纯文本：去 script/style/svg/template/noscript，标签转空白，实体解码
 * 7. GitHub 仓库主页 SPA 自动改写到 raw README
 * 8. TTL 缓存（10 分钟），避免单会话内重复抓取同一 URL
 */
const http = require('http')
const https = require('https')
const zlib = require('zlib')
const path = require('path')
const fs = require('fs')

// ─── 常量 ───────────────────────────────────────────────────

/** 缓存 TTL：10 分钟（与 web-search 保持一致） */
const CACHE_TTL = 10 * 60 * 1000

/** 单次响应最大字节数（512 KB） */
const MAX_RESPONSE_BYTES = 512 * 1024

/** 网络请求超时（15s） */
const REQUEST_TIMEOUT_MS = 15_000

/** 最大重定向次数 */
const MAX_REDIRECTS = 5

/** 返回给 LLM 的正文默认/最大字符数 */
const DEFAULT_MAX_CHARS = 50_000
const HARD_MAX_CHARS = 200_000

/** 允许的文本类 Content-Type 前缀 */
const ALLOWED_CONTENT_TYPE_PATTERNS = [
  /^text\//i,
  /^application\/json/i,
  /^application\/xml/i,
  /^application\/xhtml\+xml/i,
  /^application\/.*\+json/i,
  /^application\/.*\+xml/i,
  /^application\/javascript/i,
]

/** 内网 / 本机地址黑名单（与 safe-desktop validateUrl 思路一致） */
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
]

/** UA 池：随机选择降低反爬指纹识别率 */
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

function randomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]
}

// ─── URL 校验与改写 ─────────────────────────────────────────

/**
 * 校验 URL 是否安全可访问。
 * 返回 { ok, parsed } 或 { ok: false, error }
 */
function validateUrl(urlStr) {
  let parsed
  try {
    parsed = new URL(urlStr)
  } catch {
    return { ok: false, error: `无效的 URL: ${urlStr}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `不支持的协议: ${parsed.protocol}（仅支持 http/https）` }
  }
  const hostname = parsed.hostname
  for (const pattern of BLOCKED_HOSTS) {
    if (pattern.test(hostname)) {
      return { ok: false, error: `不允许访问内网或本机地址: ${hostname}` }
    }
  }
  return { ok: true, parsed }
}

/**
 * GitHub 仓库主页是 SPA，纯 HTTP GET 拿不到正文。
 * 自动把 github.com/owner/repo[/tree/branch[/path]] 改写到 raw.githubusercontent.com 的 README.md。
 *
 * 不改写：blob/raw/issues/pulls 等具体页面。
 */
function rewriteGithubUrl(parsed) {
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    return null
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const [owner, repo, third, fourth, ...rest] = segments

  // 排除已知的非主页/非 tree 路径
  const stopWords = new Set([
    'issues', 'pulls', 'pull', 'actions', 'projects', 'wiki', 'releases',
    'discussions', 'security', 'pulse', 'graphs', 'commits', 'blob', 'raw',
    'archive', 'compare', 'settings', 'network', 'forks', 'stargazers',
    'watchers', 'contributors', 'community', 'tags',
  ])
  if (third && stopWords.has(third)) return null

  // 解析 ref 与子路径
  let ref = 'HEAD'
  let subPath = ''
  if (third === 'tree' && fourth) {
    ref = fourth
    subPath = rest.join('/')
  } else if (!third) {
    // 仓库主页 github.com/owner/repo
  } else {
    // 形如 github.com/owner/repo/<path>，按主页处理
  }

  const cleanRepo = repo.replace(/\.git$/, '')
  const candidatePath = subPath
    ? `${owner}/${cleanRepo}/${ref}/${subPath}/README.md`
    : `${owner}/${cleanRepo}/${ref}/README.md`

  return `https://raw.githubusercontent.com/${candidatePath}`
}

// ─── HTTP 请求（含重定向 / 解压） ──────────────────────────

function buildRequestHeaders() {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'close',
    'Upgrade-Insecure-Requests': '1',
  }
}

/**
 * 发起 GET 请求并返回 { statusCode, headers, body, finalUrl }。
 * 自动跟随 3xx 重定向，对每跳重新做 SSRF 校验。
 * body 为原始 Buffer（未解码字符串）。
 */
function httpGet(targetUrl, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const validation = validateUrl(targetUrl)
    if (!validation.ok) {
      reject(new Error(validation.error))
      return
    }
    const parsed = validation.parsed
    const lib = parsed.protocol === 'https:' ? https : http

    const req = lib.request(
      {
        method: 'GET',
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: buildRequestHeaders(),
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0

        // 跟随重定向
        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            res.resume()
            reject(new Error(`重定向次数过多（${MAX_REDIRECTS}）`))
            return
          }
          const nextUrl = new URL(res.headers.location, targetUrl).toString()
          res.resume()
          httpGet(nextUrl, redirectsLeft - 1).then(resolve, reject)
          return
        }

        // 解压管线（按 Content-Encoding 选择）
        const enc = (res.headers['content-encoding'] || '').toLowerCase()
        let stream = res
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip())
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())

        const chunks = []
        let bytes = 0
        let aborted = false
        stream.on('data', (chunk) => {
          if (aborted) return
          bytes += chunk.length
          if (bytes > MAX_RESPONSE_BYTES) {
            aborted = true
            // 不再读取后续内容；保留已收集的部分用于解析
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        stream.on('end', () => {
          resolve({
            statusCode: status,
            headers: res.headers,
            body: Buffer.concat(chunks),
            finalUrl: targetUrl,
            truncated: aborted,
          })
        })
        stream.on('error', (err) => {
          // 解压错误时把 raw chunks 当作降级返回，避免完全失败
          if (chunks.length > 0) {
            resolve({
              statusCode: status,
              headers: res.headers,
              body: Buffer.concat(chunks),
              finalUrl: targetUrl,
              truncated: aborted,
              decodeError: err.message,
            })
          } else {
            reject(err)
          }
        })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
    req.end()
  })
}

// ─── 字符集与 HTML 解析 ─────────────────────────────────────

/** 从 Content-Type 提取 charset；找不到则返回 null */
function parseCharsetFromContentType(ct) {
  if (!ct) return null
  const m = ct.match(/charset\s*=\s*"?([\w-]+)"?/i)
  return m ? m[1].toLowerCase() : null
}

/** 从 HTML head 提取 meta charset；找不到则返回 null */
function parseCharsetFromHtml(buf) {
  // 只看前 4KB，防止扫整个大 buffer
  const head = buf.slice(0, 4096).toString('latin1')
  const m1 = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)
  if (m1) return m1[1].toLowerCase()
  const m2 = head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i)
  if (m2) return m2[1].toLowerCase()
  return null
}

/** Buffer → 字符串（按指定 charset，Node 不支持 gbk 等时降级到 utf-8） */
function decodeBody(buf, charset) {
  const cs = (charset || 'utf-8').toLowerCase()
  const supported = new Set(['utf-8', 'utf8', 'ascii', 'latin1', 'binary', 'ucs-2', 'utf-16le'])
  if (supported.has(cs)) {
    return buf.toString(cs === 'utf-8' ? 'utf-8' : cs)
  }
  // 不支持的 charset（gbk/gb2312/big5 等）：降级到 utf-8，可能出现乱码但优于失败
  return buf.toString('utf-8')
}

/** 提取 <title> 文本 */
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : ''
}

/** HTML → 纯文本（无第三方依赖的简易实现） */
function htmlToText(html) {
  let s = html
  // 干掉脚本/样式/svg/不可见块
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
  s = s.replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, ' ')

  // 块级元素后插换行，便于按段落保留结构
  s = s.replace(
    /<\/(p|div|section|article|header|footer|nav|aside|ul|ol|li|h[1-6]|tr|table|pre|blockquote|br)\s*>/gi,
    '\n'
  )
  s = s.replace(/<br\s*\/?>(?!\n)/gi, '\n')

  // 去除剩余标签
  s = s.replace(/<[^>]+>/g, ' ')

  // 实体解码 + 空白规范化
  s = decodeEntities(s)
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/[ \t]+\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]{2,}/g, ' ')
  return s.trim()
}

/** 解码常见 HTML 实体（命名 + &#nn; / &#xnn;） */
function decodeEntities(s) {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_, n) => safeFromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
}

function safeFromCodePoint(cp) {
  try {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return ''
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

// ─── Content-Type 判断 ─────────────────────────────────────

function isAllowedContentType(ct) {
  if (!ct) return true // 不带 Content-Type 时按文本兜底处理
  return ALLOWED_CONTENT_TYPE_PATTERNS.some((p) => p.test(ct))
}

function isHtmlLike(ct) {
  if (!ct) return true
  return /^text\/(html|xhtml)/i.test(ct) || /xhtml\+xml/i.test(ct)
}

// ─── 缓存 ──────────────────────────────────────────────────

function cacheKey(url) {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

function readCache(dataDir, key) {
  try {
    const file = path.join(dataDir, `fetch-${key}.json`)
    if (!fs.existsSync(file)) return null
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (Date.now() - (data._timestamp || 0) > CACHE_TTL) return null
    delete data._timestamp
    return data
  } catch {
    return null
  }
}

function writeCache(dataDir, key, data) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    const file = path.join(dataDir, `fetch-${key}.json`)
    fs.writeFileSync(file, JSON.stringify({ ...data, _timestamp: Date.now() }))
  } catch {
    // 缓存失败不影响主流程
  }
}

// ─── 入口 ──────────────────────────────────────────────────

async function execute(input, context) {
  const rawUrl = (input && input.url ? String(input.url) : '').trim()
  if (!rawUrl) {
    return { success: false, error: '缺少 url 参数' }
  }

  const maxChars = clamp(
    Number(input && input.maxChars) || DEFAULT_MAX_CHARS,
    1000,
    HARD_MAX_CHARS
  )

  // SSRF 校验
  const initialValidation = validateUrl(rawUrl)
  if (!initialValidation.ok) {
    return { success: false, error: initialValidation.error }
  }

  // 智能改写（GitHub 主页 → raw README）
  const rewritten = rewriteGithubUrl(initialValidation.parsed)
  const requestUrl = rewritten || rawUrl
  const rewriteNote = rewritten
    ? `已自动改写为 ${rewritten}（github.com 仓库主页是 SPA，纯抓取拿不到正文）`
    : undefined

  // 缓存命中
  const dataDir = context && context.dataDir
  const key = cacheKey(requestUrl)
  if (dataDir) {
    const cached = readCache(dataDir, key)
    if (cached) {
      console.log(`[web-fetch] 缓存命中: ${requestUrl}`)
      return { ...cached, fromCache: true }
    }
  }

  console.log(`[web-fetch] 抓取: ${requestUrl}`)

  let res
  try {
    res = await httpGet(requestUrl, MAX_REDIRECTS)
  } catch (err) {
    return {
      success: false,
      url: rawUrl,
      requestedUrl: requestUrl,
      error: `抓取失败: ${err.message}`,
      suggestion: '请检查 URL 是否可访问，或换一个能直接拿到 HTML 的链接',
    }
  }

  const contentType = String(res.headers['content-type'] || '').trim()

  if (res.statusCode >= 400) {
    return {
      success: false,
      url: rawUrl,
      requestedUrl: requestUrl,
      finalUrl: res.finalUrl,
      status: res.statusCode,
      contentType,
      error: `HTTP ${res.statusCode}`,
      suggestion: res.statusCode === 403 || res.statusCode === 429
        ? '目标站点可能存在反爬限制，可改为人工查看或换一种来源'
        : '请确认链接是否可公开访问',
    }
  }

  if (!isAllowedContentType(contentType)) {
    return {
      success: false,
      url: rawUrl,
      requestedUrl: requestUrl,
      finalUrl: res.finalUrl,
      status: res.statusCode,
      contentType,
      error: `不支持的 Content-Type: ${contentType}`,
      suggestion: '此工具只读取文本/HTML/JSON 等文本类资源；二进制文件请改用 download_file',
    }
  }

  // charset 解析
  const ctCharset = parseCharsetFromContentType(contentType)
  const htmlCharset = isHtmlLike(contentType) ? parseCharsetFromHtml(res.body) : null
  const charset = ctCharset || htmlCharset || 'utf-8'
  const decoded = decodeBody(res.body, charset)

  // HTML / 纯文本分支
  let title = ''
  let text = decoded
  if (isHtmlLike(contentType) || /<html\b/i.test(decoded.slice(0, 4096))) {
    title = extractTitle(decoded)
    text = htmlToText(decoded)
  }

  const fullLength = text.length
  const truncatedByMaxChars = fullLength > maxChars
  if (truncatedByMaxChars) {
    text = text.slice(0, maxChars) + '\n\n...(已截断)'
  }

  const response = {
    success: true,
    url: rawUrl,
    requestedUrl: requestUrl,
    finalUrl: res.finalUrl,
    status: res.statusCode,
    contentType,
    charset,
    title,
    text,
    byteSize: res.body.length,
    truncated: Boolean(res.truncated || truncatedByMaxChars),
    chars: text.length,
    note: rewriteNote,
  }

  if (dataDir) writeCache(dataDir, key, response)

  return response
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

module.exports = { execute }
