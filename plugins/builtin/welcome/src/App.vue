<template>
  <div class="welcome-page">
    <!-- 背景装饰 -->
    <div class="bg-orb orb-1"></div>
    <div class="bg-orb orb-2"></div>

    <div class="welcome-content">
      <!-- Hero -->
      <div class="hero">
        <div class="hero-icon">🧰</div>
        <h1 class="hero-title">欢迎使用 ToolBox</h1>
        <p class="hero-subtitle">你的智能工具箱，集成海量实用工具，一站式提升工作效率</p>
      </div>

      <!-- 统计信息 -->
      <div class="stats-row">
        <div class="stat-item">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">已安装工具</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ stats.builtin }}</div>
          <div class="stat-label">内置工具</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ stats.categories }}</div>
          <div class="stat-label">工具分类</div>
        </div>
      </div>

      <!-- 快速开始 -->
      <div class="section">
        <h2 class="section-title">快速开始</h2>
        <div class="guide-grid">
          <div class="guide-item" v-for="step in guideSteps" :key="step.step">
            <div class="guide-step">{{ step.step }}</div>
            <div class="guide-body">
              <div class="guide-name">{{ step.name }}</div>
              <div class="guide-desc">{{ step.desc }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 版本信息 -->
      <div class="version-info" v-if="appInfo">
        <span>ToolBox v{{ appInfo.version }}</span>
        <span class="divider">·</span>
        <span>Electron {{ appInfo.electronVersion }}</span>
        <span class="divider">·</span>
        <span>Node.js {{ appInfo.nodeVersion }}</span>
        <span class="divider">·</span>
        <span>{{ appInfo.platform }}</span>
        <template v-if="appInfo.gitHash !== 'unknown'">
          <span class="divider">·</span>
          <span title="构建信息">{{ appInfo.gitBranch }}@{{ appInfo.gitHash }}</span>
        </template>
        <template v-if="appInfo.buildTime !== 'unknown'">
          <span class="divider">·</span>
          <span :title="appInfo.buildTime">{{ formatBuildTime(appInfo.buildTime) }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { electronAPI } from '@toolbox/bridge';
import type { AppInfo } from '@toolbox/bridge';

const appInfo = ref<AppInfo | null>(null);

const stats = ref({ total: 0, builtin: 0, categories: 0 });

const guideSteps = [
  {
    step: '01',
    name: '选择分类',
    desc: '在左侧侧边栏选择工具分类，快速找到你需要的工具',
  },
  {
    step: '02',
    name: '点击工具',
    desc: '点击工具卡片，在右侧主区域打开并使用该工具',
  },
  {
    step: '03',
    name: '安装插件',
    desc: '通过插件市场安装第三方工具，扩展工具箱功能',
  },
];

onMounted(async () => {
  try {
    const [info, pluginStats] = await Promise.all([
      electronAPI.getAppInfo(),
      electronAPI.getPluginStats(),
    ]);
    appInfo.value = info;
    stats.value = pluginStats;
  } catch {
    // 非 Electron 环境忽略
  }
});

function formatBuildTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0f0f17;
  --bg-card: #1a1a28;
  --text: #e8e8f2;
  --text-dim: #8888a8;
  --accent: #6c5ce7;
  --accent-light: #a29bfe;
  --border: #1e1e30;
  --radius: 12px;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
</style>

<style scoped>
.welcome-page {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  position: relative;
  overflow: hidden;
}

/* 背景光球 */
.bg-orb {
  position: fixed;
  border-radius: 50%;
  filter: blur(100px);
  pointer-events: none;
  opacity: 0.12;
}
.orb-1 {
  width: 500px; height: 500px;
  background: var(--accent);
  top: -150px; left: -150px;
}
.orb-2 {
  width: 400px; height: 400px;
  background: var(--accent-light);
  bottom: -100px; right: -100px;
}

.welcome-content {
  width: 100%;
  max-width: 680px;
  display: flex;
  flex-direction: column;
  gap: 36px;
  position: relative;
  z-index: 1;
}

/* Hero */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 14px;
  padding: 48px 0 8px;
}

.hero-icon {
  font-size: 3.5rem;
  animation: float 3s ease-in-out infinite;
  filter: drop-shadow(0 8px 24px rgba(108, 92, 231, 0.4));
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.hero-title {
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent-light), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-subtitle {
  font-size: 0.95rem;
  color: var(--text-dim);
  line-height: 1.6;
  max-width: 480px;
}

/* 统计 */
.stats-row {
  display: flex;
  gap: 12px;
}

.stat-item {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--accent-light);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.78rem;
  color: var(--text-dim);
}

/* 快速开始 */
.section-title {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  margin-bottom: 14px;
  font-weight: 600;
}

.guide-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.guide-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  transition: border-color 0.18s ease;
}

.guide-item:hover {
  border-color: var(--accent);
}

.guide-step {
  font-size: 0.72rem;
  font-weight: 700;
  font-family: monospace;
  color: var(--accent-light);
  background: rgba(108, 92, 231, 0.15);
  border-radius: 6px;
  padding: 4px 8px;
  flex-shrink: 0;
  margin-top: 1px;
}

.guide-name {
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 4px;
}

.guide-desc {
  font-size: 0.8rem;
  color: var(--text-dim);
  line-height: 1.5;
}

/* 版本 */
.version-info {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  font-size: 0.75rem;
  color: var(--text-dim);
  padding-bottom: 8px;
  flex-wrap: wrap;
}

.divider { opacity: 0.4; }
</style>
