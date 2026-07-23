import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { dump as dumpYaml, load as loadYaml } from 'js-yaml';

const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const credentialNames = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];

function fail(message) {
  throw new Error(`DMG finalization failed: ${message}`);
}

function normalizeVersion(versionArgument) {
  const value = String(versionArgument || '');
  const version = value.startsWith('v') ? value.slice(1) : value;
  if (!stableVersionPattern.test(version)) {
    fail(`"${value}" must identify a stable MAJOR.MINOR.PATCH version.`);
  }
  return version;
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

function expectedPayloadNames(version) {
  return [
    `Cavalry-for-Mac-${version}-x64.zip`,
    `Cavalry-for-Mac-${version}-arm64.zip`,
    `Cavalry-for-Mac-${version}-x64.dmg`,
    `Cavalry-for-Mac-${version}-arm64.dmg`
  ];
}

function requireCredentials(environment) {
  return Object.fromEntries(
    credentialNames.map((name) => {
      const value = String(environment[name] || '').trim();
      if (!value) fail(`required environment value ${name} is missing.`);
      return [name, value];
    })
  );
}

async function hashFile(path) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('base64');
}

async function requireFile(path) {
  if (!existsSync(path)) fail(`missing asset: ${basename(path)}`);
  const details = await stat(path);
  if (!details.isFile() || details.size === 0) {
    fail(`missing or empty asset: ${basename(path)}`);
  }
  return details;
}

export function runCommand(command, argumentsList) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, argumentsList, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectCommand);
    child.on('close', (code) => {
      if (code === 0) {
        resolveCommand({ stdout, stderr });
        return;
      }
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      rejectCommand(
        new Error(
          `${basename(command)} ${argumentsList.slice(0, 2).join(' ')} failed with exit code ${code}${
            details ? `:\n${details}` : '.'
          }`
        )
      );
    });
  });
}

export async function regenerateBlockmap(payloadPath, blockMapBuilder = buildBlockMap) {
  const blockmapPath = `${payloadPath}.blockmap`;
  const temporaryPath = `${blockmapPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const updateInfo = await blockMapBuilder(payloadPath, 'gzip', temporaryPath);
    if (
      !updateInfo ||
      !Number.isSafeInteger(updateInfo.size) ||
      updateInfo.size <= 0 ||
      typeof updateInfo.sha512 !== 'string' ||
      updateInfo.sha512.length === 0
    ) {
      fail(`blockmap builder returned invalid update information for ${basename(payloadPath)}.`);
    }
    await requireFile(temporaryPath);
    await rename(temporaryPath, blockmapPath);
    return updateInfo;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function stapleWithRetry(dmgPath, commandRunner, retryDelayMs) {
  const maximumAttempts = 4;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await commandRunner('/usr/bin/xcrun', ['stapler', 'staple', '-v', dmgPath]);
      return;
    } catch (error) {
      if (attempt === maximumAttempts) throw error;
      process.stderr.write(
        `Apple ticket for ${basename(dmgPath)} is not available yet; retrying stapling (${attempt}/${maximumAttempts}).\n`
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
    }
  }
}

export async function refreshMacUpdateMetadata(assetDirectory, versionArgument) {
  const version = normalizeVersion(versionArgument);
  const directory = resolve(assetDirectory);
  const metadataPath = resolve(directory, 'latest-mac.yml');
  await requireFile(metadataPath);

  const metadata = loadYaml(await readFile(metadataPath, 'utf8'));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('latest-mac.yml is not an update metadata object.');
  }
  if (metadata.version !== version) {
    fail(
      `latest-mac.yml declares version ${metadata.version || '(missing)'} instead of ${version}.`
    );
  }
  if (!Array.isArray(metadata.files)) {
    fail('latest-mac.yml has no files list.');
  }

  const expectedNames = expectedPayloadNames(version);
  const expectedSet = new Set(expectedNames);
  const entriesByName = new Map();
  for (const entry of metadata.files) {
    const name = metadataAssetName(entry?.url);
    if (!expectedSet.has(name)) {
      fail(`latest-mac.yml contains unexpected payload ${name || '(missing URL)'}.`);
    }
    if (entriesByName.has(name)) {
      fail(`latest-mac.yml contains duplicate payload ${name}.`);
    }
    entriesByName.set(name, entry);
  }
  for (const name of expectedNames) {
    if (!entriesByName.has(name)) {
      fail(`latest-mac.yml is missing payload ${name}.`);
    }
  }

  for (const name of expectedNames) {
    const payloadPath = resolve(directory, name);
    const details = await requireFile(payloadPath);
    const entry = entriesByName.get(name);
    entry.sha512 = await hashFile(payloadPath);
    entry.size = details.size;
  }

  const legacyName = metadataAssetName(metadata.path);
  const legacyEntry = entriesByName.get(legacyName);
  if (!legacyEntry || !legacyName.endsWith('.zip')) {
    fail('latest-mac.yml legacy path must reference one of the verified ZIP payloads.');
  }
  metadata.sha512 = legacyEntry.sha512;

  const temporaryPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      dumpYaml(metadata, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      }),
      { mode: 0o644 }
    );
    await rename(temporaryPath, metadataPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function finalizeReleaseDmgs({
  assetDirectory,
  versionArgument,
  environment = process.env,
  platform = process.platform,
  commandRunner = runCommand,
  blockMapBuilder = buildBlockMap,
  retryDelayMs = 5000
}) {
  if (platform !== 'darwin') {
    fail('release DMGs can be finalized only on macOS.');
  }
  const version = normalizeVersion(versionArgument);
  const directory = resolve(assetDirectory);
  const credentials = requireCredentials(environment);
  const dmgNames = [`Cavalry-for-Mac-${version}-arm64.dmg`, `Cavalry-for-Mac-${version}-x64.dmg`];

  for (const name of dmgNames) {
    const dmgPath = resolve(directory, name);
    await requireFile(dmgPath);
    await commandRunner('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', dmgPath]);
    const notarization = await commandRunner('/usr/bin/xcrun', [
      'notarytool',
      'submit',
      dmgPath,
      '--key',
      credentials.APPLE_API_KEY,
      '--key-id',
      credentials.APPLE_API_KEY_ID,
      '--issuer',
      credentials.APPLE_API_ISSUER,
      '--wait',
      '--output-format',
      'json'
    ]);
    let notarizationResult;
    try {
      notarizationResult = JSON.parse(notarization.stdout);
    } catch {
      fail(`Apple returned unreadable notarization output for ${name}.`);
    }
    if (notarizationResult.status !== 'Accepted') {
      fail(`Apple did not accept ${name} for notarization.`);
    }
    await stapleWithRetry(dmgPath, commandRunner, retryDelayMs);
    await commandRunner('/usr/bin/xcrun', ['stapler', 'validate', '-v', dmgPath]);
    await commandRunner('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', dmgPath]);
    await commandRunner('/usr/sbin/spctl', [
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      '--verbose=4',
      dmgPath
    ]);
    await regenerateBlockmap(dmgPath, blockMapBuilder);
    process.stdout.write(`Apple accepted and stapled ${name}.\n`);
  }

  await refreshMacUpdateMetadata(directory, version);
  process.stdout.write(`Refreshed macOS updater metadata for ${version}.\n`);
}

async function main() {
  const assetDirectory = process.argv[2];
  const versionArgument = process.argv[3] || process.env.GITHUB_REF_NAME;
  if (!assetDirectory || !versionArgument) {
    fail('usage: node finalize-release-dmgs.mjs <asset-directory> <version-or-tag>.');
  }
  await finalizeReleaseDmgs({ assetDirectory, versionArgument });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
