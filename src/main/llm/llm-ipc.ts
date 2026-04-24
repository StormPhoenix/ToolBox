/**
 * LLM IPC Handlers
 *
 * 注册以下四个 IPC 通道：
 *   llm:chat            — 单次非流式 LLM 调用
 *   llm:get-config      — 获取当前配置（脱敏）
 *   llm:set-config      — 更新配置
 *   llm:test-connection — 测试当前配置连通性
 *
 * 在 main.ts 中调用 registerLLMHandlers(ipcMain) 即可完成注册。
 */
import { ipcMain, app, shell } from 'electron';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { LLMRouter } from './router';
import type {
  LLMConfig,
  LLMConfigPublic,
  LLMConfigInput,
  LLMMessageParam,
  LLMChatResult,
  LLMImageGenOptions,
  LLMImageGenResult,
  ProviderType,
} from './types';
import {
  readDebugConfig,
  writeDebugConfig,
  getDumpRootDir,
  type DebugConfigData,
} from './debug-config';
import { setDumpEnabled } from './prompt-dumper';
import { createLogger } from '../logger';

const log = createLogger('LLM-IPC');

// ─── 配置文件路径 ──────────────────────────────────────────

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'llm-config.json');
}

// ─── 配置读写 ──────────────────────────────────────────────

async function readConfig(): Promise<LLMConfig | null> {
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf-8');
    return JSON.parse(raw) as LLMConfig;
  } catch {
    return null;
  }
}

