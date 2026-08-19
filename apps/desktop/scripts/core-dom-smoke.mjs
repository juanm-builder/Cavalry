import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rendererDirectory = resolve(appRoot, 'dist/renderer');
const indexPath = resolve(rendererDirectory, 'index.html');

if (!existsSync(indexPath)) throw new Error('The built renderer index is missing.');
const html = readFileSync(indexPath, 'utf8');
if (!html.includes('id="app"'))
  throw new Error("The built renderer does not contain Cavalry's React root.");
if (/electron|preload\.cjs|dist\/main/i.test(html)) {
  throw new Error('The built renderer still references an Electron runtime artifact.');
}
const assetsDirectory = resolve(rendererDirectory, 'assets');
const assets = existsSync(assetsDirectory) ? readdirSync(assetsDirectory) : [];
if (!assets.some((name) => name.endsWith('.js'))) {
  throw new Error('The built renderer has no JavaScript application bundle.');
}

const smoke = spawnSync(process.execPath, [resolve(appRoot, 'scripts/sidecar-smoke.mjs')], {
  cwd: appRoot,
  stdio: 'inherit',
  env: process.env
});
if (smoke.error) throw smoke.error;
if (smoke.status !== 0) throw new Error('The Cavalry desktop host smoke failed.');

process.stdout.write('Cavalry Tauri renderer and host asset smoke passed.\n');
