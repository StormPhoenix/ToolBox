/**
 * ElectronAPI — 单一来源类型定义
 *
 * Shell 侧：window.electronAPI（由 preload.ts 通过 contextBridge 注入）
 * 插件侧：从 @toolbox/bridge 导入的 electronAPI 对象（内部走 postMessage）
 *
 * 两侧接口签名完全一致，插件无需感知通信细节。
 */

// ── Electron 对话框类型（内联，避免插件依赖 electron 本体） ──────────────

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >;
  message?: string;
}

export interface OpenDialogReturnValue {
  canceled: boolean;
  filePaths: string[];
  bookmarks?: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  message?: string;
  nameFieldLabel?: string;
  showsTagField?: boolean;
  properties?: Array<
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'treatPackageAsDirectory'
    | 'showOverwriteConfirmation'
    | 'dontAddToRecent'
  >;
}

export interface SaveDialogReturnValue {
  canceled: boolean;
  filePath?: string;
  bookmark?: string;
}

// ── 应用信息 ──────────────────────────────────────────────────────────────

export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  /** 构建时的 git commit 短 hash，不可用时为 'unknown' */
  gitHash: string;
  /** 构建时的 git branch 名，不可用时为 'unknown' */
  gitBranch: string;
  /** 构建时间 ISO 8601 字符串 */
  buildTime: string;
}

// ── 目录项 ────────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDir: boolean;
  path: string;
}

// ── 插件统计 ──────────────────────────────────────────────────────────────

export interface PluginStats {
  total: number;
  builtin: number;
  categories: number;
}

// ── LLM 类型 ──────────────────────────────────────────────────────────────

/** LLM 支持的 Provider 类型 */
export type LLMProviderType = 'claude' | 'openai' | 'gemini';

/**
 * LLM 消息内容块
 * - 纯文本：{ type: 'text', text: string }
 * - 图片：{ type: 'image', source: { type: 'base64', media_type, data } }
 *   插件侧自行将文件读为 base64 后传入
 */
export type LLMMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: {
            type: 'base64';
            media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
            data: string;
          };
        }
    >;

/** llmChat 调用参数中的单条消息 */
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: LLMMessageContent;
}

/** llmChat 可选项 */
export interface LLMChatOptions {
  /** 可选的 system prompt */
  system?: string;
}

