import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = resolve(import.meta.dirname, '../..');
const readJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(desktopRoot, relativePath), 'utf8'));

describe('Tauri desktop security and compatibility boundary', () => {
  it('bundles only the named Cavalry host sidecar', () => {
    const config = readJson('src-tauri/tauri.conf.json');
    const bundleConfig = readJson('src-tauri/tauri.bundle.conf.json');
    expect(bundleConfig.bundle.externalBin).toEqual(['binaries/cavalry-host']);
    expect(bundleConfig.bundle.macOS.files).toEqual({
      'embedded.provisionprofile': 'Cavalry.provisionprofile'
    });
    expect(bundleConfig.bundle.resources).toContain(
      '../packaging/RUNTIME-DEPENDENCY-INVENTORY.txt'
    );
    expect(config.plugins['deep-link'].desktop.schemes).toEqual(['cavalry']);
  });

  it('does not grant renderer shell or process execution permissions', () => {
    const capability = readJson('src-tauri/capabilities/main.json');
    const permissions = capability.permissions.map(String);
    expect(permissions.some((permission) => permission.startsWith('shell:'))).toBe(false);
    expect(permissions.some((permission) => permission.startsWith('process:'))).toBe(false);
    expect(permissions).toContain('dialog:default');
    expect(permissions).toContain('updater:default');
  });

  it("uses Cavalry's Apple identity and CloudKit container on macOS", () => {
    expect(readJson('src-tauri/tauri.macos.conf.json')).toMatchObject({
      productName: 'Cavalry for Mac',
      identifier: 'com.juanmbuilder.cavalry.mac'
    });
    const entitlements = readFileSync(resolve(desktopRoot, 'src-tauri/entitlements.plist'), 'utf8');
    const releaseEntitlements = readFileSync(
      resolve(desktopRoot, 'src-tauri/entitlements.release.plist'),
      'utf8'
    );
    const sidecarEntitlements = readFileSync(
      resolve(desktopRoot, 'src-tauri/entitlements.sidecar.plist'),
      'utf8'
    );
    expect(entitlements).toContain('iCloud.com.juanmbuilder.cavalry');
    expect(entitlements).toContain('com.apple.developer.icloud-services');
    expect(entitlements).toContain('U8H23USGUJ.com.juanmbuilder.cavalry.mac');
    expect(entitlements).toContain(
      'com.apple.developer.icloud-container-development-container-identifiers'
    );
    expect(entitlements).toContain('<string>Development</string>');
    expect(releaseEntitlements).toContain('U8H23USGUJ.com.juanmbuilder.cavalry.mac');
    expect(releaseEntitlements).toContain('<string>Production</string>');
    const developmentInfo = readFileSync(resolve(desktopRoot, 'src-tauri/Info.plist'), 'utf8');
    const releaseInfo = readFileSync(resolve(desktopRoot, 'src-tauri/Info.release.plist'), 'utf8');
    expect(developmentInfo).toContain('<string>Development</string>');
    expect(releaseInfo).toContain('<string>Production</string>');
    expect(sidecarEntitlements).toContain('com.apple.security.cs.allow-jit');
    expect(sidecarEntitlements).toContain('com.apple.security.cs.allow-unsigned-executable-memory');
    expect(sidecarEntitlements).not.toContain('com.apple.developer.icloud');
  });

  it('accepts ISO-8601 workbook timestamps with fractional seconds', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('.withFractionalSeconds');
    expect(cloudKitStore).toContain('fractionalFormatter.date(from: normalized)');
    expect(cloudKitStore).toContain('standardFormatter.date(from: normalized)');
  });

  it('preserves CloudKit state when the same iCloud account signs in again', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('let accountChanged = previous != current');
    expect(cloudKitStore).toContain('preservePending: previous == nil && current != nil');
    expect(cloudKitStore).toContain('diskState.subscriptionIdentifier = cavalrySyncStateVersion');
    expect(cloudKitStore).not.toContain('configuration.subscriptionID =');
    expect(cloudKitStore).toMatch(
      /if accountChanged \{[\s\S]*?resetForAccountChange\([\s\S]*?\n\s*\}/
    );
  });

  it('isolates CKSyncEngine state between development and production', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('CavalryCloudKitEnvironment');
    expect(cloudKitStore).toContain('.appendingPathComponent("environments"');
    expect(cloudKitStore).toContain('.appendingPathComponent("production"');
  });

  it('keeps manual CloudKit recovery bounded and cache-independent', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('var recordChangeRetryCount: Int?');
    expect(cloudKitStore).toContain(
      'if pending.expectedRevision == remoteRevision, retryCount < 1'
    );
    expect(cloudKitStore).toContain('private func recoverRemote(');
    expect(cloudKitStore).toContain(
      'container.privateCloudDatabase.records(for: [targetRecordID])'
    );
    expect(cloudKitStore).toContain('Deletion is deliberately idempotent.');
    expect(cloudKitStore).not.toContain(
      'guard diskState.remote[recordName]?.metadata.id == workbookId else'
    );
  });

  it('does not start the host CloudKit request before the renderer listener is ready', () => {
    const hostSource = readFileSync(resolve(desktopRoot, 'src/host/index.cjs'), 'utf8');
    expect(hostSource).not.toContain('cloudController.restoreExistingSession()');
  });

  it('contains no Electron runtime dependency', () => {
    const packageJson = readJson('package.json');
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    expect(dependencies).not.toHaveProperty('electron');
    expect(dependencies).not.toHaveProperty('electron-builder');
    expect(dependencies).not.toHaveProperty('electron-updater');
  });
});
