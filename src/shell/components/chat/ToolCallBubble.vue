<template>
  <div class="tool-call-bubble">
    <!-- 中间叙述（assistant 在每轮工具调用前说的话） -->
    <div
      v-for="(narration, idx) in narrations"
      :key="`narration-${idx}`"
      class="tool-narration"
    >
      <span class="tool-narration-glyph" aria-hidden="true">›</span>
      <span class="tool-narration-text">{{ narration }}</span>
    </div>

    <!-- 执行中状态 -->
    <div v-if="executing" class="tool-call-row executing">
      <span class="tool-icon">{{ executingTone.icon }}</span>
      <span class="tool-label">
        {{ executingTone.running }}<span v-if="executingBrief">：{{ executingBrief }}</span>
      </span>
      <span class="tool-spinner"></span>
    </div>

    <!-- 已完成的工具调用列表 -->
    <div
      v-for="(result, idx) in results"
      :key="idx"
      class="tool-call-row done"
      :class="{ error: !result.success }"
      @click="toggleExpand(idx)"
    >
      <span class="tool-icon">{{ resultIcon(result, idx) }}</span>
      <span class="tool-label">
        {{ resultLabel(result, idx) }}<span v-if="resultBriefs[idx]">：{{ resultBriefs[idx] }}</span>
      </span>
      <span v-if="resultMetas[idx]" class="tool-meta">
        {{ resultMetas[idx] }}
      </span>
      <span class="tool-expand">{{ expandedSet.has(idx) ? '▴' : '▾' }}</span>

      <!-- 展开详情 -->
      <div v-if="expandedSet.has(idx)" class="tool-detail" @click.stop>
        <pre class="tool-detail-text">{{ resultPretties[idx] }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface ToolResult {
  toolName: string;
  toolDisplayName: string;
  success: boolean;
  summary: string;
}

const props = defineProps<{
  executing: {
    toolName: string;
    toolDisplayName: string;
    toolInput: unknown;
  } | null;
  results: ToolResult[];
  /**
   * 当前请求周期内 assistant 在每轮工具调用前说的"中间叙述"。
   * 按时间顺序排列在工具行上方，用淡色非气泡的方式渲染，让用户看到"模型为什么调这个工具"。
   */
  narrations?: string[];
}>();

const expandedSet = ref<Set<number>>(new Set());

function toggleExpand(idx: number) {
  const next = new Set(expandedSet.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  expandedSet.value = next;
}

// ─── 工具元信息映射 ─────────────────────────────────────
//
// key = toolName（与 SkillRegistry 注册名一致），value 仅含 emoji 和动词。
// 状态文案由 toneFor() 拼接，避免重复填充 "正在/已/失败" 三套。
// 未在表中的工具走 displayName 兜底。
const TOOL_META: Record<string, { icon: string; verb: string }> = {
  web_search: { icon: '🔍', verb: '搜索' },
  web_fetch: { icon: '🌐', verb: '抓取' },
  download_file: { icon: '⬇️', verb: '下载' },
  read_text_file: { icon: '📄', verb: '读取' },
  list_directory: { icon: '📂', verb: '列出' },
  search_files: { icon: '🔎', verb: '搜索文件' },
  read_clipboard: { icon: '📋', verb: '读取剪贴板' },
  write_clipboard: { icon: '📋', verb: '写入剪贴板' },
  open_url: { icon: '🌐', verb: '打开网页' },
  show_in_explorer: { icon: '📁', verb: '定位文件' },
  open_directory: { icon: '📁', verb: '打开目录' },
  reveal_path: { icon: '📁', verb: '展示路径' },
  send_notification: { icon: '🔔', verb: '发送通知' },
  quick_calc: { icon: '🔢', verb: '计算' },
  text_transform: { icon: '🔤', verb: '处理文本' },
  system_info: { icon: '💻', verb: '查询系统信息' },
  file_info: { icon: '📄', verb: '查看文件信息' },
  inspect_path: { icon: '🔍', verb: '探测路径' },
  get_path: { icon: '📂', verb: '获取路径' },
  create_text_file: { icon: '✏️', verb: '创建文件' },
  write_text_file: { icon: '✏️', verb: '写入文件' },
  copy_file: { icon: '📋', verb: '复制文件' },
  move_file: { icon: '➡️', verb: '移动文件' },
  create_directory: { icon: '📁', verb: '创建目录' },
  delete_file: { icon: '🗑️', verb: '删除文件' },
  batch_file_ops: { icon: '📋', verb: '批量文件操作' },
  desktop_action: { icon: '🖥️', verb: '启动应用' },
  run_script: { icon: '⚡', verb: '执行脚本' },
};

interface Tone {
  icon: string;
  running: string;
  done: string;
  failed: string;
}

function toneFor(toolName: string, displayName?: string): Tone {
  const meta = TOOL_META[toolName];
  if (meta) {
    return {
      icon: meta.icon,
      running: `正在${meta.verb}`,
      done: `已${meta.verb}`,
      failed: `${meta.verb}失败`,
    };
  }
  const label = displayName || toolName;
  return {
    icon: '🛠',
    running: `正在执行 ${label}`,
    done: `已执行 ${label}`,
    failed: `${label} 失败`,
  };
}

// ─── 执行中的行 ─────────────────────────────────────────

const executingTone = computed<Tone>(() => {
  if (!props.executing) return { icon: '🛠', running: '执行中', done: '', failed: '' };
  return toneFor(props.executing.toolName, props.executing.toolDisplayName);
});

const executingBrief = computed<string>(() => {
  if (!props.executing) return '';
  return inputBrief(props.executing.toolName, props.executing.toolInput);
});

// ─── 已完成的行 ─────────────────────────────────────────

const resultBriefs = computed<string[]>(() =>
  props.results.map((r) => summaryBrief(r))
);

const resultMetas = computed<string[]>(() =>
  props.results.map((r) => summaryMeta(r))
);

const resultPretties = computed<string[]>(() =>
  props.results.map((r) => prettifySummary(r.summary))
);

function resultIcon(r: ToolResult, _idx: number): string {
  if (!r.success) return '⚠️';
  return toneFor(r.toolName, r.toolDisplayName).icon;
}

function resultLabel(r: ToolResult, _idx: number): string {
  const tone = toneFor(r.toolName, r.toolDisplayName);
  return r.success ? tone.done : tone.failed;
}

// ─── 内容提取辅助 ───────────────────────────────────────
//
// summary 在 chat-engine 中被截断到 200 字符（末尾追加 "..."），常导致 JSON.parse 失败。
// 因此用正则按需提取关键字段，而不是依赖完整 JSON 解析。

/** 从输入参数对象提取最有信息量的字段做简短描述 */
function inputBrief(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  // 工具特化：优先按已知关键字段提取
  const fieldOrder = inputFieldOrder(toolName);
  for (const key of fieldOrder) {
    const v = i[key];
    if (typeof v === 'string' && v.trim()) return clip(v, 80);
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function inputFieldOrder(toolName: string): string[] {
  switch (toolName) {
    case 'web_search':
      return ['query'];
    case 'web_fetch':
    case 'open_url':
    case 'download_file':
      return ['url'];
    case 'read_text_file':
    case 'file_info':
    case 'inspect_path':
    case 'list_directory':
    case 'show_in_explorer':
    case 'open_directory':
    case 'reveal_path':
    case 'create_text_file':
    case 'write_text_file':
    case 'create_directory':
    case 'delete_file':
      return ['path'];
    case 'copy_file':
    case 'move_file':
      return ['source'];
    case 'search_files':
      return ['keyword', 'directory'];
    case 'get_path':
      return ['name'];
    case 'system_info':
      return ['query'];
    case 'quick_calc':
      return ['expr', 'value'];
    case 'text_transform':
      return ['action'];
    case 'send_notification':
      return ['content', 'title'];
    case 'desktop_action':
      return ['content', 'action'];
    case 'run_script':
      return ['language'];
    default:
      return ['query', 'url', 'path', 'source', 'directory', 'expr', 'name'];
  }
}

/** 从 summary 字符串提取最有信息量的字段做简短描述 */
function summaryBrief(r: ToolResult): string {
  // 错误时优先展示 error 字段
  if (!r.success) {
    const err = pickField(r.summary, 'error');
    if (err) return clip(err, 100);
  }
  switch (r.toolName) {
    case 'web_search':
      return pickField(r.summary, 'query') || '';
    case 'web_fetch':
      return (
        pickField(r.summary, 'url') ||
        pickField(r.summary, 'requestedUrl') ||
        pickField(r.summary, 'finalUrl') ||
        ''
      );
    case 'download_file':
      return pickField(r.summary, 'savePath') || pickField(r.summary, 'url') || '';
    case 'read_text_file':
    case 'file_info':
    case 'inspect_path':
    case 'list_directory':
    case 'show_in_explorer':
    case 'open_directory':
    case 'reveal_path':
    case 'create_text_file':
    case 'write_text_file':
    case 'create_directory':
    case 'delete_file':
      return pickField(r.summary, 'path') || '';
    case 'open_url':
      return pickField(r.summary, 'url') || '';
    case 'send_notification':
      return pickField(r.summary, 'content') || '';
    default:
      // 兜底：尝试常见字段
      return (
        pickField(r.summary, 'query') ||
        pickField(r.summary, 'path') ||
        pickField(r.summary, 'url') ||
        ''
      );
  }
}

/** 从 summary 提取右上角小字 meta（数量/字数/字节数等） */
function summaryMeta(r: ToolResult): string {
  if (!r.success) return '';
  switch (r.toolName) {
    case 'web_search': {
      const n = pickNumber(r.summary, 'resultCount');
      return n != null ? `${n} 条结果` : '';
    }
    case 'web_fetch': {
      const chars = pickNumber(r.summary, 'chars');
      const truncated = pickField(r.summary, 'truncated');
      const bytes = pickNumber(r.summary, 'byteSize');
      const parts: string[] = [];
      if (chars != null) parts.push(`${formatNumber(chars)} 字`);
      else if (bytes != null) parts.push(formatBytes(bytes));
      if (truncated === 'true') parts.push('截断');
      return parts.join(' · ');
    }
    case 'download_file': {
      const bytes = pickNumber(r.summary, 'sizeBytes') ?? pickNumber(r.summary, 'size');
      return bytes != null ? formatBytes(bytes) : '';
    }
    case 'list_directory':
    case 'search_files': {
      const n = pickNumber(r.summary, 'count') ?? pickNumber(r.summary, 'totalCount');
      return n != null ? `${n} 项` : '';
    }
    default:
      return '';
  }
}

/** 美化 summary：能 parse 为 JSON 则按 2 空格缩进；否则原样返回（保留末尾的 "..."） */
function prettifySummary(summary: string): string {
  if (!summary) return '';
  const stripped = summary.endsWith('...') ? summary.slice(0, -3) : summary;
  try {
    const obj: unknown = JSON.parse(stripped);
    return JSON.stringify(obj, null, 2);
  } catch {
    return summary;
  }
}

/**
 * 用正则从被截断的 JSON 字符串里取一个键的字符串值。
 * 不依赖 JSON.parse，能处理 chat-engine 200 字符截断后的尾部。
 */
function pickField(text: string, key: string): string {
  const re = new RegExp(`"${escapeRegex(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = text.match(re);
  if (!m) {
    // 兼容布尔/数字字段被当字符串字段调用
    const reBool = new RegExp(`"${escapeRegex(key)}"\\s*:\\s*(true|false)`);
    const mb = text.match(reBool);
    if (mb) return mb[1];
    return '';
  }
  return m[1]
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\\\/g, '\\');
}

/** 用正则从被截断的 JSON 字符串里取一个数字字段的值 */
function pickNumber(text: string, key: string): number | null {
  const re = new RegExp(`"${escapeRegex(key)}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
</script>

<style scoped>
.tool-call-bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0;
}

/* 中间叙述（dim 文本，无气泡背景，与工具行视觉区分） */
.tool-narration {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary, #888);
  font-style: italic;
}
.tool-narration-glyph {
  flex-shrink: 0;
  color: var(--text-dim, #666);
  font-weight: 600;
  user-select: none;
}
.tool-narration-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
  white-space: pre-wrap;
}

.tool-call-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  background: var(--bg-tool-call, rgba(0, 0, 0, 0.04));
  cursor: pointer;
  user-select: none;
  flex-wrap: wrap;
  transition: background 0.15s;
}

.tool-call-row:hover {
  background: var(--bg-tool-call-hover, rgba(0, 0, 0, 0.07));
}

.tool-call-row.executing {
  cursor: default;
}

.tool-call-row.error {
  color: var(--text-error, #c44);
}

.tool-icon {
  flex-shrink: 0;
}

.tool-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-meta {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.7;
}

.tool-expand {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.5;
}

.tool-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: var(--accent, #4a9eff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-detail {
  width: 100%;
  margin-top: 6px;
  padding: 8px;
  background: var(--bg-code, rgba(0, 0, 0, 0.03));
  border-radius: 4px;
  cursor: text;
}

.tool-detail-text {
  margin: 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary, #333);
  max-height: 300px;
  overflow-y: auto;
}
</style>
