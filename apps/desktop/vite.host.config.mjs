import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const appRoot = dirname(fileURLToPath(import.meta.url));
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig(() => {
  return {
    build: {
      emptyOutDir: true,
      lib: {
        entry: resolve(appRoot, 'src/host/index.cjs'),
        formats: ['cjs'],
        fileName: () => 'index.cjs'
      },
      minify: false,
      outDir: resolve(appRoot, 'dist/host'),
      rollupOptions: {
        external: (specifier) => nodeBuiltins.has(specifier),
        output: { inlineDynamicImports: true }
      },
      sourcemap: false,
      target: 'node22'
    }
  };
});
