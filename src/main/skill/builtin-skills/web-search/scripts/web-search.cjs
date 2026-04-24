/**
 * web-search 工具脚本
 * 使用 DuckDuckGo HTML Lite 搜索互联网
 *
 * DuckDuckGo 反爬策略说明：
 *   DDG 会通过 HTTP 202 + 验证页面来限流自动化请求。触发因素包括：
 *   - 高频请求（短时间内多次搜索）
 *   - 缺少 Cookie（DDG 首次访问会 Set-Cookie，后续不带 Cookie 更易触发）
 *   - 固定的请求指纹（User-Agent、Accept-Language 等完全不变）
 *   应对措施：
 *   1. 收到 202 时自动重试（指数退避，最多 3 次）
 *   2. 持久化 Cookie 并在后续请求中携带
 *   3. 从 UA 池中随机选择 User-Agent 降低指纹识别率
 */
const https = require('https')
const http = require('http')
const path = require('path')
const fs = require('fs')

/** 搜索结果缓存 TTL（10 分钟） */
const CACHE_TTL = 10 * 60 * 1000

/** 收到 202 后最大重试次数 */
const MAX_RETRIES = 3

/** 重试基础延迟（毫秒），实际延迟 = BASE_DELAY * 2^attempt */
const RETRY_BASE_DELAY = 1500

/** User-Agent 池：随机选择以降低反爬指纹识别率 */
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

/** Cookie 持久化文件名 */
const COOKIE_FILE = 'ddg-cookies.json'

/** Cookie 最大有效期（7 天，超过则丢弃重新获取） */
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

/** 模块级 Cookie 存储（进程内缓存 + 磁盘持久化） */
let persistedCookies = ''
/** dataDir 路径（由 execute 入口注入，供 Cookie 读写使用） */
let cookieDataDir = ''

/** 从磁盘加载已持久化的 Cookie（应用冷启动时调用一次） */
function loadCookiesFromDisk(dataDir) {
  try {
    const file = path.join(dataDir, COOKIE_FILE)
    if (!fs.existsSync(file)) return
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (Date.now() - (data._timestamp || 0) > COOKIE_MAX_AGE) {
      // Cookie 过期，删除文件
      try { fs.unlinkSync(file) } catch { /* ignore */ }
      return
    }
    if (data.cookies && typeof data.cookies === 'string') {
      persistedCookies = data.cookies
      console.log(`[web-search] 从磁盘加载 Cookie: ${persistedCookies.substring(0, 60)}...`)
    }
  } catch {
    // 读取失败不影响主流程
  }
}

/** 将 Cookie 持久化到磁盘 */
function saveCookiesToDisk() {
  if (!cookieDataDir || !persistedCookies) return
  try {
    if (!fs.existsSync(cookieDataDir)) fs.mkdirSync(cookieDataDir, { recursive: true })
    const file = path.join(cookieDataDir, COOKIE_FILE)
    fs.writeFileSync(file, JSON.stringify({
      cookies: persistedCookies,
      _timestamp: Date.now(),
    }))
  } catch {
    // 写入失败不影响主流程
  }
}

/** 从 Set-Cookie 响应头提取并累积 Cookie，同时持久化到磁盘 */
function extractCookies(res) {
  const setCookie = res.headers['set-cookie']
  if (!setCookie) return
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .map(c => c.split(';')[0].trim())
    .filter(Boolean)
  if (cookies.length > 0) {
    const map = {}
    const existing = persistedCookies.split('; ').filter(Boolean)
    for (const c of existing) {
      const [k] = c.split('=')
      if (k) map[k] = c
    }
    for (const c of cookies) {
      const [k] = c.split('=')
      if (k) map[k] = c
    }
    persistedCookies = Object.values(map).join('; ')
    saveCookiesToDisk()
  }
}

/** 随机选择 User-Agent */
function randomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]
}

