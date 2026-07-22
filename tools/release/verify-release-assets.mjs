import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { load as loadYaml } from 'js-yaml';

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const assetDirectory = resolve(process.argv[2] || 'release-assets');
const versionArgument = process.argv[3] || process.env.GITHUB_REF_NAME || '';
const version = versionArgument.startsWith('v') ? versionArgument.slice(1) : versionArgument;

function fail(message) {
  throw new Error(`Release asset verification failed: ${message}`);
}

function requireAsset(name) {
  const path = resolve(assetDirectory, name);
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    fail(`missing or empty asset: ${name}`);
  }
  return path;
}

function metadataAssetName(url) {
  const withoutQuery = String(url || '').split(/[?#]/, 1)[0];
  const name = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

async function hashFile(path) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('base64');
}

async function readUpdateMetadata(name) {
  const metadata = loadYaml(readFileSync(requireAsset(name), 'utf8'));
  if (!metadata || typeof metadata !== 'object') {
    fail(`${name} is not an update metadata object.`);
  }
  if (metadata.version !== version) {
    fail(`${name} declares version ${metadata.version || '(missing)'} instead of ${version}.`);
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    fail(`${name} does not contain update files.`);
  }
  for (const file of metadata.files) {
    const assetName = metadataAssetName(file?.url);
    const assetPath = requireAsset(assetName);
    if (typeof file?.sha512 !== 'string' || file.sha512.length === 0) {
      fail(`${name} has no usable sha512 for ${assetName || '(unnamed file)'}.`);
    }
    const actualSha512 = await hashFile(assetPath);
    if (actualSha512 !== file.sha512) {
      fail(`${name} sha512 does not match ${assetName}.`);
    }
    if (file.size !== undefined && file.size !== statSync(assetPath).size) {
      fail(`${name} size does not match ${assetName}.`);
    }
  }
  return metadata;
}

if (!stableVersionPattern.test(version)) {
  fail(`"${versionArgument}" must identify a stable MAJOR.MINOR.PATCH version.`);
}

const macArm64Zip = `Cavalry-for-Mac-${version}-arm64.zip`;
const macX64Zip = `Cavalry-for-Mac-${version}-x64.zip`;
const macArm64Dmg = `Cavalry-for-Mac-${version}-arm64.dmg`;
const macX64Dmg = `Cavalry-for-Mac-${version}-x64.dmg`;

[
  macArm64Dmg,
  macX64Dmg,
  macArm64Zip,
  macX64Zip,
  `${macArm64Dmg}.blockmap`,
  `${macX64Dmg}.blockmap`,
  `${macArm64Zip}.blockmap`,
  `${macX64Zip}.blockmap`
].forEach(requireAsset);

const macMetadata = await readUpdateMetadata('latest-mac.yml');
const macZipAssets = new Set(
  macMetadata.files
    .map((file) => metadataAssetName(file.url))
    .filter((name) => name.endsWith('.zip'))
);
if (!macZipAssets.has(macArm64Zip) || !macZipAssets.has(macX64Zip)) {
  fail('latest-mac.yml must reference both the arm64 and x64 ZIP update payloads.');
}

const legacyPath = metadataAssetName(macMetadata.path);
const legacyFile = macMetadata.files.find((file) => metadataAssetName(file.url) === legacyPath);
if (!legacyFile || !macZipAssets.has(legacyPath)) {
  fail('latest-mac.yml legacy path must reference one of the verified macOS ZIP payloads.');
}
if (macMetadata.sha512 !== legacyFile.sha512) {
  fail('latest-mac.yml legacy sha512 must match the file referenced by its legacy path.');
}

process.stdout.write(`Verified complete macOS arm64/x64 assets for ${version}.\n`);
