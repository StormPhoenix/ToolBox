/**
 * Distiller — 两阶段蒸馏编排器
 *
 * Phase B-1：对每份材料独立调用 LLM（extraction-prompt.md 驱动），
 *            并行执行，产出各自的压缩摘要。
 * Phase B-2：把所有摘要合并，用配方 body 作为 system prompt 调用 LLM（流式），
 *            产出完整的 SKILL.md 草稿。
 *
 * 蒸馏状态机：
 *   - 每次 distill() 分配一个 requestId
 *   - 进度通过 broadcastEvent 回调推送给 persona-ipc
 *   - 支持 abort(requestId) 中止
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { LLMRouter } from '../llm/router';
import type { PersonaDistillInput, PersonaEvent } from './types';
import { createLogger } from '../logger';

const log = createLogger('Distiller');

/** 单份材料提取的最大输出 token 数（节省合成阶段 context） */
const EXTRACT_MAX_TOKENS = 1024;
/** B-2 合成阶段最大输出 token 数 */
const SYNTHESIS_MAX_TOKENS = 8192;
/** 当前 requestId → AbortController */
const activeRequests = new Map<string, AbortController>();

export type BroadcastFn = (event: PersonaEvent) => void;

// ─── 提取 prompt 加载 ────────────────────────────────────────

let cachedExtractionPrompt: string | null = null;

function loadExtractionPrompt(): string {
  if (cachedExtractionPrompt !== null) return cachedExtractionPrompt;
  const promptPath = path.join(__dirname, 'extraction-prompt.md');
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

/** 重置缓存（开发期修改 extraction-prompt.md 后可调用此函数） */
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
  signal: AbortSignal,
  broadcast: BroadcastFn
): Promise<void> {
  const provider = router.getProvider('persona-synthesis', { requestId });
  if (!provider) throw new Error('LLM 未配置');

  const preamble =
    '（以下是材料摘要，请按配方要求进行蒸馏，' +
    '输出内容将作为 SKILL.md 文件保存，请确保包含合法的 YAML frontmatter。）\n\n';

  const extractionText = extractions
    .map((e, i) => `## 材料摘要 ${i + 1}\n\n${e}`)
    .join('\n\n---\n\n');

  await provider.streamMessage(
    recipeBody,
    [{ role: 'user', content: preamble + extractionText }],
    (chunk) => {
      broadcast({ kind: 'synthesis-chunk', requestId, chunk });
    },
    signal
  );

  broadcast({ kind: 'synthesis-end', requestId });
}

// ─── 公开 API ────────────────────────────────────────────────

/**
 * 启动蒸馏流程，立即返回 requestId。
 * 蒸馏异步执行，进度通过 broadcast 推送。
 */
export function distill(
  router: LLMRouter,
  input: PersonaDistillInput,
  recipeLookup: (name: string) => { body: string } | undefined,
  broadcast: BroadcastFn
): string {
  const requestId = randomUUID();
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const { signal } = controller;

  void (async () => {
    try {
      const recipe = recipeLookup(input.recipe_name);
      if (!recipe) throw new Error(`未找到配方: ${input.recipe_name}`);

      if (!router.isAvailable()) throw new Error('LLM 未配置，请先在设置中配置 API Key');

      const { materials } = input;
      const total = materials.length;

      // Phase B-1：并行提取（各材料独立）
      const extractionPromises = materials.map(async (mat, idx) => {
        broadcast({ kind: 'extract-start', requestId, sourceIndex: idx, total });
        const result = await extractSingle(router, mat, requestId, signal);
        broadcast({ kind: 'extract-done', requestId, sourceIndex: idx });
        return result;
      });

      const extractions = await Promise.all(extractionPromises);

      if (signal.aborted) {
        broadcast({ kind: 'aborted', requestId });
        return;
      }

      // Phase B-2：流式合成
      await synthesize(router, recipe.body, extractions, requestId, signal, broadcast);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (
        msg.includes('AbortError') ||
        msg.includes('aborted') ||
        msg.includes('abort') ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        broadcast({ kind: 'aborted', requestId });
      } else {
        log.error(`蒸馏失败 [${requestId}]: ${msg}`);
        broadcast({ kind: 'error', requestId, message: msg });
      }
    } finally {
      activeRequests.delete(requestId);
    }
  })();

  return requestId;
}

/** 中止指定蒸馏请求 */
export function abortDistill(requestId: string): void {
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    log.info(`蒸馏已中止: ${requestId}`);
  }
}