/** 构造请求头 */
function buildHeaders(extra = {}) {
  const headers = {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'identity',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  }
  if (persistedCookies) {
    headers['Cookie'] = persistedCookies
  }
  return headers
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * HTTP POST 请求封装（跟随重定向）
 * 返回 { statusCode, body, headers } 而非直接 reject 非 200
 */
function httpPost(url, body, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const postData = typeof body === 'string' ? body : ''
    const opts = {
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      timeout,
      headers: buildHeaders({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Referer': 'https://html.duckduckgo.com/',
        'Origin': 'https://html.duckduckgo.com',
      }),
    }
    const req = lib.request(opts, (res) => {
      extractCookies(res)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, timeout).then(resolve, reject)
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf-8'),
        headers: res.headers,
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.write(postData)
    req.end()
  })
}

/** HTTP GET 请求封装（跟随重定向） */
function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      timeout,
      headers: buildHeaders({
        'Referer': 'https://html.duckduckgo.com/',
      }),
    }, (res) => {
      extractCookies(res)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, timeout).then(resolve, reject)
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf-8'),
        headers: res.headers,
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
  })
}

/**
 * 带重试的搜索请求
 * 收到 202 时指数退避重试，同时在 202 响应中尝试提取可用结果
 */
async function searchWithRetry(query, maxResults) {
  const searchUrl = 'https://html.duckduckgo.com/html/'
  const postBody = `q=${encodeURIComponent(query)}`
  let lastStatusCode = 0
  let lastBody = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1)
      console.log(`[web-search] 第 ${attempt} 次重试，等待 ${delay}ms...`)
      await sleep(delay)
    }

    const res = await httpPost(searchUrl, postBody)
    lastStatusCode = res.statusCode
    lastBody = res.body

    if (res.statusCode === 200) {
      return { ok: true, html: res.body }
    }

    if (res.statusCode === 202) {
      // 202 的响应体有时仍包含搜索结果（DDG 偶尔会在 202 页面中嵌入结果）
      const partialResults = parseDDGLiteResults(res.body, maxResults)
      if (partialResults.length > 0) {
        console.log(`[web-search] 状态码 202 但响应中提取到 ${partialResults.length} 条结果`)
        return { ok: true, html: res.body }
      }
      console.log(`[web-search] 收到 HTTP 202（DuckDuckGo 限流），attempt=${attempt}`)
      continue
    }

    // 其他非 200 状态码直接失败
    return { ok: false, error: `HTTP ${res.statusCode}` }
  }

  // 重试耗尽，最后的 body 也尝试解析一下
  const lastChance = parseDDGLiteResults(lastBody, maxResults)
  if (lastChance.length > 0) {
    return { ok: true, html: lastBody }
  }

  return {
    ok: false,
    error: `搜索引擎限流（HTTP ${lastStatusCode}），已重试 ${MAX_RETRIES} 次`,
    retryable: true,
  }
}

/** 去除 HTML 标签并解码常见 HTML 实体 */
function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * 从 DuckDuckGo HTML Lite 页面解析搜索结果
 *
 * 实际 HTML 结构（POST 接口）：
 *   <a rel="nofollow" class="result__a" href="URL">Title</a>
 *   <a class="result__snippet" href="URL">Snippet text</a>
 */
