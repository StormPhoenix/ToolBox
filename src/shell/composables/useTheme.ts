import { ref, computed, watch, onUnmounted } from 'vue';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

// ── 单例状态 ──────────────────────────────────────────────────────────────────

const preference = ref<ThemePreference>(readPreference());

const resolvedTheme = computed<ResolvedTheme>(() =>
  preference.value === 'system' ? getSystemTheme() : preference.value
);

// 应用主题（preference 变化时同步 DOM）
watch(resolvedTheme, (theme) => applyTheme(theme), { immediate: true });

// ── matchMedia 监听（仅 system 模式下生效） ───────────────────────────────────

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function onSystemThemeChange(): void {
  if (preference.value === 'system') {
    applyTheme(getSystemTheme());
  }
}

mediaQuery.addEventListener('change', onSystemThemeChange);

// ── 公共 composable ───────────────────────────────────────────────────────────

export function useTheme(): {
  preference: typeof preference;
  resolvedTheme: typeof resolvedTheme;
  setPreference: (val: ThemePreference) => void;
} {
  onUnmounted(() => {
    // 单例监听器不在此移除，整个应用生命周期内保持活跃
  });

  function setPreference(val: ThemePreference): void {
    preference.value = val;
    localStorage.setItem(STORAGE_KEY, val);
  }

  return { preference, resolvedTheme, setPreference };
}

// ── 应用启动时立即初始化（在 createApp 前调用） ───────────────────────────────

export function initTheme(): void {
  applyTheme(resolvedTheme.value);
}
