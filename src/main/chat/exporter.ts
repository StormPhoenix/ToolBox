/**
 * Chat 消息合并导出
 *
 * 输入：sessionId + 选中的 messageIds
 * 输出：
 *   - 在用户指定 .md 路径同级建立 <stem>/ 子目录
 *   - 子目录内生成 <stem>.md 主文件 + images/ 图片副本
 *
 * Markdown 格式策略：
 *   - 每条消息独立 section，以 `---` 分隔
 *   - user 消息 → 纯段落（保留硬换行，使用行尾两空格）
 *   - assistant 消息 → 原样嵌入其 markdown 文本
 *   - 图片 → 相对路径 `images/<hash>.<ext>`，未知 ref 降级为文本占位
 *   - 元信息（导出时间/模型/消息数）默认放在文件头部
 *
 * 主进程按时间顺序重排 ids，避免用户点选顺序与叙事顺序不一致。
 *
 * 注意：单条复制由渲染进程直接走 navigator.clipboard 处理，
 * 这里只服务"保存到文件"这一路径。
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ChatMessage, ChatSession, PersistedContentBlock } from './types';
import type { LLMImageRefBlock, SupportedMediaType } from './image-cache';
import * as store from './session-store';
import { createLogger } from '../logger';

const log = createLogger('ChatExporter');

// ── 入参/出参 ────────────────────────────────────────────────────────

export interface ChatExportInput {
  sessionId: string;
  messageIds: string[];
  /** 用户在 showSaveDialog 中选定的 .md 目标路径 */
  targetPath: string;
  /** 是否在文件头部写入导出时间/模型/消息数，默认 true */
  includeMetadata?: boolean;
}

export interface ChatExportResult {
  /** 最终 .md 文件的绝对路径（位于新建子目录中） */
  filePath: string;
  /** 所在子目录绝对路径（供"打开文件夹"跳转） */
  dirPath: string;
  /** 实际写入消息数（按时间序重排后） */
  messageCount: number;
  /** 成功复制的图片数 */
  imageCount: number;
  /** 缓存丢失跳过的图片数 */
  skippedImageCount: number;
}

// ── 工具 ─────────────────────────────────────────────────────────────

function mediaTypeToExt(mt: SupportedMediaType): 'png' | 'jpg' | 'gif' | 'webp' {
  switch (mt) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
  }
}

function isImageRef(b: unknown): b is LLMImageRefBlock {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type: string }).type === 'image_ref'
  );
}

function isTextBlock(b: unknown): b is { type: 'text'; text: string } {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type: string }).type === 'text'
  );
}

/**
 * 抽取一条消息的纯文本（用于 user 段落拼接 / 复制到剪贴板占位等）。
 * 不含图片信息；图片部分由调用方另行处理。
 */
export function extractText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join('\n');
}

/**
 * 把 user 纯文本转为 markdown 段落。
 *
 * - 连续空行正常分段
 * - 段内硬换行用行尾两空格 + LF 保留（typora / obsidian 兼容）
 * - 不包代码围栏，直接作为普通段落，避免与 assistant 代码块混淆
 */
function userTextToMarkdown(text: string): string {
  if (!text.trim()) return '';
  // 规范化换行
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 段落以空行分隔；段内换行加两空格保留
  return norm
    .split(/\n{2,}/)
    .map((para) => para.split('\n').join('  \n'))
    .join('\n\n');
}

/** 将非法文件名字符替换为 `_` 并截断到 80 字符 */
export function sanitizeFileStem(raw: string): string {
  const trimmed = (raw || '').trim();
  // eslint-disable-next-line no-control-regex
  const replaced = trimmed.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  const collapsed = replaced.replace(/_{2,}/g, '_');
  const limited = collapsed.slice(0, 80);
  return limited || 'chat-export';
}

/** 格式化时间戳为 `YYYY-MM-DD HH:mm`（本地时区） */
function formatLocalTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** 角色标题：🧑 你 / 🤖 助手 */
function roleHeading(role: ChatMessage['role'], timestamp: number): string {
  const who = role === 'user' ? '🧑 你' : '🤖 助手';
  return `### ${who} · ${formatLocalTime(timestamp)}`;
}

// ── 核心 ─────────────────────────────────────────────────────────────

/**
 * 执行导出。
 *
 * 流程：
 * 1. 加载会话、按时间序筛出选中消息
 * 2. 在 targetPath 同级建立 <stem>/ 子目录
 * 3. 拷贝所有引用图片到 <dir>/images/<hash>.<ext>（已存在则跳过）
 * 4. 生成 markdown 文本写入 <dir>/<stem>.md
 */
