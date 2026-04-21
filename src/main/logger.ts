/**
 * ToolBox 统一日志工具 — 主进程版
 *
 * 特性：
 *   1. 控制台输出（终端 stdout/stderr）
 *   2. 文件持久化（按日期滚动，位于 userData/logs/）
 *   3. 自动清理超过 7 天的旧日志
 *   4. EPIPE 管道断裂自动降级为纯文件模式
 *
 * 用法：
 *   import { createLogger } from './logger'
 *   const log = createLogger('Main')
 *   log.info('应用启动')
 *   log.warn('配置缺失')
 *   log.error('严重错误:', err)
 *   log.debug('调试信息')   // 仅开发模式输出
 *
 * 启动：
 *   initPipeGuard()          // 在 main.ts 顶部尽早调用
 *   app.whenReady().then(() => {
 *     cleanOldLogs()
 *     printStartupBanner()
 *   })
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

// ── Logger 接口 ────────────────────────────────────────────────────────────

export interface Logger {
  /** 普通信息日志 */
  info: (...args: unknown[]) => void
  /** 警告日志 */
  warn: (...args: unknown[]) => void
  /** 错误日志 */
  error: (...args: unknown[]) => void
  /** 调试日志（仅开发模式输出，生产模式完全静默） */
  debug: (...args: unknown[]) => void
}

// ── 管道状态追踪 ───────────────────────────────────────────────────────────

/** stdout 管道是否可用（断裂后永久设为 false） */
let stdoutAlive = true
/** stderr 管道是否可用（断裂后永久设为 false） */
let stderrAlive = true

/**
 * 初始化管道状态监听 — 应在 main.ts 顶部尽早调用。
 * 检测到 EPIPE 后自动降级为纯文件日志模式，不影响应用运行。
 */
export function initPipeGuard(): void {
  process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
      if (stdoutAlive) {
        stdoutAlive = false
        writeToFile('WARN', '[Logger] stdout 管道已断裂，降级为纯文件日志模式')
      }
      return
    }
    try {
      writeToFile('ERROR', `[Logger] stdout error: ${err.message}`)
    } catch { /* 忽略 */ }
  })

  process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
      if (stderrAlive) {
        stderrAlive = false
        writeToFile('WARN', '[Logger] stderr 管道已断裂，降级为纯文件日志模式')
      }
      return
    }
    try {
      writeToFile('ERROR', `[Logger] stderr error: ${err.message}`)
    } catch { /* 忽略 */ }
  })

  // 全局兜底：只捕获 EPIPE，其余异常继续抛出
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
      stdoutAlive = false
      stderrAlive = false
      writeToFile('WARN', '[Logger] uncaughtException EPIPE — 降级为纯文件日志模式')
      return
    }
    try {
      writeToFile('ERROR', `[Logger] Uncaught exception: ${err.message}\n${err.stack}`)
    } catch { /* 忽略 */ }
    throw err
  })
}

// ── 文件日志基础设施 ───────────────────────────────────────────────────────

/** 日志目录路径（延迟初始化，app ready 后才可用） */
let logDir: string | null = null

/** 当前正在写入的日志文件日期标识，如 '2026-04-21' */
let currentDateStr = ''

/** 当前日志文件的写入流 */
let currentStream: fs.WriteStream | null = null

/** 旧日志保留天数 */
const LOG_RETENTION_DAYS = 7

/** 是否为开发模式 */
const isDev = process.argv.includes('--dev')

/** 获取当前日期字符串（本地时区），格式 YYYY-MM-DD */
function getDateStr(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 获取当前时间戳字符串（本地时区），格式 HH:mm:ss.SSS */
function getTimeStr(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${h}:${min}:${s}.${ms}`
}

/** 确保日志目录存在并返回路径 */
function ensureLogDir(): string {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs')
  }
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

/**
 * 获取日志目录路径（供外部使用，如"打开日志目录"功能）
 */
export function getLogsDir(): string {
  return ensureLogDir()
}

/** 获取当日的日志写入流（按日期滚动） */
function getLogStream(): fs.WriteStream | null {
  try {
    const dateStr = getDateStr()
    if (dateStr !== currentDateStr || !currentStream) {
      if (currentStream) {
        currentStream.end()
        currentStream = null
      }
      currentDateStr = dateStr
      const dir = ensureLogDir()
      const filePath = path.join(dir, `toolbox-${dateStr}.log`)
      currentStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })
      currentStream.on('error', (err) => {
        if (stderrAlive) console.error('[Logger] 日志文件写入错误:', err.message)
        currentStream = null
      })
    }
    return currentStream
  } catch {
    return null
  }
}

/** 将一条日志写入文件 */
function writeToFile(level: string, message: string): void {
  const stream = getLogStream()
  if (stream) {
    const timestamp = `${getDateStr()} ${getTimeStr()}`
    stream.write(`${timestamp} [${level}] ${message}\n`)
  }
}

/** 将参数序列化为可读字符串 */
function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.message}\n${arg.stack}`
      if (typeof arg === 'object' && arg !== null) {
        try { return JSON.stringify(arg) } catch { return String(arg) }
      }
      return String(arg)
    })
    .join(' ')
}

