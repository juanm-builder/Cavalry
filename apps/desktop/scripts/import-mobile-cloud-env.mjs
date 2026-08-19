import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, '..');
const defaultMobileEnvironment = resolve(appRoot, '../../../Cavalry Mobile/cavalry-ios/.env.local');
const sourcePath = resolve(process.argv[2] || defaultMobileEnvironment);
const destinationPath = resolve(appRoot, '.env');

function parseEnvironment(source) {
  const values = new Map();
  source.split(/\r?\n/u).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
    if (!match) return;
    const [, name, rawValue] = match;
    const value = rawValue.replace(/^(['"])(.*)\1$/u, '$2').trim();
    values.set(name, value);
  });
  return values;
}

function fail(message) {
  throw new Error(`Cavalry Cloud local setup: ${message}`);
}

const source = await readFile(sourcePath, 'utf8').catch(() =>
  fail('the mobile .env.local file could not be read')
);
const values = parseEnvironment(source);
const url = values.get('EXPO_PUBLIC_CAVALRY_SUPABASE_URL') || '';
const publishableKey = values.get('EXPO_PUBLIC_CAVALRY_SUPABASE_PUBLISHABLE_KEY') || '';

let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  fail('the mobile Supabase URL is invalid');
}
if (
  parsedUrl.protocol !== 'https:' ||
  !parsedUrl.hostname.endsWith('.supabase.co') ||
  parsedUrl.pathname !== '/'
) {
  fail('the mobile Supabase URL is not a project URL');
}
if (
  !publishableKey ||
  /service[_-]?role|sb_secret_/iu.test(publishableKey) ||
  (!publishableKey.startsWith('sb_publishable_') && publishableKey.split('.').length !== 3)
) {
  fail('the mobile key is missing or is not a public client key');
}

const output = [
  '# Generated from Cavalry Mobile .env.local. Public client identifiers only.',
  `CAVALRY_SUPABASE_URL=${url}`,
  `CAVALRY_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  ''
].join('\n');

await writeFile(destinationPath, output, { encoding: 'utf8', mode: 0o600 });
await chmod(destinationPath, 0o600);
console.log('Configured Cavalry for Mac to use the same public Supabase project as mobile.');
