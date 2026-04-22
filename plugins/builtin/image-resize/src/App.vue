<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { electronAPI } from '@toolbox/bridge';
import type {
  ResizeAlgorithmId,
  ResizeOutputFormat,
  ResizeProviderInfo,
} from '@toolbox/bridge';
import DropZone from './components/DropZone.vue';
import InfoPanel from './components/InfoPanel.vue';
import ExifPanel from './components/ExifPanel.vue';
import ParamsPanel from './components/ParamsPanel.vue';
import PreviewCanvas from './components/PreviewCanvas.vue';
import { useImageSession } from './composables/useImageSession';

// ── 会话 & Provider 列表 ────────────────────────────────────────────────

const session = useImageSession();
const providers = ref<ResizeProviderInfo[]>([]);

// ── 参数（响应式） ──────────────────────────────────────────────────────

const algorithm = ref<ResizeAlgorithmId>('lanczos');
const maxLongEdge = ref<number>(0);
const outputFormat = ref<ResizeOutputFormat>('jpeg');
const quality = ref<number>(85);

// ── 其他 UI 状态 ────────────────────────────────────────────────────────

const isDragOver = ref(false);
const lastSaveDir = ref<string | null>(null); // 本次会话记忆，不持久化
const toast = ref<{ type: 'success' | 'error'; text: string } | null>(null);

function showToast(type: 'success' | 'error', text: string, ms = 3000): void {
  toast.value = { type, text };
  setTimeout(() => {
    if (toast.value?.text === text) toast.value = null;
  }, ms);
}

// ── 导入图片后自动填默认参数 ────────────────────────────────────────────

watch(
  () => session.basic.value,
  (b) => {
    if (!b) return;
    // 最大长边默认 = 原图最长边
    maxLongEdge.value = Math.max(b.width, b.height);
    // 输出格式跟随原图
    outputFormat.value = session.defaultOutputFormat(b.format);
    // 质量默认 85
    quality.value = 85;
    // 算法默认 Lanczos3（若不可用，降级到第一个可用经典算法）
    const def = providers.value.find((p) => p.id === 'lanczos');
    if (def?.available) {
      algorithm.value = 'lanczos';
    } else {
      const first = providers.value.find((p) => p.available && p.category === 'classical');
      if (first) algorithm.value = first.id;
    }
  }
);

// ── 参数变化 → 标记 dirty ──────────────────────────────────────────────

watch(
  () => [algorithm.value, maxLongEdge.value, outputFormat.value, quality.value],
  () => session.markDirty()
);

// ── 导入流程 ────────────────────────────────────────────────────────────

async function pickFile(): Promise<void> {
  const res = await electronAPI.showOpenDialog({
    title: '选择图片',
    properties: ['openFile'],
    filters: [
      {
        name: '图片文件',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff'],
      },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return;
  await session.importFromPath(res.filePaths[0]);
}

async function handleDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  isDragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    const filePath = await electronAPI.getPathForFile(file);
    if (!filePath) {
      showToast('error', '请从本地文件系统拖入图片');
      return;
    }
    await session.importFromPath(filePath);
  } catch (err) {
    showToast('error', (err as Error).message || '导入失败');
  }
}

function handleDragOver(e: DragEvent): void {
  e.preventDefault();
  isDragOver.value = true;
}

function handleDragLeave(): void {
  isDragOver.value = false;
}

// ── 生成 ────────────────────────────────────────────────────────────────

async function onGenerate(): Promise<void> {
  if (!session.sourcePath.value) return;
  if (!maxLongEdge.value || maxLongEdge.value <= 0) {
    showToast('error', '最大长边必须为正整数');
    return;
  }
  await session.generate(
    algorithm.value,
    maxLongEdge.value,
    outputFormat.value,
    quality.value
  );
  if (session.status.value === 'done') {
    showToast('success', '处理完成');
  }
}

// ── 另存为 ──────────────────────────────────────────────────────────────

function extForFormat(f: ResizeOutputFormat): string {
  return f === 'jpeg' ? 'jpg' : f;
}

async function onSaveAs(): Promise<void> {
  if (!session.lastResult.value || !session.basic.value) return;
  const baseName = session.basic.value.filename.replace(/\.[^.]+$/, '');
  const ext = extForFormat(outputFormat.value);
  const defaultName = `${baseName}_resized.${ext}`;
  const defaultPath = lastSaveDir.value
    ? `${lastSaveDir.value}/${defaultName}`
    : defaultName;

  const res = await electronAPI.showSaveDialog({
    title: '保存为',
    defaultPath,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return;

  // 记忆目录
  const dirEnd = res.filePath.lastIndexOf('/');
  if (dirEnd > 0) lastSaveDir.value = res.filePath.slice(0, dirEnd);

  const r = await session.saveAs(res.filePath);
  if (r.ok) {
    showToast('success', '已保存');
  } else {
    showToast('error', r.error || '保存失败');
  }
}

// ── 重置 ────────────────────────────────────────────────────────────────

function onReset(): void {
  session.reset();
  maxLongEdge.value = 0;
}

// ── 显示辅助 ────────────────────────────────────────────────────────────

const thumbUrl = computed(() =>
  session.thumbnailPath.value ? 'file://' + session.thumbnailPath.value : null
);

const currentAlgorithmName = computed(() => {
  const p = providers.value.find((x) => x.id === algorithm.value);
  return p?.displayName ?? algorithm.value;
});

const isGenerating = computed(() => session.status.value === 'generating');

const canSaveAs = computed(
  () => session.status.value === 'done' && session.lastResult.value !== null
);

const hasImage = computed(
  () => session.status.value !== 'empty' && session.basic.value !== null
);

// ── 初始化 ──────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    providers.value = await electronAPI.listResizeProviders();
  } catch (err) {
    console.error('加载 provider 列表失败', err);
  }
});
</script>

