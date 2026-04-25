/**
 * 会话持久化层
 *
 * 存储布局：
 *   userData/chat-sessions/
 *     ├── index.json           # [{id, title, updatedAt, messageCount}, ...]
 *     └── <sessionId>.json     # 完整 ChatSession 数据
 *
 * 设计要点：
 * - 索引与单会话分离：启动时只读索引渲染列表，避免加载全部 messages
 * - 所有写操作原子：先写 tmp 再 rename，避免中途崩溃导致损坏
 * - sessionId 用 crypto.randomUUID（Node.js 内置，无需依赖）
 */
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  ChatMessage,
  ChatMode,
  ChatSession,
  SessionIndexEntry,
} from './types';
import { createLogger } from '../logger';

const log = createLogger('ChatStore');

const SESSIONS_DIRNAME = 'chat-sessions';
const INDEX_FILENAME = 'index.json';

// ─── 路径工具 ──────────────────────────────────────────────

function getDir(): string {
  return path.join(app.getPath('userData'), SESSIONS_DIRNAME);
}

function getIndexPath(): string {
  return path.join(getDir(), INDEX_FILENAME);
}

function getSessionPath(id: string): string {
  return path.join(getDir(), `${id}.json`);
}

/** sessionId 合法性校验，防止路径穿越攻击（虽然 IPC 端可信，但防御编码） */
function isValidSessionId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getDir(), { recursive: true });
}

/** 原子写文件：先写临时文件再 rename */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, filePath);
}

// ─── 索引读写 ──────────────────────────────────────────────

async function readIndex(): Promise<SessionIndexEntry[]> {
  try {
    const raw = await fs.readFile(getIndexPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionIndexEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: SessionIndexEntry[]): Promise<void> {
  await ensureDir();
  // 按更新时间倒序，UI 直接使用
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  await atomicWrite(getIndexPath(), JSON.stringify(sorted, null, 2));
}

async function updateIndexEntry(session: ChatSession): Promise<void> {
  const entries = await readIndex();
  const idx = entries.findIndex((e) => e.id === session.id);
  const entry: SessionIndexEntry = {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  await writeIndex(entries);
}

async function removeIndexEntry(id: string): Promise<void> {
  const entries = await readIndex();
  const next = entries.filter((e) => e.id !== id);
  await writeIndex(next);
}

// ─── 会话 CRUD ─────────────────────────────────────────────

export async function listSessions(): Promise<SessionIndexEntry[]> {
  return readIndex();
}

export async function loadSession(id: string): Promise<ChatSession | null> {
  if (!isValidSessionId(id)) {
    log.warn(`loadSession: 非法 sessionId=${id}`);
    return null;
  }
  try {
    const raw = await fs.readFile(getSessionPath(id), 'utf-8');
    return JSON.parse(raw) as ChatSession;
  } catch (err) {
    log.warn(`loadSession 读取失败 id=${id}: ${(err as Error).message}`);
    return null;
  }
}

export async function createSession(title?: string): Promise<ChatSession> {
  await ensureDir();
  const now = Date.now();
  const session: ChatSession = {
    id: randomUUID(),
    title: title || '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    mode: 'chat',
  };
  await atomicWrite(getSessionPath(session.id), JSON.stringify(session, null, 2));
  await updateIndexEntry(session);
  log.info(`createSession 创建: id=${session.id}, title=${session.title}`);
  return session;
}

/** 更新会话对话模式并持久化（UI 切换模式时立即调用） */
export async function setSessionMode(id: string, mode: ChatMode): Promise<void> {
  const session = await loadSession(id);
  if (!session) throw new Error(`会话不存在: ${id}`);
  session.mode = mode;
  await saveSession(session);
  log.info(`setSessionMode: id=${id}, mode=${mode}`);
}

export async function saveSession(session: ChatSession): Promise<void> {
  if (!isValidSessionId(session.id)) {
    throw new Error(`非法 sessionId=${session.id}`);
  }
  await ensureDir();
  session.updatedAt = Date.now();
  await atomicWrite(getSessionPath(session.id), JSON.stringify(session, null, 2));
  await updateIndexEntry(session);
}

export async function deleteSession(id: string): Promise<void> {
  if (!isValidSessionId(id)) {
    log.warn(`deleteSession: 非法 sessionId=${id}`);
    return;
  }
  try {
    await fs.unlink(getSessionPath(id));
  } catch {
    /* 文件不存在忽略 */
  }
  await removeIndexEntry(id);
  log.info(`deleteSession 删除: id=${id}`);
}

export async function renameSession(id: string, title: string): Promise<void> {
  const session = await loadSession(id);
  if (!session) throw new Error(`会话不存在: ${id}`);
  session.title = title.trim() || session.title;
  await saveSession(session);
}

export async function clearSessionContext(id: string): Promise<void> {
  const session = await loadSession(id);
  if (!session) throw new Error(`会话不存在: ${id}`);
  session.messages = [];
  await saveSession(session);
}

/** 追加消息到会话末尾并持久化 */
export async function appendMessages(
  id: string,
  messages: ChatMessage[]
): Promise<ChatSession> {
  const session = await loadSession(id);
  if (!session) throw new Error(`会话不存在: ${id}`);
  session.messages.push(...messages);

  // 首条 user 消息自动命名（取前 20 字）
  if (session.title === '新会话') {
    const firstUser = session.messages.find((m) => m.role === 'user');
    if (firstUser) {
      const text =
        typeof firstUser.content === 'string'
          ? firstUser.content
          : firstUser.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map((b) => b.text)
              .join(' ');
      const cleaned = text.replace(/\s+/g, ' ').trim();
      if (cleaned) {
        session.title = cleaned.length > 20 ? cleaned.slice(0, 20) + '…' : cleaned;
      }
    }
  }

  await saveSession(session);
  return session;
}
