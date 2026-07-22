// Tests for local-only sync readiness reporting.

import { describe, expect, it } from 'vitest';

import { createLocalSyncAdapter } from '@cavalry/sync-foundation/application/sync/local-sync-adapter.js';
import {
  getRendererSafeSyncSettings,
  normalizeSyncSettings
} from '@cavalry/sync-foundation/application/sync/sync-types.js';
import {
  assertCloudSyncFoundationSafe,
  buildCloudSyncReadinessReport
} from '@cavalry/sync-foundation/application/sync/sync-readiness-service.js';
import { recordTransactionChange } from '@cavalry/sync-foundation/application/sync/sync-change-log.js';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

describe('cloud sync readiness foundation', () => {
  it('keeps local-only mode as the default and marks production cloud not ready', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const before = JSON.stringify(workbook);
    const report = buildCloudSyncReadinessReport({ workbook });

    expect(report).toMatchObject({
      foundationReady: true,
      productionCloudReady: false,
      dataLeavesMachine: false,
      secretsRequired: false,
      networkCallsAllowed: false,
      status: 'local_only',
      settings: {
        enabled: false,
        mode: 'local_only',
        adapter: 'none',
        allowNetwork: false,
        requireSecrets: false
      }
    });
    expect(report.checks.every((item) => item.ok)).toBe(true);
    expect(workbook).toEqual(JSON.parse(before));
  });

  it('blocks production-cloud settings and strips secrets from safe settings', () => {
    const normalized = normalizeSyncSettings({
      enabled: true,
      mode: 'cloud',
      allowNetwork: true,
      apiKey: 'sk-cloud-secret'
    });
    const safe = getRendererSafeSyncSettings({
      enabled: true,
      mode: 'cloud',
      apiKey: 'sk-cloud-secret'
    });

    expect(normalized).toMatchObject({
      enabled: false,
      mode: 'local_only',
      requestedMode: 'cloud',
      allowNetwork: false,
      requireSecrets: false,
      productionCloudReady: false,
      blockedReason: 'production_cloud_not_implemented',
      apiKeyConfigured: true
    });
    expect(JSON.stringify(safe)).not.toContain('sk-cloud-secret');
  });

  it('reports local mock readiness without requiring secrets or network', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    recordTransactionChange(
      workbook,
      { id: 'txn_ready', amount: 10 },
      {
        createId: (prefix) => prefix + '_001',
        device: { deviceId: 'mac_a' }
      }
    );
    const adapter = createLocalSyncAdapter();
    const report = assertCloudSyncFoundationSafe({
      workbook,
      adapter,
      settings: { enabled: true, mode: 'local_mock' }
    });

    expect(report).toMatchObject({
      foundationReady: true,
      productionCloudReady: false,
      dataLeavesMachine: false,
      secretsRequired: false,
      networkCallsAllowed: false,
      status: 'local_mock_enabled',
      workbook: {
        id: 'wb-minimal',
        pendingChangeCount: 1
      },
      adapter: {
        kind: 'local_mock',
        network: false,
        requiresSecrets: false
      }
    });
  });
});
