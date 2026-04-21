/**
 * ToolBox 统一日志工具 — 渲染进程版（Shell & 插件通用）
 *
 * - Shell 侧：通过 window.electronAPI.log() IPC 转发到主进程写文件
 * - 插件侧：webview 内 preload 已注入，同样直接调用 window.electronAPI.log()
 *
 * 用法（插件）：
 *   import { createLogger } from '@toolbox/bridge'
 *   const log = createLogger('PdfEditor')
 *   log.info('插件已加载')
 *   log.debug('调试信息')   // 仅开发模式输出，生产模式完全静默
 */

import type { ElectronAPI } from './types'

// ── Logger 接口（与主进程版保持一致） ─────────────────────────────────────

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

/** 获取运行时注入的 electronAPI（延迟求值，避免模块初始化时 window 尚未就绪） */
function getAPI(): ElectronAPI | undefined {
  return (window as Window & { electronAPI?: ElectronAPI }).electronAPI
}

/**
 * 创建带模块标签的日志实例
 *
 * @param tag 模块标签，如 'PdfEditor'、'Welcome'
 */
export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`
  const debugPrefix = `[${tag}][Debug]`

  return {
    info: (...args: unknown[]) => {
      console.log(prefix, ...args)
      getAPI()?.log('info', tag, formatArgs(args)).catch(() => { /* 静默 */ })
    },
    warn: (...args: unknown[]) => {
      console.warn(prefix, ...args)
      getAPI()?.log('warn', tag, formatArgs(args)).catch(() => { /* 静默 */ })
    },
    error: (...args: unknown[]) => {
      console.error(prefix, ...args)
      getAPI()?.log('error', tag, formatArgs(args)).catch(() => { /* 静默 */ })
    },
    debug: (...args: unknown[]) => {
      if (!isDev) return
      console.log(debugPrefix, ...args)
      // debug 不写文件，不转发 IPC
    },
  }
}
