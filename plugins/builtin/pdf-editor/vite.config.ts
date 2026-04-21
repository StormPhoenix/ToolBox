import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      // pdf.js worker 单独打包
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          pdflib: ['pdf-lib'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'pdf-lib'],
  },
});
