import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { getGitInfo } from './scripts/get-git-info.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const git = getGitInfo();

// Node.js 所有内置模块（含 node: 前缀和裸名），确保不被打包
const NODE_BUILTINS = [
  /^node:/,
  'path', 'fs', 'fs/promises', 'os', 'child_process',
  'crypto', 'stream', 'util', 'events', 'url', 'http',
  'https', 'net', 'tls', 'zlib', 'buffer', 'assert',
  'readline', 'worker_threads', 'perf_hooks', 'v8', 'module',
];

export default defineConfig({
  build: {
    target: 'node20',
    outDir: path.resolve(__dirname, 'dist/main'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      // 双入口：主进程 + preload
      entry: {
        main:    path.resolve(__dirname, 'src/main/main.ts'),
        preload: path.resolve(__dirname, 'src/main/preload.ts'),
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [
        'electron',
        // 原生模块必须 external，避免被打包导致二进制加载失败
        'sharp',
        // exifr 走 CJS 动态路径，external 更稳妥
        'exifr',
        // js-yaml 纯 JS 但避免 ESM/CJS 互操作问题
        'js-yaml',
        ...NODE_BUILTINS,
      ],
      output: {
        // 保持文件名不变，electron-builder 和 package.json 的 main 字段无需修改
        entryFileNames: '[name].js',
      },
    },
  },
  define: {
    // 构建期注入，主进程代码中可直接使用这三个全局常量
    __GIT_HASH__:   JSON.stringify(git.hash),
    __GIT_BRANCH__: JSON.stringify(git.branch),
    __BUILD_TIME__: JSON.stringify(git.buildTime),
  },
});
