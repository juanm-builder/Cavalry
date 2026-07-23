import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';

const temporaryDirectories = [];
const currentVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
const requireFromMacWorkspace = createRequire(
  new URL('../../apps/mac/package.json', import.meta.url)
);
const { buildBlockMap } = requireFromMacWorkspace(
  'app-builder-lib/out/targets/blockmap/blockmap.js'
);

function runScript(script, ...args) {
  return spawnSync(process.execPath, [resolve(script), ...args], {
    cwd: resolve('.'),
    encoding: 'utf8'
  });
}

function runScriptWithEnv(script, environment) {
  return spawnSync(process.execPath, [resolve(script)], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: { ...process.env, ...environment }
  });
}

async function createAssetDirectory(version, { includeX64Mac = true } = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'cavalry-release-assets-'));
  temporaryDirectories.push(directory);
  const macArm64Zip = `Cavalry-for-Mac-${version}-arm64.zip`;
  const macX64Zip = `Cavalry-for-Mac-${version}-x64.zip`;
  const macArm64Dmg = `Cavalry-for-Mac-${version}-arm64.dmg`;
  const macX64Dmg = `Cavalry-for-Mac-${version}-x64.dmg`;
  const assets = [macArm64Dmg, macX64Dmg, macArm64Zip, macX64Zip];
  assets.forEach((asset) => writeFileSync(resolve(directory, asset), `test-asset:${asset}`));
  for (const asset of assets) {
    await buildBlockMap(resolve(directory, asset), 'gzip', resolve(directory, `${asset}.blockmap`));
  }
  const metadataEntry = (url) => {
    const contents = readFileSync(resolve(directory, url));
    return {
      url,
      sha512: createHash('sha512').update(contents).digest('base64'),
      size: contents.length
    };
  };
  const serializeEntries = (entries) =>
    entries
      .map(({ url, sha512, size }) => `  - url: ${url}\n    sha512: ${sha512}\n    size: ${size}`)
      .join('\n');
  const macFiles = [
    macArm64Zip,
    ...(includeX64Mac ? [macX64Zip] : []),
    macArm64Dmg,
    ...(includeX64Mac ? [macX64Dmg] : [])
  ];
  const legacyFile = metadataEntry(macFiles[0]);
  writeFileSync(
    resolve(directory, 'latest-mac.yml'),
    `version: ${version}\nfiles:\n${serializeEntries(macFiles.map(metadataEntry))}\npath: ${legacyFile.url}\nsha512: ${legacyFile.sha512}\n`
  );
  return directory;
}

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('desktop release tooling', () => {
  it('uses the desktop runtime rules for Cavalry Cloud release values', () => {
    const valid = runScriptWithEnv('tools/release/validate-cloud-config.mjs', {
      CAVALRY_SUPABASE_URL: 'https://project.supabase.co',
      CAVALRY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key'
    });
    const invalidKey = runScriptWithEnv('tools/release/validate-cloud-config.mjs', {
      CAVALRY_SUPABASE_URL: 'https://project.supabase.co',
      CAVALRY_SUPABASE_PUBLISHABLE_KEY: 'garbage'
    });
    const invalidUrl = runScriptWithEnv('tools/release/validate-cloud-config.mjs', {
      CAVALRY_SUPABASE_URL: 'https://project.supabase.co/rest/v1',
      CAVALRY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key'
    });

    expect(valid.status, valid.stderr).toBe(0);
    expect(invalidKey.status).not.toBe(0);
    expect(invalidUrl.status).not.toBe(0);
  });

  it('accepts only the exact stable tag matching every release manifest', () => {
    const [major, minor, patch] = currentVersion.split('.').map(Number);

    expect(runScript('tools/release/validate-release.mjs', `v${currentVersion}`).status).toBe(0);
    expect(
      runScript('tools/release/validate-release.mjs', `v${major}.${minor}.${patch + 1}`).status
    ).not.toBe(0);
    expect(
      runScript('tools/release/validate-release.mjs', `v${currentVersion}-beta.1`).status
    ).not.toBe(0);
    expect(
      runScript('tools/release/validate-release.mjs', `v${currentVersion}`, 'v0.9.0').status
    ).toBe(0);
    const nonIncreasing = runScript(
      'tools/release/validate-release.mjs',
      `v${currentVersion}`,
      `v${currentVersion}`
    );
    expect(nonIncreasing.status).not.toBe(0);
    expect(nonIncreasing.stderr).toContain('must be higher than');
  });

  it('verifies a complete two-architecture macOS update set', async () => {
    const directory = await createAssetDirectory('1.0.16');
    const result = runScript('tools/release/verify-release-assets.mjs', directory, 'v1.0.16');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Verified complete macOS arm64/x64 assets');
  });

  it('rejects Mac metadata that would strand one architecture', async () => {
    const directory = await createAssetDirectory('1.0.16', { includeX64Mac: false });
    const result = runScript('tools/release/verify-release-assets.mjs', directory, 'v1.0.16');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('exactly the arm64/x64 DMG and ZIP payloads');
  });

  it('rejects a payload that does not match its published metadata', async () => {
    const directory = await createAssetDirectory('1.0.16');
    writeFileSync(resolve(directory, 'Cavalry-for-Mac-1.0.16-arm64.zip'), 'corrupted');
    const result = runScript('tools/release/verify-release-assets.mjs', directory, 'v1.0.16');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('sha512 does not match');
  });

  it('rejects an incomplete differential-download asset set', async () => {
    const directory = await createAssetDirectory('1.0.16');
    rmSync(resolve(directory, 'Cavalry-for-Mac-1.0.16-arm64.dmg.blockmap'));
    const result = runScript('tools/release/verify-release-assets.mjs', directory, 'v1.0.16');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing or empty asset');
  });

  it('rejects inconsistent legacy updater metadata', async () => {
    const directory = await createAssetDirectory('1.0.16');
    const metadataPath = resolve(directory, 'latest-mac.yml');
    const metadata = readFileSync(metadataPath, 'utf8');
    writeFileSync(metadataPath, metadata.replace(/(\nsha512: )[^\n]+/, '$1invalid'));
    const result = runScript('tools/release/verify-release-assets.mjs', directory, 'v1.0.16');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('legacy sha512 must match');
  });

  it('rejects a corrupt blockmap', async () => {
    const directory = await createAssetDirectory('1.0.16');
    writeFileSync(
      resolve(directory, 'Cavalry-for-Mac-1.0.16-arm64.dmg.blockmap'),
      'not-a-blockmap'
    );
    const result = runScript('tools/release/verify-release-assets.mjs', directory, 'v1.0.16');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('is not valid gzip-compressed JSON');
  });

  it('rejects a same-size payload mutation with a stale blockmap', async () => {
    const directory = await createAssetDirectory('1.0.16');
    const payloadName = 'Cavalry-for-Mac-1.0.16-arm64.dmg';
    const payloadPath = resolve(directory, payloadName);
    const payload = readFileSync(payloadPath);
    payload[0] ^= 0xff;
    writeFileSync(payloadPath, payload);

    const metadataPath = resolve(directory, 'latest-mac.yml');
    const metadata = loadYaml(readFileSync(metadataPath, 'utf8'));
    const entry = metadata.files.find((file) => file.url === payloadName);
    entry.sha512 = createHash('sha512').update(payload).digest('base64');
    writeFileSync(metadataPath, dumpYaml(metadata, { lineWidth: -1 }));

    const result = runScript('tools/release/verify-release-assets.mjs', directory, 'v1.0.16');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('blockmap does not match the final payload bytes');
  });
});
