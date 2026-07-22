import { CAVALRY_SYNC_FOUNDATION_VERSION, asArray, asString, clonePlain } from './sync-types.js';

function createBucket(workbookId) {
  return {
    workbookId,
    remoteVersion: 0,
    changes: [],
    snapshots: [],
    auditLog: []
  };
}

export function createLocalSyncAdapter(options = {}) {
  const buckets = new Map();
  const adapterId = asString(options.adapterId || 'local_mock_sync');

  function getBucket(workbookId) {
    const id = asString(workbookId || 'local_workbook');
    if (!buckets.has(id)) {
      buckets.set(id, createBucket(id));
    }
    return buckets.get(id);
  }

  return {
    metadata: Object.freeze({
      syncFoundationVersion: CAVALRY_SYNC_FOUNDATION_VERSION,
      adapterId,
      kind: 'local_mock',
      network: false,
      requiresSecrets: false
    }),

    async pushChanges({ workbookId, changes, device } = {}) {
      const bucket = getBucket(
        workbookId || (asArray(changes)[0] && asArray(changes)[0].workbook_id)
      );
      const existingIds = new Set(bucket.changes.map((change) => asString(change.change_id)));
      const accepted = [];
      asArray(changes).forEach((change) => {
        const id = asString(change && change.change_id);
        if (!id || existingIds.has(id)) {
          return;
        }
        bucket.remoteVersion += 1;
        const stored = Object.assign({}, clonePlain(change), {
          remote_version: bucket.remoteVersion,
          sync_status: 'stored_locally'
        });
        bucket.changes.push(stored);
        existingIds.add(id);
        accepted.push(clonePlain(stored));
      });
      bucket.auditLog.push({
        event: 'push_changes',
        workbook_id: bucket.workbookId,
        device_id: asString(device && (device.deviceId || device.device_id)),
        accepted_count: accepted.length,
        remote_version: bucket.remoteVersion
      });
      return {
        ok: true,
        adapter: adapterId,
        network: false,
        requiresSecrets: false,
        pushed: accepted.length,
        remoteVersion: bucket.remoteVersion,
        changes: accepted
      };
    },

    async pullChanges({ workbookId, sinceRemoteVersion = 0, excludeDeviceId = '' } = {}) {
      const bucket = getBucket(workbookId);
      const excluded = asString(excludeDeviceId);
      const changes = bucket.changes
        .filter((change) => Number(change.remote_version) > Number(sinceRemoteVersion || 0))
        .filter((change) => !excluded || asString(change.device_id) !== excluded)
        .map(clonePlain);
      bucket.auditLog.push({
        event: 'pull_changes',
        workbook_id: bucket.workbookId,
        excluded_device_id: excluded,
        returned_count: changes.length,
        remote_version: bucket.remoteVersion
      });
      return {
        ok: true,
        adapter: adapterId,
        network: false,
        requiresSecrets: false,
        remoteVersion: bucket.remoteVersion,
        changes
      };
    },

    async saveSnapshot({ workbookId, snapshot, device } = {}) {
      const bucket = getBucket(workbookId);
      bucket.remoteVersion += 1;
      const stored = {
        workbook_id: bucket.workbookId,
        remote_version: bucket.remoteVersion,
        device_id: asString(device && (device.deviceId || device.device_id)),
        snapshot: clonePlain(snapshot || {})
      };
      bucket.snapshots.push(stored);
      bucket.auditLog.push({
        event: 'save_snapshot',
        workbook_id: bucket.workbookId,
        device_id: stored.device_id,
        remote_version: bucket.remoteVersion
      });
      return {
        ok: true,
        adapter: adapterId,
        network: false,
        requiresSecrets: false,
        snapshot: clonePlain(stored)
      };
    },

    getWorkbookState(workbookId) {
      const bucket = getBucket(workbookId);
      return clonePlain(bucket);
    },

    listAuditEvents(workbookId) {
      return clonePlain(getBucket(workbookId).auditLog);
    },

    reset() {
      buckets.clear();
    }
  };
}
