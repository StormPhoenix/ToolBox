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
import type { LLMMessageParam } from '../llm/types';
import type { PersonaEvent, PersonaMeta } from './types';
import type { Recipe } from './types';
import { loadMaterialContents, loadPersona, saveSkillMd } from './persona-store';
import { createLogger } from '../logger';

const log = createLogger('Distiller');

/** 单份材料提取的最大输出 token 数（节省合成阶段 context） */
const EXTRACT_MAX_TOKENS = 1024;
/** B-2 合成阶段最大输出 token 数（每轮单次调用上限） */
const SYNTHESIS_MAX_TOKENS = 8192;
/**
 * 合成阶段最大轮次（首轮 + 续写轮次合计）。
 *
 * 当 LLM 返回 stop_reason='max_tokens' 时自动追加一轮续写：
 * 把已生成内容作为 assistant 消息回传给 LLM，再发一条 "请接续" 的 user 指令。
 * 达到上限仍未自然结束 → synthesis-end 事件携带 truncated:true，UI 警告用户。
 *
 * 5 轮 × 当前 maxTokens 通常足以覆盖绝大多数 SKILL.md 长度需求；
 * 极端情况建议用户在 Settings 调高全局 maxTokens 后重新蒸馏。
 */
const MAX_SYNTHESIS_ROUNDS = 5;

/** 续写指令文案（每轮 max_tokens 截断后追加的 user 消息内容） */
const CONTINUATION_PROMPT = [
  '上一段输出因达到长度上限被截断。请从中断处直接继续输出剩余内容：',
  '- 不要重复任何已写过的内容',
  '- 不要重新输出 YAML frontmatter',
  '- 不要说"好的"、"我继续"或任何过渡语',
  '- 直接以原文断点处的下一个字符开始',
].join('\n');

/**
 * 合成阶段强制运行约束（追加到配方 system prompt 末尾）。
 *
 * 用于覆盖外部导入配方（如 nvwa-skill 等 agentic Skill）中描述的多步流程，
 * 防止 LLM 在 ToolBox 单次蒸馏环境下输出"执行过程报告"而非"最终 SKILL.md"。
 *
 * 利用"最近指令"原则：放在配方 body 之后，权重高于配方原本的 Phase 流程指令。
 * 与 SYNTHESIS_USER_CONTRACT 形成 system + user 双重锁定。
 */
const SYNTHESIS_SYSTEM_CONSTRAINT = [
  '',
  '---',
  '',
  '## 强制运行约束（覆盖以上 prompt 中所有相关指令）',
  '',
  '你正在 ToolBox Persona Studio 的"单次离线蒸馏"环境中运行，',
  '与 agentic 类 prompt 设计有本质差异：',
  '',
  '1. **无对话能力**：忽略所有"检查点 / 用户确认 / 暂停展示"等交互环节。',
  '2. **无工具调用**：忽略所有 WebSearch / subagent / bash / 文件读写指令。',
  '3. **无文件副作用**：不创建任何目录或文件，不在输出中描述"已创建 X"。',
  '4. **单次完整输出**：跳过所有 Phase 中间产物（调研笔记、提炼报告、质量摘要等）。',
  '5. **材料即全部输入**：不假设可以补充搜索或读取其他文件。',
  '',
  '无论上方配方如何描述多步流程，你的本次输出只需是一份最终的 SKILL.md。',
].join('\n');

/**
 * 合成阶段输出契约（追加到 user message 末尾）。
 *
 * 作为 LLM 准备生成前最后看到的指令（最强位置），
 * 用结构化锚点（"第一个非空字符必须是 -"）规定输出形态。
 * 与 SYNTHESIS_SYSTEM_CONSTRAINT 形成双重锁定。
 */
const SYNTHESIS_USER_CONTRACT = [
  '',
  '---',
  '',
  '【输出契约 · 严格遵守】',
  '',
  '你的输出必须直接是一份完整、可保存的 SKILL.md 文件：',
  '',
  '1. 第一个非空字符必须是 `-`（YAML frontmatter 起始）',
  '2. 不输出任何前置说明（"# 蒸馏中"、"收到材料"、"## Phase X" 等）',
  '3. 不描述任何过程（目录结构、调研笔记、提炼步骤、检查点等）',
  '4. 不模拟任何工具调用（"已创建..."、"启动 subagent..."、"调用 WebSearch..."）',
  '5. 整份输出 = YAML frontmatter + Markdown body，按配方期望的章节组织内容',
  '',
  '现在直接以 `---` 开始输出 SKILL.md：',
].join('\n');

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
    [{ role: 'user', content: userContent }],
    undefined,
    undefined,
    signal
  );

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock && 'text' in textBlock ? textBlock.text : '';
}

