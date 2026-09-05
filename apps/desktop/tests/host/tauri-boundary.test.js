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

  it('fails closed when CloudKit cannot resolve the private account identity', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).not.toContain('userId: "icloud-private"');
    expect(cloudKitStore).toMatch(
      /container\.userRecordID\(\)\.recordName[\s\S]*?catch \{[\s\S]*?CloudKitAccount\(status: "could_not_determine", userId: nil\)/
    );
  });

  it('isolates CKSyncEngine state between development and production', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('CavalryCloudKitEnvironment');
    expect(cloudKitStore).toContain('.appendingPathComponent("environments"');
    expect(cloudKitStore).toContain(
      'configuredCloudEnvironment == "Invalid" ? "invalid" : "production"'
    );
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

  it('emits exact fetched deletion identities instead of inferring from a library listing', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('var deletedWorkbookIds = Set<String>()');
    expect(cloudKitStore).toContain('diskState.remote[recordName]?.metadata.id');
    expect(cloudKitStore).toContain('emit(reason: "deleted", workbookId: workbookId)');
  });

  it('unwraps terminal CloudKit partial failures into an actionable schema diagnosis', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('partialErrorsByItemID');
    expect(cloudKitStore).toContain('.serverRejectedRequest');
    expect(cloudKitStore).toContain('cloud_database_update_required');
    expect(cloudKitStore).toContain('The current CavalryWorkbook schema must be deployed');
    expect(cloudKitStore).toContain('var rejectedSaveCodes: [String: String]?');
    expect(cloudKitStore).toContain('var rejectedSaveDetails: [String: String]?');
    expect(cloudKitStore).toContain('var lastErrorDetails: String?');
    expect(cloudKitStore).toContain('response.retryable = false');
    expect(cloudKitStore).toMatch(
      /actionableCloudError\([\s\S]*?itemID: AnyHashable\(failure\.record\.recordID\)/
    );
    expect(cloudKitStore).toContain('switch actionableError.code');
    expect(cloudKitStore).toContain('actionableError.serverRecord');
    expect(cloudKitStore).not.toContain('switch failure.error.code');
    expect(cloudKitStore).toContain('var lastErrorOperation: String?');
    expect(cloudKitStore).toContain('var lastErrorWorkbookId: String?');
    expect(cloudKitStore).toContain('metadata.inCloud = diskState.remote[recordName] != nil');
    expect(cloudKitStore).toContain(
      'case .serverRejectedRequest where cavalryConfiguredCloudKitEnvironment() == "Production"'
    );
  });

  it('keeps retry and delete diagnostics scoped until their matching operation recovers', () => {
    const cloudKitStore = readFileSync(
      resolve(desktopRoot, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift'),
      'utf8'
    );
    expect(cloudKitStore).toContain('private var fetchCycleHadError = false');
    expect(cloudKitStore).toMatch(
      /case \.didFetchChanges:[\s\S]*?if !fetchCycleHadError, diskState\.lastErrorRetryable == true \{[\s\S]*?clearLastError\(operation: "refresh"\)/
    );
    expect(cloudKitStore).toMatch(/case \.willFetchChanges:[\s\S]*?fetchCycleHadError = false/);
    expect(cloudKitStore).toContain('var pendingDeleteWorkbookIds: [String: String]?');
    expect(cloudKitStore).toContain('pendingDeleteWorkbookIds[recordName] = workbookId');
    expect(cloudKitStore).toMatch(
      /handleFailedDelete[\s\S]*?diskState\.pendingDeleteWorkbookIds\?\[recordID\.recordName\]/
    );
    expect(cloudKitStore).toMatch(
      /applySavedDeletion[\s\S]*?diskState\.pendingDeleteWorkbookIds\?\[recordName\]/
    );
    expect(cloudKitStore).toMatch(
      /pending\.payloadHash == decoded\.payloadHash[\s\S]*?clearLastError\(operation: "upload", workbookId: decoded\.metadata\.id\)/
    );
    expect(cloudKitStore).toContain('var rejectedConflictNotices: [String: String]?');
    expect(cloudKitStore).toContain('var rejectedConflictNoticeCodes: [String: String]?');
    expect(cloudKitStore).toContain('var rejectedConflictNoticeDetails: [String: String]?');
    expect(cloudKitStore).toMatch(
      /if let rejection = diskState\.rejectedConflictNotices\?\[recordName\][\s\S]*?response\.errorOperation = "conflict"[\s\S]*?return response/
    );
    expect(cloudKitStore).toContain('var rejectedDeleteCodes: [String: String]?');
    expect(cloudKitStore).toContain('var rejectedDeleteDetails: [String: String]?');
    expect(cloudKitStore).toContain('details: "Technical code: remote_record_fields_invalid."');
    expect(cloudKitStore).toMatch(
      /let recoverableWorkbookId = normalizedWorkbookId\([\s\S]*?code: "cloud_snapshot_invalid"[\s\S]*?workbookId: recoverableWorkbookId/
    );
    expect(cloudKitStore).toContain('var shouldRetryRecord = false');
    expect(cloudKitStore).toMatch(
      /pending\.recordChangeRetryCount = retryCount \+ 1[\s\S]*?shouldRetryRecord = true/
    );
    expect(cloudKitStore).toMatch(
      /if shouldRetryRecord \{[\s\S]*?syncEngine\.state\.add\([\s\S]*?\} else \{[\s\S]*?syncEngine\.state\.remove\(/
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
