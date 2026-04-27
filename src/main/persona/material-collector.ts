/**
 * MaterialCollector — URL 抓取与文本清洗
 *
 * persona:fetch-url IPC 的主进程实现。
 * 使用 Electron net.fetch 抓取 URL，提取可读文本，
 * 结果直接返回给 Shell 侧作为材料内容。
 *
 * 限制：
 * - 超时 30s
 * - 响应体上限 2MB（防止超大页面撑爆内存）
 * - 仅处理 text/* 和 application/json MIME
 */
import { net } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('MaterialCollector');

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// ─── HTML 文本提取 ────────────────────────────────────────────

/** 从 HTML 字符串中提取可读文本（简单标签剥离） */
function extractTextFromHtml(html: string): string {
  return html
    // 移除 <script> 和 <style> 块（含内容）
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 移除 HTML 注释
    .replace(/<!--[\s\S]*?-->/g, '')
    // 块级标签转换为换行
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre)[^>]*>/gi, '\n')
    // 移除剩余所有标签
    .replace(/<[^>]+>/g, '')
    // 解码常见 HTML 实体
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // 清理多余空白行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── 公开 API ────────────────────────────────────────────────

/**
 * 抓取 URL 返回可读文本。
 * 支持 text/html、text/plain、text/markdown、application/json 等文本 MIME。
 */
export async function fetchUrlContent(url: string): Promise<string> {
  log.info(`抓取 URL: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await net.fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ToolBox/1.0; +https://toolbox.app)',
        Accept: 'text/html,text/plain,text/markdown,application/json,*/*',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message ?? String(err);
    if (msg.includes('abort') || msg.includes('AbortError')) {
      throw new Error(`抓取超时（${FETCH_TIMEOUT_MS / 1000}s）: ${url}`);
    }
    throw new Error(`网络请求失败: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isText =
    contentType.includes('text/') ||
    contentType.includes('application/json') ||
    contentType.includes('application/xml');

  if (!isText) {
    throw new Error(`不支持的内容类型 "${contentType}"，仅支持文本类型: ${url}`);
  }

  // 限制读取大小
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    log.warn(`响应体过大 (${(buffer.byteLength / 1024).toFixed(0)} KB)，截断至 ${MAX_BYTES / 1024} KB`);
  }
  const truncated = buffer.slice(0, MAX_BYTES);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(truncated);

  const isHtml = contentType.includes('text/html') || text.trimStart().startsWith('<!');
  const result = isHtml ? extractTextFromHtml(text) : text.trim();

  if (!result) {
    throw new Error(`URL 内容为空或无法提取文本: ${url}`);
  }

  log.info(`抓取完成: ${url} (${result.length} 字符)`);
  return result;
}
