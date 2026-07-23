import { readFileSync } from 'node:fs';
import { normalize } from 'node:path';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../../', import.meta.url);

function readText(path) {
  return readFileSync(new URL(path, repoRoot), 'utf8');
}

function normalizePackagePath(path) {
  return normalize(path).replace(/\\/g, '/');
}

function packageFileEntries(configPath = 'electron-builder.yml') {
  const config = loadYaml(readText(configPath));
  return (Array.isArray(config.files) ? config.files : []).map(normalizePackagePath);
}

function isPackaged(path, entries) {
  const normalized = normalizePackagePath(path);
  return entries.some((entry) => {
    if (entry === normalized) {
      return true;
    }
    if (entry.endsWith('/**/*')) {
      return normalized.startsWith(entry.slice(0, -4));
    }
    return false;
  });
}

describe('Electron packaging manifest', () => {
  it('packages only built application output and uses the built main entry', () => {
    const manifest = JSON.parse(readText('package.json'));
    const entries = packageFileEntries();

    expect(manifest.main).toBe('dist/main/index.cjs');
    expect(entries).toEqual([
      'dist/main/**/*',
      'dist/preload/**/*',
      'dist/renderer/**/*',
      'package.json'
    ]);
    expect(isPackaged(manifest.main, entries)).toBe(true);
    expect(isPackaged('dist/mac-arm64/Cavalry for Mac.app', entries)).toBe(false);
    expect(isPackaged('dist/mac/Cavalry for Mac.app', entries)).toBe(false);
    expect(isPackaged('dist/Cavalry for Mac-1.0.15-arm64.dmg', entries)).toBe(false);
    expect(isPackaged('dist/Cavalry for Mac-1.0.15-x64.dmg', entries)).toBe(false);
    expect(readText('vite.main.config.mjs')).toContain('src/main/index.cjs');
    expect(readText('src/main/index.cjs')).toContain("require('./deep-link.cjs')");
  });

  it('keeps separate Apple silicon and Intel packaging commands', () => {
    const manifest = JSON.parse(readText('package.json'));
    const workspaceManifest = JSON.parse(readText('../../package.json'));
    const config = loadYaml(readText('electron-builder.yml'));

    expect(manifest.scripts['pack:mac']).toContain('--arm64');
    expect(manifest.scripts['dist:mac']).toContain('--arm64');
    expect(manifest.scripts['dist:mac']).toContain('--publish never');
    expect(manifest.scripts['pack:mac:intel']).toContain('--x64');
    expect(manifest.scripts['dist:mac:intel']).toContain('--x64');
    expect(manifest.scripts['dist:mac:intel']).toContain('--publish never');
    expect(workspaceManifest.scripts['package:mac:intel']).toBe(
      'npm run dist:mac:intel --workspace @cavalry/mac'
    );
    expect(workspaceManifest.devDependencies.react).toBe(manifest.dependencies.react);
    expect(workspaceManifest.devDependencies['react-dom']).toBe(manifest.dependencies['react-dom']);
    expect(config.dmg.artifactName).toContain('${arch}');
  });

  it('keeps local macOS packaging ad-hoc and isolates signed release output', () => {
    const localConfig = loadYaml(readText('electron-builder.yml'));
    const releaseConfig = loadYaml(readText('electron-builder.release.yml'));
    const manifest = JSON.parse(readText('package.json'));

    expect(localConfig.appId).toBe('com.local.cavalry.mac');
    expect(localConfig.productName).toBe('Cavalry for Mac');
    expect(localConfig.protocols).toEqual([{ name: 'Cavalry URL', schemes: ['cavalry'] }]);
    expect(localConfig.mac.identity).toBe('-');
    expect(localConfig.directories.output).toBe('out/package');
    expect(releaseConfig.appId).toBe(localConfig.appId);
    expect(releaseConfig.productName).toBe(localConfig.productName);
    expect(releaseConfig.protocols).toEqual(localConfig.protocols);
    expect(releaseConfig.mac.identity).toBeUndefined();
    expect(releaseConfig.mac.hardenedRuntime).toBe(true);
    expect(releaseConfig.mac.notarize).toBe(true);
    expect(releaseConfig.forceCodeSigning).toBe(true);
    expect(releaseConfig.mac.target).toEqual(['dmg', 'zip']);
    expect(releaseConfig.dmg).toEqual({ sign: false });
    expect(releaseConfig.mac.artifactName).toBe('Cavalry-for-Mac-${version}-${arch}.${ext}');
    expect(releaseConfig.directories.output).toBe('out/release/mac');
    expect(packageFileEntries('electron-builder.release.yml')).toEqual(packageFileEntries());
    expect(manifest.devDependencies['electron-builder']).toBe('26.15.3');
    expect(manifest.scripts['dist:release:mac']).toContain('--arm64 --x64');
    expect(manifest.scripts['dist:release:mac']).toContain('--publish never');
  });

  it('builds a separately identified, signed Windows x64 NSIS updater', () => {
    const config = loadYaml(readText('electron-builder.windows.yml'));
    const manifest = JSON.parse(readText('package.json'));
    const icon = readFileSync(new URL(config.win.icon, repoRoot));

    expect(config.appId).toBe('com.local.cavalry.windows');
    expect(config.productName).toBe('Cavalry for Windows');
    expect(config.protocols).toEqual([{ name: 'Cavalry URL', schemes: ['cavalry'] }]);
    expect(config.forceCodeSigning).toBe(true);
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(config.win.verifyUpdateCodeSignature).toBe(true);
    expect(config.win.signtoolOptions).toBeUndefined();
    expect(config.nsis.differentialPackage).toBe(true);
    expect(config.win.icon).toBe('packaging/cavalry-icon.png');
    expect(icon.subarray(1, 4).toString()).toBe('PNG');
    expect(config.directories.output).toBe('out/release/windows');
    expect(packageFileEntries('electron-builder.windows.yml')).toEqual(packageFileEntries());
    expect(manifest.scripts['dist:release:windows']).toContain('--win --x64');
    expect(manifest.scripts['dist:release:windows']).toContain('--publish never');
  });

  it('uses public token-free update feeds and a tag-only draft release workflow', () => {
    const manifest = JSON.parse(readText('package.json'));
    const macConfig = loadYaml(readText('electron-builder.release.yml'));
    const windowsConfig = loadYaml(readText('electron-builder.windows.yml'));
    const workflow = loadYaml(readText('../../.github/workflows/desktop-release.yml'));
    const workflowText = readText('../../.github/workflows/desktop-release.yml');
    const expectedFeed = 'https://github.com/${env.GITHUB_REPOSITORY}/releases/latest/download';

    expect(manifest.dependencies['electron-updater']).toBe('6.8.9');
    expect(macConfig.publish).toMatchObject({ provider: 'generic', url: expectedFeed });
    expect(windowsConfig.publish).toMatchObject({ provider: 'generic', url: expectedFeed });
    expect(workflow.on).toEqual({ push: { tags: ['v*'] } });
    expect(workflow.on).not.toHaveProperty('workflow_dispatch');
    expect(workflow.jobs['build-macos'].strategy).toBeUndefined();
    expect(workflow.jobs).not.toHaveProperty('build-windows');
    expect(workflow.jobs['prepare-draft'].needs).toBe('build-macos');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs['build-macos'].environment).toBe('release-signing');
    expect(workflow.jobs['prepare-draft'].environment).toBe('release-publishing');
    expect(workflow.jobs['prepare-draft'].permissions).toEqual({ contents: 'write' });
    expect(workflowText).not.toContain('CAVALRY_UPDATE_REPOSITORY');
    expect(workflowText).not.toContain('CAVALRY_UPDATE_TOKEN');
    expect(workflowText).not.toContain('CAVALRY_WINDOWS_PUBLISHER_NAME');
    expect(workflowText.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g)).toHaveLength(2);
    expect(workflowText).toContain('repos/$GITHUB_REPOSITORY/releases');
    expect(workflowText).toContain('repository="$GITHUB_REPOSITORY"');
    expect(workflowText).toContain('set -- "$GITHUB_REF_NAME"');
    expect(workflowText).toContain('set -- "$@" "$published_tag"');
    expect(workflowText).toContain('node tools/release/validate-release.mjs "$@"');
    expect(workflowText).not.toContain('published_tags=()');
    expect(workflowText).not.toContain('"${published_tags[@]}"');
    expect(workflowText.match(/electron-updater\/out\/main\.js/g)).toHaveLength(1);
    expect(workflowText).toContain('pattern: cavalry-release-macos-${{ github.ref_name }}');
    expect(workflowText).toContain('apps/mac/scripts/finalize-release-dmgs.mjs');
    expect(workflowText.match(/CSC_LINK: \$\{\{ secrets\.MAC_CSC_LINK \}\}/g)).toHaveLength(2);
    expect(
      workflowText.match(/CSC_KEY_PASSWORD: \$\{\{ secrets\.MAC_CSC_KEY_PASSWORD \}\}/g)
    ).toHaveLength(2);
    const releaseStepNames = workflow.jobs['build-macos'].steps.map((step) => step.name);
    expect(releaseStepNames.indexOf('Sign, notarize, and staple the disk images')).toBeLessThan(
      releaseStepNames.indexOf(
        'Verify macOS signatures, notarization, architectures, and disk images'
      )
    );
    expect(
      releaseStepNames.indexOf(
        'Verify macOS signatures, notarization, architectures, and disk images'
      )
    ).toBeLessThan(releaseStepNames.indexOf('Upload macOS release assets'));
    expect(workflowText).toContain('spctl --assess');
    expect(workflowText).toContain('context:primary-signature');
    expect(workflowText).toContain('verify-release-assets.mjs');
    expect(workflowText).toContain('gh release create "$tag"');
    expect(workflowText).toContain('--draft');
    expect(workflowText).not.toContain('--draft=false');
    expect(workflowText).not.toContain('juanm-builder/Cavalry');
    expect(readText('electron-builder.windows.yml')).not.toContain(
      '${env.CAVALRY_WINDOWS_PUBLISHER_NAME}'
    );
  });

  it('builds and launches both packages on matching native CI runners', () => {
    const workflow = loadYaml(readText('../../.github/workflows/mac-full.yml'));
    const targets = workflow.jobs.full.strategy.matrix.include;

    expect(targets).toEqual([
      {
        display_name: 'Apple silicon',
        runner: 'macos-latest',
        package_command: 'npm run package:mac',
        app_directory: 'mac-arm64',
        binary_architecture: 'arm64',
        artifact_architecture: 'arm64'
      },
      {
        display_name: 'Intel',
        runner: 'macos-15-intel',
        package_command: 'npm run package:mac:intel',
        app_directory: 'mac',
        binary_architecture: 'x86_64',
        artifact_architecture: 'x64'
      }
    ]);
  });

  it('declares the macOS microphone usage reason for Advisor voice input', () => {
    const config = loadYaml(readText('electron-builder.yml'));
    expect(config.productName).toBe('Cavalry for Mac');
    expect(config.mac.icon).toBe('packaging/Cavalry.icns');
    expect(readFileSync(new URL(config.mac.icon, repoRoot)).length).toBeGreaterThan(0);
    expect(config.mac.extendInfo.CFBundleDisplayName).toBe('Cavalry for Mac');
    expect(config.mac.extendInfo.CFBundleName).toBe('Cavalry for Mac');
    const microphoneUsage = config.mac.extendInfo.NSMicrophoneUsageDescription;
    expect(typeof microphoneUsage).toBe('string');
    expect(microphoneUsage).toContain('voice input');
    expect(microphoneUsage.length).toBeGreaterThan(24);
  });

  it('signs the hardened runtime with the microphone entitlement for Advisor voice input', () => {
    const config = loadYaml(readText('electron-builder.yml'));
    expect(config.mac.entitlements).toBe('packaging/entitlements.mac.plist');
    expect(config.mac.entitlementsInherit).toBe('packaging/entitlements.mac.plist');
    const entitlements = readText(config.mac.entitlements);
    expect(entitlements).toContain('<key>com.apple.security.device.audio-input</key>');
    expect(entitlements).toContain('<key>com.apple.security.cs.allow-jit</key>');
    expect(entitlements).toContain(
      '<key>com.apple.security.cs.allow-unsigned-executable-memory</key>'
    );
    expect(entitlements).toContain('<key>com.apple.security.cs.disable-library-validation</key>');
  });
});
