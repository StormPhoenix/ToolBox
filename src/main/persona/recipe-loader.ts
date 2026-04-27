/**
 * RecipeLoader — 解析 SKILL.md 格式的配方文件
 *
 * 宽容解析：只要求 name + Markdown body，其余字段按需提取。
 * 开源蒸馏 SKILL.md 项目（如 nuwa-skill、colleague-skill）放入
 * userData/persona-recipes/ 目录即可直接作为配方使用，无需修改。
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import yaml from 'js-yaml';
import type { Recipe } from './types';
import { createLogger } from '../logger';

const log = createLogger('RecipeLoader');

// ─── 内部解析 ────────────────────────────────────────────────

interface RawFrontmatter {
  name?: unknown;
  description?: unknown;
  version?: unknown;
  metadata?: {
    toolbox?: {
      recipe?: {
        suitable_for?: unknown;
      };
    };
  };
  [key: string]: unknown;
}

function parseRecipeMd(content: string, filePath: string): Omit<Recipe, 'builtin' | 'dirPath'> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    log.warn(`配方文件缺少 YAML frontmatter: ${filePath}`);
    return null;
  }

  const yamlStr = match[1];
  const body = match[2].trim();

  if (!body) {
    log.warn(`配方文件 Markdown body 为空: ${filePath}`);
    return null;
  }

  let fm: RawFrontmatter = {};
  try {
    fm = (yaml.load(yamlStr) as RawFrontmatter) ?? {};
  } catch (err) {
    log.warn(`配方文件 YAML 解析失败: ${filePath} — ${(err as Error).message}`);
  }

  const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : null;
  if (!name) {
    log.warn(`配方文件缺少 name 字段，跳过: ${filePath}`);
    return null;
  }

  const description =
    typeof fm.description === 'string' && fm.description.trim()
      ? fm.description.trim()
      : '无描述';

  const suitableFor = fm.metadata?.toolbox?.recipe?.suitable_for;
  const suitable_for = Array.isArray(suitableFor)
    ? suitableFor.filter((s): s is string => typeof s === 'string')
    : undefined;

  return { name, description, body, suitable_for };
}

// ─── 目录扫描 ────────────────────────────────────────────────

async function loadRecipesFromDir(dir: string, builtin: boolean): Promise<Recipe[]> {
  if (!fs.existsSync(dir)) return [];

  const recipes: Recipe[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const recipeDir = path.join(dir, entry.name);
    const skillMdPath = path.join(recipeDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const parsed = parseRecipeMd(content, skillMdPath);
      if (!parsed) continue;
      recipes.push({ ...parsed, builtin, dirPath: recipeDir });
      log.info(`已加载配方: ${parsed.name} (${builtin ? '内置' : '用户自定义'})`);
    } catch (err) {
      log.warn(`加载配方失败: ${skillMdPath} — ${(err as Error).message}`);
    }
  }
  return recipes;
}

// ─── 公开 API ────────────────────────────────────────────────

/** 内置配方目录（dist/main/persona/builtin-recipes/） */
export function getBuiltinRecipesDir(): string {
  return path.join(__dirname, 'builtin-recipes');
}

/** 用户自定义配方目录（userData/persona-recipes/） */
export function getUserRecipesDir(): string {
  return path.join(app.getPath('userData'), 'persona-recipes');
}

/** 加载所有配方（内置 + 用户自定义） */
export async function loadAllRecipes(): Promise<Recipe[]> {
  const builtinDir = getBuiltinRecipesDir();
  const userDir = getUserRecipesDir();

  const [builtins, userRecipes] = await Promise.all([
    loadRecipesFromDir(builtinDir, true),
    loadRecipesFromDir(userDir, false),
  ]);

  // 用户配方同名时覆盖内置配方
  const map = new Map<string, Recipe>();
  for (const r of builtins) map.set(r.name, r);
  for (const r of userRecipes) map.set(r.name, r);

  const result = Array.from(map.values());
  log.info(`配方加载完成: ${result.length} 个 (内置 ${builtins.length}, 用户 ${userRecipes.length})`);
  return result;
}
