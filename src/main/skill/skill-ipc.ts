/**
 * Skill IPC Handlers
 *
 * 注册以下 IPC 通道：
 *   skill:list         — 获取所有 Skill 状态列表
 *   skill:toggle       — 启用/禁用指定 Skill
 *   skill:open-dir     — 在资源管理器中打开用户 Skill 目录
 *
 * 在 main.ts 中调用 registerSkillHandlers() 完成注册。
 */
import { ipcMain, shell, app } from 'electron';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { SkillRegistry } from './skill-registry';
import { readSkillConfig, toggleSkill } from './skill-config';
import { createLogger } from '../logger';

const log = createLogger('Skill-IPC');

let registryRef: SkillRegistry | null = null;

export function registerSkillHandlers(registry: SkillRegistry): void {
  registryRef = registry;

  // ── skill:list ────────────────────────────────────────
  ipcMain.handle('skill:list', async () => {
    if (!registryRef) return [];
    return registryRef.getSkillList();
  });

  // ── skill:toggle ──────────────────────────────────────
  ipcMain.handle(
    'skill:toggle',
    async (_e, name: string, enabled: boolean) => {
      if (!registryRef) return;
      if (enabled) {
        registryRef.enableSkill(name);
      } else {
        registryRef.disableSkill(name);
      }
      await toggleSkill(name, enabled);
      log.info(`Skill "${name}" ${enabled ? '已启用' : '已禁用'}`);
    }
  );

  // ── skill:open-dir ────────────────────────────────────
  // 在资源管理器中打开用户 Skill 目录（如目录不存在则先创建）
  ipcMain.handle('skill:open-dir', async () => {
    const userSkillsDir = path.join(app.getPath('userData'), 'skills');
    if (!existsSync(userSkillsDir)) {
      mkdirSync(userSkillsDir, { recursive: true });
    }
    await shell.openPath(userSkillsDir);
    log.info(`打开 Skill 目录: ${userSkillsDir}`);
  });

  log.info('Skill IPC handlers 已注册');
}

/**
 * 初始化 Skill 系统：加载所有 Skill + 应用禁用列表 + 注册 IPC
 */
export async function initializeSkillSystem(
  registry: SkillRegistry
): Promise<void> {
  const { loadAllSkills, getDefaultSearchPaths } = await import('./skill-loader');

  const paths = getDefaultSearchPaths();
  const skills = await loadAllSkills(paths);

  for (const skill of skills) {
    registry.register(skill);
  }

  // 应用禁用列表
  const config = await readSkillConfig();
  if (config.disabled.length > 0) {
    registry.applyDisabledList(config.disabled);
  }

  registerSkillHandlers(registry);
  log.info(`Skill 系统初始化完成: ${registry.size} 个 Skill 已加载`);
}
