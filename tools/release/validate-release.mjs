import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), 'utf8'));
}
function fail(message) {
  throw new Error(`Release validation failed: ${message}`);
}
function compareStableVersions(left, right) {
  const leftParts = left.split('.').map(BigInt);
  const rightParts = right.split('.').map(BigInt);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}
function cargoVersion() {
  const source = readFileSync(resolve(workspaceRoot, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const match = source.match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : '';
}

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
if (!tag) fail('pass the release tag, for example v1.2.3.');
const version = tag.startsWith('v') ? tag.slice(1) : '';
if (!stableVersionPattern.test(version) || tag !== `v${version}`) {
  fail(`tag "${tag}" must use stable vMAJOR.MINOR.PATCH format.`);
}

const rootManifest = readJson('package.json');
const appManifest = readJson('apps/desktop/package.json');
const lockfile = readJson('package-lock.json');
const tauriConfig = readJson('apps/desktop/src-tauri/tauri.conf.json');
const releaseTemplate = readJson('apps/desktop/src-tauri/tauri.release.template.json');
const versions = new Map([
  ['package.json', rootManifest.version],
  ['apps/desktop/package.json', appManifest.version],
  ['package-lock.json root', lockfile.packages?.['']?.version],
  ['package-lock.json desktop', lockfile.packages?.['apps/desktop']?.version],
  ['tauri.conf.json', tauriConfig.version],
  ['Cargo.toml', cargoVersion()]
]);
for (const [source, found] of versions) {
  if (found !== version) fail(`${source} declares ${found || '(missing)'}, expected ${version}.`);
}

for (const name of [
  ...Object.keys(appManifest.dependencies || {}),
  ...Object.keys(appManifest.devDependencies || {})
]) {
  if (['electron', 'electron-builder', 'electron-updater'].includes(name)) {
    fail(`legacy Electron dependency remains: ${name}.`);
  }
}
if (releaseTemplate.bundle?.createUpdaterArtifacts !== true) {
  fail('release template must create signed updater artifacts.');
}
if (releaseTemplate.plugins?.updater?.pubkey !== '__CAVALRY_UPDATER_PUBLIC_KEY__') {
  fail('tracked release template must contain only the updater public-key placeholder.');
}
if (
  !releaseTemplate.plugins?.updater?.endpoints?.every((endpoint) => /^https:\/\//.test(endpoint))
) {
  fail('all updater endpoints must use HTTPS.');
}

const published = process.argv
  .slice(3)
  .map((value) => (value.startsWith('v') ? value.slice(1) : value))
  .filter((value) => stableVersionPattern.test(value));
const highest = published.sort(compareStableVersions).at(-1);
if (highest && compareStableVersions(version, highest) <= 0) {
  fail(`version ${version} must be higher than published version ${highest}.`);
}

process.stdout.write(`Release ${tag} matches npm, Tauri, Cargo, and updater metadata.\n`);
