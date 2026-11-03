import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// En GitHub Pages el sitio vive en /<repositorio>/; se fija con BASE al compilar.
export default defineConfig({
  base: process.env.BASE ?? '/',
  resolve: {
    alias: {
      '@datos': fileURLToPath(new URL('../data', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
