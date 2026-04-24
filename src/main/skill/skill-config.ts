/**
 * SkillConfig — Skill 启用/禁用配置持久化
 *
 * 存储在 userData/skill-config.json
 * 格式: { disabled: string[], webSearchEnabled: boolean }
 */
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('SkillConfig');

interface SkillConfigData {
  /** 被禁用的 Skill 名称列表（黑名单模式：默认全部启用） */
  disabled: string[];
  /** 联网搜索全局开关（默认 true） */
  webSearchEnabled: boolean;
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'skill-config.json');
}

const DEFAULT_CONFIG: SkillConfigData = {
  disabled: [],
  webSearchEnabled: true,
};

export async function readSkillConfig(): Promise<SkillConfigData> {
  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
    const raw = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(raw) as Partial<SkillConfigData>;
    return {
      disabled: data.disabled ?? [],
      webSearchEnabled: data.webSearchEnabled ?? true,
    };
  } catch (err) {
    log.warn('读取 skill-config.json 失败，使用默认配置:', err);
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeSkillConfig(
  config: SkillConfigData
): Promise<void> {
  try {
    await fs.writeFile(
      getConfigPath(),
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  } catch (err) {
    log.error('写入 skill-config.json 失败:', err);
  }
}

/** 切换指定 Skill 的启用/禁用状态 */
export async function toggleSkill(
  name: string,
  enabled: boolean
): Promise<void> {
  const config = await readSkillConfig();
  if (enabled) {
    config.disabled = config.disabled.filter((n) => n !== name);
  } else {
    if (!config.disabled.includes(name)) {
      config.disabled.push(name);
    }
  }
  await writeSkillConfig(config);
}

/** 设置联网搜索全局开关 */
export async function setWebSearchEnabled(
  enabled: boolean
): Promise<void> {
  const config = await readSkillConfig();
  config.webSearchEnabled = enabled;
  await writeSkillConfig(config);
}

/** 获取联网搜索全局开关 */
export async function getWebSearchEnabled(): Promise<boolean> {
  const config = await readSkillConfig();
  return config.webSearchEnabled;
}
