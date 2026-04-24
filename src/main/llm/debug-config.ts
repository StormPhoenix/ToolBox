/**
 * DebugConfig — 调试功能配置持久化
 *
 * 存储在 userData/debug-config.json
 *
 * 字段：
 * - promptDump.enabled: 是否启用 LLM prompt/response dump
 *   · 开发环境（!app.isPackaged）默认 true
 *   · 生产环境默认 false
 *   · 持久化：用户在 Settings 里改动后，永久覆盖默认值
 * - promptDump.maxFilesPerDay: 单日最多保留的 dump 文件数（超过自动清理最旧的）
 */
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('DebugConfig');

export interface DebugConfigData {
  promptDump: {
    /** 是否启用 LLM prompt dump */
    enabled: boolean;
    /** 单日最多保留的 dump 文件数 */
    maxFilesPerDay: number;
  };
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'debug-config.json');
}

/** 返回当前环境的默认配置 */
function getDefaultConfig(): DebugConfigData {
  return {
    promptDump: {
      enabled: !app.isPackaged, // 开发环境默认开
      maxFilesPerDay: 200,
    },
  };
}

export async function readDebugConfig(): Promise<DebugConfigData> {
  const defaults = getDefaultConfig();
  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) return defaults;
    const raw = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(raw) as Partial<DebugConfigData>;
    return {
      promptDump: {
        enabled: data.promptDump?.enabled ?? defaults.promptDump.enabled,
        maxFilesPerDay:
          data.promptDump?.maxFilesPerDay ?? defaults.promptDump.maxFilesPerDay,
      },
    };
  } catch (err) {
    log.warn('读取 debug-config.json 失败，使用默认配置:', err);
    return defaults;
  }
}

export async function writeDebugConfig(config: DebugConfigData): Promise<void> {
  try {
    await fs.writeFile(
      getConfigPath(),
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  } catch (err) {
    log.error('写入 debug-config.json 失败:', err);
  }
}

/** 获取 dump 文件根目录 */
export function getDumpRootDir(): string {
  return path.join(app.getPath('userData'), 'llm-dumps');
}
