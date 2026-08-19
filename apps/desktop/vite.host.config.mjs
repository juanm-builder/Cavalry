import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv } from 'vite';

const appRoot = dirname(fileURLToPath(import.meta.url));
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig(({ mode }) => {
  const cloudEnv = loadEnv(mode, appRoot, 'CAVALRY_SUPABASE_');
  const supabaseUrl = process.env.CAVALRY_SUPABASE_URL || cloudEnv.CAVALRY_SUPABASE_URL || '';
  const publishableKey =
    process.env.CAVALRY_SUPABASE_PUBLISHABLE_KEY || cloudEnv.CAVALRY_SUPABASE_PUBLISHABLE_KEY || '';

  return {
    define: {
      'process.env.CAVALRY_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'process.env.CAVALRY_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(publishableKey)
    },
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
