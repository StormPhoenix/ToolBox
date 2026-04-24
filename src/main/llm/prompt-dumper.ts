/**
 * PromptDumper — LLM 请求/响应 dump 到磁盘
 *
 * 单文件策略：
 *   - 每次 LLM 调用产出一个 JSON 文件，包含 request + response（+ 可选 error）
 *   - 文件名包含完整上下文：{timestamp}_{scene}_sess-{sid}_req-{rid}_iter{N}.json
 *   - 响应完成后一次性写入（异常场景也会写，包含 error 字段）
 *
 * 覆盖范围：
 *   所有通过 LLMRouter 发起的调用都会被自动 dump，包括：
 *   - chat-engine 的 Agent 循环（scene: 'main-chat'）
 *   - llm-ipc 的插件调用（scene: 'plugin-llmchat' / 'plugin-image-gen'）
 *   - 未来新增的调用入口
 *
 * 性能：
 *   - 未启用时 dumpCall() 首行判断 enabled 直接 return，零 IO
 *   - 启用时异步写盘（调用方 fire-and-forget），不阻塞主流程
 *   - 启动时异步清理过期目录（保留最近 7 天）
 */
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import type {
  LLMSystemParam,
  LLMMessageParam,
  LLMToolDef,
  LLMResponse,
  LLMImageGenOptions,
  LLMImageGenResult,
} from './types';
import { readDebugConfig, getDumpRootDir } from './debug-config';
import { createLogger } from '../logger';

const log = createLogger('PromptDumper');

/** 保留最近 N 天的 dump 目录 */
const KEEP_DAYS = 7;

// ─── Dump 数据结构 ─────────────────────────────────

/**
 * 一次 LLM 调用的完整 dump 记录（request + response 合并，含 meta）
 */
export interface DumpRecord {
  /** ISO 时间戳（请求发起时） */
  timestamp: string;
  /** 调用场景，如 'main-chat' / 'plugin-llmchat' / 'plugin-image-gen' */
  scene: string;
  /** 关联请求 ID（同一 Agent 循环的多轮共用，可选） */
  requestId?: string;
  /** 会话 ID（仅 chat 场景有，可选） */
  sessionId?: string;
  /** Agent 循环迭代轮次（仅 chat 场景有，可选） */
  iteration?: number;
  /** Provider 信息 */
  provider: {
    name: string;
    model: string;
  };
  /** 从请求到响应的耗时（毫秒） */
  durationMs: number;
  /**
   * LLM 调用类型：
   * - 'chat' 对应 createMessage / streamMessage（message 型请求 / response）
   * - 'image-gen' 对应 generateImage（文生图）
   */
  callType: 'chat' | 'image-gen';
  /** 请求参数 */
  request: DumpChatRequest | DumpImageGenRequest;
  /** 响应结果（error 非空时 response 为占位值） */
  response: LLMResponse | LLMImageGenResult;
  /** 请求统计（便于快速浏览） */
  requestMeta: {
    systemChars?: number;
    messageChars?: number;
    toolCount?: number;
    messageCount?: number;
    prompt?: string; // image-gen 的提示词
  };
  /** 异常信息（LLM 抛错时填入） */
  error?: {
    message: string;
    stack?: string;
  };
}

export interface DumpChatRequest {
  system: LLMSystemParam;
  messages: LLMMessageParam[];
  tools?: LLMToolDef[];
}

export interface DumpImageGenRequest {
  options: LLMImageGenOptions;
}

// ─── 模块级状态 ─────────────────────────────────────

/** 当前配置缓存（避免每次调用读 IO） */
let cachedEnabled = false;
let cachedMaxFilesPerDay = 200;

/**
 * 初始化 dumper：
 * 1. 读取配置到内存缓存
 * 2. 清理过期的日期目录
 *
 * main.ts 在 app.whenReady() 时调用一次。
 */
export async function initializePromptDumper(): Promise<void> {
  const config = await readDebugConfig();
  cachedEnabled = config.promptDump.enabled;
  cachedMaxFilesPerDay = config.promptDump.maxFilesPerDay;

  log.info(
    `PromptDumper 初始化: enabled=${cachedEnabled}, maxFilesPerDay=${cachedMaxFilesPerDay}`
  );

  if (cachedEnabled) {
    void cleanupOldDirs().catch((err) => {
      log.warn(`清理旧 dump 目录失败: ${(err as Error).message}`);
    });
  }
}

/** 动态更新 enabled（Settings 切换时调用） */
export function setDumpEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  log.info(`PromptDumper enabled 更新为: ${enabled}`);
}

