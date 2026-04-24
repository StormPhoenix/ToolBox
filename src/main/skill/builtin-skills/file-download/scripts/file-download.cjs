/**
 * file-download 工具脚本
 * 从互联网下载文件到本地磁盘
 *
 * 特性：
 * - 零外部依赖（Node.js 内置 https/http + fs）
 * - 流式下载（不占用大量内存）
 * - 自动推断文件名（Content-Disposition / URL 路径）
 * - 重定向跟随（最多 5 次）
 * - 大小限制（默认 500MB）
 * - 重名自动编号
 */
const https = require('https')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')

/** 默认最大下载大小 500MB */
const DEFAULT_MAX_SIZE = 500 * 1024 * 1024
/** 绝对最大下载大小 2GB */
const ABSOLUTE_MAX_SIZE = 2048 * 1024 * 1024
/** 默认超时 5 分钟 */
const DEFAULT_TIMEOUT = 300 * 1000
/** 最大超时 30 分钟 */
const MAX_TIMEOUT = 1800 * 1000
/** 最大重定向次数 */
const MAX_REDIRECTS = 5

/** 不允许的 URL 模式（内网地址） */
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^\[::1\]/,
]

/**
 * 从 Content-Disposition 头提取文件名
 * 支持: attachment; filename="file.pdf"
 *        attachment; filename*=UTF-8''encoded%20name.pdf
 */
function parseContentDisposition(header) {
  if (!header) return null

  // filename*=UTF-8''xxx 优先（RFC 5987）
  const starMatch = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''(.+?)(?:;|$)/i)
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1].trim())
    } catch { /* fall through */ }
  }

  // filename="xxx" 或 filename=xxx
  const match = header.match(/filename\s*=\s*"?([^";\n]+)"?/i)
  if (match) {
    return match[1].trim()
  }

  return null
}

/**
 * 从 URL 路径提取文件名
 */
function filenameFromUrl(urlStr) {
  try {
    const parsed = new URL(urlStr)
    const pathname = decodeURIComponent(parsed.pathname)
    const base = path.basename(pathname)
    // 过滤掉无意义的文件名（纯路径分隔符、空、太长）
    if (base && base !== '/' && base.length <= 255 && /\.\w{1,10}$/.test(base)) {
      return base
    }
  } catch { /* ignore */ }
  return null
}

/**
 * 清理文件名中的非法字符
 */
function sanitizeFilename(name) {
  // 移除 Windows 非法字符 + 控制字符
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .trim()
    .slice(0, 200)
}

/**
 * 如果目标文件已存在，添加编号后缀
 * download.pdf → download (1).pdf → download (2).pdf ...
 */
function resolveUniqueFilename(filePath) {
  if (!fs.existsSync(filePath)) return filePath

  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)

  for (let i = 1; i <= 999; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }

  // 极端情况：用时间戳
  const ts = Date.now().toString(36)
  return path.join(dir, `${base}_${ts}${ext}`)
}

/**
 * 格式化字节数为人类可读格式
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`
}

/**
 * 验证 URL 安全性
 */
function validateUrl(urlStr) {
  let parsed
  try {
    parsed = new URL(urlStr)
  } catch {
    return { ok: false, error: `无效的 URL: ${urlStr}` }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: `不支持的协议: ${parsed.protocol}（仅支持 http/https）` }
  }

  const hostname = parsed.hostname
  for (const pattern of BLOCKED_HOSTS) {
    if (pattern.test(hostname)) {
      return { ok: false, error: `不允许访问内网地址: ${hostname}` }
    }
  }

  return { ok: true, parsed }
}

/**
 * 执行 HTTP 下载（流式写入文件）
 * 返回 Promise<{ filePath, size, contentType, filename }>
 */
