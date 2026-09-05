'use strict';

const {
  ZONE_ID,
  RECORD_TYPE,
  fail,
  workbookId,
  recordName,
  field,
  payloadBytes,
  metadata,
  positiveInteger,
  workbookFields,
  conflictNotice,
  conflictFields
} = require('./cloudkit-web-records.cjs');
const { createAssetTransport } = require('./cloudkit-web-assets.cjs');

const ERROR_MAP = {
  AUTHENTICATION_REQUIRED: 'icloud_authentication_required',
  AUTHENTICATION_FAILED: 'icloud_authentication_required',
  NOT_AUTHENTICATED: 'icloud_authentication_required',
  invalid_cloudkit_session: 'icloud_authentication_required',
  invalid_cloudkit_response: 'cloudkit_invalid_response',
  cloud_network_unavailable: 'cloudkit_request_failed',
  ACCESS_DENIED: 'icloud_access_denied',
  QUOTA_EXCEEDED: 'cloud_quota_exceeded',
  CONFLICT: 'workbook_revision_conflict',
  EXISTS: 'workbook_revision_conflict',
  TRY_AGAIN_LATER: 'cloudkit_request_failed',
  INTERNAL_ERROR: 'cloudkit_request_failed',
  THROTTLED: 'cloudkit_request_failed',
  ZONE_NOT_FOUND: 'cloud_zone_unavailable',
  UNKNOWN_ITEM: 'cloud_workbook_not_found',
  NOT_FOUND: 'cloud_workbook_not_found'
};
const PUBLIC_ERRORS = {
  cloud_snapshot_invalid:
    'The iCloud copy failed its integrity check. Your local workbook is unchanged.',
  cloud_workbook_identity_mismatch: 'The iCloud copy does not match this workbook.',
  invalid_workbook_id: 'Choose a valid iCloud workbook.',
  invalid_revision: 'The expected iCloud revision is invalid.',
  invalid_conflict_notice: 'The conflict details could not be shared safely.',
  cloud_conflict_package_unavailable:
    'The conflict review changed. Refresh iCloud before resolving it.',
  cloud_workbook_not_found: 'That workbook is no longer in iCloud. Your local copy is unchanged.',
  workbook_revision_conflict:
    'The iCloud workbook changed on another device. Refresh before saving again.',
  cloud_quota_exceeded:
    'iCloud could not accept this workbook. Cavalry supports snapshots up to 25 MiB.',
  icloud_authentication_required:
    'Sign in again to continue syncing. Your work is saved on this device.',
  icloud_access_denied: 'This Apple Account has not granted access to this iCloud library.',
  cloud_zone_unavailable: 'This iCloud library is unavailable. Your local workbooks are unchanged.',
  cloud_database_update_required: 'The iCloud database needs an update before this copy can sync.',
  cloud_session_save_failed:
    'Cavalry could not securely save the iCloud session. Sign in again. Your local workbooks are unchanged.',
  icloud_account_changed:
    'The selected iCloud account changed. Open its library before syncing again.',
  cloudkit_request_failed: 'iCloud is temporarily unavailable. Your work is saved on this device.',
  cloud_asset_url_invalid: 'iCloud returned an asset location that Cavalry could not verify.',
  cloud_asset_upload_failed: 'The iCloud upload did not complete. Your local copy is unchanged.',
  cloud_asset_request_failed: 'The iCloud file could not be transferred. Try syncing again.',
  cloudkit_invalid_response:
    'iCloud returned an incomplete response. Your local workbooks are unchanged.',
  unsupported_cloudkit_operation: 'This iCloud operation is not available.'
};

function responseError(value) {
  if (value?.serverErrorCode) throw fail(value.serverErrorCode);
  if (!value || typeof value !== 'object') throw fail('cloudkit_invalid_response');
  return value;
}

function isMissing(error) {
  return ['NOT_FOUND', 'UNKNOWN_ITEM', 'cloud_workbook_not_found'].includes(error?.code);
}

