/**
 * 将 src/main/skill/builtin-skills/ 原样拷贝到 dist/main/skill/builtin-skills/
 *
 * .cjs 脚本不能走 Vite 打包（会被当 ESM 处理），必须原样拷贝。
 * SKILL.md 也一并拷贝（SkillLoader 运行时从磁盘读取）。
 */
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '..', 'src', 'main', 'skill', 'builtin-skills');
const dest = resolve(__dirname, '..', 'dist', 'main', 'skill', 'builtin-skills');

if (!existsSync(src)) {
  console.error(`❌ 源目录不存在: ${src}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`✅ builtin-skills 已拷贝到 ${dest}`);
