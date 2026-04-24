/**
 * Skill IPC Handlers
 *
 * 注册以下 IPC 通道：
 *   skill:list              — 获取所有 Skill 状态列表
 *   skill:toggle            — 启用/禁用指定 Skill
 *   skill:open-dir          — 打开用户 Skill 目录
 *   skill:list-trusted      — 获取永久信任工具列表
 *   skill:untrust           — 撤销某工具的永久信任
 */
import { ipcMain, shell, app } from 'electron';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { SkillRegistry } from './skill-registry';
import {
  readSkillConfig,
  toggleSkill,
  removeTrustedTool,
} from './skill-config';
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
  ipcMain.handle('skill:open-dir', async () => {
    const userSkillsDir = path.join(app.getPath('userData'), 'skills');
    if (!existsSync(userSkillsDir)) {
      mkdirSync(userSkillsDir, { recursive: true });
    }
    await shell.openPath(userSkillsDir);
    log.info(`打开 Skill 目录: ${userSkillsDir}`);
  });

  // ── skill:list-trusted ────────────────────────────────
  ipcMain.handle('skill:list-trusted', async () => {
    if (!registryRef) return [];
    return registryRef.getTrustedToolDetails();
  });

  // ── skill:untrust ─────────────────────────────────────
  ipcMain.handle('skill:untrust', async (_e, toolName: string) => {
    if (!registryRef) return;
    registryRef.removeTrustedTool(toolName);
    await removeTrustedTool(toolName);
    log.info(`已撤销工具 "${toolName}" 的永久信任`);
  });

  log.info('Skill IPC handlers 已注册');
}

/**
 * 初始化 Skill 系统：加载所有 Skill + 应用禁用列表 + 应用信任列表 + 注册 IPC
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

  // 应用禁用列表 + 信任列表
  const config = await readSkillConfig();
  if (config.disabled.length > 0) {
    registry.applyDisabledList(config.disabled);
  }
  if (config.trustedTools.length > 0) {
    registry.applyTrustedList(config.trustedTools);
  }

  registerSkillHandlers(registry);
  log.info(
    `Skill 系统初始化完成: ${registry.size} 个 Skill, ` +
      `已信任 ${config.trustedTools.length} 个工具`
  );
}
