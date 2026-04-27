import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  getAppInfo: () =>
    ipcRenderer.invoke('get-app-info'),

  // 插件 webview 所需的 preload 绝对路径
  getPreloadPath: () =>
    ipcRenderer.invoke('get-preload-path'),

  // 文件对话框
  showOpenDialog: (options?: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:showOpenDialog', options),

  showSaveDialog: (options?: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('dialog:showSaveDialog', options),

  // 文件系统
  readFile: (filePath: string, encoding?: BufferEncoding) =>
    ipcRenderer.invoke('fs:readFile', filePath, encoding),

  writeFile: (filePath: string, data: string, encoding?: BufferEncoding) =>
    ipcRenderer.invoke('fs:writeFile', filePath, data, encoding),

  readDir: (dirPath: string) =>
    ipcRenderer.invoke('fs:readDir', dirPath),

  // 系统
  openInExplorer: (targetPath: string) =>
    ipcRenderer.invoke('shell:openInExplorer', targetPath),

  renameFile: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke('fs:renameFile', oldPath, newPath),

  // 获取拖拽/选择文件的系统路径（webUtils，仅 preload 可调用）
  // 包为 Promise 以与 ElectronAPI 接口统一（bridge 侧也是 Promise<string>）
  getPathForFile: (file: File) =>
    Promise.resolve(webUtils.getPathForFile(file)),

  // 渲染进程日志转发（Shell / 插件 → 主进程写文件）
  log: (level: 'info' | 'warn' | 'error', tag: string, message: string) =>
    ipcRenderer.invoke('logger:log', level, tag, message),

  // 插件统计信息
  getPluginStats: () =>
    ipcRenderer.invoke('get-plugin-stats'),

  // ── LLM ──────────────────────────────────────────────────
  llmChat: (
    messages: Array<{ role: 'user' | 'assistant'; content: unknown }>,
    options?: { system?: string }
  ) => ipcRenderer.invoke('llm:chat', messages, options),

  llmGenerateImage: (options: unknown) =>
    ipcRenderer.invoke('llm:generate-image', options),

  getLLMConfig: () =>
    ipcRenderer.invoke('llm:get-config'),

  setLLMConfig: (config: unknown) =>
    ipcRenderer.invoke('llm:set-config', config),

  testLLMConnection: () =>
    ipcRenderer.invoke('llm:test-connection'),

  // ── Image Resize ─────────────────────────────────────────
  listResizeProviders: () =>
    ipcRenderer.invoke('image-resize:list-providers'),

  parseImageMetadata: (filePath: string) =>
    ipcRenderer.invoke('image-resize:parse-metadata', filePath),

  resizeImage: (inputPath: string, options: unknown, sessionId: string) =>
    ipcRenderer.invoke('image-resize:process', inputPath, options, sessionId),

  saveResizedImage: (tempPath: string, targetPath: string) =>
    ipcRenderer.invoke('image-resize:save-as', tempPath, targetPath),

  // ── Chat（V1 纯对话，仅 Shell 使用，插件侧不可见） ─────
  chatListSessions: () =>
    ipcRenderer.invoke('chat:list-sessions'),

  chatLoadSession: (id: string) =>
    ipcRenderer.invoke('chat:load-session', id),

  chatCreateSession: (title?: string) =>
    ipcRenderer.invoke('chat:create-session', title),

  chatDeleteSession: (id: string) =>
    ipcRenderer.invoke('chat:delete-session', id),

  chatRenameSession: (id: string, title: string) =>
    ipcRenderer.invoke('chat:rename-session', id, title),

  chatClearContext: (id: string) =>
    ipcRenderer.invoke('chat:clear-context', id),

  chatSetSessionMode: (sessionId: string, mode: unknown) =>
    ipcRenderer.invoke('chat:set-session-mode', sessionId, mode),

  chatSend: (input: unknown) =>
    ipcRenderer.invoke('chat:send', input),

  chatAbort: (requestId: string) =>
    ipcRenderer.invoke('chat:abort', requestId),

  chatConfirmResponse: (input: unknown) =>
    ipcRenderer.invoke('chat:confirm-response', input),

  chatResendImageRef: (ref: unknown) =>
    ipcRenderer.invoke('chat:resend-image-ref', ref),

  chatRegenerate: (input: unknown) =>
    ipcRenderer.invoke('chat:regenerate', input),

  chatEditAndResend: (input: unknown) =>
    ipcRenderer.invoke('chat:edit-and-resend', input),

  chatExportSelected: (input: unknown) =>
    ipcRenderer.invoke('chat:export-selected', input),

  /**
   * 订阅 chat 事件流，返回一个 dispose 函数用于取消订阅。
   * 主进程通过 webContents.send('chat:event', event) 推送事件。
   */
  onChatEvent: (callback: (event: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: unknown) => callback(event);
    ipcRenderer.on('chat:event', listener);
    return () => ipcRenderer.removeListener('chat:event', listener);
  },

  // ── Skill 技能管理 ──────────────────────────────────────
  skillList: () =>
    ipcRenderer.invoke('skill:list'),

  skillToggle: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('skill:toggle', name, enabled),

  skillOpenDir: () =>
    ipcRenderer.invoke('skill:open-dir'),

  skillListTrusted: () =>
    ipcRenderer.invoke('skill:list-trusted'),

  skillUntrust: (toolName: string) =>
    ipcRenderer.invoke('skill:untrust', toolName),

  // ── Debug（开发者调试：LLM prompt dump）──────────────────
  debugGetConfig: () =>
    ipcRenderer.invoke('debug:get-config'),

  debugSetConfig: (config: unknown) =>
    ipcRenderer.invoke('debug:set-config', config),

  debugOpenDumpDir: () =>
    ipcRenderer.invoke('debug:open-dump-dir'),

  // ── Persona Studio（工作区模型） ──────────────────────────
  personaListRecipes: () =>
    ipcRenderer.invoke('persona:list-recipes'),

  personaFetchUrl: (url: string) =>
    ipcRenderer.invoke('persona:fetch-url', url),

  personaCreate: (input: unknown) =>
    ipcRenderer.invoke('persona:create', input),

  personaAddMaterial: (input: unknown) =>
    ipcRenderer.invoke('persona:add-material', input),

  personaRemoveMaterial: (id: string, sourceIndex: number) =>
    ipcRenderer.invoke('persona:remove-material', id, sourceIndex),

  personaRename: (id: string, newName: string) =>
    ipcRenderer.invoke('persona:rename', id, newName),

  personaSetRecipe: (id: string, recipeName: string) =>
    ipcRenderer.invoke('persona:set-recipe', id, recipeName),

  personaSaveSkillMd: (input: unknown) =>
    ipcRenderer.invoke('persona:save-skill-md', input),

  personaDistill: (input: unknown) =>
    ipcRenderer.invoke('persona:distill', input),

  personaDistillAbort: (requestId: string) =>
    ipcRenderer.invoke('persona:distill-abort', requestId),

  personaListActiveDistillations: () =>
    ipcRenderer.invoke('persona:list-active-distillations'),

  personaList: () =>
    ipcRenderer.invoke('persona:list'),

  personaLoad: (id: string) =>
    ipcRenderer.invoke('persona:load', id),

  personaDelete: (id: string) =>
    ipcRenderer.invoke('persona:delete', id),

  personaPublish: (id: string, options?: { overwrite?: boolean }) =>
    ipcRenderer.invoke('persona:publish', id, options),

  personaUnpublish: (id: string) =>
    ipcRenderer.invoke('persona:unpublish', id),

  personaOpenRecipeDir: () =>
    ipcRenderer.invoke('persona:open-recipe-dir'),

  personaOpenDir: (id: string, target?: 'persona' | 'published') =>
    ipcRenderer.invoke('persona:open-dir', id, target ?? 'persona'),

  /**
   * 订阅 Persona 蒸馏进度事件流，返回 dispose 函数。
   */
  onPersonaEvent: (callback: (event: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: unknown) => callback(event);
    ipcRenderer.on('persona:event', listener);
    return () => ipcRenderer.removeListener('persona:event', listener);
  },
});
