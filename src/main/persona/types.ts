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
  /** 留空时使用第一个内置配方 */
  recipe_name?: string;
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
  | { kind: 'synthesis-end'; requestId: string; personaId: string }
  | { kind: 'error'; requestId: string; personaId: string; message: string }
  | { kind: 'aborted'; requestId: string; personaId: string };
