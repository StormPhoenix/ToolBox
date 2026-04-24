/**
 * Skill IPC Handlers
 *
 * 注册以下 IPC 通道：
 *   skill:list         — 获取所有 Skill 状态列表
 *   skill:toggle       — 启用/禁用指定 Skill
 *   skill:web-search-enabled   — 获取联网搜索全局开关
 *   skill:set-web-search       — 设置联网搜索全局开关
 *
 * 在 main.ts 中调用 registerSkillHandlers() 完成注册。
 */
import { ipcMain } from 'electron';
import type { SkillRegistry } from './skill-registry';
import {
  readSkillConfig,
  toggleSkill,
  getWebSearchEnabled,
  setWebSearchEnabled,
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

  // ── skill:web-search-enabled ──────────────────────────
  ipcMain.handle('skill:web-search-enabled', async () => {
    return getWebSearchEnabled();
  });

  // ── skill:set-web-search ──────────────────────────────
  ipcMain.handle(
    'skill:set-web-search',
    async (_e, enabled: boolean) => {
      await setWebSearchEnabled(enabled);
      log.info(`联网搜索全局开关: ${enabled}`);
    }
  );

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
