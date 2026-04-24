/**
 * file-write 工具脚本
 * 安全的文件操作：创建文件、写入文本、复制、移动、创建目录、删除到回收站、批量操作
 *
 * 风险级别: MODERATE
 *
 * 安全限制：
 * - 所有路径必须在用户主目录下
 * - 写入内容不超过 1MB
 * - 禁止操作系统目录
 * - 删除操作移入回收站（不是永久删除）
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { shell } = require('electron')

const MAX_WRITE_SIZE = 1024 * 1024 // 1MB

const SYSTEM_DIR_PATTERNS = [
  /^[A-Za-z]:\\Windows/i,
  /^[A-Za-z]:\\Program Files/i,
  /^[A-Za-z]:\\Program Files \(x86\)/i,
  /^[A-Za-z]:\\ProgramData/i,
  /^[A-Za-z]:\\Recovery/i,
  /^[A-Za-z]:\\System Volume Information/i,
  /^[A-Za-z]:\\Boot/i,
  /^\/usr/,
  /^\/bin/,
  /^\/sbin/,
  /^\/etc/,
  /^\/var/,
  /^\/sys/,
  /^\/proc/,
  /^\/boot/,
]

function fixUserPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return inputPath
  inputPath = inputPath.trim()

  const winMatch = inputPath.match(/^([A-Za-z]):\\Users\\([^\\]+)(\\.*)?$/)
  const macMatch = inputPath.match(/^\/Users\/([^/]+)(\/.*)?$/)

  if (winMatch) {
    const subPath = winMatch[3] || ''
    const realHome = os.homedir()
    if (!fs.existsSync(inputPath)) {
      const corrected = realHome + subPath
      if (fs.existsSync(path.dirname(corrected))) {
        console.log(`[file-write] 路径自动修正: "${inputPath}" -> "${corrected}"`)
        return corrected
      }
    }
  } else if (macMatch) {
    const subPath = (macMatch[2] || '').replace(/\//g, '\\')
    const realHome = os.homedir()
    const corrected = realHome + subPath
    if (fs.existsSync(path.dirname(corrected))) {
      console.log(`[file-write] 路径自动修正: "${inputPath}" -> "${corrected}"`)
      return corrected
    }
  }

  return inputPath
}

function validatePath(filePath) {
  const normalized = path.resolve(filePath)
  const home = os.homedir()

  for (const pattern of SYSTEM_DIR_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ok: false, error: `禁止操作系统目录: "${normalized}"` }
    }
  }

  if (!normalized.startsWith(home)) {
    return { ok: false, error: `路径不在用户目录下: "${normalized}"（用户目录: ${home}）` }
  }

  return { ok: true, path: normalized }
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

/**
 * 执行单个文件操作（供 switch/case 和 batch 共用）
 */