function parseDDGLiteResults(html, maxResults) {
  const results = []

  // 主模式：匹配 class="result__a" 的标题链接
  const titlePattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  // 摘要模式：匹配 class="result__snippet" 的摘要链接
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

  let titleMatch
  const links = []
  while ((titleMatch = titlePattern.exec(html)) !== null) {
    links.push({
      url: titleMatch[1],
      title: stripHtml(titleMatch[2]),
    })
  }

  let snippetMatch
  const snippets = []
  while ((snippetMatch = snippetPattern.exec(html)) !== null) {
    snippets.push(stripHtml(snippetMatch[1]))
  }

  let snippetIdx = 0
  for (let i = 0; i < links.length && results.length < maxResults; i++) {
    const { url, title } = links[i]
    if (!url || !title) continue
    // 跳过 DuckDuckGo 广告链接（URL 含 ad_provider / ad_domain）
    if (url.includes('duckduckgo.com/y.js') || url.includes('ad_provider')) continue
    results.push({ title, url, snippet: snippets[snippetIdx] || '' })
    snippetIdx++
  }

  // 如果主模式没匹配到，尝试旧版 result-link 模式（兼容）
  if (results.length === 0) {
    const legacyPattern = /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi
    let legacyMatch
    while ((legacyMatch = legacyPattern.exec(html)) !== null && results.length < maxResults) {
      results.push({
        title: stripHtml(legacyMatch[2]),
        url: legacyMatch[1],
        snippet: '',
      })
    }
  }

  // 终极兜底：提取所有外部链接
  if (results.length === 0) {
    const fallbackPattern = /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    let fbMatch
    while ((fbMatch = fallbackPattern.exec(html)) !== null && results.length < maxResults) {
      const url = fbMatch[1]
      const title = stripHtml(fbMatch[2])
      if (title && !url.includes('duckduckgo.com') && title.length > 5) {
        results.push({ title, url, snippet: '' })
      }
    }
  }

  return results
}

/** 读取缓存 */
function readCache(dataDir, key) {
  try {
    const cacheFile = path.join(dataDir, `search-${key}.json`)
    if (!fs.existsSync(cacheFile)) return null
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
    if (Date.now() - data._timestamp > CACHE_TTL) return null
    delete data._timestamp
    return data
  } catch {
    return null
  }
}

/** 写入缓存 */
function writeCache(dataDir, key, data) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    const cacheFile = path.join(dataDir, `search-${key}.json`)
    fs.writeFileSync(cacheFile, JSON.stringify({ ...data, _timestamp: Date.now() }))
  } catch {
    // 缓存写入失败不影响主流程
  }
}

/** 生成缓存 key（简单哈希） */
function cacheKey(query) {
  let hash = 0
  for (let i = 0; i < query.length; i++) {
    hash = ((hash << 5) - hash) + query.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

// ========== 入口 ==========

async function execute(input, context) {
  const { query, maxResults = 5 } = input

  if (!query || typeof query !== 'string') {
    return { success: false, error: '缺少 query 参数' }
  }

  const limit = Math.min(Math.max(maxResults, 1), 10)
  const dataDir = context.dataDir

  // 注入 dataDir 供 Cookie 持久化使用，首次调用时从磁盘加载 Cookie
  if (dataDir && !cookieDataDir) {
    cookieDataDir = dataDir
    loadCookiesFromDisk(dataDir)
  }

  // 尝试读取缓存
  const key = cacheKey(query)
  const cached = readCache(dataDir, key)
  if (cached) {
    console.log(`[web-search] 缓存命中: "${query}"`)
    return { ...cached, _fromCache: true }
  }

  console.log(`[web-search] 搜索: "${query}"`)

  try {
    const searchResult = await searchWithRetry(query, limit)

    if (!searchResult.ok) {
      console.error(`[web-search] 搜索失败:`, searchResult.error)
      return {
        success: false,
        error: `搜索失败: ${searchResult.error}`,
        suggestion: searchResult.retryable
          ? '搜索引擎正在限流，建议等待 1-2 分钟后再试'
          : '可能是网络连接问题，请稍后重试',
      }
    }

    const results = parseDDGLiteResults(searchResult.html, limit)

    const response = {
      success: true,
      query,
      resultCount: results.length,
      results,
    }

    if (results.length === 0) {
      response.message = '没有找到相关结果，可能是搜索词过于具体或网络问题'
    }

    // 写入缓存
    writeCache(dataDir, key, response)

    return response
  } catch (err) {
    console.error(`[web-search] 搜索失败:`, err.message)
    return {
      success: false,
      error: `搜索失败: ${err.message}`,
      suggestion: '可能是网络连接问题，请稍后重试',
    }
  }
}

module.exports = { execute }
