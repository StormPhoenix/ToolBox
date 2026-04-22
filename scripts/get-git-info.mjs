/**
 * 获取当前 git 构建信息，供各 vite.config.ts 使用。
 *
 * 用法：
 *   import { getGitInfo } from './scripts/get-git-info.mjs';
 *   const git = getGitInfo();
 *   // { hash: 'a1b2c3d', branch: 'main', buildTime: '2026-04-22T13:00:00.000Z' }
 *
 * git 命令不可用（如 CI 未 checkout 完整历史）时，所有字段返回 'unknown'。
 */

import { execSync } from 'child_process';

/**
 * @returns {{ hash: string, branch: string, buildTime: string }}
 */
export function getGitInfo() {
  /**
   * @param {string} cmd
   * @returns {string}
   */
  function run(cmd) {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      return 'unknown';
    }
  }

  return {
    hash:      run('git rev-parse --short HEAD'),
    branch:    run('git rev-parse --abbrev-ref HEAD'),
    buildTime: new Date().toISOString(),
  };
}