// ─── Phase B-2：合成（含 max_tokens 续写循环） ────────────────

interface SynthesisResult {
  /** 累积的完整文本（所有轮次拼接） */
  text: string;
  /** true 表示达到最大轮次仍未自然结束，输出可能不完整 */
  truncated: boolean;
}

async function synthesize(
  router: LLMRouter,
  recipeBody: string,
  extractions: string[],
  requestId: string,
  personaId: string,
  signal: AbortSignal,
  broadcast: BroadcastFn
): Promise<SynthesisResult> {
  const preamble =
    '（以下是材料摘要，请按配方要求进行蒸馏，' +
    '输出内容将作为 SKILL.md 文件保存，请确保包含合法的 YAML frontmatter。）\n\n';

  const extractionText = extractions
    .map((e, i) => `## 材料摘要 ${i + 1}\n\n${e}`)
    .join('\n\n---\n\n');

  // ─── 双重锁定：覆盖 agentic 配方的多步流程指令 ───
  //
  // 位置 1：system prompt 末尾追加 SYNTHESIS_SYSTEM_CONSTRAINT
  //   - 利用"最近指令"原则覆盖配方原本的 Phase 流程描述
  //   - 让 LLM 知道当前是单次离线蒸馏，无对话/工具/文件能力
  //
  // 位置 2：user message 末尾追加 SYNTHESIS_USER_CONTRACT
  //   - 作为 LLM 准备生成前最后看到的指令（最强位置）
  //   - 用结构化锚点（"第一个非空字符必须是 -"）规定输出形态
  //
  // 两处共同防止 LLM 输出"执行过程报告"而非"最终 SKILL.md"。
  // 详见各常量上方注释及 docs/design/backlog.md 中关于 agentic 配方的说明。
  const systemPrompt = recipeBody + SYNTHESIS_SYSTEM_CONSTRAINT;
  const userMessage = preamble + extractionText + SYNTHESIS_USER_CONTRACT;

  // 对话历史：续写时不断累积 assistant 响应 + 续写指令
  const messages: LLMMessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let fullText = '';
  let stopReason: string = 'end_turn';
  let round = 0;

  do {
    round++;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    if (round > 1) {
      broadcast({
        kind: 'continuation-start',
        requestId,
        personaId,
        round,
        max: MAX_SYNTHESIS_ROUNDS,
      });
      log.info(
        `[${requestId}] synthesis 续写第 ${round}/${MAX_SYNTHESIS_ROUNDS} 轮（上轮 stop_reason=max_tokens）`
      );
    }

    // 每轮独立 provider 实例：iteration 区分 dump 文件，便于排查
    const provider = router.getProvider('persona-synthesis', {
      requestId,
      iteration: round,
    });
    if (!provider) throw new Error('LLM 未配置');

    let roundText = '';
    const response = await provider.streamMessage(
      systemPrompt,
      messages,
      (chunk) => {
        roundText += chunk;
        fullText += chunk;
        broadcast({ kind: 'synthesis-chunk', requestId, personaId, chunk });
      },
      signal
    );

    stopReason = response.stop_reason;

    // 仍未结束且未到上限：把本轮 assistant 输出 + 续写指令加入历史，进入下一轮
    if (stopReason === 'max_tokens' && round < MAX_SYNTHESIS_ROUNDS) {
      messages.push({ role: 'assistant', content: roundText });
      messages.push({ role: 'user', content: CONTINUATION_PROMPT });
    }
  } while (stopReason === 'max_tokens' && round < MAX_SYNTHESIS_ROUNDS);

  const truncated = stopReason === 'max_tokens';
  if (truncated) {
    log.warn(
      `[${requestId}] synthesis 达到最大续写轮次 ${MAX_SYNTHESIS_ROUNDS} 仍未结束，输出可能不完整`
    );
  }
  return { text: fullText, truncated };
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

      // Phase B-2：流式合成（含 max_tokens 续写循环）
      const synthesis = await synthesize(
        router,
        recipe.body,
        extractions,
        requestId,
        personaId,
        signal,
        broadcast
      );

      // 自动落盘 SKILL.md（即使 truncated 也保留，让用户在 Review 阶段决定）
      await saveSkillMd(personaId, synthesis.text);

      broadcast({
        kind: 'synthesis-end',
        requestId,
        personaId,
        truncated: synthesis.truncated,
      });
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
