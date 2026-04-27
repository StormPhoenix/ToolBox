/**
 * Publisher — 将 persona SKILL.md 发布到 userData/skills/
 *
 * 工作区模型下的发布行为：
 *
 *   发布目录命名 = slugify(persona.name)，与内部 persona id 解耦
 *
 *   场景 A 首次发布 → 目标目录不存在 → 直接写入
 *   场景 B 重发布同一 persona → 目标目录 == 当前 published_dir → 直接覆盖（无弹窗）
 *   场景 C 重命名后重发布 → 目标目录与当前 published_dir 不同且新目标不存在
 *                          → 删除旧 published_dir 目录 + 写新目录（无弹窗）
 *   场景 D 跨 persona 冲突 → 目标目录存在但不属于当前 persona
 *                          → 返回 directory_taken，由前端弹确认；overwrite=true 时强制覆盖
 *
 *   撤销发布 → 优先用 meta.published_dir 删除；缺失（旧数据）时按 persona id fallback
 */
import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  readSkillMd,
  readPersonaMeta,
  updatePersonaPublishInfo,
  slugifyName,
} from './persona-store';
import type { PublishResult } from './types';
import { createLogger } from '../logger';

const log = createLogger('Publisher');

// ─── 路径工具 ────────────────────────────────────────────────

function getSkillsBaseDir(): string {
  return path.join(app.getPath('userData'), 'skills');
}

/** 已发布的 Skill 目录绝对路径（按目录名定位） */
export function getPublishedSkillDirByName(dirName: string): string {
  return path.join(getSkillsBaseDir(), dirName);
}

/**
 * 兼容旧 API：按 persona id 拼路径。
 *
 * 优先读 meta.published_dir；缺失时回退用 id（旧数据兼容路径）。
 * Persona 详情页"打开 Skill 目录"使用此函数。
 */
export async function getPublishedSkillDir(id: string): Promise<string> {
  try {
    const meta = await readPersonaMeta(id);
    const dirName = meta.published_dir ?? id;
    return getPublishedSkillDirByName(dirName);
  } catch {
    return getPublishedSkillDirByName(id);
  }
}

function publishedSkillPath(dirName: string): string {
  return path.join(getPublishedSkillDirByName(dirName), 'SKILL.md');
}

// ─── 计算目标目录名 ──────────────────────────────────────────

/** 基于 persona.name 计算发布目录名；slug 化为空时 fallback persona id */
function resolveTargetDirName(personaName: string, personaId: string): string {
  const slug = slugifyName(personaName);
  return slug || personaId;
}

// ─── 发布 ───────────────────────────────────────────────────

/**
 * 发布 Persona 为 Skill。
 *
 * @param id        persona id
 * @param overwrite 是否在场景 D（跨 persona 冲突）时强制覆盖
 * @returns         结构化结果，前端据此决定是否弹确认或显示成功
 */
export async function publishPersona(
  id: string,
  overwrite = false
): Promise<PublishResult> {
  const meta = await readPersonaMeta(id);
  const skillMd = await readSkillMd(id).catch(() => '');
  if (!skillMd.trim()) {
    return { ok: false, reason: 'no_skill_md' };
  }

  const targetDirName = resolveTargetDirName(meta.name, meta.id);
  const targetDir = getPublishedSkillDirByName(targetDirName);
  const currentPublished = meta.published_dir;
  const targetExists = fs.existsSync(targetDir);

  // 场景 A：首次发布，目标目录不存在
  if (!targetExists && !currentPublished) {
    return await writePublished(id, targetDirName, skillMd);
  }

  // 场景 B：重发布同一 persona（目标目录 = 当前 published_dir）
  if (currentPublished === targetDirName) {
    return await writePublished(id, targetDirName, skillMd);
  }

  // 场景 C：重命名后重发布（旧目录是自己的，新目录不存在）
  if (currentPublished && !targetExists) {
    // 删除旧目录
    const oldDir = getPublishedSkillDirByName(currentPublished);
    if (fs.existsSync(oldDir)) {
      await fsp.rm(oldDir, { recursive: true, force: true });
      log.info(`Persona ${id}: 重命名后重发布，删除旧目录 ${currentPublished}`);
    }
    return await writePublished(id, targetDirName, skillMd);
  }

  // 场景 D：跨 persona 冲突——目标目录存在但不是当前 persona 的发布目录
  if (targetExists && currentPublished !== targetDirName) {
    if (!overwrite) {
      return {
        ok: false,
        reason: 'directory_taken',
        dir: targetDir,
        slug: targetDirName,
      };
    }
    // 强制覆盖：先删除旧的发布目录（如果有，与目标不同）
    if (currentPublished && currentPublished !== targetDirName) {
      const oldDir = getPublishedSkillDirByName(currentPublished);
      if (fs.existsSync(oldDir)) {
        await fsp.rm(oldDir, { recursive: true, force: true });
        log.info(`Persona ${id}: 强制覆盖，先删除旧 published_dir ${currentPublished}`);
      }
    }
    // 删除目标位置的旧 Skill
    await fsp.rm(targetDir, { recursive: true, force: true });
    log.warn(`Persona ${id}: 强制覆盖发布目录 ${targetDirName}（原内容已被替换）`);
    return await writePublished(id, targetDirName, skillMd);
  }

  // 兜底（理论上不会到达）：直接写入目标
  return await writePublished(id, targetDirName, skillMd);
}

async function writePublished(
  id: string,
  dirName: string,
  skillMd: string
): Promise<PublishResult> {
  const targetDir = getPublishedSkillDirByName(dirName);
  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.writeFile(publishedSkillPath(dirName), skillMd, 'utf-8');
  await updatePersonaPublishInfo(id, dirName);
  log.info(`Persona 已发布: ${id} → ${publishedSkillPath(dirName)}`);
  return { ok: true, publishedDir: dirName };
}

// ─── 撤销发布 ───────────────────────────────────────────────

/**
 * 撤销发布。
 * 优先按 meta.published_dir 删除；旧数据无该字段时按 persona id 兼容处理。
 */
export async function unpublishPersona(id: string): Promise<void> {
  let dirName: string;
  try {
    const meta = await readPersonaMeta(id);
    dirName = meta.published_dir ?? id;
  } catch {
    dirName = id;
  }

  const dir = getPublishedSkillDirByName(dirName);
  if (fs.existsSync(dir)) {
    await fsp.rm(dir, { recursive: true, force: true });
    log.info(`Persona 已撤销发布: ${id} (目录 ${dirName})`);
  }
  await updatePersonaPublishInfo(id, null);
}

/**
 * 检查 Persona 是否已发布（meta.status='published' 即视为已发布）。
 * 不再依赖文件存在性判断，因为目录名不再是 persona id。
 */
export async function isPublished(id: string): Promise<boolean> {
  try {
    const meta = await readPersonaMeta(id);
    return meta.status === 'published';
  } catch {
    return false;
  }
}
