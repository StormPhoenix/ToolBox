/**
 * system-info 工具脚本
 * 查询系统时间、日期、操作系统和内存信息
 */
const os = require('os')

async function execute(input, context) {
  const { query } = input

  switch (query) {
    case 'time':
      return { time: new Date().toLocaleTimeString('zh-CN') }
    case 'date':
      return {
        date: new Date().toLocaleDateString('zh-CN'),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()],
      }
    case 'os':
      return {
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
      }
    case 'memory':
      return {
        totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
        freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`,
        appMemory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      }
    case 'all':
      return {
        time: new Date().toLocaleTimeString('zh-CN'),
        date: new Date().toLocaleDateString('zh-CN'),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()],
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
        freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`,
        appMemory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      }
    default:
      return { error: `不支持的查询类型: ${query}` }
  }
}

module.exports = { execute }
