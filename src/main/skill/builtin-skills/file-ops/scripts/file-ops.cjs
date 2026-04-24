/**
 * file-ops 工具脚本
 * 安全的文件系统只读操作：目录列表、文件信息、文本读取、文件搜索、系统路径
 *
 * 支持工具：
 * - get_path: 获取常用系统路径
 * - list_directory: 列出目录内容
 * - file_info: 查看文件/目录详细信息
 * - read_text_file: 读取文本文件内容
 * - search_files: 递归搜索文件
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

// ========== 常量 ==========

/** 文本文件读取大小上限：1MB */
const MAX_READ_SIZE = 1024 * 1024

/** 搜索结果默认上限 */
const DEFAULT_MAX_RESULTS = 100

/** 搜索深度默认上限 */
const DEFAULT_MAX_DEPTH = 5

/** 常见文本文件扩展名（用于 read_text_file 安全检查） */
const TEXT_EXTENSIONS = new Set([
  // 文本/文档
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log',
  // 数据/配置格式
  '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  // Web
  '.html', '.htm', '.css', '.scss', '.less',
  // JavaScript/TypeScript
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  // Web 框架
  '.vue', '.svelte', '.astro',
  // Python/Ruby/PHP
  '.py', '.rb', '.php',
  // JVM 系
  '.java', '.kt', '.scala', '.groovy',
  // C/C++/Objective-C
  '.c', '.cpp', '.h', '.hpp', '.m', '.mm',
  // Go/Rust/Swift
  '.go', '.rs', '.swift',
  // C#
  '.cs',
  // Dart/Lua/R
  '.dart', '.lua', '.r',
  // Perl
  '.pl', '.pm',
  // 函数式语言
  '.hs', '.ex', '.exs', '.erl',
  // 新兴系统语言
  '.zig', '.nim',
  // Shell/脚本
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  // 查询/Schema
  '.sql', '.graphql', '.proto',
  // 配置文件
  '.gitignore', '.editorconfig', '.eslintrc', '.prettierrc',
])

// ========== 工具函数 ==========

/**
 * 格式化文件大小为可读字符串
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
}

/**
 * 格式化日期为本地字符串
 */
function formatDate(date) {
  return date.toLocaleString('zh-CN')
}

/**
 * 安全地获取文件 stat，返回 null 表示路径不存在
 */
function safeStat(filePath) {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

// ========== get_path ==========

/**
 * 解析单个路径名，返回 { name, path, exists }
 */
function resolveOnePath(name) {
  const { app } = require('electron')

  const pathMap = {
    home: os.homedir(),
    desktop: path.join(os.homedir(), 'Desktop'),
    downloads: path.join(os.homedir(), 'Downloads'),
    documents: path.join(os.homedir(), 'Documents'),
    music: path.join(os.homedir(), 'Music'),
    pictures: path.join(os.homedir(), 'Pictures'),
    videos: path.join(os.homedir(), 'Videos'),
    temp: os.tmpdir(),
  }

  // 尝试使用 Electron app.getPath 获取更准确的路径（用户可能自定义了目录位置）
  const electronPathMap = {
    home: 'home',
    desktop: 'desktop',
    downloads: 'downloads',
    documents: 'documents',
    music: 'music',
    pictures: 'pictures',
    videos: 'videos',
    temp: 'temp',
  }

  if (!pathMap[name]) {
    return { name, error: `不支持的路径名: ${name}。支持: ${Object.keys(pathMap).join(', ')}` }
  }

  let resolvedPath = pathMap[name]
  try {
    if (app && electronPathMap[name]) {
      resolvedPath = app.getPath(electronPathMap[name])
    }
  } catch {
    // Electron app.getPath 不可用时回退到 os 拼接
  }

  return { name, path: resolvedPath, exists: fs.existsSync(resolvedPath) }
}

/**
 * get_path: 支持单个 name 或批量 names 查询
 * - name: "desktop" → 返回单个路径
 * - names: ["home","desktop","downloads"] → 返回路径映射
 */
function getPath(input) {
  // 批量模式：传入 names 数组
  if (Array.isArray(input.names) && input.names.length > 0) {
    const paths = {}
    for (const n of input.names) {
      const result = resolveOnePath(n)
      if (result.error) {
        paths[n] = { error: result.error }
      } else {
        paths[n] = { path: result.path, exists: result.exists }
      }
    }
    return { success: true, paths }
  }

  // 单个模式：传入 name 字符串
  const { name } = input
  if (!name) {
    return { success: false, error: '缺少 name 或 names 参数' }
  }

  const result = resolveOnePath(name)
  if (result.error) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    name: result.name,
    path: result.path,
    exists: result.exists,
  }
}

