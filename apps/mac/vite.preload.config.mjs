import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const appRoot = dirname(fileURLToPath(import.meta.url));
const platformModules = new Set([
  'electron',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
]);

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(appRoot, 'src/preload/index.cjs'),
      formats: ['cjs'],
      fileName: () => 'index.cjs'
    },
    minify: false,
    outDir: resolve(appRoot, 'dist/preload'),
    rollupOptions: {
      external: (specifier) => platformModules.has(specifier),
      output: {
        inlineDynamicImports: true
      }
    },
    sourcemap: false,
    target: 'node22'
  }
});