/** 查询当前是否启用 */
export function isDumpEnabled(): boolean {
  return cachedEnabled;
}

// ─── 核心 API：记录一次完整调用 ─────────────────────

/**
 * 记录一次完整的 LLM 调用（请求 + 响应）。
 *
 * 由 DumpingProvider 在 LLM 调用完成后（成功或失败）调用。
 * 未启用时零开销直接返回。
 *
 * @returns 写入的文件绝对路径（未启用或失败时返回 null）
 */
export async function dumpCall(record: DumpRecord): Promise<string | null> {
  if (!cachedEnabled) return null;

  try {
    // 填充 meta（若调用方未填）
    if (!record.requestMeta) {
      record.requestMeta = computeMeta(record.callType, record.request);
    }

    const dir = await ensureDayDir();
    const fileName = buildFileName(record);
    const filePath = path.join(dir, fileName);

    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');

    // 异步检查并清理单日上限
    void enforcePerDayLimit(dir).catch(() => {
      /* 静默 */
    });

    return filePath;
  } catch (err) {
    log.warn(`dumpCall 失败: ${(err as Error).message}`);
    return null;
  }
}

// ─── 内部工具函数 ──────────────────────────────────

/** 根据 callType 计算 meta */
function computeMeta(
  callType: DumpRecord['callType'],
  request: DumpChatRequest | DumpImageGenRequest
): DumpRecord['requestMeta'] {
  if (callType === 'image-gen') {
    const req = request as DumpImageGenRequest;
    return {
      prompt: req.options.prompt,
    };
  }

  const req = request as DumpChatRequest;
  let systemChars = 0;
  if (typeof req.system === 'string') {
    systemChars = req.system.length;
  } else {
    systemChars = req.system.reduce((sum, b) => sum + b.text.length, 0);
  }

  let messageChars = 0;
  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      messageChars += m.content.length;
    } else {
      for (const block of m.content) {
        if ('text' in block) messageChars += block.text.length;
      }
    }
  }

  return {
    systemChars,
    messageChars,
    toolCount: req.tools?.length ?? 0,
    messageCount: req.messages.length,
  };
}

/**
 * 构造文件名：
 *   {iso-stamp}_{scene}_sess-{sid}_req-{rid}_iter{N}.json
 *
 * 无 sessionId/requestId 时省略对应段，便于非 chat 场景的调用。
 */
function buildFileName(record: DumpRecord): string {
  const stamp = record.timestamp.replace(/[:.]/g, '-').replace('Z', '');
  const parts: string[] = [stamp, record.scene];
  if (record.sessionId) parts.push(`sess-${record.sessionId.slice(0, 8)}`);
  if (record.requestId) parts.push(`req-${record.requestId.slice(0, 8)}`);
  if (record.iteration !== undefined) parts.push(`iter${record.iteration}`);
  return parts.join('_') + '.json';
}

/** 获取今日目录（YYYY-MM-DD），不存在则创建 */
async function ensureDayDir(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(getDumpRootDir(), today);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}

/** 清理超过 KEEP_DAYS 天的日期目录 */
async function cleanupOldDirs(): Promise<void> {
  const root = getDumpRootDir();
  if (!existsSync(root)) return;

  const entries = await fs.readdir(root, { withFileTypes: true });
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const dayTs = new Date(`${entry.name}T00:00:00Z`).getTime();
    if (isNaN(dayTs)) continue;
    if (dayTs < cutoff) {
      const fullPath = path.join(root, entry.name);
      try {
        await fs.rm(fullPath, { recursive: true, force: true });
        log.info(`清理过期 dump 目录: ${entry.name}`);
      } catch (err) {
        log.warn(`清理目录失败 ${entry.name}: ${(err as Error).message}`);
      }
    }
  }
}

/** 强制单日文件数上限 */
async function enforcePerDayLimit(dir: string): Promise<void> {
  const files = await fs.readdir(dir);
  if (files.length <= cachedMaxFilesPerDay) return;

  files.sort(); // 文件名以 ISO 时间戳开头，字典序 = 时间顺序
  const toDelete = files.slice(0, files.length - cachedMaxFilesPerDay);
  for (const name of toDelete) {
    try {
      await fs.unlink(path.join(dir, name));
    } catch {
      /* ignore */
    }
  }
  if (toDelete.length > 0) {
    log.info(`单日 dump 超限，已清理 ${toDelete.length} 个最旧文件`);
  }
}