// ========== list_directory ==========

/** 递归结果条目上限，防止 depth>1 时结果爆炸 */
const LIST_DIR_MAX_ITEMS = 500

function listDirectory(input) {
  const { path: dirPath, showHidden = false, depth = 1 } = input

  if (!dirPath) {
    return { success: false, error: '缺少 path 参数' }
  }

  const stat = safeStat(dirPath)
  if (!stat) {
    return { success: false, error: `路径不存在: ${dirPath}` }
  }
  if (!stat.isDirectory()) {
    return { success: false, error: `不是一个目录: ${dirPath}` }
  }

  const clampedDepth = Math.max(1, Math.min(depth, 5))

  const items = []
  let truncated = false

  function listLevel(currentDir, currentDepth, prefix) {
    if (currentDepth > clampedDepth) return
    if (items.length >= LIST_DIR_MAX_ITEMS) { truncated = true; return }

    let entries
    try {
      entries = fs.readdirSync(currentDir)
    } catch {
      return
    }

    if (!showHidden) {
      entries = entries.filter(name => !name.startsWith('.'))
    }

    // 排序：目录在前，然后按名称排序
    const sorted = entries.map(name => {
      const fullPath = path.join(currentDir, name)
      const entryStat = safeStat(fullPath)
      return { name, fullPath, entryStat }
    }).filter(e => e.entryStat)

    sorted.sort((a, b) => {
      const aDir = a.entryStat.isDirectory()
      const bDir = b.entryStat.isDirectory()
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })

    for (const { name, fullPath, entryStat } of sorted) {
      if (items.length >= LIST_DIR_MAX_ITEMS) { truncated = true; return }

      const relativePath = prefix ? `${prefix}/${name}` : name
      items.push({
        name: clampedDepth > 1 ? relativePath : name,
        type: entryStat.isDirectory() ? 'directory' : 'file',
        size: entryStat.isFile() ? formatSize(entryStat.size) : null,
        sizeBytes: entryStat.isFile() ? entryStat.size : null,
        modified: formatDate(entryStat.mtime),
      })

      if (entryStat.isDirectory() && currentDepth < clampedDepth) {
        listLevel(fullPath, currentDepth + 1, relativePath)
      }
    }
  }

  listLevel(dirPath, 1, '')

  return {
    success: true,
    path: dirPath,
    depth: clampedDepth,
    totalItems: items.length,
    truncated,
    directories: items.filter(i => i.type === 'directory').length,
    files: items.filter(i => i.type === 'file').length,
    items,
  }
}

// ========== file_info ==========

function fileInfo(input) {
  const { path: filePath } = input

  if (!filePath) {
    return { success: false, error: '缺少 path 参数' }
  }

  const stat = safeStat(filePath)
  if (!stat) {
    return {
      success: true,
      exists: false,
      path: filePath,
      message: `路径不存在: ${filePath}`,
    }
  }

  const info = {
    success: true,
    exists: true,
    path: filePath,
    name: path.basename(filePath),
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other',
    size: formatSize(stat.size),
    sizeBytes: stat.size,
    created: formatDate(stat.birthtime),
    modified: formatDate(stat.mtime),
    accessed: formatDate(stat.atime),
  }

  if (stat.isFile()) {
    info.extension = path.extname(filePath).toLowerCase()
  }

  if (stat.isDirectory()) {
    // 统计直接子项数量
    try {
      const children = fs.readdirSync(filePath)
      info.childCount = children.length
    } catch {
      info.childCount = null
    }
  }

  return info
}

