import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { normalizeCloudConfig } = require(
  resolve(workspaceRoot, 'apps/mac/src/main/cloud-config.cjs')
);

const config = normalizeCloudConfig({
  supabaseUrl: process.env.CAVALRY_SUPABASE_URL,
  publishableKey: process.env.CAVALRY_SUPABASE_PUBLISHABLE_KEY
});

if (!config.configured) {
  throw new Error(
    'Cavalry Cloud release configuration requires an HTTPS project URL and a Supabase publishable key (or legacy anon JWT).'
  );
}

process.stdout.write('Cavalry Cloud release configuration is valid.\n');
