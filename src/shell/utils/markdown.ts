/**
 * Markdown 渲染工具
 *
 * 基于 markdown-it + highlight.js：
 * - 禁用原生 HTML（防 XSS）
 * - 代码块：自动识别语言并语法高亮，加"复制"按钮
 * - 支持 GFM 风格的 table/strikethrough/linkify
 *
 * 流式渲染性能：外部组件应使用 throttle / rAF 合批 update，
 * 不要每个 chunk 都调用 render（markdown-it 每次都会重 parse）。
 */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

// 引入暗色代码主题（与 Shell 深色设计系统风格匹配）
// 使用 atom-one-dark 变体
import 'highlight.js/styles/atom-one-dark.css';

/** 转义 HTML 特殊字符 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const md: MarkdownIt = new MarkdownIt({
  html: false, // 禁用原生 HTML，防 XSS
  xhtmlOut: false,
  breaks: true, // 换行渲染为 <br>
  linkify: true,
  typographer: false,
  highlight: (code, lang) => {
    const langLabel = lang || 'text';
    let highlighted: string;
    if (lang && hljs.getLanguage(lang)) {
      try {
        highlighted = hljs.highlight(code, {
          language: lang,
          ignoreIllegals: true,
        }).value;
      } catch {
        highlighted = escapeHtml(code);
      }
    } else {
      highlighted = escapeHtml(code);
    }
    // 使用 data-code 存原始源码供复制（base64 避免特殊字符嵌入 HTML 属性冲突）
    const encoded = typeof window !== 'undefined'
      ? btoa(unescape(encodeURIComponent(code)))
      : Buffer.from(code, 'utf-8').toString('base64');
    return (
      `<pre class="code-block" data-lang="${escapeHtml(langLabel)}" data-code="${encoded}">` +
      `<div class="code-header">` +
      `<span class="code-lang">${escapeHtml(langLabel)}</span>` +
      `<button class="code-copy" type="button" aria-label="复制代码">复制</button>` +
      `</div>` +
      `<code class="hljs language-${escapeHtml(langLabel)}">${highlighted}</code>` +
      `</pre>`
    );
  },
});

// 让外链在新窗口打开
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (/^https?:/i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** 渲染 Markdown → 安全 HTML 字符串 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  return md.render(text);
}

/**
 * 给 MessageBubble 容器元素绑定代码块复制按钮。
 * 调用时机：Vue 组件在 updated/mounted 时，传入消息内容的根 DOM 节点。
 *
 * 通过事件委托，单个容器只挂一个 click 监听，性能更好。
 */
export function attachCodeCopyHandler(container: HTMLElement): () => void {
  const handler = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('code-copy')) return;
    const pre = target.closest('pre.code-block') as HTMLElement | null;
    if (!pre) return;
    const encoded = pre.getAttribute('data-code') || '';
    let code = '';
    try {
      code = decodeURIComponent(escape(atob(encoded)));
    } catch {
      // fallback：取 <code> 文本
      code = pre.querySelector('code')?.textContent ?? '';
    }
    void navigator.clipboard.writeText(code).then(() => {
      const original = target.textContent;
      target.textContent = '已复制';
      setTimeout(() => {
        target.textContent = original;
      }, 1500);
    });
  };
  container.addEventListener('click', handler);
  return () => container.removeEventListener('click', handler);
}
