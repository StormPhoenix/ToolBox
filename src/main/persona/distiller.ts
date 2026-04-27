/**
 * Distiller — 两阶段蒸馏编排器
 *
 * Phase B-1：对每份材料独立调用 LLM（extraction-prompt.md 驱动），
 *            并行执行，产出各自的压缩摘要。
 * Phase B-2：把所有摘要合并，用配方 body 作为 system prompt 调用 LLM（流式），
 *            产出完整的 SKILL.md 草稿。
 *
 * 工作区模型下：
 *   - 入参只有 personaId；材料和配方由主进程从磁盘读
 *   - 完成后自动把结果写入 userData/personas/<id>/SKILL.md
 *   - 事件携带 personaId，UI 可全局订阅按 id 路由
 *   - getActiveDistillations() 返回所有"正在进行中"的 personaId 集合
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { LLMRouter } from '../llm/router';
import type { PersonaEvent, PersonaMeta } from './types';
import type { Recipe } from './types';
import { loadMaterialContents, loadPersona, saveSkillMd } from './persona-store';
import { createLogger } from '../logger';

const log = createLogger('Distiller');

/** 单份材料提取的最大输出 token 数（节省合成阶段 context） */
const EXTRACT_MAX_TOKENS = 1024;
/** B-2 合成阶段最大输出 token 数 */
const SYNTHESIS_MAX_TOKENS = 8192;

/** requestId → AbortController */
const activeByRequestId = new Map<string, AbortController>();
/** personaId → requestId（最新的），用于 UI 跟踪 */
const personaToRequest = new Map<string, string>();

export type BroadcastFn = (event: PersonaEvent) => void;
export type RecipeLookup = (name: string) => Recipe | undefined;

// ─── 提取 prompt 加载 ────────────────────────────────────────

let cachedExtractionPrompt: string | null = null;

function loadExtractionPrompt(): string {
  if (cachedExtractionPrompt !== null) return cachedExtractionPrompt;
  // __dirname = dist/main/，需拼上 'persona' 子目录与 copy-personas.mjs 的拷贝目标对齐
  const promptPath = path.join(__dirname, 'persona', 'extraction-prompt.md');
  try {
    cachedExtractionPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
    return cachedExtractionPrompt;
  } catch (err) {
    log.warn(`读取 extraction-prompt.md 失败，使用内置默认值: ${(err as Error).message}`);
    cachedExtractionPrompt = [
      '你是一个材料摘要专家。请从以下材料中提取对理解这个人物至关重要的关键信息，',
      '包括其思维方式、表达风格、核心价值观和决策倾向。',
      '以自由格式输出要点，无需结构化。',
      '若材料与人物无关，输出"无关材料，跳过"。',
    ].join('\n');
    return cachedExtractionPrompt;
  }
}

/** 重置缓存（开发期修改 extraction-prompt.md 后可调用） */
export function resetExtractionPromptCache(): void {
  cachedExtractionPrompt = null;
}

// ─── Phase B-1：单材料提取 ───────────────────────────────────

async function extractSingle(
  router: LLMRouter,
  material: { label: string; content: string },
  requestId: string,
  signal: AbortSignal
): Promise<string> {
  const provider = router.getProvider('persona-extract', { requestId });
  if (!provider) throw new Error('LLM 未配置');

  if (!material.content.trim()) return '';

  const systemPrompt = loadExtractionPrompt();
  const userContent = `材料来源：${material.label}\n\n${material.content}`;

  const response = await provider.createMessage(
    systemPrompt,
    [{ role: 'user', content: userContent }]
  );

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock && 'text' in textBlock ? textBlock.text : '';
}

// ─── Phase B-2：合成 ─────────────────────────────────────────

