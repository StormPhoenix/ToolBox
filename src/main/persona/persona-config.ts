/**
 * Persona Studio 配置持久化
 *
 * 存储位置：userData/persona-config.json
 *
 * 字段：
 *   customRecipeDir : string | null
 *     - 留空（null/空字符串）→ 使用默认 userData/persona-recipes/
 *     - 非空 → 使用用户指定的绝对路径作为用户级配方目录（替代默认）
 *
 * 用户级配方目录在加载时若不存在会自动创建（与现有 personaOpenRecipeDir 行为一致）。
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('PersonaConfig');

export interface PersonaConfig {
  customRecipeDir: string | null;
}

const DEFAULT_CONFIG: PersonaConfig = {
  customRecipeDir: null,
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'persona-config.json');
}

/** 读取配置；文件不存在或损坏时返回默认值 */
export async function readPersonaConfig(): Promise<PersonaConfig> {
  const filePath = getConfigPath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_CONFIG };
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersonaConfig>;
    return {
      customRecipeDir:
        typeof parsed.customRecipeDir === 'string' && parsed.customRecipeDir.trim()
          ? parsed.customRecipeDir.trim()
          : null,
    };
  } catch (err) {
    log.warn(`读取配置失败，使用默认值: ${(err as Error).message}`);
    return { ...DEFAULT_CONFIG };
  }
}

/** 写入配置 */
export async function writePersonaConfig(config: PersonaConfig): Promise<void> {
  const filePath = getConfigPath();
  const normalized: PersonaConfig = {
    customRecipeDir:
      config.customRecipeDir && config.customRecipeDir.trim()
        ? config.customRecipeDir.trim()
        : null,
  };
  await fsp.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  log.info(`配置已保存: customRecipeDir=${normalized.customRecipeDir ?? '<default>'}`);
}

/** 默认用户配方目录（不受配置影响，用于 UI 展示"留空时使用…"） */
export function getDefaultUserRecipesDir(): string {
  return path.join(app.getPath('userData'), 'persona-recipes');
}

/**
 * 当前生效的用户级配方目录。
 *
 * - config.customRecipeDir 有值：用它（不存在时由调用方自行处理 mkdir）
 * - 否则：使用默认 userData/persona-recipes/
 */
export function resolveUserRecipesDir(config: PersonaConfig): string {
  return config.customRecipeDir ?? getDefaultUserRecipesDir();
}
