import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2] || 'release-assets');
const versionArgument = process.argv[3] || process.env.GITHUB_REF_NAME || '';
const version = versionArgument.startsWith('v') ? versionArgument.slice(1) : versionArgument;
const requiredPlatforms = String(process.argv[4] || 'darwin-aarch64,darwin-x86_64')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  throw new Error(`Release asset verification failed: ${message}`);
}
function requireFile(name) {
  const filePath = path.resolve(directory, name);
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
    fail(`missing or empty asset: ${name}`);
  }
  return filePath;
}
function assetName(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    fail(`invalid update URL: ${url || '(missing)'}`);
  }
  if (parsed.protocol !== 'https:') fail(`update URL must use HTTPS: ${url}`);
  return decodeURIComponent(parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1));
}

if (!stable.test(version)) fail(`"${versionArgument}" must identify MAJOR.MINOR.PATCH.`);
const metadataPath = requireFile('latest.json');
let metadata;
try {
  metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
} catch {
  fail('latest.json is not valid JSON.');
}
const metadataVersion = String(metadata.version || '').replace(/^v/, '');
if (metadataVersion !== version) {
  fail(`latest.json declares ${metadata.version || '(missing)'}, expected ${version}.`);
}
if (!metadata.platforms || typeof metadata.platforms !== 'object') {
  fail('latest.json has no platforms map.');
}

for (const platform of requiredPlatforms) {
  const entry = metadata.platforms[platform];
  if (!entry || typeof entry !== 'object') fail(`latest.json is missing ${platform}.`);
  const name = assetName(entry.url);
  requireFile(name);
  const signature = String(entry.signature || '').trim();
  if (!signature) fail(`${platform} has no updater signature.`);
  const signaturePath = requireFile(`${name}.sig`);
  const fileSignature = readFileSync(signaturePath, 'utf8').trim();
  if (fileSignature !== signature) fail(`${platform} signature does not match ${name}.sig.`);
}

if (!metadata.pub_date || Number.isNaN(Date.parse(metadata.pub_date))) {
  fail('latest.json must contain a valid pub_date.');
}
process.stdout.write(`Verified signed Tauri updater assets for ${requiredPlatforms.join(', ')}.\n`);