async function synthesize(
  router: LLMRouter,
  recipeBody: string,
  extractions: string[],
  requestId: string,
  personaId: string,
  signal: AbortSignal,
  broadcast: BroadcastFn
): Promise<string> {
  const provider = router.getProvider('persona-synthesis', { requestId });
  if (!provider) throw new Error('LLM 未配置');

  const preamble =
    '（以下是材料摘要，请按配方要求进行蒸馏，' +
    '输出内容将作为 SKILL.md 文件保存，请确保包含合法的 YAML frontmatter。）\n\n';

  const extractionText = extractions
    .map((e, i) => `## 材料摘要 ${i + 1}\n\n${e}`)
    .join('\n\n---\n\n');

  let fullText = '';
  await provider.streamMessage(
    recipeBody,
    [{ role: 'user', content: preamble + extractionText }],
    (chunk) => {
      fullText += chunk;
      broadcast({ kind: 'synthesis-chunk', requestId, personaId, chunk });
    },
    signal
  );

  return fullText;
}

// ─── 公开 API ────────────────────────────────────────────────

/**
 * 启动蒸馏流程。
 * 立即返回 requestId，蒸馏异步执行，完成后自动落盘 SKILL.md。
 */
export function distill(
  router: LLMRouter,
  personaId: string,
  recipeLookup: RecipeLookup,
  broadcast: BroadcastFn
): string {
  const requestId = randomUUID();
  const controller = new AbortController();
  activeByRequestId.set(requestId, controller);
  personaToRequest.set(personaId, requestId);
  const { signal } = controller;

  void (async () => {
    try {
      // 从磁盘加载最新的 meta + 材料
      const loaded = await loadPersona(personaId);
      if (!loaded) throw new Error(`Persona 不存在: ${personaId}`);
      const meta: PersonaMeta = loaded.meta;

      const recipe = recipeLookup(meta.recipe_name);
      if (!recipe) throw new Error(`未找到配方: ${meta.recipe_name}`);

      if (meta.sources.length === 0) {
        throw new Error('没有可用的材料，请先添加至少 1 份材料');
      }

      if (!router.isAvailable()) throw new Error('LLM 未配置，请先在设置中配置 API Key');

      const materialContents = await loadMaterialContents(personaId, meta.sources);
      const materials = meta.sources.map((s, i) => ({
        label: s.label,
        content: materialContents[i] ?? '',
      }));
      const total = materials.length;

      // Phase B-1：并行提取
      const extractionPromises = materials.map(async (mat, idx) => {
        broadcast({
          kind: 'extract-start',
          requestId,
          personaId,
          sourceIndex: idx,
          total,
        });
        const result = await extractSingle(router, mat, requestId, signal);
        broadcast({ kind: 'extract-done', requestId, personaId, sourceIndex: idx });
        return result;
      });

      const extractions = await Promise.all(extractionPromises);

      if (signal.aborted) {
        broadcast({ kind: 'aborted', requestId, personaId });
        return;
      }

      // Phase B-2：流式合成
      const skillMd = await synthesize(
        router,
        recipe.body,
        extractions,
        requestId,
        personaId,
        signal,
        broadcast
      );

      // 自动落盘 SKILL.md
      await saveSkillMd(personaId, skillMd);

      broadcast({ kind: 'synthesis-end', requestId, personaId });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (
        msg.includes('AbortError') ||
        msg.includes('aborted') ||
        msg.includes('abort') ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        broadcast({ kind: 'aborted', requestId, personaId });
      } else {
        log.error(`蒸馏失败 [${requestId}, persona=${personaId}]: ${msg}`);
        broadcast({ kind: 'error', requestId, personaId, message: msg });
      }
    } finally {
      activeByRequestId.delete(requestId);
      // 仅当当前 persona 关联的 requestId 仍是这一个时清理
      if (personaToRequest.get(personaId) === requestId) {
        personaToRequest.delete(personaId);
      }
    }
  })();

  return requestId;
}

/** 中止指定蒸馏请求 */
export function abortDistill(requestId: string): void {
  const controller = activeByRequestId.get(requestId);
  if (controller) {
    controller.abort();
    log.info(`蒸馏已中止: ${requestId}`);
  }
}

/** 中止指定 Persona 当前的蒸馏（若有） */
export function abortDistillByPersona(personaId: string): void {
  const requestId = personaToRequest.get(personaId);
  if (requestId) abortDistill(requestId);
}

/** 返回所有正在进行中的 personaId 列表 */
export function getActiveDistillations(): string[] {
  return Array.from(personaToRequest.keys());
}
