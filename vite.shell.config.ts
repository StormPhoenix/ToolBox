import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  root: 'src/shell',
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/shell'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/shell'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