/** llmChat 返回结果 */
export interface LLMChatResult {
  text: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * 单个 Provider 的脱敏公开配置。
 *
 * - `apiKeyMasked`：掩码后的 apiKey（如 `****1a2b`），仅用于展示。
 * - `hasApiKey`：该 provider 是否已持久化一个非空 apiKey。前端据此决定
 *   "测试连接"按钮在输入框留空时是否仍可点击（留空表示沿用已存 key）。
 */
export interface LLMProviderPublicConfig {
  apiKeyMasked: string;
  hasApiKey: boolean;
  baseURL?: string;
  model: string;
}

/** getLLMConfig 返回的脱敏配置（apiKey 替换为掩码） */
export interface LLMConfigPublic {
  provider: LLMProviderType;
  claude?: LLMProviderPublicConfig;
  openai?: LLMProviderPublicConfig;
  gemini?: LLMProviderPublicConfig;
  maxTokens?: number;
  /** 当前 provider 是否已配置可用（apiKey + model 均非空） */
  available: boolean;
}

/** setLLMConfig 接收的输入（可部分更新，apiKey 传空字符串表示不变） */
export interface LLMConfigInput {
  provider?: LLMProviderType;
  claude?: { apiKey?: string; baseURL?: string; model?: string };
  openai?: { apiKey?: string; baseURL?: string; model?: string };
  gemini?: { apiKey?: string; baseURL?: string; model?: string };
  maxTokens?: number;
}

/** testLLMConnection 返回结果 */
export interface LLMTestResult {
  ok: boolean;
  error?: string;
}

/**
 * 图像生成请求参数
 *
 * 各参数对不同 Provider 的生效情况：
 * | 参数    | OpenAI DALL-E 3       |
 * |---------|-----------------------|
 * | size    | ✅ 见下方说明         |
 * | quality | ✅ standard / hd      |
 * | style   | ✅ vivid / natural    |
 * | n       | ✅（固定生成 1 张）   |
 */
export interface LLMImageGenOptions {
  /** 生成图像的文字描述 */
  prompt: string;
  /**
   * 图像尺寸，格式 'WxH'。
   * OpenAI DALL-E 3 支持: '1024x1024'（默认）、'1792x1024'、'1024x1792'。
   */
  size?: string;
  /** 图像质量，仅 OpenAI 生效。'standard'（默认）速度快，'hd' 细节更丰富。 */
  quality?: 'standard' | 'hd';
  /** 图像风格，仅 OpenAI 生效。'vivid'（默认）超现实鲜艳，'natural' 写实自然。 */
  style?: 'vivid' | 'natural';
  /** 生成张数。OpenAI DALL-E 3 固定 1 张，传入更大值时忽略。 */
  n?: number;
}

/** 图像生成返回结果 */
export interface LLMImageGenResult {
  /** base64 编码的图像字符串数组（不含 data URL 前缀） */
  images: string[];
  /**
   * OpenAI 对原始 prompt 的修订版本（DALL-E 3 会自动优化 prompt）。
   * 其他 Provider 不返回此字段。
   */
  revised_prompt?: string;
}

// ── Image Resize 类型 ────────────────────────────────────────────────────

/** 缩放算法标识。本地经典算法 + 未来 LLM 超分（V2） */
export type ResizeAlgorithmId =
  | 'nearest'
  | 'bilinear'
  | 'bicubic'
  | 'lanczos'
  | 'llm-upscale';

/** 算法分类，UI 分组展示用 */
export type ResizeCategory = 'classical' | 'ai';

/** 单个 Provider 的公开描述信息（UI 下拉菜单数据源） */
export interface ResizeProviderInfo {
  id: ResizeAlgorithmId;
  displayName: string;
  description: string;
  category: ResizeCategory;
  /** 当前是否可用（LLM 未配置时为 false） */
  available: boolean;
  /** 不可用时的提示文案 */
  unavailableReason?: string;
  supportsUpscale: boolean;
  supportsDownscale: boolean;
}

/** 输出图像格式 */
export type ResizeOutputFormat = 'jpeg' | 'png' | 'webp' | 'avif';

/** resizeImage 调用参数 */
export interface ResizeOptions {
  algorithm: ResizeAlgorithmId;
  /** 最大长边像素 N，长边缩放到该值，短边按比例 */
  maxLongEdge: number;
  outputFormat: ResizeOutputFormat;
  /** 1-100，有损格式（jpeg/webp/avif）有效 */
  quality?: number;
  /** 是否将原 EXIF 写入输出文件。V1 恒为 true */
  preserveExif: boolean;
  /** V2 LLM Provider 扩展字段 */
  llmOptions?: {
    model?: string;
    prompt?: string;
    scale?: 2 | 4;
  };
}

/** 原图元数据解析结果 */
export interface ImageBasicInfo {
  filename: string;
  byteSize: number;
  format: string;
  colorSpace: string;
  /** 纠正 EXIF Orientation 后的视觉宽 */
  width: number;
  /** 纠正 EXIF Orientation 后的视觉高 */
  height: number;
}

/** parseImageMetadata 返回值 */
export interface ParseMetadataResult {
  /** 本次插件会话 ID，后续 resizeImage 调用需带上 */
  sessionId: string;
  basic: ImageBasicInfo;
  /** exifr 完整解析结果（含 GPS），无 EXIF 时为 null */
  exif: Record<string, unknown> | null;
  /** 主进程生成的 256px 略缩图临时文件绝对路径（渲染进程 file:// 加载） */
  thumbnailPath: string;
}

/** resizeImage 成功返回 */
export interface ResizeSuccess {
  ok: true;
  /** 处理后的临时文件绝对路径（渲染进程 file:// 加载预览） */
  tempOutputPath: string;
  width: number;
  height: number;
  byteSize: number;
  format: string;
  durationMs: number;
  /** 实际使用的算法 id（可能因 fallback 不同于请求值） */
  actualAlgorithm: ResizeAlgorithmId;
  /** 非致命警告（如 "bilinear 当前以 cubic 近似"） */
  warnings?: string[];
}

/** resizeImage 错误返回 */
export interface ResizeFailure {
  ok: false;
  error: {
    code:
      | 'DECODE_FAILED'
      | 'UNSUPPORTED_FORMAT'
      | 'DISK_FULL'
      | 'LLM_NOT_CONFIGURED'
      | 'LLM_API_ERROR'
      | 'UNKNOWN';
    message: string;
    /** 调试用详细信息（可折叠展示） */
    detail?: string;
  };
}

export type ResizeResponse = ResizeSuccess | ResizeFailure;

/** saveResizedImage 返回值 */
export interface SaveResizedResult {
  ok: boolean;
  error?: string;
}

// ── Chat 类型（Shell 内置对话功能） ───────────────────────────────────────

/**
 * Chat 消息内容块（持久化用）。
 * 复用 LLM 消息内容结构，含 text 与 image。
 */
export type ChatMessageContent = LLMMessageContent;

/** 持久化的单条消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ChatMessageContent;
  timestamp: number;
  attachments?: Array<{ name: string; mediaType: string }>;
  model?: { provider: LLMProviderType; model: string };
}

/** 完整会话 */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
  messages: ChatMessage[];
}

