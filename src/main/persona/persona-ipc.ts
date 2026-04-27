/**
 * Persona IPC Handlers
 *
 * 注册以下 IPC 通道：
 *   persona:list-recipes     — 列出所有配方
 *   persona:fetch-url        — 抓取 URL 返回文本（材料收集用）
 *   persona:distill          — 启动蒸馏（异步，事件通过 persona:event 推送）
 *   persona:distill-abort    — 中止蒸馏
 *   persona:save             — 保存/更新 persona（draft）
 *   persona:list             — 列出所有 persona
 *   persona:load             — 加载 persona 详情
 *   persona:delete           — 删除 persona（同时撤销发布）
 *   persona:publish          — 发布为 Skill
 *   persona:unpublish        — 撤销发布
 *   persona:open-recipe-dir  — 在 Finder 打开用户配方目录
 *
 * 事件推送（向所有渲染进程）：
 *   persona:event            — PersonaEvent 联合类型
 */
import { ipcMain, webContents, shell, app } from 'electron';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { LLMRouter } from '../llm/router';
import type { PersonaDistillInput, PersonaEvent, PersonaSaveInput } from './types';
import type { RecipeRegistry } from './recipe-registry';
import { loadAllRecipes, getUserRecipesDir } from './recipe-loader';
import { fetchUrlContent } from './material-collector';
import { distill, abortDistill } from './distiller';
import {
  savePersona,
  listPersonas,
  loadPersona,
  deletePersona,
  loadMaterialContents,
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

  // ── persona:distill ───────────────────────────────────────
  ipcMain.handle('persona:distill', (_e, input: PersonaDistillInput) => {
    if (!routerRef) return { requestId: null, error: 'LLM 未初始化' };
    const requestId = distill(
      routerRef,
      input,
      (name) => registryRef?.getRecipe(name),
      broadcastEvent
    );
    log.info(`蒸馏已启动: ${requestId} (配方: ${input.recipe_name}, 材料: ${input.materials.length})`);
    return { requestId };
  });

  // ── persona:distill-abort ─────────────────────────────────
  ipcMain.handle('persona:distill-abort', (_e, requestId: string) => {
    abortDistill(requestId);
  });

  // ── persona:save ──────────────────────────────────────────
  ipcMain.handle('persona:save', async (_e, input: PersonaSaveInput) => {
    const meta = await savePersona(input);
    return meta;
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
    // 先撤销发布，再删除 persona 目录
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

  // ── persona:load-materials ────────────────────────────────
  ipcMain.handle('persona:load-materials', async (_e, id: string) => {
    const result = await loadPersona(id);
    if (!result) return [];
    return loadMaterialContents(id, result.meta.sources);
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

  log.info(`Persona 系统初始化完成: ${registry.size} 个配方`);
}
