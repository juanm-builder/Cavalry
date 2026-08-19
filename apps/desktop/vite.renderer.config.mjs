import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: resolve(appRoot, 'dist/renderer'),
    rollupOptions: {
      input: resolve(appRoot, 'index.html')
    },
    sourcemap: false
  }
});
