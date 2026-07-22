import {
  CAVALRY_SYNC_FOUNDATION_VERSION,
  asString,
  getRendererSafeSyncSettings,
  normalizeSyncSettings
} from './sync-types.js';
import { getWorkbookSyncHash } from './sync-change-log.js';

function check(id, ok, message) {
  return { id, ok: ok === true, message };
}

function countPendingSyncChanges(workbook) {
  const outbox =
    workbook && workbook.syncState && Array.isArray(workbook.syncState.outbox)
      ? workbook.syncState.outbox
      : [];
  return outbox.filter((change) => change && change.sync_status !== 'applied').length;
}

export function buildCloudSyncReadinessReport({ workbook, settings, adapter } = {}) {
  const normalized = normalizeSyncSettings(settings || {});
  const defaultSettings = normalizeSyncSettings({});
  const adapterMetadata = adapter && adapter.metadata ? adapter.metadata : null;
  const checks = [
    check(
      'local_only_default',
      defaultSettings.enabled === false && defaultSettings.mode === 'local_only',
      'Default sync mode is local-only.'
    ),
    check(
      'production_cloud_disabled',
      normalized.productionCloudReady === false && normalized.mode !== 'cloud',
      'Production cloud sync is not implemented.'
    ),
    check(
      'no_network_calls',
      normalized.allowNetwork === false && (!adapterMetadata || adapterMetadata.network === false),
      'Foundation sync performs no network calls.'
    ),
    check(
      'no_secrets_required',
      normalized.requireSecrets === false &&
        (!adapterMetadata || adapterMetadata.requiresSecrets === false),
      'Foundation sync requires no secrets.'
    ),
    check(
      'single_workbook_scope',
      !!asString(workbook && workbook.id),
      'Foundation readiness is scoped to one workbook.'
    ),
    check(
      'local_mock_only',
      !normalized.enabled || normalized.adapter === 'local_mock',
      'Only the local mock adapter can be enabled in the foundation.'
    )
  ];
  return {
    syncFoundationVersion: CAVALRY_SYNC_FOUNDATION_VERSION,
    foundationReady: checks.every((item) => item.ok),
    productionCloudReady: false,
    dataLeavesMachine: false,
    secretsRequired: false,
    networkCallsAllowed: false,
    status: normalized.enabled ? 'local_mock_enabled' : 'local_only',
    settings: getRendererSafeSyncSettings(settings || {}),
    workbook: {
      id: asString(workbook && workbook.id),
      version: Number(workbook && workbook.version) || 0,
      hash: workbook ? getWorkbookSyncHash(workbook) : '',
      pendingChangeCount: workbook ? countPendingSyncChanges(workbook) : 0
    },
    adapter: adapterMetadata,
    checks,
    productDecisionsNeeded: [
      'real user account and auth model',
      'hosted storage and encryption model',
      'device trust and revocation model',
      'conflict resolution UI',
      'privacy and legal review'
    ]
  };
}

export function assertCloudSyncFoundationSafe(options = {}) {
  const report = buildCloudSyncReadinessReport(options);
  if (report.networkCallsAllowed || report.secretsRequired || report.productionCloudReady) {
    throw new Error('Cloud sync foundation attempted to enable unsafe production behavior.');
  }
  return report;
}
