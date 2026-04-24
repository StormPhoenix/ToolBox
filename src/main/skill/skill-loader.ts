/**
 * SkillLoader — SKILL.md 解析器和 Skill 目录发现/加载
 *
 * 移植自外部项目，裁剪了：
 * - OpenClaw 兼容元数据（openclaw 命名空间）
 * - fileHandlers / plugin 配置
 * - onActivate / onDeactivate 生命周期
 * - requires.bins / env 兼容性检查
 * - OS gate 检查
 *
 * 保留核心：
 * 1. 发现：扫描内置、用户目录中的 Skill 目录
 * 2. 解析：读取 SKILL.md，解析 YAML frontmatter + Markdown body
 * 3. 加载：从 scripts/ 目录导入工具执行函数
 * 4. 组装：将 manifest + instructions + tools 组装为 SkillDefinition
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import yaml from 'js-yaml';
import type {
  SkillManifest,
  SkillDefinition,
  SkillToolDefinition,
  SkillToolManifest,
  SkillContext,
} from './types';
import { createLogger } from '../logger';

const log = createLogger('SkillLoader');

// ─── SKILL.md 解析 ───────────────────────────────────────

/**
 * 解析 SKILL.md 文件内容
 * 返回 frontmatter（SkillManifest）和 Markdown body（instructions）
 */
export function parseSkillMd(content: string): {
  manifest: SkillManifest;
  instructions: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error('SKILL.md 缺少 YAML frontmatter（需要 --- 包裹）');
  }

  const yamlStr = match[1];
  const body = match[2].trim();

  const manifest = parseSimpleYaml(yamlStr);

  // 回退逻辑：如果顶层没有 name/description，尝试从 metadata.toolbox 提取
  const toolbox = (manifest.metadata as Record<string, unknown>)?.toolbox as
    | Record<string, unknown>
    | undefined;
  if ((!manifest.name || typeof manifest.name !== 'string') && toolbox?.name) {
    manifest.name = toolbox.name as string;
  }
  if (
    (!manifest.description || typeof manifest.description !== 'string') &&
    toolbox?.description
  ) {
    manifest.description =
      typeof toolbox.description === 'string'
        ? toolbox.description.trim()
        : String(toolbox.description).trim();
  }

  // 验证必填字段
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('SKILL.md frontmatter 缺少必填字段: name');
  }
  if (!manifest.description || typeof manifest.description !== 'string') {
    throw new Error('SKILL.md frontmatter 缺少必填字段: description');
  }

  // 验证 name 格式（小写字母 + 数字 + 连字符/下划线，最长 64 字符）
  if (manifest.name.length > 64) {
    throw new Error(`Skill name 超过 64 字符限制: "${manifest.name}"`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]$/.test(manifest.name)) {
    throw new Error(
      `Skill name 格式无效: "${manifest.name}"（需要小写字母、数字、连字符或下划线）`
    );
  }

  return {
    manifest: manifest as unknown as SkillManifest,
    instructions: body,
  };
}

/**
 * 解析 YAML frontmatter 字符串为对象
 * 使用 js-yaml 库解析，支持完整 YAML 1.2 语法。
 * 解析后自动将顶层 kebab-case 键转为 camelCase。
 */
function parseSimpleYaml(yamlStr: string): Record<string, unknown> {
  const raw = yaml.load(yamlStr);
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const camelKey = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

// ─── Skill 目录发现 ──────────────────────────────────────

export interface SkillSearchPaths {
  /** 内置 Skill 目录（随应用分发） */
  builtinDir: string;
  /** 用户 Skill 目录（userData/skills/） */
  userDir: string;
}

/** 获取默认的 Skill 搜索路径 */
export function getDefaultSearchPaths(): SkillSearchPaths {
  return {
    builtinDir: getBuiltinSkillsDir(),
    userDir: getUserSkillsDir(),
  };
}

/** 获取内置 Skill 目录（区分开发/生产环境） */
function getBuiltinSkillsDir(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'dist',
      'main',
      'skill',
      'builtin-skills'
    );
  }
  // 开发环境：dist/main/skill/builtin-skills（由 copy-skills 脚本拷贝）
  // 回退到源码目录（方便未构建时也能加载）
  const distDir = path.join(__dirname, 'skill', 'builtin-skills');
  if (fs.existsSync(distDir)) return distDir;
  return path.resolve(__dirname, '..', '..', 'src', 'main', 'skill', 'builtin-skills');
}

