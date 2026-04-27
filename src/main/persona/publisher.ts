/**
 * Publisher — 将 persona SKILL.md 发布到 userData/skills/
 *
 * 发布：复制 personas/<id>/SKILL.md → skills/<id>/SKILL.md
 *       更新 personas/<id>/meta.json status → 'published'
 *
 * 撤销发布：删除 skills/<id>/ 目录
 *           更新 meta.json status → 'draft'
 *
 * Skill 系统的 SkillLoader 会在下次扫描 userData/skills/ 时自动发现
 * 新发布的 Skill（kind=persona，因无工具声明），无需任何改动。
 */
import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { readSkillMd, updatePersonaStatus } from './persona-store';
import { createLogger } from '../logger';

const log = createLogger('Publisher');

function publishedSkillDir(id: string): string {
  return path.join(app.getPath('userData'), 'skills', id);
}

function publishedSkillPath(id: string): string {
  return path.join(publishedSkillDir(id), 'SKILL.md');
}

/** 发布 persona 为 Skill */
export async function publishPersona(id: string): Promise<void> {
  const skillMd = await readSkillMd(id);
  if (!skillMd.trim()) {
    throw new Error(`Persona "${id}" 的 SKILL.md 为空，无法发布`);
  }

  const targetDir = publishedSkillDir(id);
  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.writeFile(publishedSkillPath(id), skillMd, 'utf-8');
  await updatePersonaStatus(id, 'published');

  log.info(`Persona 已发布为 Skill: ${id} → ${publishedSkillPath(id)}`);
}

/** 撤销发布（删除 skills/<id>/ 目录） */
export async function unpublishPersona(id: string): Promise<void> {
  const dir = publishedSkillDir(id);
  if (fs.existsSync(dir)) {
    await fsp.rm(dir, { recursive: true, force: true });
    log.info(`Persona 已撤销发布: ${id}`);
  }
  await updatePersonaStatus(id, 'draft');
}

/** 检查 persona 是否已发布（skills/ 目录下存在对应文件） */
export function isPublished(id: string): boolean {
  return fs.existsSync(publishedSkillPath(id));
}
