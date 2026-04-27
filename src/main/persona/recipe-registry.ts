/**
 * RecipeRegistry — 配方注册表单例
 *
 * 在 initializePersonaSystem() 时一次性加载所有配方，
 * 之后通过 getRecipe / listRecipes 提供只读访问。
 */
import type { Recipe } from './types';
import { createLogger } from '../logger';

const log = createLogger('RecipeRegistry');

export class RecipeRegistry {
  private recipes: Map<string, Recipe> = new Map();

  register(recipe: Recipe): void {
    this.recipes.set(recipe.name, recipe);
  }

  getRecipe(name: string): Recipe | undefined {
    return this.recipes.get(name);
  }

  listRecipes(): Recipe[] {
    return Array.from(this.recipes.values());
  }

  get size(): number {
    return this.recipes.size;
  }

  clear(): void {
    this.recipes.clear();
    log.info('配方注册表已清空');
  }

  /** 用一组新配方替换整个注册表（用于配置变更后的热重载） */
  replaceAll(recipes: Recipe[]): void {
    this.recipes.clear();
    for (const r of recipes) this.recipes.set(r.name, r);
    log.info(`配方注册表已重载: ${recipes.length} 个`);
  }
}
