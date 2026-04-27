/**
 * PersonaStore — userData/personas/ 读写
 *
 * 目录结构（每个 persona）：
 *   <id>/
 *     meta.json      — PersonaMeta
 *     materials/     — 原始材料文本存档
 *     SKILL.md       — 蒸馏产物（用户编辑后的权威版本）
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import type { PersonaMeta, PersonaSaveInput, PersonaLoadResult } from './types';
import { createLogger } from '../logger';

const log = createLogger('PersonaStore');

// ─── 路径工具 ────────────────────────────────────────────────

export function getPersonasBaseDir(): string {
  return path.join(app.getPath('userData'), 'personas');
}

function personaDir(id: string): string {
  return path.join(getPersonasBaseDir(), id);
}

function metaPath(id: string): string {
  return path.join(personaDir(id), 'meta.json');
}

function skillMdPath(id: string): string {
  return path.join(personaDir(id), 'SKILL.md');
}

function materialsDir(id: string): string {
  return path.join(personaDir(id), 'materials');
}

// ─── ID 生成 ─────────────────────────────────────────────────

function generateId(name: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = name
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const uid = randomUUID().slice(0, 8);
  return `${date}-${slug}-${uid}`;
}

// ─── 读写原语 ────────────────────────────────────────────────

async function readMeta(id: string): Promise<PersonaMeta> {
  const raw = await fsp.readFile(metaPath(id), 'utf-8');
  return JSON.parse(raw) as PersonaMeta;
}

async function writeMeta(meta: PersonaMeta): Promise<void> {
  const dir = personaDir(meta.id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8');
}

async function saveMaterials(id: string, sources: PersonaSaveInput['sources'], materialsMap: Map<string, string>): Promise<void> {
  const dir = materialsDir(id);
  await fsp.mkdir(dir, { recursive: true });
  for (const [filename, content] of materialsMap) {
    await fsp.writeFile(path.join(dir, filename), content, 'utf-8');
  }
  // 删除已不再引用的旧材料文件（仅当目录已存在时）
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const referenced = new Set(sources.map(s => s.stored_as));
  for (const file of existing) {
    if (!referenced.has(file)) {
      await fsp.unlink(path.join(dir, file)).catch(() => undefined);
    }
  }
}

// ─── 公开 API ────────────────────────────────────────────────

/** 新建或更新 persona（Draft 状态） */
export async function savePersona(input: PersonaSaveInput): Promise<PersonaMeta> {
  const now = new Date().toISOString();
  const id = input.id ?? generateId(input.name);

  // 如果是更新，先读取旧 meta 保留 status
  let existingStatus: PersonaMeta['status'] = 'draft';
  if (input.id && fs.existsSync(metaPath(input.id))) {
    try {
      const old = await readMeta(input.id);
      existingStatus = old.status;
    } catch {
      // 读取失败则视为新建
    }
  }

  // 构建 materials 文件名映射（content → stored_as）
  const materialsMap = new Map<string, string>();
  const sources = input.sources.map((s, idx) => {
    const ext = s.type === 'url' ? '.md' : '.txt';
    const storedAs = s.stored_as || `source-${idx}${ext}`;
    return { ...s, stored_as: storedAs };
  });

  // 注意：材料内容由 IPC 层传入时已经分离；store 只负责文件名索引的一致性
  // 实际材料内容写入由 persona-ipc 调用 saveMaterials 单独处理

  const meta: PersonaMeta = {
    id,
    name: input.name,
    recipe_name: input.recipe_name,
    status: existingStatus,
    created: input.id ? (await readMeta(input.id).then(m => m.created).catch(() => now)) : now,
    updated: now,
    sources,
  };

  const dir = personaDir(id);
  await fsp.mkdir(dir, { recursive: true });
  await writeMeta(meta);
  await fsp.writeFile(skillMdPath(id), input.skillMd, 'utf-8');

  log.info(`Persona 已保存: ${id} (${meta.status})`);
  return meta;
}

/** 将材料文本写入 materials/ 目录 */
export async function saveMaterialFiles(
  id: string,
  sources: PersonaSaveInput['sources'],
  contents: string[]
): Promise<void> {
  const dir = materialsDir(id);
  await fsp.mkdir(dir, { recursive: true });
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s.stored_as && contents[i] !== undefined) {
      await fsp.writeFile(path.join(dir, s.stored_as), contents[i], 'utf-8');
    }
  }
}

/** 加载 persona（meta + SKILL.md 文本） */
export async function loadPersona(id: string): Promise<PersonaLoadResult | null> {
  if (!fs.existsSync(metaPath(id))) return null;
  try {
    const [meta, skillMd] = await Promise.all([
      readMeta(id),
      fsp.readFile(skillMdPath(id), 'utf-8').catch(() => ''),
    ]);
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

/** 删除 persona 目录（不删除 userData/skills/ 的发布文件，由 publisher 处理） */
export async function deletePersona(id: string): Promise<void> {
  const dir = personaDir(id);
  if (fs.existsSync(dir)) {
    await fsp.rm(dir, { recursive: true, force: true });
    log.info(`Persona 已删除: ${id}`);
  }
}

/** 更新 meta.json 的 status 字段 */
export async function updatePersonaStatus(
  id: string,
  status: PersonaMeta['status']
): Promise<void> {
  const meta = await readMeta(id);
  meta.status = status;
  meta.updated = new Date().toISOString();
  await writeMeta(meta);
}

/** 读取 SKILL.md 内容（供 publisher 复制） */
export async function readSkillMd(id: string): Promise<string> {
  return fsp.readFile(skillMdPath(id), 'utf-8');
}

/** 读取 materials/ 目录下所有已存档的材料内容 */
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