// ========== read_text_file ==========

function readTextFile(input) {
  const { path: filePath, maxLines, encoding = 'utf-8' } = input

  if (!filePath) {
    return { success: false, error: '缺少 path 参数' }
  }

  const stat = safeStat(filePath)
  if (!stat) {
    return { success: false, error: `文件不存在: ${filePath}` }
  }
  if (!stat.isFile()) {
    return { success: false, error: `不是一个文件: ${filePath}` }
  }

  // 检查扩展名是否为已知文本类型
  const ext = path.extname(filePath).toLowerCase()
  // 对于无扩展名的文件（如 Makefile, Dockerfile），也允许读取
  // 只在扩展名明确为二进制格式时拒绝
  const binaryExtensions = new Set([
    '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
    '.zip', '.tar', '.gz', '.7z', '.rar',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.db', '.sqlite', '.mdb',
  ])

  if (binaryExtensions.has(ext)) {
    return {
      success: false,
      error: `这是二进制文件（${ext}），无法作为文本读取。`,
    }
  }

  // 大小检查
  if (stat.size > MAX_READ_SIZE) {
    // 仍然尝试读取，但截断
  }

  try {
    let content
    if (encoding.toLowerCase() === 'utf-8' || encoding.toLowerCase() === 'utf8') {
      content = fs.readFileSync(filePath, 'utf-8')
    } else {
      // 对于非 UTF-8 编码，读取 Buffer 后尝试解码
      const buffer = fs.readFileSync(filePath)
      const { TextDecoder } = require('util')
      try {
        const decoder = new TextDecoder(encoding)
        content = decoder.decode(buffer)
      } catch {
        // 编码不支持时回退 utf-8
        content = buffer.toString('utf-8')
      }
    }

    let truncated = false
    if (content.length > MAX_READ_SIZE) {
      content = content.slice(0, MAX_READ_SIZE)
      truncated = true
    }

    // 按行截断
    if (maxLines && maxLines > 0) {
      const lines = content.split('\n')
      if (lines.length > maxLines) {
        content = lines.slice(0, maxLines).join('\n')
        truncated = true
      }
    }

    return {
      success: true,
      path: filePath,
      size: formatSize(stat.size),
      lineCount: content.split('\n').length,
      truncated,
      content,
    }
  } catch (err) {
    return { success: false, error: `读取文件失败: ${err.message}` }
  }
}

// ========== search_files ==========

function searchFiles(input) {
  const {
    directory,
    keyword,
    extensions,
    minSize,
    maxSize,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxResults = DEFAULT_MAX_RESULTS,
  } = input

  if (!directory) {
    return { success: false, error: '缺少 directory 参数' }
  }

  const stat = safeStat(directory)
  if (!stat) {
    return { success: false, error: `目录不存在: ${directory}` }
  }
  if (!stat.isDirectory()) {
    return { success: false, error: `不是一个目录: ${directory}` }
  }

  // 解析扩展名过滤
  const extFilter = extensions
    ? new Set(extensions.split(',').map(e => {
        const trimmed = e.trim().toLowerCase()
        return trimmed.startsWith('.') ? trimmed : '.' + trimmed
      }))
    : null

  const lowerKeyword = keyword ? keyword.toLowerCase() : null

  const results = []
  let scannedCount = 0

  // 需要跳过的目录
  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.svn', '__pycache__',
    '.next', '.nuxt', 'dist', 'build', '.cache',
  ])

  function walk(dir, depth) {
    if (depth > maxDepth) return
    if (results.length >= maxResults) return

    let entries
    try {
      entries = fs.readdirSync(dir)
    } catch {
      return // 权限不足等错误，静默跳过
    }

    for (const name of entries) {
      if (results.length >= maxResults) return

      // 跳过隐藏文件和特殊目录
      if (name.startsWith('.') && SKIP_DIRS.has(name)) continue

      const fullPath = path.join(dir, name)
      const entryStat = safeStat(fullPath)
      if (!entryStat) continue

      scannedCount++

      if (entryStat.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        walk(fullPath, depth + 1)
      } else if (entryStat.isFile()) {
        // 关键词过滤
        if (lowerKeyword && !name.toLowerCase().includes(lowerKeyword)) continue

        // 扩展名过滤
        if (extFilter) {
          const ext = path.extname(name).toLowerCase()
          if (!extFilter.has(ext)) continue
        }

        // 大小过滤
        if (minSize !== undefined && entryStat.size < minSize) continue
        if (maxSize !== undefined && entryStat.size > maxSize) continue

        results.push({
          name,
          path: fullPath,
          size: formatSize(entryStat.size),
          sizeBytes: entryStat.size,
          modified: formatDate(entryStat.mtime),
        })
      }
    }
  }

  walk(directory, 0)

  return {
    success: true,
    searchRoot: directory,
    keyword: keyword || null,
    extensions: extensions || null,
    totalResults: results.length,
    scannedItems: scannedCount,
    truncated: results.length >= maxResults,
    results,
  }
}

