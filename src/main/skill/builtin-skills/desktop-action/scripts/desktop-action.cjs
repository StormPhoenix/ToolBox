/**
 * desktop-action 工具脚本
 * 执行桌面操作：打开 URL、打开应用/文件夹
 *
 * 风险级别: DANGEROUS — 执行前需要用户确认
 *
 * 注意：notification 和 open_file_location 已拆分到 safe-desktop 技能
 * - 发送通知 → safe-desktop 的 send_notification
 * - 定位文件 → safe-desktop 的 show_in_explorer
 */
const { shell } = require('electron')
const os = require('os')
const path = require('path')
const fs = require('fs')

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
        console.log(`[desktop-action] 路径自动修正: "${inputPath}" -> "${corrected}"`)
        return corrected
      }
    }
  } else if (macMatch) {
    const givenUser = macMatch[1]
    const subPath = (macMatch[2] || '').replace(/\//g, '\\')
    const realHome = os.homedir()

    const corrected = realHome + subPath
    if (fs.existsSync(corrected) || fs.existsSync(path.dirname(corrected))) {
      console.log(`[desktop-action] 路径自动修正: "${inputPath}" -> "${corrected}"`)
      return corrected
    }
  }

  return inputPath
}

/**
 * 执行单个桌面操作
 */
async function executeOne(action, content) {
  const cleaned = (content || '').trim()
  switch (action) {
    case 'open_url':
      return { success: false, error: 'open_url 已迁移到 safe-desktop 技能的 open_url 工具（SAFE 级别，无需确认），请改用该工具。' }
    case 'open_app': {
      const correctedPath = fixUserPath(cleaned)
      await shell.openPath(correctedPath)
      return { success: true, action: 'open_app', path: correctedPath }
    }
    // 向后兼容：如果 AI 仍然调用旧的 action，给出提示
    case 'notification':
      return { success: false, error: 'notification 已迁移到 safe-desktop 技能的 send_notification 工具，请改用该工具。' }
    case 'open_file_location':
      return { success: false, error: 'open_file_location 已迁移到 safe-desktop 技能的 show_in_explorer 工具，请改用该工具。' }
    default:
      return { success: false, error: `不支持的操作类型: ${action}` }
  }
}

async function execute(input, context) {
  // 批量模式：actions 数组
  if (Array.isArray(input.actions) && input.actions.length > 0) {
    const results = []
    for (const item of input.actions) {
      const result = await executeOne(item.action, item.content)
      results.push(result)
    }
    return {
      success: results.every(r => r.success),
      mode: 'batch',
      count: results.length,
      results,
    }
  }

  // 单操作模式
  return executeOne(input.action, input.content)
}

module.exports = { execute }