async function executeOne(toolName, input) {
  switch (toolName) {
    case 'create_text_file': {
      const filePath = fixUserPath((input.path || '').trim())
      const content = input.content ?? ''
      const encoding = input.encoding || 'utf-8'
      const overwrite = input.overwrite === true

      if (!filePath) return { success: false, error: '缺少 path 参数' }

      const v = validatePath(filePath)
      if (!v.ok) return { success: false, error: v.error }

      if (Buffer.byteLength(content, encoding) > MAX_WRITE_SIZE) {
        return { success: false, error: '内容超过 1MB 大小限制' }
      }

      if (fs.existsSync(v.path) && !overwrite) {
        return { success: false, error: `文件已存在: "${v.path}"。如需覆盖请传 overwrite=true` }
      }

      const dir = path.dirname(v.path)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(v.path, content, encoding)
      const stat = fs.statSync(v.path)
      console.log(`[file-write] 创建文件: "${v.path}" (${stat.size} bytes)`)

      return { success: true, tool: 'create_text_file', path: v.path, size: stat.size }
    }

    case 'write_text_file': {
      const filePath = fixUserPath((input.path || '').trim())
      const content = input.content ?? ''
      const mode = input.mode || 'overwrite'
      const encoding = input.encoding || 'utf-8'

      if (!filePath) return { success: false, error: '缺少 path 参数' }

      const v = validatePath(filePath)
      if (!v.ok) return { success: false, error: v.error }

      if (Buffer.byteLength(content, encoding) > MAX_WRITE_SIZE) {
        return { success: false, error: '内容超过 1MB 大小限制' }
      }

      if (!fs.existsSync(v.path)) {
        return { success: false, error: `文件不存在: "${v.path}"。如需创建新文件请用 create_text_file` }
      }

      if (mode === 'append') {
        fs.appendFileSync(v.path, content, encoding)
        console.log(`[file-write] 追加内容到: "${v.path}"`)
      } else {
        fs.writeFileSync(v.path, content, encoding)
        console.log(`[file-write] 覆盖写入: "${v.path}"`)
      }

      const stat = fs.statSync(v.path)
      return { success: true, tool: 'write_text_file', path: v.path, mode, size: stat.size }
    }

    case 'copy_file': {
      const source = fixUserPath((input.source || '').trim())
      const destination = fixUserPath((input.destination || '').trim())
      const overwrite = input.overwrite === true

      if (!source) return { success: false, error: '缺少 source 参数' }
      if (!destination) return { success: false, error: '缺少 destination 参数' }

      const vs = validatePath(source)
      if (!vs.ok) return { success: false, error: `源路径: ${vs.error}` }

      const vd = validatePath(destination)
      if (!vd.ok) return { success: false, error: `目标路径: ${vd.error}` }

      if (!fs.existsSync(vs.path)) {
        return { success: false, error: `源文件不存在: "${vs.path}"` }
      }

      if (fs.existsSync(vd.path) && !overwrite) {
        return { success: false, error: `目标已存在: "${vd.path}"。如需覆盖请传 overwrite=true` }
      }

      const destDir = path.dirname(vd.path)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }

      const srcStat = fs.statSync(vs.path)
      if (srcStat.isDirectory()) {
        copyRecursive(vs.path, vd.path)
        console.log(`[file-write] 复制目录: "${vs.path}" -> "${vd.path}"`)
      } else {
        fs.copyFileSync(vs.path, vd.path)
        console.log(`[file-write] 复制文件: "${vs.path}" -> "${vd.path}" (${srcStat.size} bytes)`)
      }

      return { success: true, tool: 'copy_file', source: vs.path, destination: vd.path, isDirectory: srcStat.isDirectory() }
    }

    case 'move_file': {
      const source = fixUserPath((input.source || '').trim())
      const destination = fixUserPath((input.destination || '').trim())
      const overwrite = input.overwrite === true

      if (!source) return { success: false, error: '缺少 source 参数' }
      if (!destination) return { success: false, error: '缺少 destination 参数' }

      const vs = validatePath(source)
      if (!vs.ok) return { success: false, error: `源路径: ${vs.error}` }

      const vd = validatePath(destination)
      if (!vd.ok) return { success: false, error: `目标路径: ${vd.error}` }

      if (!fs.existsSync(vs.path)) {
        return { success: false, error: `源文件不存在: "${vs.path}"` }
      }

      if (fs.existsSync(vd.path) && !overwrite) {
        return { success: false, error: `目标已存在: "${vd.path}"。如需覆盖请传 overwrite=true` }
      }

      const destDir = path.dirname(vd.path)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }

      fs.renameSync(vs.path, vd.path)
      console.log(`[file-write] 移动: "${vs.path}" -> "${vd.path}"`)

      return { success: true, tool: 'move_file', source: vs.path, destination: vd.path }
    }

    case 'create_directory': {
      const dirPath = fixUserPath((input.path || '').trim())
      if (!dirPath) return { success: false, error: '缺少 path 参数' }

      const v = validatePath(dirPath)
      if (!v.ok) return { success: false, error: v.error }

      if (fs.existsSync(v.path)) {
        const stat = fs.statSync(v.path)
        if (stat.isDirectory()) {
          return { success: true, tool: 'create_directory', path: v.path, alreadyExists: true }
        }
        return { success: false, error: `路径已存在且不是目录: "${v.path}"` }
      }

      fs.mkdirSync(v.path, { recursive: true })
      console.log(`[file-write] 创建目录: "${v.path}"`)

      return { success: true, tool: 'create_directory', path: v.path, alreadyExists: false }
    }

    case 'delete_file': {
      const filePath = fixUserPath((input.path || '').trim())
      if (!filePath) return { success: false, error: '缺少 path 参数' }

      const v = validatePath(filePath)
      if (!v.ok) return { success: false, error: v.error }

      if (!fs.existsSync(v.path)) {
        return { success: false, error: `文件不存在: "${v.path}"` }
      }

      await shell.trashItem(v.path)
      console.log(`[file-write] 已移入回收站: "${v.path}"`)

      return { success: true, tool: 'delete_file', path: v.path, movedToTrash: true }
    }

    default:
      return { success: false, error: `不支持的工具: ${toolName}` }
  }
}

async function execute(input, context) {
  const toolName = context.toolName

  if (toolName === 'batch_file_ops') {
    // 健壮解析：兼容 LLM 可能的多种传参格式
    let actions = input.actions

    // Fallback 1: LLM 可能把 actions 序列化为 JSON 字符串
    if (typeof actions === 'string') {
      try {
        actions = JSON.parse(actions)
      } catch {
        // 解析失败，继续走后面的错误分支
      }
    }

    // Fallback 2: LLM 可能用了 operations 等别名字段
    if (!Array.isArray(actions)) {
      actions = input.operations || input.ops || input.items
    }

    // Fallback 3: LLM 可能直接传了顶层的 tool/path 等字段（当作单操作）
    if (!Array.isArray(actions) && input.tool && typeof input.tool === 'string') {
      actions = [input]
    }

    if (!Array.isArray(actions) || actions.length === 0) {
      // 错误信息中包含正确格式示例，帮助 LLM 纠正
      return {
        success: false,
        error: '缺少 actions 参数或为空数组。正确格式: { "actions": [{ "tool": "create_directory", "path": "..." }, { "tool": "move_file", "source": "...", "destination": "..." }] }',
      }
    }

    const results = []
    for (const action of actions) {
      const tool = action.tool
      if (!tool) {
        results.push({ success: false, error: '缺少 tool 字段' })
        continue
      }
      try {
        const result = await executeOne(tool, action)
        results.push(result)
      } catch (err) {
        results.push({ success: false, tool, error: err.message })
      }
    }

    const successCount = results.filter((r) => r.success).length
    console.log(`[file-write] 批量操作完成: ${successCount}/${results.length} 成功`)

    return {
      success: results.every((r) => r.success),
      tool: 'batch_file_ops',
      mode: 'batch',
      count: results.length,
      successCount,
      results,
    }
  }

  return executeOne(toolName, input)
}

module.exports = { execute }
