/**
 * SkillRegistry — 统一技能注册表（精简版）
 *
 * 管理所有 Skill（内置 + 用户）的注册、查询和工具执行。
 * 移植自外部项目，裁剪了：
 * - 渐进式加载（autoActivate / activate_tools）
 * - ExternalToolSource（MCP）
 * - fileHandlers / pluginManifest
 * - 风险确认弹窗
 * - 永久信任 / trustedTools
 * - 生命周期钩子（onActivate / onDeactivate）
 * - 兼容性检查 / OS gate
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { LLMToolDef } from '../llm/types';
import type {
  SkillDefinition,
  SkillToolDefinition,
  SkillContext,
} from './types';
import { toLLMTool } from './types';
import { createLogger } from '../logger';

const log = createLogger('SkillRegistry');

export class SkillRegistry {
  /** 已注册的 Skill（name → definition） */
  private skills: Map<string, SkillDefinition> = new Map();
  /** 工具名 → 所属 Skill 的映射（快速查找） */
  private toolIndex: Map<
    string,
    { skill: SkillDefinition; tool: SkillToolDefinition }
  > = new Map();
  /** 被禁用的 Skill 名称集合 */
  private disabledSkills: Set<string> = new Set();

  // ─── 注册 / 注销 ──────────────────────────────────────

  /** 注册一个 Skill，自动索引其包含的所有工具 */
  register(skill: SkillDefinition): void {
    const existing = this.skills.get(skill.name);
    if (existing) {
      log.warn(`Skill "${skill.name}" 已存在，将覆盖`);
      // 先移除旧工具索引
      for (const tool of existing.tools) {
        this.toolIndex.delete(tool.name);
      }
    }
    this.skills.set(skill.name, skill);

    for (const tool of skill.tools) {
      if (this.toolIndex.has(tool.name)) {
        log.warn(
          `工具名 "${tool.name}" 冲突（来自 Skill "${skill.name}"），将覆盖`
        );
      }
      this.toolIndex.set(tool.name, { skill, tool });
    }
  }

  /** 注销一个 Skill */
  unregister(skillName: string): void {
    const skill = this.skills.get(skillName);
    if (!skill) return;

    for (const tool of skill.tools) {
      this.toolIndex.delete(tool.name);
    }
    this.disabledSkills.delete(skillName);
    this.skills.delete(skillName);
    log.info(
      `Skill "${skillName}" 已注销（${skill.tools.length} 个工具已移除）`
    );
  }

  // ─── 工具查询与执行 ─────────────────────────────────

  /** 获取所有启用 Skill 的工具的 LLM 格式定义 */
  getLLMTools(): LLMToolDef[] {
    return Array.from(this.toolIndex.values())
      .filter(({ skill }) => !this.disabledSkills.has(skill.name))
      .map(({ tool }) => toLLMTool(tool));
  }

  /** 执行工具 */
  async execute(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<unknown> {
    const entry = this.toolIndex.get(toolName);
    if (!entry) throw new Error(`Unknown tool: ${toolName}`);

    const ctx = this.makeSkillContext(entry.skill, toolName);
    return entry.tool.execute(input, ctx);
  }

  /** 获取工具的显示名称 */
  getToolDisplayName(toolName: string): string {
    const entry = this.toolIndex.get(toolName);
    return entry?.tool.displayName || toolName;
  }

  /** 获取所有已注册的工具名 */
  getToolNames(): string[] {
    return Array.from(this.toolIndex.keys());
  }

  // ─── System Prompt 构建 ────────────────────────────

  /**
   * 构建所有启用 Skill 的 instructions，用于注入 system prompt。
   * 格式参考外部项目 prompt-sections.ts 的 buildSkillInstructions。
   */
  buildSystemInstructions(): string {
    const enabled = Array.from(this.skills.values()).filter(
      (s) => !this.disabledSkills.has(s.name)
    );

    if (enabled.length === 0) return '';

    const sections: string[] = [];

    for (const skill of enabled) {
      if (!skill.instructions) continue;

      // 替换模板变量
      let instructions = skill.instructions;
      instructions = instructions.replace(/\{baseDir\}/g, skill.skillDir);
      const dataDir = this.getSkillDataDir(skill.name);
      instructions = instructions.replace(/\{dataDir\}/g, dataDir);

      sections.push(
        `<skill name="${skill.name}">\n${instructions}\n</skill>`
      );
    }

    if (sections.length === 0) return '';

    return [
      '【已安装的技能】',
      '以下是你可以使用的技能，请根据用户的需求主动调用对应的工具：',
      '',
      sections.join('\n\n'),
    ].join('\n');
  }

  // ─── Skill 列表与管理 ──────────────────────────────

  /** 获取所有 Skill 的状态列表（UI 展示用） */
  getSkillList(): Array<{
    name: string;
    description: string;
    emoji?: string;
    builtin: boolean;
    enabled: boolean;
    toolCount: number;
  }> {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      description: s.description,
      emoji: s.manifest.metadata?.toolbox?.emoji,
      builtin: s.builtin,
      enabled: !this.disabledSkills.has(s.name),
      toolCount: s.tools.length,
    }));
  }

  /** 禁用指定 Skill */
  disableSkill(name: string): void {
    if (!this.skills.has(name)) return;
    this.disabledSkills.add(name);
    log.info(`Skill "${name}" 已禁用`);
  }

  /** 启用指定 Skill */
  enableSkill(name: string): void {
    if (!this.skills.has(name)) return;
    this.disabledSkills.delete(name);
    log.info(`Skill "${name}" 已启用`);
  }

  /** 检查是否禁用 */
  isDisabled(name: string): boolean {
    return this.disabledSkills.has(name);
  }

  /** 应用禁用列表（启动时调用） */
  applyDisabledList(names: string[]): void {
    this.disabledSkills = new Set(names);
  }

  /** 获取已注册 Skill 数量 */
  get size(): number {
    return this.skills.size;
  }

  // ─── 私有方法 ──────────────────────────────────────

  /** 获取 Skill 专属缓存目录 */
  private getSkillDataDir(skillName: string): string {
    return path.join(app.getPath('userData'), 'skill-data', skillName);
  }

  /** 构造 SkillContext */
  private makeSkillContext(
    skill: SkillDefinition,
    toolName: string
  ): SkillContext {
    const dataDir = this.getSkillDataDir(skill.name);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    return {
      skillDir: skill.skillDir,
      dataDir,
      toolName,
    };
  }
}
