/**
 * Skill 框架类型定义（精简版）
 *
 * 移植自外部项目 Skill 系统，裁剪了所有桌宠领域特定字段：
 * - 无渐进式加载（autoActivate / activate_tools）
 * - 无风险确认弹窗（V1 仅 SAFE 工具）
 * - 无 ExternalToolSource / MCP
 * - 无 fileHandlers / pluginManifest
 * - 无 onActivate / onDeactivate 生命周期
 * - SkillContext 精简到仅 3 个字段
 *
 * SKILL.md 规范：
 * - 每个 Skill 是一个目录，包含 SKILL.md（YAML frontmatter + Markdown 指令）
 * - 可选 scripts/ 子目录存放工具执行脚本（.cjs）
 * - metadata 命名空间使用 "toolbox"（区别于外部项目的 "clawpet"）
 */
import type { LLMToolDef } from '../llm/types';

// ─── SKILL.md Frontmatter 类型 ───────────────────────────

/** SKILL.md frontmatter 解析结果 */
export interface SkillManifest {
  /** Skill 唯一名称（小写字母 + 连字符，最长 64 字符） */
  name: string;
  /** Skill 描述（最长 1024 字符） */
  description: string;
  /** 扩展元数据 */
  metadata?: {
    toolbox?: ToolboxSkillMetadata;
    [key: string]: unknown;
  };
}

/** ToolBox 特有的 Skill 元数据 */
export interface ToolboxSkillMetadata {
  /** 语义版本号 */
  version?: string;
  /** Skill 图标（emoji） */
  emoji?: string;
  /** 工具定义列表 */
  tools?: SkillToolManifest[];
}

// ─── 工具清单声明（SKILL.md 中） ──────────────────────────

/** 工具在 SKILL.md frontmatter 中的声明格式 */
export interface SkillToolManifest {
  /** 工具名称 */
  name: string;
  /** 用户界面显示名称 */
  displayName?: string;
  /** 工具描述（传递给 LLM） */
  description: string;
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  /** 风险级别：MODERATE 需要用户确认 */
  riskLevel?: 'SAFE' | 'MODERATE';
  /** 对应的脚本入口（相对于 Skill 目录的路径） */
  scriptEntry?: string;
  /**
   * 确认弹窗中展示给用户的操作描述模板。
   * 支持 {paramName} 语法引用工具输入参数，渲染时自动替换。
   * 例如: "移动: {source} → {destination}"
   * 未设置时使用 displayName 作为兜底描述。
   */
  confirmHint?: string;
}

// ─── Skill 运行时上下文 ───────────────────────────────────

/**
 * SkillContext — Skill 脚本运行时可访问的上下文（精简版）
 *
 * 外部项目有 20+ 字段，我们只保留工具脚本真正需要的 3 个。
 */
export interface SkillContext {
  /** SKILL.md 所在目录（绝对路径，只读） */
  skillDir: string;
  /**
   * Skill 专属缓存目录（绝对路径）
   * 路径: userData/skill-data/<skillName>/
   * 目录在工具执行时自动创建。
   */
  dataDir: string;
  /** 当前被调用的工具名称（同一脚本服务多个工具时用于区分） */
  toolName: string;
}

// ─── 运行时 Skill 工具定义 ────────────────────────────────

/** SkillToolDefinition — 运行时的工具定义（含执行函数） */
export interface SkillToolDefinition {
  /** 工具名称（全局唯一） */
  name: string;
  /** 用户界面显示名称 */
  displayName?: string;
  /** 工具描述（传递给 LLM） */
  description: string;
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  /** 风险级别 */
  riskLevel: 'SAFE' | 'MODERATE';
  /**
   * 确认弹窗中展示给用户的操作描述模板。
   * 支持 {paramName} 语法引用工具输入参数。
   */
  confirmHint?: string;
  /** 工具执行函数 */
  execute: (
    input: Record<string, unknown>,
    context: SkillContext
  ) => Promise<unknown>;
}

// ─── 运行时 Skill 定义 ────────────────────────────────────

/** SkillDefinition — 完整的运行时 Skill 定义 */
export interface SkillDefinition {
  /** Skill 唯一名称 */
  name: string;
  /** 人类可读描述 */
  description: string;
  /** SKILL.md 的完整 Markdown body（Agent 指令） */
  instructions: string;
  /** 解析出的 frontmatter 元数据 */
  manifest: SkillManifest;
  /** Skill 目录的绝对路径 */
  skillDir: string;
  /** 是否为内置 Skill */
  builtin: boolean;
  /** Skill 提供的工具列表 */
  tools: SkillToolDefinition[];
}

// ─── 输出格式转换 ─────────────────────────────────────────

/** 将 SkillToolDefinition 转换为统一 LLM 工具格式 */
export function toLLMTool(tool: SkillToolDefinition): LLMToolDef {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}
