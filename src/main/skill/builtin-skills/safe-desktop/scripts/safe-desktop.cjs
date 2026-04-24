/**
 * safe-desktop 工具脚本
 * 安全的桌面操作：打开网页链接、系统通知、文件管理器定位
 *
 * 风险级别: SAFE — 纯展示操作或安全的外部链接打开，无需用户确认
 */
const { Notification, shell, app } = require('electron')
const os = require('os')
const path = require('path')
const fs = require('fs')

// 应用图标路径（用于系统通知）。
// 找不到图标文件时返回 undefined，Notification 会使用系统默认图标。
function resolveAppIconPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icons', 'icon.png'),
        path.join(process.resourcesPath, 'build', 'icon.ico'),
      ]
    : [
        path.join(process.env.APP_ROOT || '', 'build', 'icon.ico'),
        path.join(process.env.APP_ROOT || '', 'resources', 'icons', 'icon.png'),
      ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch { /* ignore */ }
  }
  return undefined
}
const appIconPath = resolveAppIconPath()

/**
 * 等待 Explorer 窗口出现，找到后将其拉到前台。
 *
 * 解决 Windows 11 22H2+ 的已知问题：shell.showItemInFolder / shell.openPath
 * 打开的 Explorer 窗口可能在后台（Electron 窗口后面），用户看起来就是"没反应"。
 *
 * 原理：用 FindWindowEx 轮询 CabinetWClass 窗口，一旦出现就用
 * SetForegroundWindow + BringWindowToTop 拉到前台。
 *
 * @param {string} label - 日志标签，如 'show_in_explorer' 或 'open_directory'
 * @returns {Promise<boolean>} 是否成功找到并前置了窗口
 */
const PS_FOCUS_EXPLORER = `
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Diagnostics;using System.Collections.Generic;
public class EW{
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr c,string cls,string t);
  [DllImport("user32.dll")][return:MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")][return:MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")][return:MarshalAs(UnmanagedType.Bool)] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
  public static string WaitAndFocus(int maxMs,int interval){
    var sw=Stopwatch.StartNew();
    IntPtr found=IntPtr.Zero;
    while(sw.ElapsedMilliseconds<maxMs){
      IntPtr h=FindWindowEx(IntPtr.Zero,IntPtr.Zero,"CabinetWClass",null);
      while(h!=IntPtr.Zero){
        if(IsWindowVisible(h)){found=h;break;}
        h=FindWindowEx(IntPtr.Zero,h,"CabinetWClass",null);
      }
      if(found!=IntPtr.Zero) break;
      System.Threading.Thread.Sleep(interval);
    }
    if(found==IntPtr.Zero) return "TIMEOUT:"+sw.ElapsedMilliseconds;
    ShowWindow(found,9);
    SetForegroundWindow(found);
    BringWindowToTop(found);
    return "OK:"+sw.ElapsedMilliseconds;
  }
}
"@
[EW]::WaitAndFocus(5000,200)`

async function waitAndFocusExplorerWindow(label, runPs) {
  // 未注入 runPowerShell（ToolBox 精简版 SkillContext 不提供此字段），
  // 直接跳过 Windows 窗口前置逻辑，不影响核心"打开目录/定位文件"功能。
  if (typeof runPs !== 'function') {
    return false
  }
  const startTime = Date.now()
  try {
    const result = await runPs(PS_FOCUS_EXPLORER, { timeout: 8000 })

    if (typeof result === 'string' && result.startsWith('OK:')) {
      const waitMs = result.substring(3)
      console.log(`[safe-desktop] ${label}: Explorer 窗口已就绪并拉到前台 (等待了 ${waitMs}ms)`)
      await new Promise(r => setTimeout(r, 300))
      return true
    } else {
      console.log(`[safe-desktop] ${label}: Explorer 窗口等待超时 (${Date.now() - startTime}ms)`)
      return false
    }
  } catch (e) {
    console.log(`[safe-desktop] ${label}: 窗口检测失败: ${e.message}`)
    return false
  }
}

/**
 * 修正 AI 可能编造的错误用户目录路径。
 * 例如 AI 把用户昵称当作 Windows 用户名，生成了 C:\Users\蒸蚌\Downloads，
 * 但实际的 homedir 是 C:\Users\zhiruili。
 * 此函数检测这种情况并自动修正。
 *
 * 也处理 AI 产生的 macOS 风格路径（/Users/xxx/...），在 Windows 上自动转换。
 */
function fixUserPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return inputPath

  // 先清理首尾空白和换行符（AI 可能从 run_script 输出中复制了末尾的 \n）
  inputPath = inputPath.trim()

  // 检测 Windows 用户目录模式: C:\Users\xxx\... 或 /Users/xxx/...
  const winMatch = inputPath.match(/^([A-Za-z]):\\Users\\([^\\]+)(\\.*)?$/)
  const macMatch = inputPath.match(/^\/Users\/([^/]+)(\/.*)?$/)

  if (winMatch) {
    const drive = winMatch[1]
    const givenUser = winMatch[2]
    const subPath = winMatch[3] || ''
    const realHome = os.homedir()

    // 如果给定路径不存在，但替换为真实 homedir 后存在，则修正
    if (!fs.existsSync(inputPath)) {
      const corrected = realHome + subPath
      if (fs.existsSync(corrected) || fs.existsSync(path.dirname(corrected))) {
        console.log(`[safe-desktop] 路径自动修正: "${inputPath}" -> "${corrected}"`)
        return corrected
      }
    }
  } else if (macMatch) {
    const givenUser = macMatch[1]
    const subPath = (macMatch[2] || '').replace(/\//g, '\\')
    const realHome = os.homedir()

    const corrected = realHome + subPath
    if (fs.existsSync(corrected) || fs.existsSync(path.dirname(corrected))) {
      console.log(`[safe-desktop] 路径自动修正: "${inputPath}" -> "${corrected}"`)
      return corrected
    }
  }

  return inputPath
}

const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^\[::1\]/,
]

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

async function execute(input, context) {
  const toolName = context.toolName
  const runPs = context.runPowerShell

  switch (toolName) {
    case 'open_url': {
      const url = (input.url || '').trim()
      if (!url) {
        return { success: false, error: '缺少 url 参数' }
      }
      const validation = validateUrl(url)
      if (!validation.ok) {
        return { success: false, error: validation.error }
      }
      await shell.openExternal(url)
      console.log(`[safe-desktop] 已打开 URL: "${url}"`)
      return { success: true, tool: 'open_url', url }
    }

    case 'send_notification': {
      const { title, content } = input
      new Notification({
        title: title || 'ToolBox',
        body: (content || '').trim(),
        icon: appIconPath,
      }).show()
      return { success: true, tool: 'send_notification' }
    }

    case 'open_directory': {
      const dirPath = (input.path || '').trim()
      if (!dirPath) {
        return { success: false, error: '缺少 path 参数' }
      }

      const correctedDir = fixUserPath(dirPath)
      const winDir = correctedDir.replace(/\//g, '\\')

      try {
        const stat = fs.statSync(winDir)
        if (!stat.isDirectory()) {
          return { success: false, error: `路径不是目录: "${winDir}"。如果要定位文件，请使用 show_in_explorer。` }
        }
      } catch (e) {
        return { success: false, error: `目录不存在: "${winDir}"` }
      }

      const result = await shell.openPath(winDir)
      if (result) {
        return { success: false, error: `打开目录失败: ${result}` }
      }
      console.log(`[safe-desktop] 已打开目录: "${winDir}"`)

      const windowFound = await waitAndFocusExplorerWindow('open_directory', runPs)

      return { success: true, tool: 'open_directory', path: winDir, windowReady: windowFound }
    }

    case 'show_in_explorer': {
      if (process.platform !== 'win32') {
        return { success: false, error: 'show_in_explorer 仅支持 Windows 平台' }
      }

      const inputPath = (input.path || '').trim()
      if (!inputPath) {
        return { success: false, error: '缺少 path 参数' }
      }

      const correctedFilePath = fixUserPath(inputPath)
      const winPath = correctedFilePath.replace(/\//g, '\\')

      shell.showItemInFolder(winPath)
      console.log(`[safe-desktop] 已调用 shell.showItemInFolder: "${winPath}"`)

      const windowFound = await waitAndFocusExplorerWindow('show_in_explorer', runPs)

      return { success: true, tool: 'show_in_explorer', path: winPath, windowReady: windowFound }
    }

    case 'reveal_path': {
      const inputPath = (input.path || '').trim()
      if (!inputPath) {
        return { success: false, error: '缺少 path 参数' }
      }

      const corrected = fixUserPath(inputPath)
      const winPath = corrected.replace(/\//g, '\\')

      let stat
      try {
        stat = fs.statSync(winPath)
      } catch {
        return { success: false, error: `路径不存在: "${winPath}"` }
      }

      if (stat.isDirectory()) {
        // 目录 → 等效 open_directory
        const result = await shell.openPath(winPath)
        if (result) {
          return { success: false, error: `打开目录失败: ${result}` }
        }
        console.log(`[safe-desktop] reveal_path(目录): "${winPath}"`)
        const windowFound = await waitAndFocusExplorerWindow('reveal_path', runPs)
        return { success: true, tool: 'reveal_path', type: 'directory', path: winPath, windowReady: windowFound }
      } else {
        // 文件 → 等效 show_in_explorer
        if (process.platform !== 'win32') {
          return { success: false, error: 'reveal_path(文件) 仅支持 Windows 平台' }
        }
        shell.showItemInFolder(winPath)
        console.log(`[safe-desktop] reveal_path(文件): "${winPath}"`)
        const windowFound = await waitAndFocusExplorerWindow('reveal_path', runPs)
        return { success: true, tool: 'reveal_path', type: 'file', path: winPath, windowReady: windowFound }
      }
    }

    default:
      return { error: `不支持的工具: ${toolName}` }
  }
}

module.exports = { execute }