function downloadToFile(url, filePath, maxSize, timeout, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      return reject(new Error(`重定向次数超过 ${MAX_REDIRECTS} 次`))
    }

    const lib = url.startsWith('https') ? https : http

    const req = lib.get(url, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    }, (res) => {
      // 重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        let redirectUrl = res.headers.location
        // 处理相对 URL
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, url).href
        }
        return downloadToFile(redirectUrl, filePath, maxSize, timeout, redirectCount + 1)
          .then(resolve, reject)
      }

      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`服务器返回 HTTP ${res.statusCode}`))
      }

      // 从响应头推断文件名（如果 filePath 是目录）
      const contentDisp = res.headers['content-disposition']
      const contentType = res.headers['content-type'] || ''
      const contentLength = parseInt(res.headers['content-length'], 10) || 0

      // 检查 Content-Length 预检
      if (contentLength > maxSize) {
        res.resume()
        return reject(new Error(
          `文件大小 ${formatBytes(contentLength)} 超过限制 ${formatBytes(maxSize)}`
        ))
      }

      let cdFilename = parseContentDisposition(contentDisp)

      // 如果 filePath 是目录，需要在里面生成文件名
      let finalPath = filePath
      const isDir = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
      if (isDir) {
        const name = cdFilename || filenameFromUrl(url) || `download_${Date.now().toString(36)}`
        finalPath = path.join(filePath, sanitizeFilename(name))
      }

      finalPath = resolveUniqueFilename(finalPath)

      // 确保目标目录存在
      const dir = path.dirname(finalPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const fileStream = fs.createWriteStream(finalPath)
      let downloaded = 0

      res.on('data', (chunk) => {
        downloaded += chunk.length
        if (downloaded > maxSize) {
          res.destroy()
          fileStream.destroy()
          // 清理不完整文件
          try { fs.unlinkSync(finalPath) } catch { /* ignore */ }
          reject(new Error(
            `下载大小 ${formatBytes(downloaded)} 超过限制 ${formatBytes(maxSize)}，已中断并清理`
          ))
        }
      })

      res.pipe(fileStream)

      fileStream.on('finish', () => {
        resolve({
          filePath: finalPath,
          filename: path.basename(finalPath),
          size: downloaded,
          sizeFormatted: formatBytes(downloaded),
          contentType: contentType.split(';')[0].trim(),
          redirects: redirectCount,
        })
      })

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(finalPath) } catch { /* ignore */ }
        reject(new Error(`写入文件失败: ${err.message}`))
      })
    })

    req.on('error', (err) => {
      reject(new Error(`网络请求失败: ${err.message}`))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`下载超时（${Math.round(timeout / 1000)} 秒）`))
    })
  })
}

// ========== 入口 ==========

async function execute(input, context) {
  const { url, savePath, maxSizeMB, timeoutSec } = input

  if (!url || typeof url !== 'string') {
    return { success: false, error: '缺少 url 参数' }
  }

  // 验证 URL 安全性
  const validation = validateUrl(url.trim())
  if (!validation.ok) {
    return { success: false, error: validation.error }
  }

  // 计算大小限制（允许小数 MB，如 0.5 表示 512KB）
  const maxSize = (maxSizeMB != null && maxSizeMB > 0)
    ? Math.min(maxSizeMB * 1024 * 1024, ABSOLUTE_MAX_SIZE)
    : DEFAULT_MAX_SIZE

  // 计算超时
  const timeout = timeoutSec
    ? Math.min(Math.max(timeoutSec, 10) * 1000, MAX_TIMEOUT)
    : DEFAULT_TIMEOUT

  // 解析保存路径
  let targetPath
  const downloadsDir = path.join(os.homedir(), 'Downloads')

  if (savePath && typeof savePath === 'string') {
    const trimmed = savePath.trim()
    if (path.isAbsolute(trimmed)) {
      targetPath = trimmed
    } else {
      // 相对路径/仅文件名 → 存到 Downloads
      targetPath = path.join(downloadsDir, trimmed)
    }
  } else {
    // 未指定 → 使用 Downloads 目录（download 函数内部自动推断文件名）
    targetPath = downloadsDir
  }

  console.log(`[file-download] 开始下载: ${url}`)
  console.log(`[file-download] 目标路径: ${targetPath}`)
  console.log(`[file-download] 大小限制: ${formatBytes(maxSize)}, 超时: ${Math.round(timeout / 1000)}s`)

  const startTime = Date.now()

  try {
    const result = await downloadToFile(url.trim(), targetPath, maxSize, timeout)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`[file-download] 下载完成: ${result.filePath} (${result.sizeFormatted}, ${elapsed}s)`)

    return {
      success: true,
      filePath: result.filePath,
      filename: result.filename,
      size: result.sizeFormatted,
      sizeBytes: result.size,
      contentType: result.contentType,
      elapsedSeconds: parseFloat(elapsed),
      message: `文件已下载到: ${result.filePath} (${result.sizeFormatted})`,
    }
  } catch (err) {
    console.error(`[file-download] 下载失败:`, err.message)
    return {
      success: false,
      error: err.message,
      url: url.trim(),
    }
  }
}

module.exports = { execute }