/** 会话列表项（轻量索引） */
export interface SessionIndexEntry {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

/** 发送时的用户附件 */
export interface ChatAttachmentInput {
  name: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** base64（不含 data URL 前缀） */
  base64: string;
}

/** chat:send 入参 */
export interface ChatSendInput {
  sessionId: string;
  userText: string;
  attachments?: ChatAttachmentInput[];
}

/** chat:send 出参 */
export interface ChatSendResult {
  requestId: string;
  userMessageId: string;
}

/** Chat 事件（主进程推送给渲染进程） */
export type ChatEvent =
  | { kind: 'stream-chunk'; requestId: string; text: string }
  | {
      kind: 'stream-end';
      requestId: string;
      text: string;
      assistantMessageId: string;
      usage?: { input_tokens: number; output_tokens: number };
    }
  | { kind: 'error'; requestId: string; message: string; recoverable: boolean }
  | { kind: 'aborted'; requestId: string };

// ── ElectronAPI 主接口 ────────────────────────────────────────────────────

export interface ElectronAPI {
  /** 获取应用及运行环境信息 */
  getAppInfo(): Promise<AppInfo>;

  /** 获取插件 webview 所需的 preload 脚本绝对路径（仅 Shell 侧使用） */
  getPreloadPath(): Promise<string>;

  /** 弹出文件打开对话框 */
  showOpenDialog(options?: OpenDialogOptions): Promise<OpenDialogReturnValue>;

  /** 弹出文件保存对话框 */
  showSaveDialog(options?: SaveDialogOptions): Promise<SaveDialogReturnValue>;

  /** 读取文件内容（默认 utf-8，可传 'base64'） */
  readFile(filePath: string, encoding?: BufferEncoding | 'base64'): Promise<string>;

  /** 写入文件内容（默认 utf-8，可传 'base64'） */
  writeFile(filePath: string, data: string, encoding?: BufferEncoding | 'base64'): Promise<void>;

  /** 列出目录内容 */
  readDir(dirPath: string): Promise<DirEntry[]>;

  /** 在系统资源管理器中打开路径 */
  openInExplorer(targetPath: string): Promise<void>;

  /**
   * 获取 File 对象对应的系统文件路径。
   * preload 层通过 webUtils.getPathForFile 实现（同步）；
   * bridge 层通过 postMessage 异步获取，统一为 Promise<string>。
   */
  getPathForFile(file: File): Promise<string>;

  /** 重命名文件（或移动到同目录下的新名） */
  renameFile(oldPath: string, newPath: string): Promise<void>;

  /**
   * 将渲染进程（Shell / 插件）日志转发到主进程写文件。
   * debug 级别在调用方已过滤，不应传入此方法。
   */
  log(level: 'info' | 'warn' | 'error', tag: string, message: string): Promise<void>;

  /** 获取插件注册表统计信息（总数、内置数、分类数） */
  getPluginStats(): Promise<PluginStats>;

  // ── LLM ──────────────────────────────────────────────────────────────────

  /**
   * 单次非流式 LLM 调用。
   *
   * 使用在 Settings 中配置的当前 Provider，无需插件感知具体模型。
   *
   * content 支持纯字符串或 block 数组（多模态场景传 image block）。
   *
   * @example
   * // 纯文本
   * const result = await electronAPI.llmChat(
   *   [{ role: 'user', content: '帮我分析这个文件名...' }],
   *   { system: '你是一个文件重命名助手' }
   * );
   *
   * @example
   * // 带图片（插件自行读文件转 base64）
   * const b64 = await electronAPI.readFile(path, 'base64');
   * const result = await electronAPI.llmChat([{
   *   role: 'user',
   *   content: [
   *     { type: 'text', text: '描述这张图片' },
   *     { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }
   *   ]
   * }]);
   */
  llmChat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResult>;