<template>
  <div
    class="app"
    @drop="handleDrop"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
  >
    <!-- 顶部操作条 -->
    <header class="toolbar">
      <div class="toolbar-left">
        <button @click="pickFile" :disabled="isGenerating">导入图片</button>
        <button
          @click="onReset"
          :disabled="isGenerating || session.status.value === 'empty'"
        >
          重置
        </button>
      </div>
      <div class="toolbar-right">
        <button
          class="primary"
          :disabled="!canSaveAs || isGenerating"
          @click="onSaveAs"
        >
          另存为…
        </button>
        <button class="batch-btn" disabled title="即将推出">批量</button>
      </div>
    </header>

    <!-- 主体 -->
    <main class="body">
      <!-- 左侧面板 -->
      <aside class="sidebar">
        <DropZone
          :hasImage="hasImage"
          :thumbUrl="thumbUrl"
          :filename="session.basic.value?.filename"
          :isDragOver="isDragOver"
          @pick="pickFile"
        />

        <InfoPanel :basic="session.basic.value" />

        <ExifPanel :exif="session.exif.value" />

        <ParamsPanel
          :providers="providers"
          :algorithm="algorithm"
          :maxLongEdge="maxLongEdge"
          :outputFormat="outputFormat"
          :quality="quality"
          :originalLongEdge="session.originalLongEdge.value"
          :disabled="isGenerating"
          :hasImage="hasImage"
          @update:algorithm="algorithm = $event"
          @update:maxLongEdge="maxLongEdge = $event"
          @update:outputFormat="outputFormat = $event"
          @update:quality="quality = $event"
          @generate="onGenerate"
        />
      </aside>

      <!-- 右侧预览区 -->
      <section class="preview-area">
        <!-- 未导入 / 已导入未生成 / generating / done / error -->
        <div v-if="session.status.value === 'empty'" class="empty-zone">
          <DropZone
            :hasImage="false"
            :isDragOver="isDragOver"
            @pick="pickFile"
          />
        </div>
        <PreviewCanvas
          v-else
          :status="session.status.value"
          :result="session.lastResult.value"
          :errorMsg="session.errorMsg.value"
          :errorDetail="session.errorDetail.value"
          :algorithmName="currentAlgorithmName"
          :dirty="session.dirty.value"
          @retry="onGenerate"
        />
      </section>
    </main>

    <!-- Toast -->
    <transition name="toast">
      <div v-if="toast" class="toast" :class="toast.type">
        {{ toast.text }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-base);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 8px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  gap: 8px;
}

.batch-btn {
  cursor: not-allowed;
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 12px;
  gap: 12px;
}

.sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding-right: 2px;
}

.preview-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.empty-zone {
  flex: 1;
  display: flex;
}

.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 18px;
  font-size: 13px;
  color: var(--text-primary);
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.toast.success {
  border-color: var(--success);
  color: var(--success);
}

.toast.error {
  border-color: var(--error);
  color: var(--error);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.18s ease;
}
</style>
