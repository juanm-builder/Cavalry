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

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
if (!tag) {
  fail('pass the release tag (for example, npm run release:validate -- v1.2.3).');
}

const version = tag.startsWith('v') ? tag.slice(1) : '';
if (!stableVersionPattern.test(version) || tag !== `v${version}`) {
  fail(`tag "${tag}" must use the stable vMAJOR.MINOR.PATCH format.`);
}

const rootManifest = readJson('package.json');
const appManifest = readJson('apps/mac/package.json');
const lockfile = readJson('package-lock.json');
const lockRoot = lockfile.packages?.[''];
const lockApp = lockfile.packages?.['apps/mac'];

if (rootManifest.version !== version) {
  fail(`package.json is ${rootManifest.version}, but the tag is ${tag}.`);
}
if (appManifest.version !== version) {
  fail(`apps/mac/package.json is ${appManifest.version}, but the tag is ${tag}.`);
}
if (lockRoot?.version !== version || lockApp?.version !== version) {
  fail('package-lock.json must contain the same root and desktop app version as the tag.');
}

const updaterVersion = appManifest.dependencies?.['electron-updater'];
if (typeof updaterVersion !== 'string' || updaterVersion.length === 0) {
  fail('electron-updater must be a production dependency of the desktop app.');
}
if (lockApp?.dependencies?.['electron-updater'] !== updaterVersion) {
  fail('package-lock.json must contain the desktop app electron-updater dependency.');
}

const publishedStableVersions = process.argv
  .slice(3)
  .map((publishedTag) => (publishedTag.startsWith('v') ? publishedTag.slice(1) : ''))
  .filter((publishedVersion) => stableVersionPattern.test(publishedVersion));
const highestPublishedVersion = publishedStableVersions.sort(compareStableVersions).at(-1);
if (highestPublishedVersion && compareStableVersions(version, highestPublishedVersion) <= 0) {
  fail(
    `version ${version} must be higher than the newest published stable version ${highestPublishedVersion}.`
  );
}

process.stdout.write(`Release ${tag} matches the workspace, desktop app, and lockfile versions.\n`);
