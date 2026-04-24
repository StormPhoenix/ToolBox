/**
 * clipboard-ops 工具脚本
 * 读取和写入系统剪贴板
 */
const { clipboard, nativeImage } = require('electron')

/** 剪贴板 HTML 预览截取长度上限 */
const HTML_PREVIEW_LIMIT = 2000

/** 剪贴板文本截取长度上限（约 100KB，防止巨量文本撑爆 token） */
const TEXT_LIMIT = 100000

async function execute(input, context) {
  const toolName = context.toolName

  switch (toolName) {
    case 'read_clipboard': {
      const text = clipboard.readText() || ''
      const html = clipboard.readHTML() || ''
      const image = clipboard.readImage()

      // 判断内容类型
      const hasText = text.trim().length > 0
      const hasHtml = html.trim().length > 0 && html !== text
      const hasImage = image && !image.isEmpty()

      if (!hasText && !hasHtml && !hasImage) {
        return { success: true, type: 'empty', message: '剪贴板为空' }
      }

      const result = {
        success: true,
        type: hasImage ? 'image' : hasHtml ? 'html' : 'text',
      }

      if (hasText) {
        result.text = text.length > TEXT_LIMIT
          ? text.slice(0, TEXT_LIMIT) + '\n...(内容过长已截断)'
          : text
        result.textLength = text.length
      }

      if (hasHtml && html !== text) {
        result.htmlPreview = html.length > HTML_PREVIEW_LIMIT
          ? html.slice(0, HTML_PREVIEW_LIMIT) + '...'
          : html
      }

      if (hasImage) {
        const size = image.getSize()
        const buffer = image.toPNG()
        result.image = {
          width: size.width,
          height: size.height,
          sizeBytes: buffer.length,
          format: 'PNG',
        }
      }

      return result
    }

    case 'write_clipboard': {
      const { text } = input
      if (!text) {
        return { success: false, error: '缺少 text 参数' }
      }
      clipboard.writeText(text)
      return {
        success: true,
        message: '已写入剪贴板',
        length: text.length,
      }
    }

    default:
      return { success: false, error: `未知工具: ${toolName}` }
  }
}

module.exports = { execute }
