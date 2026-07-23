import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { load as loadYaml } from 'js-yaml';

const requireFromMacWorkspace = createRequire(
  new URL('../../apps/mac/package.json', import.meta.url)
);
const { buildBlockMap } = requireFromMacWorkspace(
  'app-builder-lib/out/targets/blockmap/blockmap.js'
);

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
  const assetNames = new Set();
  for (const file of metadata.files) {
    const assetName = metadataAssetName(file?.url);
    if (file?.url !== assetName) {
      fail(`${name} URL for ${assetName || '(unnamed file)'} must be a basename only.`);
    }
    if (assetNames.has(assetName)) {
      fail(`${name} contains duplicate payload ${assetName || '(unnamed file)'}.`);
    }
    assetNames.add(assetName);
    const assetPath = requireAsset(assetName);
    if (typeof file?.sha512 !== 'string' || file.sha512.length === 0) {
      fail(`${name} has no usable sha512 for ${assetName || '(unnamed file)'}.`);
    }
    const actualSha512 = await hashFile(assetPath);
    if (actualSha512 !== file.sha512) {
      fail(`${name} sha512 does not match ${assetName}.`);
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      fail(`${name} has no usable size for ${assetName}.`);
    }
    if (file.size !== statSync(assetPath).size) {
      fail(`${name} size does not match ${assetName}.`);
    }
  }
  return { metadata, assetNames };
}

function inspectBlockmap(blockmapPath, payloadName, payloadSize) {
  let blockmap;
  try {
    blockmap = JSON.parse(gunzipSync(readFileSync(blockmapPath)).toString('utf8'));
  } catch {
    fail(`${payloadName}.blockmap is not valid gzip-compressed JSON.`);
  }
  if (blockmap?.version !== '2' || !Array.isArray(blockmap.files) || blockmap.files.length !== 1) {
    fail(`${payloadName}.blockmap does not use the expected version 2 single-file format.`);
  }
  const [file] = blockmap.files;
  if (
    !Array.isArray(file?.checksums) ||
    !Array.isArray(file?.sizes) ||
    file.checksums.length === 0 ||
    file.checksums.length !== file.sizes.length
  ) {
    fail(`${payloadName}.blockmap has inconsistent chunk checksums and sizes.`);
  }
  if (
    file.checksums.some((checksum) => typeof checksum !== 'string' || checksum.length === 0) ||
    file.sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)
  ) {
    fail(`${payloadName}.blockmap contains an invalid chunk.`);
  }
  const coveredBytes = file.sizes.reduce((total, size) => total + size, 0);
  if (coveredBytes !== payloadSize) {
    fail(`${payloadName}.blockmap covers ${coveredBytes} bytes instead of ${payloadSize}.`);
  }
}

async function verifyBlockmap(payloadName) {
  const payloadPath = requireAsset(payloadName);
  const blockmapPath = requireAsset(`${payloadName}.blockmap`);
  const payloadSize = statSync(payloadPath).size;
  inspectBlockmap(blockmapPath, payloadName, payloadSize);

  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'cavalry-blockmap-check-'));
  const expectedBlockmapPath = resolve(temporaryDirectory, 'expected.blockmap');
  try {
    await buildBlockMap(payloadPath, 'gzip', expectedBlockmapPath);
    if (!readFileSync(blockmapPath).equals(readFileSync(expectedBlockmapPath))) {
      fail(`${payloadName}.blockmap does not match the final payload bytes.`);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (!stableVersionPattern.test(version)) {
  fail(`"${versionArgument}" must identify a stable MAJOR.MINOR.PATCH version.`);
}

const macArm64Dmg = `Cavalry-for-Mac-${version}-arm64.dmg`;
const macX64Dmg = `Cavalry-for-Mac-${version}-x64.dmg`;
const macArm64Zip = `Cavalry-for-Mac-${version}-arm64.zip`;
const macX64Zip = `Cavalry-for-Mac-${version}-x64.zip`;
const expectedPayloads = [macX64Zip, macArm64Zip, macX64Dmg, macArm64Dmg];

for (const payloadName of expectedPayloads) {
  requireAsset(payloadName);
  requireAsset(`${payloadName}.blockmap`);
}

const { metadata: macMetadata, assetNames: macMetadataAssets } =
  await readUpdateMetadata('latest-mac.yml');
if (
  macMetadataAssets.size !== expectedPayloads.length ||
  expectedPayloads.some((name) => !macMetadataAssets.has(name))
) {
  fail('latest-mac.yml must reference exactly the arm64/x64 DMG and ZIP payloads.');
}

const legacyPath = metadataAssetName(macMetadata.path);
const legacyFile = macMetadata.files.find((file) => metadataAssetName(file.url) === legacyPath);
if (!legacyFile || !legacyPath.endsWith('.zip')) {
  fail('latest-mac.yml legacy path must reference one of the verified macOS ZIP payloads.');
}
if (macMetadata.sha512 !== legacyFile.sha512) {
  fail('latest-mac.yml legacy sha512 must match the file referenced by its legacy path.');
}

for (const payloadName of expectedPayloads) {
  await verifyBlockmap(payloadName);
}

process.stdout.write(`Verified complete macOS arm64/x64 assets for ${version}.\n`);