/**
 * 清理超过保留天数的旧日志文件，应用启动时调用一次
 */
export function cleanOldLogs(): void {
  try {
    const dir = ensureLogDir()
    const files = fs.readdirSync(dir)
    const now = Date.now()
    const maxAge = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

    for (const file of files) {
      if (!file.startsWith('toolbox-') || !file.endsWith('.log')) continue
      const filePath = path.join(dir, file)
      try {
        const stat = fs.statSync(filePath)
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath)
        }
      } catch { /* 单个文件失败不影响其他 */ }
    }
  } catch { /* 清理失败不影响主流程 */ }
}

// ── 公共 Logger API ────────────────────────────────────────────────────────

/**
 * 创建带模块标签的日志实例
 *
 * @param tag 模块标签，如 'Main'、'IPC'、'PluginLoader'
 */
export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`
  const debugPrefix = `[${tag}][Debug]`

  return {
    info: (...args: unknown[]) => {
      if (stdoutAlive) console.log(prefix, ...args)
      writeToFile('INFO', `${prefix} ${formatArgs(args)}`)
    },
    warn: (...args: unknown[]) => {
      if (stderrAlive) console.warn(prefix, ...args)
      writeToFile('WARN', `${prefix} ${formatArgs(args)}`)
    },
    error: (...args: unknown[]) => {
      if (stderrAlive) console.error(prefix, ...args)
      writeToFile('ERROR', `${prefix} ${formatArgs(args)}`)
    },
    debug: (...args: unknown[]) => {
      if (!isDev) return
      if (stdoutAlive) console.log(debugPrefix, ...args)
      // debug 不写文件
    },
  }
}

// ── 渲染进程日志转发 ───────────────────────────────────────────────────────

/**
 * 将渲染进程（Shell / 插件）转发的日志写入文件。
 * 在 main.ts 的 logger:log IPC handler 中调用。
 *
 * @param level  日志级别
 * @param tag    模块标签（由渲染侧传入）
 * @param message 已格式化的消息字符串
 */
export function writeRendererLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  tag: string,
  message: string
): void {
  // debug 级别在渲染侧已被过滤，主进程侧不会收到，此处防御性处理
  if (level === 'debug') return
  const fileLevel = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO'
  const line = `[Renderer][${tag}] ${message}`
  // 同时输出到主进程终端，方便开发时统一查看
  if (level === 'error') {
    if (stderrAlive) console.error(line)
  } else if (level === 'warn') {
    if (stderrAlive) console.warn(line)
  } else {
    if (stdoutAlive) console.log(line)
  }
  writeToFile(fileLevel, line)
}

// ── 启动横幅 ───────────────────────────────────────────────────────────────

/**
 * 打印程序启动横幅 — 在日志文件中起到分隔符作用，记录关键环境信息。
 * 必须在 app.whenReady() 之后调用。
 */
export function printStartupBanner(): void {
  const divider = '═'.repeat(56)
  const appVersion = app.getVersion()
  const electronVersion = process.versions.electron ?? 'unknown'
  const chromeVersion = process.versions.chrome ?? 'unknown'
  const nodeVersion = process.versions.node ?? 'unknown'
  const platform = `${process.platform} ${process.arch}`
  const userData = app.getPath('userData')
  const startTime = new Date().toLocaleString()

  const lines = [
    divider,
    `  ToolBox v${appVersion} — Process started`,
    divider,
    `  Time      : ${startTime}`,
    `  PID       : ${process.pid}`,
    `  Platform  : ${platform}`,
    `  Electron  : ${electronVersion}`,
    `  Chrome    : ${chromeVersion}`,
    `  Node      : ${nodeVersion}`,
    `  UserData  : ${userData}`,
    divider,
  ]

  const banner = '\n' + lines.join('\n') + '\n'

  if (stdoutAlive) console.log(banner)

  const stream = getLogStream()
  if (stream) {
    stream.write(banner + '\n')
  }
}
