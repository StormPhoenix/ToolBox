/**
 * run-script 工具脚本
 * 执行 AI 生成的 Node.js 脚本或 Shell 命令
 *
 * 风险级别: DANGEROUS — 执行前需要用户确认
 *
 * 执行策略：
 * - JavaScript: 写入临时文件 → child_process.fork() 在独立子进程执行
 * - Shell: child_process.exec() 异步执行（Windows 使用 cmd, macOS/Linux 使用 sh）
 * - 所有执行均有超时保护（默认 6 分钟，最大 10 分钟）
 * - stdout/stderr 会被捕获并返回给 AI 用于生成回复
 */
const { fork, exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

/** 超时限制 */
const DEFAULT_TIMEOUT = 360000
const MAX_TIMEOUT = 600000

/** stdout/stderr 最大捕获长度（防止内存溢出） */
const MAX_OUTPUT_LENGTH = 50000

/**
 * exec 的 maxBuffer 限制（字节）
 * 必须大于 MAX_OUTPUT_LENGTH，否则 exec 会在截断逻辑生效前就 kill 子进程。
 * 设为 5MB，确保 base64 图片数据等大输出也能正常接收。
 */
const EXEC_MAX_BUFFER = 5 * 1024 * 1024

async function execute(input, context) {
  const { language, code, description } = input
  let timeout = input.timeout || DEFAULT_TIMEOUT

  // 校验参数
  if (!language || !code || !description) {
    return {
      success: false,
      error: '缺少必填参数：language, code, description 均为必填',
    }
  }

  if (!['javascript', 'shell'].includes(language)) {
    return {
      success: false,
      error: `不支持的脚本语言: ${language}，仅支持 javascript 和 shell`,
    }
  }

  // 限制超时范围
  timeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT)

  console.log(
    `[Skill:run_script] 执行 ${language} 脚本 (超时: ${timeout}ms)\n` +
      `[Skill:run_script] 描述: ${description}`
  )

  try {
    if (language === 'javascript') {
      return await executeJavaScript(code, timeout)
    } else {
      return await executeShell(code, timeout)
    }
  } catch (err) {
    console.error(`[Skill:run_script] 执行异常:`, err)
    return {
      success: false,
      error: `脚本执行异常: ${err.message}`,
    }
  }
}

/**
 * 执行 Node.js 脚本
 * 策略：写入临时文件 → fork 子进程执行 → 捕获输出 → 清理临时文件
 */
function executeJavaScript(code, timeout) {
  return new Promise((resolve) => {
    // 生成临时文件路径
    const tmpDir = os.tmpdir()
    const tmpFile = path.join(tmpDir, `clawpet-script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.js`)

    try {
      fs.writeFileSync(tmpFile, code, 'utf-8')
    } catch (err) {
      resolve({
        success: false,
        error: `无法写入临时脚本文件: ${err.message}`,
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let finished = false

    const child = fork(tmpFile, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      timeout: timeout,
      // 不继承父进程的 env 中可能存在的敏感变量
      env: {
        ...process.env,
        NODE_ENV: 'clawpet-script',
      },
    })

    const cleanup = () => {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // 忽略清理失败
      }
    }

    const finish = (result) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(result)
    }

    // 设置额外超时保护（fork 的 timeout 可能不可靠）
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
        // 给进程 2 秒优雅退出
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch {}
        }, 2000)
      } catch {}
      finish({
        success: false,
        error: `脚本执行超时（${timeout / 1000}秒）`,
        output: truncateOutput(stdout),
      })
    }, timeout + 1000) // 额外 1 秒缓冲

    child.stdout.on('data', (data) => {
      stdout += data.toString()
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n... [输出过长，已截断]'
      }
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
      if (stderr.length > MAX_OUTPUT_LENGTH) {
        stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n... [错误输出过长，已截断]'
      }
    })

    child.on('exit', (exitCode, signal) => {
      clearTimeout(timer)

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        finish({
          success: false,
          error: `脚本被终止（信号: ${signal}）`,
          output: truncateOutput(stdout),
        })
        return
      }

      if (exitCode === 0) {
        finish({
          success: true,
          output: stdout.trimEnd() || '脚本执行完成，无输出',
        })
      } else {
        finish({
          success: false,
          exitCode: exitCode,
          error: stderr || `脚本退出码: ${exitCode}`,
          output: truncateOutput(stdout),
        })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      finish({
        success: false,
        error: `子进程启动失败: ${err.message}`,
      })
    })
  })
}

/**
 * 执行 Shell 命令（异步，不阻塞主进程事件循环）
 * Windows 使用 cmd /c，macOS/Linux 使用 sh -c
 */
function executeShell(code, timeout) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32'
    const shellOptions = {
      timeout: timeout,
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: EXEC_MAX_BUFFER,
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
    }

    const child = exec(code, shellOptions, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          resolve({
            success: false,
            error: `命令执行超时（${timeout / 1000}秒）`,
            output: truncateOutput(stdout),
          })
          return
        }
        resolve({
          success: false,
          exitCode: err.code,
          error: truncateOutput(stderr) || err.message,
          output: truncateOutput(stdout),
        })
        return
      }

      resolve({
        success: true,
        output: truncateOutput(stdout).trimEnd() || '命令执行完成，无输出',
      })
    })
  })
}

/**
 * 截断过长的输出
 */
function truncateOutput(text) {
  if (!text) return ''
  const str = String(text)
  if (str.length > MAX_OUTPUT_LENGTH) {
    return str.slice(0, MAX_OUTPUT_LENGTH) + '\n... [输出过长，已截断]'
  }
  return str
}

module.exports = { execute }
