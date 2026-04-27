/**
 * PersonaStore — userData/personas/ 读写
 *
 * 工作区模型下的细粒度操作：
 *   - createPersona       创建占位（写 meta.json，不写 SKILL.md）
 *   - addMaterial         追加单份材料（即时落盘）
 *   - removeMaterial      删除单份材料
 *   - renamePersona       改名
 *   - setRecipe           切换配方
 *   - saveSkillMd         保存 SKILL.md 文本编辑
 *   - updateStatus        发布/撤销发布时切换 status 字段
 *
 * 目录结构（每个 persona）：
 *   <id>/
 *     meta.json      — PersonaMeta
 *     materials/     — 原始材料文本存档
 *     SKILL.md       — 蒸馏产物（仅在首次蒸馏后存在）
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import type {
  PersonaMeta,
  PersonaSourceRef,
  PersonaLoadResult,
} from './types';
import { createLogger } from '../logger';

const log = createLogger('PersonaStore');

// ─── 路径工具 ────────────────────────────────────────────────

export function getPersonasBaseDir(): string {
  return path.join(app.getPath('userData'), 'personas');
}

/** Persona 主目录绝对路径（公开供 IPC 打开目录使用） */
export function getPersonaDir(id: string): string {
  return path.join(getPersonasBaseDir(), id);
}

/** 别名：模块内部使用的短名 */
const personaDir = getPersonaDir;

function metaPath(id: string): string {
  return path.join(personaDir(id), 'meta.json');
}

function skillMdPath(id: string): string {
  return path.join(personaDir(id), 'SKILL.md');
}

function materialsDir(id: string): string {
  return path.join(personaDir(id), 'materials');
}

// ─── ID / 文件名生成 ─────────────────────────────────────────

/**
 * 内部 Persona 目录名 ID。
 *
 * 格式：`<YYYYMMDD>-<8 位 uuid>`，例如 `20260427-a1b2c3d4`。
 *
 * - 与展示名彻底解耦（重命名不影响目录路径）
 * - 日期前缀便于 ls/Finder 按时间排序
 * - 8 位 uuid 段保证唯一性
 */
function generateId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const uid = randomUUID().slice(0, 8);
  return `${date}-${uid}`;
}

/**
 * 把人格展示名 slug 化为发布目录名。
 *
 * 规则：
 * - 保留中文字符（filesystem 都支持）
 * - 空格 / 路径非法字符（/\:*?"<>|）→ 连字符
 * - 多个连续连字符合并
 * - 长度限制 64 字符
 * - slug 化后为空（极端情况：纯特殊字符）→ 返回空字符串，由调用方 fallback
 */