function createCloudKitWebLibrary({
  api,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString()
}) {
  const assets = createAssetTransport(fetchImpl);

  async function call(path, body) {
    return responseError(await api(path, body));
  }

  async function lookup(id) {
    try {
      const response = await call('records/lookup', {
        zoneID: ZONE_ID,
        records: [{ recordName: recordName(id) }]
      });
      if (!Array.isArray(response.records) || response.records.length !== 1)
        throw fail('cloudkit_invalid_response');
      const record = responseError(response.records[0]);
      if (record.recordName !== recordName(id)) throw fail('cloud_workbook_identity_mismatch');
      if (record.deleted === true) return null;
      metadata(record);
      return record;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function requireRecord(id) {
    const record = await lookup(id);
    if (!record) throw fail('cloud_workbook_not_found');
    return record;
  }

  async function list() {
    const records = new Map();
    const tokens = new Set();
    let syncToken;
    for (let page = 0; page < 100; page += 1) {
      let response;
      try {
        response = await call('changes/zone', {
          zones: [{ zoneID: ZONE_ID, ...(syncToken ? { syncToken } : {}) }],
          resultsLimit: 200
        });
        if (!Array.isArray(response.zones) || response.zones.length !== 1)
          throw fail('cloudkit_invalid_response');
        const zone = responseError(response.zones[0]);
        if (
          zone.zoneID?.zoneName !== ZONE_ID.zoneName ||
          !Array.isArray(zone.records) ||
          typeof zone.moreComing !== 'boolean'
        )
          throw fail('cloudkit_invalid_response');
        for (const record of zone.records) {
          responseError(record);
          if (record.deleted === true) {
            records.delete(record.recordName);
          } else if (record.recordType === RECORD_TYPE) {
            const item = metadata(record);
            records.set(record.recordName, item);
          }
        }
        if (records.size > 10000) throw fail('cloudkit_invalid_response');
        if (zone.moreComing !== true)
          return {
            ok: true,
            workbooks: [...records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            pendingCount: 0,
            lastSyncAt: now()
          };
        if (typeof zone.syncToken !== 'string' || !zone.syncToken || tokens.has(zone.syncToken))
          throw fail('cloudkit_invalid_response');
        syncToken = zone.syncToken;
        tokens.add(syncToken);
      } catch (error) {
        // Only an initially absent zone represents an empty new library. Never
        // turn a failed later page into a successful, incomplete listing.
        if (page === 0 && error.code === 'ZONE_NOT_FOUND')
          return { ok: true, workbooks: [], pendingCount: 0, lastSyncAt: now() };
        throw error;
      }
    }
    throw fail('cloudkit_invalid_response');
  }

  async function uploadAsset(id, fieldName, html) {
    payloadBytes(html);
    const response = await call('assets/upload', {
      zoneID: ZONE_ID,
      tokens: [{ recordName: recordName(id), recordType: RECORD_TYPE, fieldName }]
    });
    const token = response.tokens?.[0];
    responseError(token);
    if (
      response.tokens?.length !== 1 ||
      token?.recordName !== recordName(id) ||
      token.fieldName !== fieldName
    )
      throw fail('cloudkit_invalid_response');
    return assets.upload(token.url, html);
  }

  async function modify(id, remote, fields, operationType = remote ? 'update' : 'create') {
    if (remote && (typeof remote.recordChangeTag !== 'string' || !remote.recordChangeTag))
      throw fail('cloudkit_invalid_response');
    const record = {
      recordName: recordName(id),
      recordType: RECORD_TYPE,
      ...(remote ? { recordChangeTag: remote.recordChangeTag } : {}),
      ...(fields ? { fields } : {})
    };
    const response = await call('records/modify', {
      zoneID: ZONE_ID,
      atomic: true,
      operations: [{ operationType, record }]
    });
    if (!Array.isArray(response.records) || response.records.length !== 1)
      throw fail('cloudkit_invalid_response');
    const saved = responseError(response.records[0]);
    if (saved.recordName !== record.recordName) throw fail('cloud_workbook_identity_mismatch');
    if (operationType === 'delete') {
      if (saved.deleted !== true) throw fail('cloudkit_invalid_response');
      return saved;
    }
    metadata(saved);
    return saved;
  }

  async function save(request) {
    const id = workbookId(request.workbookId);
    const expected =
      request.expectedRevision == null ? null : positiveInteger(request.expectedRevision);
    const revision = (expected ?? 0) + 1;
    // Validate all metadata before the first cloud mutation or asset upload.
    workbookFields(request, revision, null);
    let remote;
    try {
      remote = await lookup(id);
    } catch (error) {
      if (error.code !== 'ZONE_NOT_FOUND' || expected !== null) throw error;
      remote = null;
    }
    if ((remote ? metadata(remote).revision : null) !== expected)
      throw fail('workbook_revision_conflict');
    if (!remote) {
      const zones = await call('zones/modify', {
        operations: [{ operationType: 'create', zone: { zoneID: ZONE_ID } }]
      });
      if (
        zones.zones?.length !== 1 ||
        responseError(zones.zones[0]).zoneID?.zoneName !== ZONE_ID.zoneName
      )
        throw fail('cloudkit_invalid_response');
    }
    const uploaded = await uploadAsset(id, 'payloadAsset', request.portableHtml);
    const fields = workbookFields(request, revision, uploaded.asset);
    let saved;
    try {
      saved = await modify(id, remote, fields);
    } catch (error) {
      if (!['CONFLICT', 'workbook_revision_conflict'].includes(error.code) || !remote) throw error;
      // A conflict-notice update may advance only the record tag. Retry once
      // against that tag only while the workbook revision remains unchanged.
      remote = await lookup(id);
      if (!remote || metadata(remote).revision !== expected)
        throw fail('workbook_revision_conflict');
      saved = await modify(id, remote, fields);
    }
    const result = metadata(saved);
    if (result.revision !== revision || field(saved, 'payloadHash') !== fields.payloadHash.value)
      throw fail('cloudkit_invalid_response');
    return { ok: true, metadata: result, pending: false };
  }

  async function conflict(request, clear) {
    const id = workbookId(request.workbookId);
    const notice = clear ? null : conflictNotice(request.conflictNotice, id);
    if (!clear) {
      payloadBytes(request.conflictPortableHtml);
      if (request.conflictBasePortableHtml != null) payloadBytes(request.conflictBasePortableHtml);
    }
    const remote = await requireRecord(id);
    const source = clear
      ? null
      : await uploadAsset(id, 'conflictPayloadAsset', request.conflictPortableHtml);
    const base =
      !clear && request.conflictBasePortableHtml != null
        ? await uploadAsset(id, 'conflictBasePayloadAsset', request.conflictBasePortableHtml)
        : null;
    const saved = await modify(id, remote, conflictFields(notice, source, base));
    return { ok: true, metadata: metadata(saved), pending: false };
  }

  async function perform(request) {
    switch (request.operation) {
      case 'list':
      case 'sync':
        return list();
      case 'save':
      case 'upload':
        return save(request);
      case 'publish_conflict':
        return conflict(request, false);
      case 'clear_conflict':
        return conflict(request, true);
      case 'download': {
        const record = await requireRecord(workbookId(request.workbookId));
        return {
          ok: true,
          workbook: {
            metadata: metadata(record),
            portableHtml: await assets.download(
              field(record, 'payloadAsset'),
              field(record, 'payloadHash')
            )
          }
        };
      }
      case 'download_conflict': {
        const record = await requireRecord(workbookId(request.workbookId));
        const notice = metadata(record).conflictNotice;
        if (
          !notice ||
          notice.id !== request.conflictNoticeId ||
          field(record, 'conflictPackageNoticeId') !== notice.id
        )
          throw fail('cloud_conflict_package_unavailable');
        const baseAsset = field(record, 'conflictBasePayloadAsset');
        const baseHash = field(record, 'conflictBasePayloadHash');
        if ((baseAsset == null) !== (baseHash == null)) throw fail();
        return {
          ok: true,
          conflictPackage: {
            noticeId: notice.id,
            sourcePortableHtml: await assets.download(
              field(record, 'conflictPayloadAsset'),
              field(record, 'conflictPayloadHash')
            ),
            basePortableHtml: baseAsset == null ? null : await assets.download(baseAsset, baseHash)
          }
        };
      }
      case 'delete': {
        const id = workbookId(request.workbookId);
        let remote;
        try {
          remote = await lookup(id);
        } catch (error) {
          if (error.code !== 'ZONE_NOT_FOUND') throw error;
          remote = null;
        }
        if (remote) {
          try {
            await modify(id, remote, null, 'delete');
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
        return { ok: true, id, pending: false };
      }
      default:
        throw fail('unsupported_cloudkit_operation');
    }
  }

  return {
    async request(payload) {
      try {
        return await perform(payload || {});
      } catch (error) {
        const mapped = ERROR_MAP[error?.code] || error?.code;
        const code = Object.hasOwn(PUBLIC_ERRORS, mapped) ? mapped : 'cloudkit_request_failed';
        return {
          ok: false,
          code,
          error: PUBLIC_ERRORS[code],
          retryable: [
            'cloudkit_request_failed',
            'cloud_asset_request_failed',
            'cloud_asset_upload_failed'
          ].includes(code),
          ...(code === 'workbook_revision_conflict' ? { conflict: true } : {})
        };
      }
    }
  };
}

module.exports = { createCloudKitWebLibrary };