export async function exportSelectedMessages(
  input: ChatExportInput
): Promise<ChatExportResult> {
  const session = await store.loadSession(input.sessionId);
  if (!session) throw new Error(`会话不存在：${input.sessionId}`);

  const idSet = new Set(input.messageIds);
  // 按时间序重排（忽略用户点选顺序）
  const selected = session.messages.filter((m) => idSet.has(m.id));
  if (selected.length === 0) {
    throw new Error('未匹配到任何选中的消息');
  }

  // 解析目标路径，拆成 <dirParent>/<stem>/<stem>.md
  const parsed = path.parse(input.targetPath);
  // showSaveDialog 默认已带 .md；即便用户改了扩展名也统一按 .md 处理
  const rawStem = parsed.name || 'chat-export';
  const stem = sanitizeFileStem(rawStem);
  const dirPath = path.join(parsed.dir, stem);
  const imagesDir = path.join(dirPath, 'images');
  const mdPath = path.join(dirPath, `${stem}.md`);

  await fs.mkdir(imagesDir, { recursive: true });

  // 先复制图片，同时建 hash → 相对路径 映射
  let imageCount = 0;
  let skippedImageCount = 0;
  const hashToRelPath = new Map<string, string>();

  for (const msg of selected) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (!isImageRef(block)) continue;
      const ext = mediaTypeToExt(block.mediaType);
      const fileName = `${block.hash}.${ext}`;
      const dest = path.join(imagesDir, fileName);
      if (hashToRelPath.has(block.hash)) continue;

      try {
        // 已存在直接复用（hash 内容一致）
        try {
          await fs.access(dest);
        } catch {
          await fs.copyFile(block.cachePath, dest);
        }
        hashToRelPath.set(block.hash, `./images/${fileName}`);
        imageCount++;
      } catch (err) {
        log.warn(
          `copy image failed hash=${block.hash} src=${block.cachePath}: ${(err as Error).message}`
        );
        skippedImageCount++;
      }
    }
  }

  // 序列化 markdown
  const md = buildMarkdown(session, selected, {
    includeMetadata: input.includeMetadata !== false,
    hashToRelPath,
  });

  await fs.writeFile(mdPath, md, 'utf-8');

  log.info(
    `exportSelectedMessages 完成: sessionId=${session.id}, ` +
      `msgs=${selected.length}, images=${imageCount}, skipped=${skippedImageCount}, ` +
      `file=${mdPath}`
  );

  return {
    filePath: mdPath,
    dirPath,
    messageCount: selected.length,
    imageCount,
    skippedImageCount,
  };
}

// ── Markdown 组装 ────────────────────────────────────────────────────

interface BuildMarkdownOptions {
  includeMetadata: boolean;
  hashToRelPath: Map<string, string>;
}

function buildMarkdown(
  session: ChatSession,
  selected: ChatMessage[],
  opts: BuildMarkdownOptions
): string {
  const lines: string[] = [];

  // 标题
  lines.push(`# ${session.title || '对话导出'}`);
  lines.push('');

  if (opts.includeMetadata) {
    const userCount = selected.filter((m) => m.role === 'user').length;
    const assistantCount = selected.length - userCount;
    // 取会话最后一条 assistant 消息的 model 快照（若有）
    const lastAssistant = [...session.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.model);
    const modelLabel = lastAssistant?.model
      ? `${lastAssistant.model.provider} · ${lastAssistant.model.model}`
      : '未记录';

    lines.push(`> 导出时间：${formatLocalTime(Date.now())}`);
    lines.push(`> 模型：${modelLabel}`);
    lines.push(
      `> 共 ${selected.length} 条消息（🧑 ${userCount} / 🤖 ${assistantCount}）`
    );
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  for (const msg of selected) {
    lines.push(roleHeading(msg.role, msg.timestamp));
    lines.push('');
    lines.push(renderMessageBody(msg, opts.hashToRelPath));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 结尾多余的分隔符可以保留，不影响阅读
  return lines.join('\n');
}

/**
 * 单条消息正文：
 *  - user：图片占位行 + 纯文本段落（不包代码围栏）
 *  - assistant：直接把 content 中的 text 块拼成原始 markdown（保留代码围栏）
 */
function renderMessageBody(
  msg: ChatMessage,
  hashToRelPath: Map<string, string>
): string {
  // 纯字符串 content
  if (typeof msg.content === 'string') {
    return msg.role === 'user'
      ? userTextToMarkdown(msg.content) || '（空消息）'
      : msg.content || '（空消息）';
  }

  // block 数组
  const pieces: string[] = [];
  // 图片先单独抽一组（放在文本之前，符合 Composer 习惯）
  const images: LLMImageRefBlock[] = [];
  const imagesRaw: { type: 'image'; mediaType?: string }[] = [];
  const texts: string[] = [];

  for (const b of msg.content as PersistedContentBlock[]) {
    if (isImageRef(b)) {
      images.push(b);
    } else if (b.type === 'image') {
      // 运行时残留的 base64 image 块（很少见）
      imagesRaw.push({ type: 'image', mediaType: b.source.media_type });
    } else if (b.type === 'text') {
      texts.push(b.text);
    }
  }

  for (const img of images) {
    const rel = hashToRelPath.get(img.hash);
    if (rel) {
      pieces.push(`![${escapeMdAlt(img.fileName)}](${rel})`);
    } else {
      pieces.push(`> 图片缺失：${img.fileName}`);
    }
  }
  for (const _ of imagesRaw) {
    pieces.push(`> 图片缺失（未落盘）`);
  }

  const textBody = texts.join('\n');
  if (textBody.trim()) {
    pieces.push(
      msg.role === 'user' ? userTextToMarkdown(textBody) : textBody
    );
  } else if (images.length === 0 && imagesRaw.length === 0) {
    pieces.push('（空消息）');
  }

  return pieces.join('\n\n');
}

/** 转义 alt 文本里的方括号 */
function escapeMdAlt(s: string): string {
  return s.replace(/[[\]]/g, '_');
}
