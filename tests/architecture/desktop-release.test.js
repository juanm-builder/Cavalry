import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories = [];
const generatedReleaseConfig = resolve('apps/desktop/src-tauri/tauri.release.conf.json');
const currentVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;

function runScript(script, args = [], environment = {}) {
  return spawnSync(process.execPath, [resolve(script), ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: { ...process.env, ...environment }
  });
}

function createUpdaterAssets({
  version = currentVersion,
  platform = 'darwin-aarch64',
  protocol = 'https:',
  signature = 'trusted-test-signature',
  signatureFile = signature
} = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'cavalry-tauri-release-'));
  temporaryDirectories.push(directory);
  const asset = `Cavalry_${version}_${platform}.app.tar.gz`;
  writeFileSync(resolve(directory, asset), `synthetic:${asset}`);
  writeFileSync(resolve(directory, `${asset}.sig`), `${signatureFile}\n`);
  writeFileSync(
    resolve(directory, 'latest.json'),
    `${JSON.stringify(
      {
        version,
        notes: 'Synthetic release metadata used by repository tests.',
        pub_date: '2026-08-19T00:00:00.000Z',
        platforms: {
          [platform]: {
            signature,
            url: `${protocol}//downloads.example.test/${asset}`
          }
        }
      },
      null,
      2
    )}\n`
  );
  return { directory, asset, platform };
}

afterEach(() => {
  rmSync(generatedReleaseConfig, { force: true });
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Tauri desktop release tooling', () => {
  it('uses the desktop runtime rules for Cavalry Cloud release values', () => {
    const valid = runScript('tools/release/validate-cloud-config.mjs', [], {
      CAVALRY_SUPABASE_URL: 'https://project.supabase.co',
      CAVALRY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key'
    });
    const invalidKey = runScript('tools/release/validate-cloud-config.mjs', [], {
      CAVALRY_SUPABASE_URL: 'https://project.supabase.co',
      CAVALRY_SUPABASE_PUBLISHABLE_KEY: 'garbage'
    });
    const invalidUrl = runScript('tools/release/validate-cloud-config.mjs', [], {
      CAVALRY_SUPABASE_URL: 'https://project.supabase.co/rest/v1',
      CAVALRY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key'
    });

    expect(valid.status, valid.stderr).toBe(0);
    expect(invalidKey.status).not.toBe(0);
    expect(invalidUrl.status).not.toBe(0);
  });

  it('accepts only the exact stable tag matching npm, Cargo, and Tauri versions', () => {
    const [major, minor, patch] = currentVersion.split('.').map(Number);

    expect(runScript('tools/release/validate-release.mjs', [`v${currentVersion}`]).status).toBe(0);
    expect(
      runScript('tools/release/validate-release.mjs', [`v${major}.${minor}.${patch + 1}`]).status
    ).not.toBe(0);
    expect(
      runScript('tools/release/validate-release.mjs', [`v${currentVersion}-beta.1`]).status
    ).not.toBe(0);
    expect(
      runScript('tools/release/validate-release.mjs', [`v${currentVersion}`, 'v0.9.0']).status
    ).toBe(0);

    const nonIncreasing = runScript('tools/release/validate-release.mjs', [
      `v${currentVersion}`,
      `v${currentVersion}`
    ]);
    expect(nonIncreasing.status).not.toBe(0);
    expect(nonIncreasing.stderr).toContain('must be higher than');
  });

  it('fails closed when a production updater public key is absent', () => {
    const result = runScript('apps/desktop/scripts/write-release-config.mjs', [], {
      CAVALRY_UPDATER_PUBLIC_KEY: ''
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CAVALRY_UPDATER_PUBLIC_KEY is required');
  });

  it('generates an ignored release overlay without mutating the tracked template', () => {
    const trackedBefore = readFileSync(
      resolve('apps/desktop/src-tauri/tauri.release.template.json'),
      'utf8'
    );
    const result = runScript('apps/desktop/scripts/write-release-config.mjs', [], {
      CAVALRY_UPDATER_PUBLIC_KEY: 'test-public-key'
    });
    const generated = JSON.parse(readFileSync(generatedReleaseConfig, 'utf8'));
    const trackedAfter = readFileSync(
      resolve('apps/desktop/src-tauri/tauri.release.template.json'),
      'utf8'
    );
    const trackedTemplate = JSON.parse(trackedBefore);

    expect(result.status, result.stderr).toBe(0);
    expect(generated.plugins.updater.pubkey).toBe('test-public-key');
    expect(generated.bundle.createUpdaterArtifacts).toBe(true);
    expect(generated.bundle).toEqual(trackedTemplate.bundle);
    expect(trackedAfter).toBe(trackedBefore);
  });

  it('verifies a signed Tauri updater payload and matching companion signature', () => {
    const { directory, platform } = createUpdaterAssets();
    const result = runScript('tools/release/verify-release-assets.mjs', [
      directory,
      `v${currentVersion}`,
      platform
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Verified signed Tauri updater assets for ${platform}`);
  });

  it('rejects an updater payload served over an insecure URL', () => {
    const { directory, platform } = createUpdaterAssets({ protocol: 'http:' });
    const result = runScript('tools/release/verify-release-assets.mjs', [
      directory,
      `v${currentVersion}`,
      platform
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('update URL must use HTTPS');
  });

  it('rejects updater metadata whose signature differs from the uploaded .sig file', () => {
    const { directory, platform } = createUpdaterAssets({
      signature: 'metadata-signature',
      signatureFile: 'different-file-signature'
    });
    const result = runScript('tools/release/verify-release-assets.mjs', [
      directory,
      `v${currentVersion}`,
      platform
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('signature does not match');
  });
});
