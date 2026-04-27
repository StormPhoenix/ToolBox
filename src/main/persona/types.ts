/**
 * Persona Studio — 核心类型定义
 *
 * PersonaMeta    : 持久化在 userData/personas/<id>/meta.json 的元数据
 * Recipe         : 配方（从 SKILL.md 解析）
 * PersonaMaterial: 单份输入材料（含内容，仅用于传输，不持久化）
 * PersonaEvent   : 主进程向渲染进程推送的蒸馏进度事件
 */

// ─── 持久化元数据 ───────────────────────────────────────────

/** 单份材料来源描述（持久化）*/
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
}

// ─── 配方 ───────────────────────────────────────────────────

/**
 * 已加载的配方。
 * 配方以 SKILL.md 格式存储；body 即合成阶段的 LLM system prompt。
 * suitable_for 为可选展示提示，来自 metadata.toolbox.recipe.suitable_for。
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

// ─── 蒸馏输入 ───────────────────────────────────────────────

/** 单份材料（传输结构，不落盘；落盘由 persona-store 处理） */
export interface PersonaMaterial {
  type: 'text' | 'file' | 'url';
  /** 展示标签 */
  label: string;
  /** 文本内容（URL 抓取结果由 persona:fetch-url 预取后传入） */
  content: string;
}

/** persona:distill IPC 入参 */
export interface PersonaDistillInput {
  recipe_name: string;
  materials: PersonaMaterial[];
}

/** persona:distill IPC 出参（蒸馏异步执行，进度通过 persona:event 推送） */
export interface PersonaDistillResult {
  requestId: string;
}

// ─── 保存/加载 ──────────────────────────────────────────────

/** persona:save IPC 入参 */
export interface PersonaSaveInput {
  /** 传入则更新已有 persona，不传则新建 */
  id?: string;
  name: string;
  recipe_name: string;
  /** SKILL.md 全文（蒸馏产出 + 用户编辑后的内容） */
  skillMd: string;
  sources: PersonaSourceRef[];
}

/** persona:load IPC 出参 */
export interface PersonaLoadResult {
  meta: PersonaMeta;
  skillMd: string;
}

// ─── 事件 ───────────────────────────────────────────────────

/** 主进程向渲染进程推送的蒸馏进度事件 */
export type PersonaEvent =
  | { kind: 'extract-start'; requestId: string; sourceIndex: number; total: number }
  | { kind: 'extract-done'; requestId: string; sourceIndex: number }
  | { kind: 'synthesis-chunk'; requestId: string; chunk: string }
  | { kind: 'synthesis-end'; requestId: string }
  | { kind: 'error'; requestId: string; message: string }
  | { kind: 'aborted'; requestId: string };
