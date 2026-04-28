/**
 * Persona Studio — 核心类型定义
 *
 * 数据模型：
 *   PersonaMeta    : 持久化在 userData/personas/<id>/meta.json 的元数据
 *   Recipe         : 配方（从 SKILL.md 解析）
 *
 * 工作区模型（V2）：
 *   - "+ 新建"立即创建 Persona 占位（写 meta.json，不写 SKILL.md）
 *   - 添加/删除材料即时落盘
 *   - 蒸馏发起后由主进程从磁盘读取最新材料和配方
 *   - 事件包含 personaId，前端可全局订阅展示活跃状态
 */

// ─── 持久化元数据 ───────────────────────────────────────────

/** 单份材料来源描述（持久化） */
export interface PersonaSourceRef {
  type: 'text' | 'file' | 'url';
  /** 展示用标签：文件名、URL 或 "手动输入" */
  label: string;
  /** materials/ 目录下的文件名（存档内容） */
  stored_as: string;
}

/** persona 产物元数据，写入 meta.json */
export interface PersonaMeta {
  id: string;
  name: string;
  recipe_name: string;
  status: 'draft' | 'published';
  created: string;
  updated: string;
  sources: PersonaSourceRef[];
  /**
   * 已发布到 userData/skills/ 下的目录名（不含路径前缀）。
   * 仅 status='published' 时有值；用于撤销发布时精确删除并支持发布目录命名解耦于 persona id。
   * 旧数据可能没有此字段，unpublish 时按 persona.id fallback。
   */
  published_dir?: string;
  /**
   * 人格来源类型。
   * - 'distilled'：通过材料 + 配方蒸馏产生（默认，旧数据无此字段时视为 distilled）
   * - 'imported'：直接导入用户已有的 SKILL.md 文件
   */
  source_type?: 'distilled' | 'imported';
  /**
   * 导入型人格的原始文件完整路径（仅 source_type='imported' 时有值）。
   * 仅作展示和溯源用途，文件可能已被用户移动/删除。
   */
  imported_from?: string;
}

/** 发布结果（publishPersona 返回值） */
export type PublishResult =
  | { ok: true; publishedDir: string }
  | { ok: false; reason: 'directory_taken'; dir: string; slug: string }
  | { ok: false; reason: 'no_skill_md' };

// ─── 配方 ───────────────────────────────────────────────────

/**
 * 已加载的配方。
 * 配方以 SKILL.md 格式存储；body 即合成阶段的 LLM system prompt。
 */
export interface Recipe {
  name: string;
  description: string;
  /** Phase B-2 合成阶段的 LLM system prompt（即 SKILL.md Markdown body） */
  body: string;
  suitable_for?: string[];
  builtin: boolean;
  /** 配方目录绝对路径 */
  dirPath: string;
}

// ─── IPC 入参 ───────────────────────────────────────────────

/** persona:create 入参 */
export interface PersonaCreateInput {
  /** 留空时主进程生成"未命名人格 HH:mm"占位名 */
  name?: string;
  /** 留空时使用第一个内置配方；source_type='imported' 时忽略此字段 */
  recipe_name?: string;
  /** 来源类型，留空视为 'distilled' */
  source_type?: 'distilled' | 'imported';
  /** 导入型人格的原始文件完整路径（source_type='imported' 时传入） */
  imported_from?: string;
}

/** persona:add-material 入参 */
export interface PersonaAddMaterialInput {
  id: string;
  type: 'text' | 'file' | 'url';
  label: string;
  content: string;
}

/** persona:save-skill-md 入参 */
export interface PersonaSaveSkillMdInput {
  id: string;
  skillMd: string;
}

/** persona:distill 入参 */
export interface PersonaDistillInput {
  /** 已存在的 Persona id；主进程从磁盘读取最新材料和配方 */
  id: string;
}

/** persona:distill 出参 */
export interface PersonaDistillResult {
  requestId: string;
}

/** persona:load 出参 */
export interface PersonaLoadResult {
  meta: PersonaMeta;
  /** 文件不存在时为空字符串，前端据此判断"未蒸馏过" */
  skillMd: string;
}

// ─── 事件 ───────────────────────────────────────────────────

/**
 * 主进程向渲染进程推送的蒸馏进度事件。
 * 所有事件携带 personaId，前端全局订阅按 personaId 路由。
 */
export type PersonaEvent =
  | {
      kind: 'extract-start';
      requestId: string;
      personaId: string;
      sourceIndex: number;
      total: number;
    }
  | {
      kind: 'extract-done';
      requestId: string;
      personaId: string;
      sourceIndex: number;
    }
  | { kind: 'synthesis-chunk'; requestId: string; personaId: string; chunk: string }
  /**
   * 上一轮合成因达到 max_tokens 截断，开始续写。
   * round 为本次进入的轮次（≥2，因为第 1 轮不发此事件），max 为最大允许轮次。
   */
  | {
      kind: 'continuation-start';
      requestId: string;
      personaId: string;
      round: number;
      max: number;
    }
  /**
   * 合成阶段结束。
   * truncated=true 表示达到最大续写次数后仍未自然结束（最终输出可能不完整）。
   */
  | { kind: 'synthesis-end'; requestId: string; personaId: string; truncated: boolean }
  | { kind: 'error'; requestId: string; personaId: string; message: string }
  | { kind: 'aborted'; requestId: string; personaId: string };