export function slugifyName(name: string): string {
  return name
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function defaultPlaceholderName(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `未命名人格 ${hh}:${mm}`;
}

function pickMaterialFilename(
  type: 'text' | 'file' | 'url',
  label: string,
  existing: PersonaSourceRef[]
): string {
  const ext = type === 'url' ? '.md' : '.txt';
  const used = new Set(existing.map(s => s.stored_as));
  // 用递增序号避免冲突
  let n = existing.length;
  // 防御性循环上限，避免极端情况死循环
  for (let i = 0; i < 1000; i++) {
    const candidate = `source-${n}${ext}`;
    if (!used.has(candidate)) return candidate;
    n++;
  }
  return `source-${randomUUID().slice(0, 8)}${ext}`;
}

// ─── meta.json 读写 ─────────────────────────────────────────

async function readMeta(id: string): Promise<PersonaMeta> {
  const raw = await fsp.readFile(metaPath(id), 'utf-8');
  return JSON.parse(raw) as PersonaMeta;
}

async function writeMeta(meta: PersonaMeta): Promise<void> {
  const dir = personaDir(meta.id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8');
}

function touchUpdated(meta: PersonaMeta): void {
  meta.updated = new Date().toISOString();
}

// ─── 公开 API ────────────────────────────────────────────────

/** 创建一个空白 Persona 占位（不写 SKILL.md） */
export async function createPersona(
  name: string | undefined,
  recipeName: string
): Promise<PersonaMeta> {
  const finalName = (name?.trim()) || defaultPlaceholderName();
  const now = new Date().toISOString();
  const id = generateId();

  const meta: PersonaMeta = {
    id,
    name: finalName,
    recipe_name: recipeName,
    status: 'draft',
    created: now,
    updated: now,
    sources: [],
  };

  await fsp.mkdir(personaDir(id), { recursive: true });
  await fsp.mkdir(materialsDir(id), { recursive: true });
  await writeMeta(meta);

  log.info(`Persona 已创建: ${id} (${finalName})`);
  return meta;
}

/** 追加一份材料（写入文件 + 更新 meta） */
export async function addMaterial(
  id: string,
  type: 'text' | 'file' | 'url',
  label: string,
  content: string
): Promise<PersonaMeta> {
  const meta = await readMeta(id);
  const stored_as = pickMaterialFilename(type, label, meta.sources);

  await fsp.mkdir(materialsDir(id), { recursive: true });
  await fsp.writeFile(path.join(materialsDir(id), stored_as), content, 'utf-8');

  meta.sources.push({ type, label, stored_as });
  touchUpdated(meta);
  await writeMeta(meta);

  log.info(`Persona ${id}: 已添加材料 ${stored_as} (${type}, ${content.length} 字符)`);
  return meta;
}

/** 删除指定 index 的材料（删文件 + 更新 meta） */
export async function removeMaterial(
  id: string,
  sourceIndex: number
): Promise<PersonaMeta> {
  const meta = await readMeta(id);
  if (sourceIndex < 0 || sourceIndex >= meta.sources.length) return meta;

  const removed = meta.sources.splice(sourceIndex, 1)[0];
  await fsp
    .unlink(path.join(materialsDir(id), removed.stored_as))
    .catch(() => undefined);

  touchUpdated(meta);
  await writeMeta(meta);

  log.info(`Persona ${id}: 已删除材料 ${removed.stored_as}`);
  return meta;
}

/** 重命名 Persona */
export async function renamePersona(
  id: string,
  newName: string
): Promise<PersonaMeta> {
  const meta = await readMeta(id);
  meta.name = newName.trim() || meta.name;
  touchUpdated(meta);
  await writeMeta(meta);
  return meta;
}

/** 切换 Persona 关联的配方（不影响材料/SKILL.md） */
export async function setRecipe(
  id: string,
  recipeName: string
): Promise<PersonaMeta> {
  const meta = await readMeta(id);
  meta.recipe_name = recipeName;
  touchUpdated(meta);
  await writeMeta(meta);
  return meta;
}

/** 保存 SKILL.md 文本编辑（蒸馏完成或用户手动修改后调用） */
export async function saveSkillMd(id: string, content: string): Promise<PersonaMeta> {
  const meta = await readMeta(id);
  await fsp.writeFile(skillMdPath(id), content, 'utf-8');
  touchUpdated(meta);
  await writeMeta(meta);
  return meta;
}

/** 加载 persona（meta + SKILL.md 文本，文件不存在时返回空字符串） */
export async function loadPersona(id: string): Promise<PersonaLoadResult | null> {
  if (!fs.existsSync(metaPath(id))) return null;
  try {
    const meta = await readMeta(id);
    const skillMd = await fsp.readFile(skillMdPath(id), 'utf-8').catch(() => '');
    return { meta, skillMd };
  } catch (err) {
    log.warn(`加载 Persona 失败: ${id} — ${(err as Error).message}`);
    return null;
  }
}

/** 列出所有 persona（仅 meta，按 updatedAt 降序） */
export async function listPersonas(): Promise<PersonaMeta[]> {
  const baseDir = getPersonasBaseDir();
  if (!fs.existsSync(baseDir)) return [];

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const metas: PersonaMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mp = path.join(baseDir, entry.name, 'meta.json');
    if (!fs.existsSync(mp)) continue;
    try {
      const raw = fs.readFileSync(mp, 'utf-8');
      metas.push(JSON.parse(raw) as PersonaMeta);
    } catch {
      // 损坏的 meta 跳过
    }
  }

  return metas.sort((a, b) => b.updated.localeCompare(a.updated));
}

/** 删除 persona 目录（不删除 userData/skills/，由 publisher 处理） */
export async function deletePersona(id: string): Promise<void> {
  const dir = personaDir(id);
  if (fs.existsSync(dir)) {
    await fsp.rm(dir, { recursive: true, force: true });
    log.info(`Persona 已删除: ${id}`);
  }
}

/** 更新 meta.json 的 status 字段（发布/撤销发布用） */
export async function updatePersonaStatus(
  id: string,
  status: PersonaMeta['status']
): Promise<void> {
  const meta = await readMeta(id);
  meta.status = status;
  touchUpdated(meta);
  await writeMeta(meta);
}

/**
 * 更新 meta.json 的发布字段（published_dir + status）。
 * publishedDir 为 null 时清空字段（撤销发布）。
 */
export async function updatePersonaPublishInfo(
  id: string,
  publishedDir: string | null
): Promise<PersonaMeta> {
  const meta = await readMeta(id);
  if (publishedDir) {
    meta.status = 'published';
    meta.published_dir = publishedDir;
  } else {
    meta.status = 'draft';
    delete meta.published_dir;
  }
  touchUpdated(meta);
  await writeMeta(meta);
  return meta;
}

/** 读取 meta（公开，供 publisher 读 published_dir） */
export async function readPersonaMeta(id: string): Promise<PersonaMeta> {
  return readMeta(id);
}

/** 读取 SKILL.md 内容（供 publisher 复制） */
export async function readSkillMd(id: string): Promise<string> {
  return fsp.readFile(skillMdPath(id), 'utf-8');
}

/** 读取 materials/ 目录下所有已存档的材料内容（供 distiller 使用） */
export async function loadMaterialContents(
  id: string,
  sources: PersonaMeta['sources']
): Promise<string[]> {
  const dir = materialsDir(id);
  return Promise.all(
    sources.map(async (s) => {
      const filePath = path.join(dir, s.stored_as);
      if (!fs.existsSync(filePath)) return '';
      return fsp.readFile(filePath, 'utf-8').catch(() => '');
    })
  );
}
