import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(appRoot, 'src-tauri/tauri.release.template.json');
const destinationPath = resolve(appRoot, 'src-tauri/tauri.release.conf.json');
const placeholder = '__CAVALRY_UPDATER_PUBLIC_KEY__';
const publicKey = String(process.env.CAVALRY_UPDATER_PUBLIC_KEY || '').trim();

if (!publicKey || publicKey === placeholder) {
  throw new Error(
    'CAVALRY_UPDATER_PUBLIC_KEY is required for a signed production release. ' +
      'Generate the Tauri updater key pair and provide the public key through the release environment.'
  );
}

const template = JSON.parse(readFileSync(templatePath, 'utf8'));
if (template.plugins?.updater?.pubkey !== placeholder) {
  throw new Error(
    'The tracked release template no longer contains the expected updater-key placeholder.'
  );
}
template.plugins.updater.pubkey = publicKey;
writeFileSync(destinationPath, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Wrote ${destinationPath}\n`);
