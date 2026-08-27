import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { normalizeCloudConfig } = require(
  resolve(workspaceRoot, 'apps/desktop/src/host/cloud-config.cjs')
);

const config = normalizeCloudConfig({
  supabaseUrl: process.env.CAVALRY_SUPABASE_URL,
  publishableKey: process.env.CAVALRY_SUPABASE_PUBLISHABLE_KEY
});
const argumentsList = process.argv.slice(2);

if (
  argumentsList.length !== 0 &&
  (argumentsList.length !== 2 || argumentsList[0] !== '--bundle' || !argumentsList[1])
) {
  throw new Error('Usage: validate-cloud-config.mjs [--bundle <built-host-bundle>]');
}

if (!config.configured) {
  throw new Error(
    'Cavalry Cloud release configuration requires an HTTPS project URL and a Supabase publishable key (or legacy anon JWT).'
  );
}

if (argumentsList.length === 2) {
  let builtHost;
  try {
    builtHost = readFileSync(resolve(argumentsList[1]), 'utf8');
  } catch (_error) {
    throw new Error('The built Cavalry host bundle could not be read for Cloud verification.');
  }
  if (!builtHost.includes(config.url) || !builtHost.includes(config.publishableKey)) {
    throw new Error(
      'The built Cavalry host bundle does not contain the validated public Cloud configuration.'
    );
  }
  process.stdout.write('Cavalry Cloud release configuration is embedded in the built host.\n');
} else {
  process.stdout.write('Cavalry Cloud release configuration is valid.\n');
}