/** 获取用户 Skill 目录 */
function getUserSkillsDir(): string {
  return path.join(app.getPath('userData'), 'skills');
}

/**
 * 发现所有可用的 Skill 目录
 * 按优先级排序：user > builtin（同名 Skill 高优先级覆盖低优先级）
 */
export function discoverSkillDirs(
  paths: SkillSearchPaths
): Map<string, string> {
  const skills = new Map<string, string>();

  // 按优先级从低到高扫描（后扫描的覆盖先扫描的）
  const dirsToScan: Array<{ dir: string; label: string }> = [
    { dir: paths.builtinDir, label: 'builtin' },
    { dir: paths.userDir, label: 'user' },
  ];

  for (const { dir, label } of dirsToScan) {
    if (!fs.existsSync(dir)) continue;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          skills.set(entry.name, path.join(dir, entry.name));
          log.info(`发现 Skill: ${entry.name} (${label}: ${dir})`);
        }
      }
    } catch (err) {
      log.warn(`扫描目录失败 ${dir}:`, err);
    }
  }

  return skills;
}

// ─── Skill 加载 ──────────────────────────────────────────

/** 从目录加载单个 Skill */
export async function loadSkillFromDir(
  skillDir: string,
  isBuiltin: boolean = false
): Promise<SkillDefinition> {
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`SKILL.md 不存在: ${skillMdPath}`);
  }

  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const { manifest, instructions } = parseSkillMd(content);

  const tools = await loadSkillTools(skillDir, manifest);

  return {
    name: manifest.name,
    description: manifest.description,
    instructions,
    manifest,
    skillDir,
    builtin: isBuiltin,
    tools,
  };
}

// ─── 工具定义校验 ────────────────────────────────────────

function validateToolManifest(
  tool: Record<string, unknown>,
  skillName: string,
  index: number
): string[] {
  const errors: string[] = [];
  const prefix = `Skill "${skillName}" 的第 ${index + 1} 个工具`;

  if (!tool.name || typeof tool.name !== 'string') {
    errors.push(`${prefix}: 缺少 name 字段或类型错误（需要非空字符串）`);
  }

  const toolName =
    typeof tool.name === 'string' ? `"${tool.name}"` : `#${index + 1}`;

  if (!tool.description || typeof tool.description !== 'string') {
    errors.push(`${prefix} ${toolName}: 缺少 description 字段`);
  }

  const schema = tool.inputSchema || tool['input-schema'];
  if (!schema) {
    errors.push(`${prefix} ${toolName}: 缺少 inputSchema 字段`);
  } else if (typeof schema !== 'object' || Array.isArray(schema)) {
    errors.push(`${prefix} ${toolName}: inputSchema 必须是对象`);
  } else {
    const s = schema as Record<string, unknown>;
    if (s.type !== 'object') {
      errors.push(`${prefix} ${toolName}: inputSchema.type 必须为 "object"`);
    }
    if (!s.properties || typeof s.properties !== 'object') {
      errors.push(`${prefix} ${toolName}: inputSchema.properties 缺失`);
    }
    if (s.required !== undefined && !Array.isArray(s.required)) {
      errors.push(`${prefix} ${toolName}: inputSchema.required 必须是数组`);
    }
  }

  return errors;
}

// ─── 工具加载 ────────────────────────────────────────────

