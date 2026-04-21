export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;        // 内置 SVG icon 名 或 emoji
  entry: string;       // 相对于插件 dist/ 的入口 HTML 路径（构建后）
  version: string;
  builtin: boolean;
}

export interface Category {
  id: string;
  label: string;
  icon: string;
}