  /** 获取当前 LLM 配置（脱敏，apiKey 已掩码） */
  getLLMConfig(): Promise<LLMConfigPublic>;

  /**
   * 更新 LLM 配置。
   * 只传入需要变更的字段；apiKey 传空字符串或不传均表示保留原值。
   */
  setLLMConfig(config: LLMConfigInput): Promise<void>;

  /** 测试当前配置的连通性，发送一条最小请求验证 API Key 有效性 */
  testLLMConnection(): Promise<LLMTestResult>;

  /**
   * 图像生成（文生图）。
   *
   * 需要当前 Provider 支持图像生成能力（目前仅 OpenAI DALL-E 3）。
   * 不支持时抛出错误，插件侧应 catch 并给用户友好提示。
   *
   * 返回 base64 编码的图像字符串，插件侧可：
   * - 直接展示：`<img src="data:image/png;base64,${result.images[0]}">`
   * - 保存文件：`electronAPI.writeFile(path, result.images[0], 'base64')`
   *
   * @example
   * const result = await electronAPI.llmGenerateImage({
   *   prompt: '一只在樱花树下打盹的橘猫，吉卜力风格',
   *   size: '1024x1024',
   *   quality: 'hd',
   * });
   * // result.images[0] 为 base64 字符串
   * // result.revised_prompt 为 OpenAI 修订后的 prompt（可选）
   */
  llmGenerateImage(options: LLMImageGenOptions): Promise<LLMImageGenResult>;

  // ── Image Resize ─────────────────────────────────────────────────────────

  /**
   * 列出所有缩放算法 Provider，包含可用性状态。
   * UI 下拉菜单的数据源；新增算法零改前端。
   */
  listResizeProviders(): Promise<ResizeProviderInfo[]>;

  /**
   * 解析图片元数据（基本信息 + EXIF），同时生成 256px 略缩图。
   *
   * 首次调用会分配一个新的 sessionId；后续 resizeImage 需带上。
   *
   * @param filePath 本地图片绝对路径
   */
  parseImageMetadata(filePath: string): Promise<ParseMetadataResult>;

  /**
   * 按指定参数处理图片，结果写入临时文件，返回路径供渲染进程通过
   * file:// 协议加载预览。
   *
   * @param inputPath 原图绝对路径
   * @param options   处理参数
   * @param sessionId 由 parseImageMetadata 返回的会话 id
   */
  resizeImage(
    inputPath: string,
    options: ResizeOptions,
    sessionId: string
  ): Promise<ResizeResponse>;

  /**
   * 将处理后的临时文件复制到用户指定的保存路径（另存为）。
   * 临时文件不删除，保留到窗口关闭。
   */
  saveResizedImage(tempPath: string, targetPath: string): Promise<SaveResizedResult>;

  // ── Chat（Shell 内置对话，插件一般不使用） ────────────────────────────

  /** 列出所有会话（轻量索引，不含 messages） */
  chatListSessions(): Promise<SessionIndexEntry[]>;

  /** 加载单个会话完整数据，不存在返回 null */
  chatLoadSession(id: string): Promise<ChatSession | null>;

  /** 创建空会话 */
  chatCreateSession(title?: string): Promise<ChatSession>;

  /** 删除会话 */
  chatDeleteSession(id: string): Promise<void>;

  /** 重命名会话 */
  chatRenameSession(id: string, title: string): Promise<void>;

  /** 清空会话消息（保留会话本身） */
  chatClearContext(id: string): Promise<void>;

  /**
   * 发送用户消息，异步流式回复。
   *
   * 调用方需在调用前通过 onChatEvent 订阅事件：
   *   - 'stream-chunk'：每次收到增量文本
   *   - 'stream-end':  本次回复结束，含 assistantMessageId
   *   - 'error':       出错
   *   - 'aborted':     用户中止
   */
  chatSend(input: ChatSendInput): Promise<ChatSendResult>;

  /** 中止指定 requestId 对应的进行中请求 */
  chatAbort(requestId: string): Promise<void>;

  /**
   * 订阅 Chat 事件流。
   * 返回 dispose 函数，调用即可取消订阅。
   */
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
}