async function loadSkillTools(
  skillDir: string,
  manifest: SkillManifest
): Promise<SkillToolDefinition[]> {
  const toolManifests = manifest.metadata?.toolbox?.tools;
  if (!toolManifests || toolManifests.length === 0) {
    return [];
  }

  const tools: SkillToolDefinition[] = [];

  for (let i = 0; i < toolManifests.length; i++) {
    const rawTool = toolManifests[i];
    const raw = rawTool as unknown as Record<string, unknown>;

    const errors = validateToolManifest(raw, manifest.name, i);
    if (errors.length > 0) {
      log.error(`工具定义校验失败，跳过加载:\n  ${errors.join('\n  ')}`);
      continue;
    }

    // 兼容 kebab-case 键名 + DANGEROUS → MODERATE 归并（V1 两级风险）
    const rawRiskLevel = (rawTool.riskLevel || (raw['risk-level'] as string)) as
      | 'SAFE'
      | 'MODERATE'
      | 'DANGEROUS'
      | undefined;
    const normalizedRisk: 'SAFE' | 'MODERATE' =
      rawRiskLevel === 'MODERATE' || rawRiskLevel === 'DANGEROUS'
        ? 'MODERATE'
        : 'SAFE';

    const toolManifest: SkillToolManifest = {
      ...rawTool,
      inputSchema: rawTool.inputSchema || (raw['input-schema'] as SkillToolManifest['inputSchema']),
      scriptEntry: rawTool.scriptEntry || (raw['script-entry'] as string | undefined),
      riskLevel: normalizedRisk,
      confirmHint: rawTool.confirmHint || (raw['confirm-hint'] as string | undefined),
    };

    const execute = await loadToolExecutor(skillDir, toolManifest);

    tools.push({
      name: toolManifest.name,
      displayName: toolManifest.displayName,
      description: toolManifest.description,
      inputSchema: toolManifest.inputSchema,
      riskLevel: normalizedRisk,
      confirmHint: toolManifest.confirmHint,
      execute,
    });
  }

  return tools;
}

// ─── 脚本加载 ────────────────────────────────────────────

/** 通用脚本模块加载，支持 .cjs / .mjs / .js */
async function loadScriptModule(
  scriptPath: string
): Promise<Record<string, unknown>> {
  if (scriptPath.endsWith('.cjs')) {
    // Vite 编译主进程为 CJS，import.meta.url 不可用。
    // 使用 Module.createRequire(__filename) 构造 require 实例。
    const Module = require('module') as typeof import('module');
    const localRequire = Module.createRequire(__filename);
    const resolved = localRequire.resolve(scriptPath);
    // 清除模块缓存，确保热更新后加载最新文件
    delete localRequire.cache[resolved];
    return localRequire(scriptPath);
  } else if (scriptPath.endsWith('.mjs')) {
    return await import(`file://${scriptPath.replace(/\\/g, '/')}`);
  } else {
    return await import(`file://${scriptPath.replace(/\\/g, '/')}`);
  }
}

/** 加载工具的执行函数 */
async function loadToolExecutor(
  skillDir: string,
  toolManifest: SkillToolManifest
): Promise<
  (input: Record<string, unknown>, context: SkillContext) => Promise<unknown>
> {
  const scriptEntry =
    toolManifest.scriptEntry || `scripts/${toolManifest.name}.cjs`;
  const scriptPath = path.resolve(skillDir, scriptEntry);

  if (!fs.existsSync(scriptPath)) {
    log.warn(`工具 "${toolManifest.name}" 的脚本不存在: ${scriptPath}`);
    return async () => ({
      error: `工具 "${toolManifest.name}" 的脚本文件缺失`,
    });
  }

  try {
    const mod = await loadScriptModule(scriptPath);
    const executeFn = mod.execute || mod.default;
    if (typeof executeFn !== 'function') {
      throw new Error(`脚本 "${scriptPath}" 未导出 execute 或 default 函数`);
    }

    return executeFn as (
      input: Record<string, unknown>,
      context: SkillContext
    ) => Promise<unknown>;
  } catch (err) {
    log.error(`加载工具脚本失败 "${toolManifest.name}":`, err);
    return async () => ({
      error: `工具 "${toolManifest.name}" 脚本加载失败: ${(err as Error).message}`,
    });
  }
}

// ─── 批量加载 ────────────────────────────────────────────

/** 从所有搜索路径发现并加载所有 Skill */
export async function loadAllSkills(
  paths: SkillSearchPaths
): Promise<SkillDefinition[]> {
  const skillDirs = discoverSkillDirs(paths);
  const skills: SkillDefinition[] = [];

  for (const [name, dir] of skillDirs) {
    try {
      const isBuiltin =
        paths.builtinDir !== '' && dir.startsWith(paths.builtinDir);
      const skill = await loadSkillFromDir(dir, isBuiltin);
      skills.push(skill);
      log.info(
        `已加载 Skill: ${name} ` +
          `(${skill.builtin ? '内置' : '用户'}, ` +
          `${skill.tools.length} 个工具)`
      );
    } catch (err) {
      log.error(`加载 Skill "${name}" 失败:`, err);
    }
  }

  return skills;
}