async function writeConfig(config: LLMConfig): Promise<void> {
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

function maskApiKey(key: string): string {
  if (key.length <= 4) return '****';
  return '****' + key.slice(-4);
}

function toPublicConfig(config: LLMConfig): LLMConfigPublic {
  const result: LLMConfigPublic = {
    provider: config.provider,
    maxTokens: config.maxTokens,
    available: false,
  };

  if (config.claude) {
    result.claude = {
      apiKeyMasked: maskApiKey(config.claude.apiKey),
      hasApiKey: !!config.claude.apiKey,
      baseURL: config.claude.baseURL,
      model: config.claude.model,
    };
  }
  if (config.openai) {
    result.openai = {
      apiKeyMasked: maskApiKey(config.openai.apiKey),
      hasApiKey: !!config.openai.apiKey,
      baseURL: config.openai.baseURL,
      model: config.openai.model,
    };
  }
  if (config.gemini) {
    result.gemini = {
      apiKeyMasked: maskApiKey(config.gemini.apiKey),
      hasApiKey: !!config.gemini.apiKey,
      baseURL: config.gemini.baseURL,
      model: config.gemini.model,
    };
  }

  // 检查当前 provider 是否有有效配置
  const active = config.provider;
  const providerCfg = config[active];
  result.available = !!(
    providerCfg &&
    'apiKey' in providerCfg &&
    providerCfg.apiKey &&
    'model' in providerCfg &&
    providerCfg.model
  );

  return result;
}

// ─── 模块级单例 ────────────────────────────────────────────

let router: LLMRouter | null = null;

async function getRouter(): Promise<LLMRouter> {
  if (router) return router;
  const config = await readConfig();
  if (config) {
    router = new LLMRouter(config);
  } else {
    // 无配置时创建一个空路由（isAvailable() === false）
    router = new LLMRouter({ provider: 'openai' });
  }
  return router;
}

/**
 * 供其他模块（如 ChatEngine）共享同一个 LLMRouter 实例。
 * 保证 Settings 中更新配置后，所有消费者立即用上新 Provider。
 */
export async function getSharedLLMRouter(): Promise<LLMRouter> {
  return getRouter();
}

// ─── IPC 注册 ──────────────────────────────────────────────

export function registerLLMHandlers(): void {
  // ── llm:chat ────────────────────────────────────────────
  ipcMain.handle(
    'llm:chat',
    async (
      _e,
      messages: LLMMessageParam[],
      options?: { system?: string }
    ): Promise<LLMChatResult> => {
      const r = await getRouter();
      const provider = r.getProvider();
      if (!provider) {
        throw new Error('LLM 未配置，请先在设置中填写 API Key 和模型名称');
      }

      log.info(
        `llm:chat 请求: messages=${messages.length}, ` +
          `system=${options?.system ? options.system.length + ' chars' : 'none'}, ` +
          `provider=${r.getProviderName()}`
      );

      // 设置 scene 上下文后立即调用（withScene 返回 this 以便链式）
      const response = await r
        .withScene('plugin-llmchat')
        .getProvider()!
        .createMessage(options?.system ?? '', messages);

      const text = response.content
        .filter((b): b is import('./types').LLMTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      log.info(
        `llm:chat 完成: stop_reason=${response.stop_reason}, ` +
          `text=${text.length} chars, ` +
          `usage=${response.usage ? `in=${response.usage.input_tokens},out=${response.usage.output_tokens}` : 'N/A'}`
      );

      return {
        text,
        usage: response.usage
          ? {
              input_tokens: response.usage.input_tokens,
              output_tokens: response.usage.output_tokens,
            }
          : undefined,
      };
    }
  );

  // ── llm:get-config ──────────────────────────────────────
  ipcMain.handle('llm:get-config', async (): Promise<LLMConfigPublic> => {
    const config = await readConfig();
    if (!config) {
      return {
        provider: 'openai',
        available: false,
      };
    }
    return toPublicConfig(config);
  });

  // ── llm:set-config ──────────────────────────────────────
  ipcMain.handle(
    'llm:set-config',
    async (_e, input: LLMConfigInput): Promise<void> => {
      // 读取现有配置进行合并（保留已有 apiKey，避免前端传入空值覆盖）
      const existing = await readConfig();
      const base: LLMConfig = existing ?? { provider: 'openai' };

      if (input.provider) {
        base.provider = input.provider as ProviderType;
      }
      if (input.maxTokens !== undefined) {
        base.maxTokens = input.maxTokens;
      }

      // 合并各 provider 配置（只更新非空字段）
      for (const key of ['claude', 'openai', 'gemini'] as const) {
        const incoming = input[key];
        if (!incoming) continue;
        const current = base[key] ?? { apiKey: '', model: '' };
        base[key] = {
          apiKey:
            incoming.apiKey !== undefined && incoming.apiKey !== ''
              ? incoming.apiKey
              : current.apiKey,
          model:
            incoming.model !== undefined && incoming.model !== ''
              ? incoming.model
              : current.model,
          baseURL:
            incoming.baseURL !== undefined
              ? incoming.baseURL
              : current.baseURL,
        };
      }

      await writeConfig(base);

      // 重建 Router
      router = new LLMRouter(base);
      log.info(`配置已更新: provider=${base.provider}, available=${router.isAvailable()}`);
    }
  );

  // ── llm:test-connection ─────────────────────────────────
  ipcMain.handle(
    'llm:test-connection',
    async (): Promise<{ ok: boolean; error?: string }> => {
      const r = await getRouter();
      const provider = r.getProvider();
      if (!provider) {
        return { ok: false, error: '未配置 API Key 或模型名称' };
      }

      try {
        log.info(`测试连接: ${r.getProviderName()}`);
        const response = await r
          .withScene('connection-test')
          .getProvider()!
          .createMessage('', [{ role: 'user', content: 'Hi' }]);
        const hasText = response.content.some((b) => b.type === 'text');
        if (!hasText) throw new Error('返回内容为空');
        // 打印返回信息
        log.info(`测试连接返回: ${response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')}`);
        log.info('连接测试成功');
        return { ok: true };
      } catch (err) {
        const msg = (err as Error).message || '未知错误';
        log.warn(`连接测试失败: ${msg}`);
        return { ok: false, error: msg };
      }
    }
  );

  // ── llm:generate-image ──────────────────────────────────
  ipcMain.handle(
    'llm:generate-image',
    async (_e, options: LLMImageGenOptions): Promise<LLMImageGenResult> => {
      const r = await getRouter();
      const provider = r.getProvider();
      if (!provider) {
        throw new Error('LLM 未配置，请先在设置中填写 API Key 和模型名称');
      }
      if (!provider.capabilities.imageGeneration) {
        const providerName = r.getProviderName();
        throw new Error(`当前 Provider (${providerName}) 不支持图像生成`);
      }
      if (!provider.generateImage) {
        throw new Error('Provider 未实现图像生成方法');
      }

      log.info(
        `llm:generate-image 请求: prompt="${options.prompt.slice(0, 60)}...", ` +
          `provider=${r.getProviderName()}`
      );

      const result = await r
        .withScene('plugin-image-gen')
        .getProvider()!
        .generateImage!(options);

      log.info(
        `llm:generate-image 完成: images=${result.images.length}, ` +
          `revised_prompt=${!!result.revised_prompt}`
      );

      return result;
    }
  );

  // ── debug:get-config ──────────────────────────────
  ipcMain.handle('debug:get-config', async (): Promise<DebugConfigData> => {
    return readDebugConfig();
  });

  // ── debug:set-config ──────────────────────────────
  ipcMain.handle(
    'debug:set-config',
    async (_e, config: DebugConfigData): Promise<void> => {
      await writeDebugConfig(config);
      // 立即生效到 dumper 内存缓存
      setDumpEnabled(config.promptDump.enabled);
      log.info(
        `调试配置更新: promptDumpEnabled=${config.promptDump.enabled}`
      );
    }
  );

  // ── debug:open-dump-dir ───────────────────────────
  // 在资源管理器中打开 LLM dump 根目录（不存在时自动创建）
  ipcMain.handle('debug:open-dump-dir', async (): Promise<void> => {
    const dir = getDumpRootDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await shell.openPath(dir);
    log.info(`打开 dump 目录: ${dir}`);
  });

  log.info('LLM IPC handlers 已注册');
}
