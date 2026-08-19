import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2] || 'release-assets');
const versionArgument = String(process.argv[3] || process.env.GITHUB_REF_NAME || '');
const repository = String(process.argv[4] || process.env.GITHUB_REPOSITORY || '');
const version = versionArgument.startsWith('v') ? versionArgument.slice(1) : versionArgument;
const tag = `v${version}`;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function fail(message) {
  throw new Error(`Tauri update manifest generation failed: ${message}`);
}

function requireFile(name) {
  const file = path.join(directory, name);
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
    fail(`missing or empty release asset: ${name}.`);
  }
  return file;
}

if (!stableVersion.test(version))
  fail(`invalid release version: ${versionArgument || '(missing)'}.`);
if (!repositoryPattern.test(repository))
  fail(`invalid GitHub repository: ${repository || '(missing)'}.`);

const assetByPlatform = {
  'darwin-aarch64': `Cavalry-for-Mac-${version}-aarch64.app.tar.gz`,
  'darwin-x86_64': `Cavalry-for-Mac-${version}-x86_64.app.tar.gz`
};
const baseUrl = `https://github.com/${repository}/releases/download/${tag}`;
const platforms = {};

for (const [platform, asset] of Object.entries(assetByPlatform)) {
  requireFile(asset);
  const signaturePath = requireFile(`${asset}.sig`);
  const signature = readFileSync(signaturePath, 'utf8').trim();
  if (!signature) fail(`empty updater signature: ${asset}.sig.`);
  platforms[platform] = {
    signature,
    url: `${baseUrl}/${encodeURIComponent(asset)}`
  };
}

const manifest = {
  version,
  notes: `Cavalry ${tag}`,
  pub_date: new Date().toISOString(),
  platforms
};
const destination = path.join(directory, 'latest.json');
writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Generated ${destination}\n`);
