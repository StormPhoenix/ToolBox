/**
 * Persona IPC Handlers（工作区模型）
 *
 * 注册以下 IPC 通道：
 *   persona:list-recipes              — 列出所有配方
 *   persona:fetch-url                 — 抓取 URL 返回文本（材料收集用）
 *   persona:create                    — 创建占位 Persona
 *   persona:add-material              — 追加单份材料（即时落盘）
 *   persona:remove-material           — 删除单份材料
 *   persona:rename                    — 重命名 Persona
 *   persona:set-recipe                — 切换 Persona 关联的配方
 *   persona:save-skill-md             — 保存 SKILL.md 文本编辑
 *   persona:distill                   — 启动蒸馏（异步）
 *   persona:distill-abort             — 中止蒸馏
 *   persona:list-active-distillations — 返回当前正在蒸馏的 personaId 列表
 *   persona:list                      — 列出所有 Persona
 *   persona:load                      — 加载 Persona 详情
 *   persona:delete                    — 删除 Persona（同时撤销发布）
 *   persona:publish                   — 发布为 Skill
 *   persona:unpublish                 — 撤销发布
 *   persona:open-recipe-dir           — 在 Finder 打开用户配方目录
 *
 * 事件推送（向所有渲染进程）：
 *   persona:event                     — PersonaEvent 联合类型（含 personaId）
 */
import { ipcMain, webContents, shell, app } from 'electron';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { LLMRouter } from '../llm/router';
import type {
  PersonaCreateInput,
  PersonaAddMaterialInput,
  PersonaSaveSkillMdInput,
  PersonaDistillInput,
  PersonaEvent,
} from './types';
import type { RecipeRegistry } from './recipe-registry';
import { loadAllRecipes, getUserRecipesDir } from './recipe-loader';
import { fetchUrlContent } from './material-collector';
import {
  distill,
  abortDistill,
  getActiveDistillations,
} from './distiller';
import {
  createPersona,
  addMaterial,
  removeMaterial,
  renamePersona,
  setRecipe,
  saveSkillMd,
  listPersonas,
  loadPersona,
  deletePersona,
} from './persona-store';
import { publishPersona, unpublishPersona } from './publisher';
import { createLogger } from '../logger';

const log = createLogger('Persona-IPC');

let routerRef: LLMRouter | null = null;
let registryRef: RecipeRegistry | null = null;

// ─── 事件广播 ────────────────────────────────────────────────

function broadcastEvent(event: PersonaEvent): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send('persona:event', event);
  }
}

// ─── Handler 注册 ────────────────────────────────────────────

function registerPersonaHandlers(router: LLMRouter, registry: RecipeRegistry): void {
  routerRef = router;
  registryRef = registry;

  // ── persona:list-recipes ──────────────────────────────────
  ipcMain.handle('persona:list-recipes', () => {
    if (!registryRef) return [];
    return registryRef.listRecipes().map(r => ({
      name: r.name,
      description: r.description,
      suitable_for: r.suitable_for,
      builtin: r.builtin,
    }));
  });

  // ── persona:fetch-url ─────────────────────────────────────
  ipcMain.handle('persona:fetch-url', async (_e, url: string) => {
    try {
      const content = await fetchUrlContent(url);
      return { ok: true, content };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ── persona:create ────────────────────────────────────────
  ipcMain.handle('persona:create', async (_e, input: PersonaCreateInput) => {
    // 默认配方 = 第一个内置
    const recipes = registryRef?.listRecipes() ?? [];
    const fallbackRecipe = recipes.find(r => r.builtin)?.name ?? recipes[0]?.name ?? '';
    const recipeName = input.recipe_name?.trim() || fallbackRecipe;
    if (!recipeName) {
      throw new Error('当前没有可用配方，请先放置或重启应用');
    }
    return createPersona(input.name, recipeName);
  });

  // ── persona:add-material ──────────────────────────────────
  ipcMain.handle('persona:add-material', async (_e, input: PersonaAddMaterialInput) => {
    return addMaterial(input.id, input.type, input.label, input.content);
  });

  // ── persona:remove-material ───────────────────────────────
  ipcMain.handle(
    'persona:remove-material',
    async (_e, id: string, sourceIndex: number) => {
      return removeMaterial(id, sourceIndex);
    }
  );

  // ── persona:rename ────────────────────────────────────────
  ipcMain.handle('persona:rename', async (_e, id: string, newName: string) => {
    return renamePersona(id, newName);
  });

  // ── persona:set-recipe ────────────────────────────────────
  ipcMain.handle('persona:set-recipe', async (_e, id: string, recipeName: string) => {
    return setRecipe(id, recipeName);
  });

  // ── persona:save-skill-md ─────────────────────────────────
  ipcMain.handle('persona:save-skill-md', async (_e, input: PersonaSaveSkillMdInput) => {
    return saveSkillMd(input.id, input.skillMd);
  });

  // ── persona:distill ───────────────────────────────────────
  ipcMain.handle('persona:distill', (_e, input: PersonaDistillInput) => {
    if (!routerRef) return { requestId: '' };
    const requestId = distill(
      routerRef,
      input.id,
      (name) => registryRef?.getRecipe(name),
      broadcastEvent
    );
    log.info(`蒸馏已启动: ${requestId} (persona: ${input.id})`);
    return { requestId };
  });

  // ── persona:distill-abort ─────────────────────────────────
  ipcMain.handle('persona:distill-abort', (_e, requestId: string) => {
    abortDistill(requestId);
  });

  // ── persona:list-active-distillations ─────────────────────
  ipcMain.handle('persona:list-active-distillations', () => {
    return getActiveDistillations();
  });

  // ── persona:list ──────────────────────────────────────────
  ipcMain.handle('persona:list', async () => {
    return listPersonas();
  });

  // ── persona:load ──────────────────────────────────────────
  ipcMain.handle('persona:load', async (_e, id: string) => {
    return loadPersona(id);
  });

  // ── persona:delete ────────────────────────────────────────
  ipcMain.handle('persona:delete', async (_e, id: string) => {
    try {
      await unpublishPersona(id);
    } catch {
      // 未发布时忽略错误
    }
    await deletePersona(id);
    log.info(`Persona 已删除: ${id}`);
  });

  // ── persona:publish ───────────────────────────────────────
  ipcMain.handle('persona:publish', async (_e, id: string) => {
    await publishPersona(id);
  });

  // ── persona:unpublish ─────────────────────────────────────
  ipcMain.handle('persona:unpublish', async (_e, id: string) => {
    await unpublishPersona(id);
  });

  // ── persona:open-recipe-dir ───────────────────────────────
  ipcMain.handle('persona:open-recipe-dir', async () => {
    const recipeDir = getUserRecipesDir();
    if (!existsSync(recipeDir)) {
      mkdirSync(recipeDir, { recursive: true });
    }
    await shell.openPath(recipeDir);
    log.info(`打开配方目录: ${recipeDir}`);
  });

  log.info('Persona IPC handlers 已注册');
}

// ─── 初始化入口 ──────────────────────────────────────────────

/**
 * 初始化 Persona 系统：加载配方 → 填充注册表 → 注册 IPC
 * 在 app.whenReady() 时由 main.ts 调用。
 */
export async function initializePersonaSystem(
  router: LLMRouter,
  registry: RecipeRegistry
): Promise<void> {
  const recipes = await loadAllRecipes();
  for (const recipe of recipes) {
    registry.register(recipe);
  }

  registerPersonaHandlers(router, registry);

  // app 路径未使用但保留 import 语义清晰
  void app;

  log.info(`Persona 系统初始化完成: ${registry.size} 个配方`);
}