// ========== inspect_path ==========

/**
 * 万能路径探测工具：自动判断路径类型并返回适当信息。
 * - 不存在 → 报错
 * - 目录 → 列出内容（等效 list_directory depth=1）
 * - 文本文件 → 返回 stat 信息 + 内容前 200 行预览
 * - 二进制文件 → 仅返回 stat 信息
 */
function inspectPath(input) {
  const { path: targetPath, maxPreviewLines = 200 } = input

  if (!targetPath) {
    return { success: false, error: '缺少 path 参数' }
  }

  const stat = safeStat(targetPath)
  if (!stat) {
    return { success: false, exists: false, path: targetPath, error: `路径不存在: ${targetPath}` }
  }

  if (stat.isDirectory()) {
    const listing = listDirectory({ path: targetPath, showHidden: false })
    return {
      success: true,
      exists: true,
      path: targetPath,
      type: 'directory',
      modified: formatDate(stat.mtime),
      ...listing.success ? {
        totalItems: listing.totalItems,
        directories: listing.directories,
        files: listing.files,
        items: listing.items,
      } : { listError: listing.error },
    }
  }

  // 文件
  const ext = path.extname(targetPath).toLowerCase()
  const info = {
    success: true,
    exists: true,
    path: targetPath,
    type: 'file',
    name: path.basename(targetPath),
    extension: ext,
    size: formatSize(stat.size),
    sizeBytes: stat.size,
    created: formatDate(stat.birthtime),
    modified: formatDate(stat.mtime),
  }

  // 尝试读取文本预览
  const binaryExtensions = new Set([
    '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
    '.zip', '.tar', '.gz', '.7z', '.rar',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.db', '.sqlite', '.mdb',
  ])

  if (!binaryExtensions.has(ext) && stat.size <= MAX_READ_SIZE) {
    try {
      let content = fs.readFileSync(targetPath, 'utf-8')
      const lines = content.split('\n')
      const clampedMax = Math.max(1, Math.min(maxPreviewLines, 500))
      if (lines.length > clampedMax) {
        content = lines.slice(0, clampedMax).join('\n')
        info.previewTruncated = true
        info.totalLines = lines.length
      }
      info.preview = content
      info.lineCount = lines.length
    } catch {
      // 读取失败（编码问题等），跳过预览
    }
  } else if (binaryExtensions.has(ext)) {
    info.binary = true
  }

  return info
}

// ========== 入口 ==========

async function execute(input, context) {
  const toolName = context.toolName || 'list_directory'

  switch (toolName) {
    case 'get_path':
      return getPath(input)
    case 'list_directory':
      return listDirectory(input)
    case 'file_info':
      return fileInfo(input)
    case 'read_text_file':
      return readTextFile(input)
    case 'search_files':
      return searchFiles(input)
    case 'inspect_path':
      return inspectPath(input)
    default:
      return { success: false, error: `未知工具: ${toolName}` }
  }
}

module.exports = { execute }
