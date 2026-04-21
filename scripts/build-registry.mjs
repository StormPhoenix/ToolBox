#!/usr/bin/env node
/**
 * build-registry.mjs
 * 扫描 plugins/ 目录，读取每个插件的 manifest.json，
 * 生成 dist/plugin-registry.json 供 Shell 运行时加载。
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const OUT_DIR = join(ROOT, 'dist');
const OUT_FILE = join(OUT_DIR, 'plugin-registry.json');

async function scanPlugins(baseDir) {
  const manifests = [];

  // 遍历 plugins/<scope>/<id>/
  const scopes = await readdir(baseDir, { withFileTypes: true });
  for (const scope of scopes) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(baseDir, scope.name);
    const plugins = await readdir(scopeDir, { withFileTypes: true });

    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;
      const manifestPath = join(scopeDir, plugin.name, 'manifest.json');
      if (!existsSync(manifestPath)) {
        console.warn(`[registry] No manifest.json in ${scope.name}/${plugin.name}, skipping`);
        continue;
      }

      try {
        const raw = await readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw);
        // 注入 scope 信息，便于运行时定位
        manifest._scope = scope.name;
        manifests.push(manifest);
        console.log(`[registry] ✓ ${scope.name}/${plugin.name} (${manifest.name})`);
      } catch (e) {
        console.error(`[registry] Failed to parse ${manifestPath}:`, e.message);
      }
    }
  }

  return manifests;
}

async function main() {
  console.log('[registry] Scanning plugins...');
  const manifests = await scanPlugins(PLUGINS_DIR);

  // 确保输出目录存在
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(manifests, null, 2), 'utf-8');

  console.log(`[registry] Done. ${manifests.length} plugin(s) → ${OUT_FILE}`);
}

main().catch(e => {
  console.error('[registry] Error:', e);
  process.exit(1);
});
