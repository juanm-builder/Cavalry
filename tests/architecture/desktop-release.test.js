import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyGitHubReleaseSnapshot } from '../../tools/release/verify-release-assets.mjs';

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
  const architecture = platform === 'darwin-aarch64' ? 'aarch64' : 'x64';
  const asset = `Cavalry.for.Mac_${version}_${architecture}.app.tar.gz`;
  writeFileSync(resolve(directory, asset), `synthetic:${asset}`);
  writeFileSync(resolve(directory, `${asset}.sig`), `${signatureFile}\n`);
  writeFileSync(
    resolve(directory, `Cavalry.for.Mac_${version}_${architecture}.dmg`),
    'synthetic dmg'
  );
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

function createGitHubReleaseSnapshot({
  version = currentVersion,
  commit = 'a'.repeat(40),
  repository = 'juanm-builder/Cavalry',
  draft = true,
  includeAliases = true
} = {}) {
  let id = 500;
  const assets = [];
  const byName = {};
  const addAsset = (name) => {
    id += 1;
    const asset = {
      id,
      name,
      size: 100,
      state: 'uploaded',
      url: `https://api.github.com/repos/${repository}/releases/assets/${id}`
    };
    assets.push(asset);
    byName[name] = asset;
    return asset;
  };
  const platformEntries = {};
  const downloadedAssetText = {};
  [
    ['darwin-aarch64', 'aarch64'],
    ['darwin-x86_64', 'x64']
  ].forEach(([platform, architecture]) => {
    const prefix = `Cavalry.for.Mac_${version}_${architecture}`;
    const archive = addAsset(`${prefix}.app.tar.gz`);
    const signatureName = `${prefix}.app.tar.gz.sig`;
    addAsset(signatureName);
    addAsset(`${prefix}.dmg`);
    downloadedAssetText[signatureName] = `${platform}-signature`;
    platformEntries[platform] = {
      signature: `${platform}-signature`,
      url: archive.url
    };
    if (includeAliases) platformEntries[`${platform}-app`] = platformEntries[platform];
  });
  addAsset('latest.json');
  const metadata = {
    version,
    pub_date: '2026-08-21T00:00:00.000Z',
    platforms: platformEntries
  };
  downloadedAssetText['latest.json'] = JSON.stringify(metadata);
  return {
    repository,
    tag: `v${version}`,
    commit,
    tagCommit: commit,
    release: {
      tag_name: `v${version}`,
      target_commitish: commit,
      draft,
      assets
    },
    metadata,
    downloadedAssetText,
    byName
  };
}

afterEach(() => {
  rmSync(generatedReleaseConfig, { force: true });
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Tauri desktop release tooling', () => {
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
    expect(generated.bundle.macOS).toEqual({
      entitlements: 'entitlements.release.plist',
      files: { 'embedded.provisionprofile': 'Cavalry.provisionprofile' }
    });
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

  it('verifies the real draft asset convention and immutable GitHub asset-ID URLs', () => {
    const snapshot = createGitHubReleaseSnapshot();

    expect(verifyGitHubReleaseSnapshot(snapshot)).toMatchObject({
      version: currentVersion,
      tag: `v${currentVersion}`,
      commit: snapshot.commit,
      platforms: ['darwin-aarch64', 'darwin-x86_64']
    });
  });

  it('rejects unknown or cross-repository updater asset IDs', () => {
    const unknown = createGitHubReleaseSnapshot();
    unknown.metadata.platforms['darwin-aarch64'].url =
      'https://api.github.com/repos/juanm-builder/Cavalry/releases/assets/999999';
    expect(() => verifyGitHubReleaseSnapshot(unknown)).toThrow(/unknown release asset ID/i);

    const foreign = createGitHubReleaseSnapshot();
    foreign.metadata.platforms['darwin-aarch64'].url = foreign.metadata.platforms[
      'darwin-aarch64'
    ].url.replace('juanm-builder/Cavalry', 'someone-else/Other');
    expect(() => verifyGitHubReleaseSnapshot(foreign)).toThrow(/belongs to .* expected/i);
  });

  it('rejects an incomplete, unexpected, stale, or already-public release inventory', () => {
    const missingIntel = createGitHubReleaseSnapshot();
    missingIntel.release.assets = missingIntel.release.assets.filter(
      (asset) => !asset.name.endsWith('_x64.dmg')
    );
    expect(() => verifyGitHubReleaseSnapshot(missingIntel)).toThrow(/missing assets/i);

    const unexpected = createGitHubReleaseSnapshot();
    unexpected.release.assets.push({
      id: 999,
      name: 'debug.log',
      size: 1,
      state: 'uploaded',
      url: 'https://api.github.com/repos/juanm-builder/Cavalry/releases/assets/999'
    });
    expect(() => verifyGitHubReleaseSnapshot(unexpected)).toThrow(/unexpected assets/i);

    const stale = createGitHubReleaseSnapshot();
    stale.tagCommit = 'b'.repeat(40);
    expect(() => verifyGitHubReleaseSnapshot(stale)).toThrow(/points to .* expected/i);

    const published = createGitHubReleaseSnapshot({ draft: false });
    expect(() => verifyGitHubReleaseSnapshot(published)).toThrow(/must remain a draft/i);
  });

  it('pins native ARM and Intel runners and verifies the uploaded draft after both builds', () => {
    const workflow = readFileSync(resolve('.github/workflows/desktop-release.yml'), 'utf8');

    expect(workflow).toContain('runner: macos-15');
    expect(workflow).toContain('runner: macos-15-intel');
    expect(workflow).toContain('max-parallel: 1');
    expect(workflow).toContain('asset_arch: aarch64');
    expect(workflow).toContain('asset_arch: x64');
    expect(workflow).toContain('Cavalry.for.Mac_${version}_${{ matrix.asset_arch }}.dmg');
    expect(workflow).toContain('Verify uploaded release assets');
    expect(workflow).toContain('--expect-icloud-enabled');
    expect(workflow).toContain('tools/release/prepare-mac-profile.mjs');
    expect(workflow).toContain('APPLE_SIGNING_CERTIFICATE_SERIAL');
    expect(workflow).toContain('MAC_PROVISIONING_PROFILE_BASE64');
    expect(workflow).toContain('openssl base64 -d -A -out "$profile_path"');
    expect(workflow).toContain("grep -Eq 'CloudKit|^[[:space:]]*\\*[[:space:]]*$'");
    expect(workflow).toContain('embedded.provisionprofile');
    expect(workflow).toContain('scripts/macos-codesign-shim');
    expect(workflow).toContain('/usr/bin/codesign -d --entitlements :- "$sidecar"');
    expect(workflow).toContain(
      'The host sidecar must not carry the app-only CloudKit entitlement.'
    );
    expect(workflow).not.toContain('Skipping sidecar smoke test');
  });
});
