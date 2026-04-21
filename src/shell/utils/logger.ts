/**
 * ToolBox 统一日志工具 — Shell 渲染进程版
 *
 * 与插件侧 createLogger（来自 @toolbox/bridge）接口完全一致，
 * 区别是 Shell 直接调用 window.electronAPI.log()，无需经过 postMessage。
 *
 * 用法：
 *   import { createLogger } from '@/utils/logger'
 *   const log = createLogger('App')
 *   log.info('Shell 已挂载')
 *   log.debug('调试信息')   // 仅开发模式输出，生产模式完全静默
 */

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

/** 是否为开发模式（Vite 注入） */
const isDev = import.meta.env.DEV

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
 * 创建带模块标签的日志实例
 *
 * @param tag 模块标签，如 'App'、'Sidebar'、'PluginLoader'
 */
export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`
  const debugPrefix = `[${tag}][Debug]`

  return {
    info: (...args: unknown[]) => {
      console.log(prefix, ...args)
      window.electronAPI.log('info', tag, formatArgs(args)).catch(() => { /* 静默 */ })
    },
    warn: (...args: unknown[]) => {
      console.warn(prefix, ...args)
      window.electronAPI.log('warn', tag, formatArgs(args)).catch(() => { /* 静默 */ })
    },
    error: (...args: unknown[]) => {
      console.error(prefix, ...args)
      window.electronAPI.log('error', tag, formatArgs(args)).catch(() => { /* 静默 */ })
    },
    debug: (...args: unknown[]) => {
      if (!isDev) return
      console.log(debugPrefix, ...args)
      // debug 不写文件，不转发 IPC
    },
  }
}
