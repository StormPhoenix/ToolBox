/**
 * 将 src/main/persona/builtin-recipes/ 和 extraction-prompt.md
 * 原样拷贝到 dist/main/persona/ 下。
 *
 * .md 文件需要在运行时被 fs.readFile 读取，不能打包进 asar，
 * 因此采用与 copy-skills.mjs 相同的独立拷贝策略。
 */
import { cpSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcBase = resolve(__dirname, '..', 'src', 'main', 'persona');
const destBase = resolve(__dirname, '..', 'dist', 'main', 'persona');

// 拷贝 builtin-recipes/
const srcRecipes = resolve(srcBase, 'builtin-recipes');
const destRecipes = resolve(destBase, 'builtin-recipes');

if (!existsSync(srcRecipes)) {
  console.error(`❌ 源目录不存在: ${srcRecipes}`);
  process.exit(1);
}

mkdirSync(destRecipes, { recursive: true });
cpSync(srcRecipes, destRecipes, { recursive: true });
console.log(`✅ builtin-recipes 已拷贝到 ${destRecipes}`);

// 拷贝 extraction-prompt.md
const srcPrompt = resolve(srcBase, 'extraction-prompt.md');
const destPrompt = resolve(destBase, 'extraction-prompt.md');

if (!existsSync(srcPrompt)) {
  console.error(`❌ extraction-prompt.md 不存在: ${srcPrompt}`);
  process.exit(1);
}

mkdirSync(destBase, { recursive: true });
copyFileSync(srcPrompt, destPrompt);
console.log(`✅ extraction-prompt.md 已拷贝到 ${destPrompt}`);
