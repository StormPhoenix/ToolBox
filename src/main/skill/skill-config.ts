/**
 * SkillConfig — Skill 启用/禁用 + 信任工具 配置持久化
 *
 * 存储在 userData/skill-config.json
 * 格式: { disabled: string[], trustedTools: string[] }
 *
 * 语义说明：
 * - disabled: 被禁用的 Skill 名称（黑名单模式，默认全部启用）
 * - trustedTools: 被用户永久信任的 MODERATE 工具名称（免确认）
 */
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('SkillConfig');

interface SkillConfigData {
  /** 被禁用的 Skill 名称列表 */
  disabled: string[];
  /** 被用户永久信任的工具名称列表 */
  trustedTools: string[];
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'skill-config.json');
}

const DEFAULT_CONFIG: SkillConfigData = {
  disabled: [],
  trustedTools: [],
};

export async function readSkillConfig(): Promise<SkillConfigData> {
  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
    const raw = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(raw) as Partial<SkillConfigData>;
    return {
      disabled: data.disabled ?? [],
      trustedTools: data.trustedTools ?? [],
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

/** 添加永久信任的工具 */
export async function addTrustedTool(toolName: string): Promise<void> {
  const config = await readSkillConfig();
  if (!config.trustedTools.includes(toolName)) {
    config.trustedTools.push(toolName);
    await writeSkillConfig(config);
  }
}

/** 移除永久信任的工具 */
export async function removeTrustedTool(toolName: string): Promise<void> {
  const config = await readSkillConfig();
  config.trustedTools = config.trustedTools.filter((n) => n !== toolName);
  await writeSkillConfig(config);
}
