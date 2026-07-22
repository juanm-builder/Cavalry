// Adapts validated portable workbooks to owner-scoped Supabase RPCs.
'use strict';

const MAX_PORTABLE_WORKBOOK_BYTES = 25 * 1024 * 1024;

function text(value, maximum = 512) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maximum);
}

function publicFailure(code, message, extra = {}) {
  return { ok: false, code, error: message, ...extra };
}

function firstRecord(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === 'object' ? data : null;
}

function normalizeCloudWorkbookMetadata(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = text(source.local_workbook_id || source.id, 256);
  if (!id) return null;
  const year = Number(source.year);
  const revision = Number(source.latest_revision ?? source.revision);
  return {
    id,
    name: text(source.name, 160) || 'Cavalry',
    year: Number.isInteger(year) ? year : null,
    currency: text(source.currency, 12).toUpperCase(),
    revision: Number.isSafeInteger(revision) && revision > 0 ? revision : 0,
    updatedAt: text(source.updated_at || source.updatedAt, 64)
  };
}

function isSafeWorkbookId(value) {
  const raw = String(value == null ? '' : value);
  return (
    raw === raw.trim() && raw.length >= 1 && raw.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(raw)
  );
}

function normalizeExpectedRevision(value) {
  if (value == null || value === '') return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : NaN;
}

function normalizeDeviceId(value) {
  const id = text(value, 64);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

function isRevisionConflict(error) {
  return !!(
    error &&
    (String(error.code || '') === '40001' ||
      /workbook_revision_conflict|revision conflict/i.test(String(error.message || '')))
  );
}

function isQuotaError(error) {
  return !!(
    error &&
    (String(error.code || '') === '54000' ||
      /(?:quota|snapshot_too_large)/i.test(error.message || ''))
  );
}

function isDatabaseContractError(error) {
  const code = String((error && error.code) || '');
  const message = String((error && error.message) || '');
  return (
    ['42702', '42883', 'PGRST202'].includes(code) ||
    /ambiguous|save_workbook_snapshot.*(?:missing|not found)|schema cache/i.test(message)
  );
}

function createCloudWorkbookController(dependencies = {}) {
  const auth = dependencies.auth;
  let persistencePromise = null;

  function loadPersistence() {
    if (typeof dependencies.getPersistenceService === 'function') {
      return dependencies.getPersistenceService();
    }
    persistencePromise ||=
      import('@cavalry/finance-core/application/workbook/workbook-persistence-service.js');
    return persistencePromise;
  }

  function signedInClient() {
    return auth && auth.isSignedIn() ? auth.getClient() : null;
  }

  async function listWorkbooks() {
    const client = signedInClient();
    if (!client) return publicFailure('not_signed_in', 'Sign in to Cavalry Cloud first.');
    try {
      const result = await client
        .from('workbooks')
        .select('local_workbook_id,name,year,currency,latest_revision,updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });
      if (result.error) throw result.error;
      return {
        ok: true,
        workbooks: (Array.isArray(result.data) ? result.data : [])
          .map(normalizeCloudWorkbookMetadata)
          .filter(Boolean)
      };
    } catch (_error) {
      return publicFailure('cloud_list_failed', 'Cloud workbooks could not be loaded.');
    }
  }

  async function preparePortableWorkbook(payload) {
    const persistence = await loadPersistence();
    let portableHtml = typeof payload.portableHtml === 'string' ? payload.portableHtml : '';
    if (
      !portableHtml &&
      payload.workbook &&
      typeof persistence.serializeWorkbookForSave === 'function'
    ) {
      portableHtml = persistence.serializeWorkbookForSave(payload.workbook, {
        rejectInvalid: true
      }).html;
    }
    if (!portableHtml || Buffer.byteLength(portableHtml, 'utf8') > MAX_PORTABLE_WORKBOOK_BYTES) {
      throw new Error('portable_workbook_size');
    }
    const decoded = persistence.deserializeWorkbookFromFile(portableHtml, { rejectInvalid: true });
    const workbook = decoded.workbook;
    if (!isSafeWorkbookId(workbook && workbook.id)) {
      const error = new Error('workbook_id');
      error.code = 'invalid_workbook_id';
      throw error;
    }
    return { portableHtml, workbook };
  }

  async function uploadWorkbook(payload = {}) {
    const client = signedInClient();
    if (!client) return publicFailure('not_signed_in', 'Sign in to Cavalry Cloud first.');
    const expectedRevision = normalizeExpectedRevision(payload.expectedRevision);
    if (Number.isNaN(expectedRevision)) {
      return publicFailure('invalid_revision', 'The expected cloud revision is invalid.');
    }
    try {
      const prepared = await preparePortableWorkbook(payload);
      const workbook = prepared.workbook;
      const result = await client.rpc('save_workbook_snapshot', {
        p_local_workbook_id: text(workbook.id, 256),
        p_name: text(workbook.name, 160),
        p_year: Number.isInteger(Number(workbook.year)) ? Number(workbook.year) : null,
        p_currency: text(workbook.currency, 12).toUpperCase(),
        p_schema_version: Number.isInteger(Number(workbook.version)) ? Number(workbook.version) : 2,
        p_portable_html: prepared.portableHtml,
        p_expected_revision: expectedRevision,
        p_device_id: normalizeDeviceId(payload.deviceId),
        p_source_updated_at: text(workbook.updatedAt, 64) || null
      });
      if (result.error) {
        if (isRevisionConflict(result.error)) {
          return publicFailure(
            'workbook_revision_conflict',
            'This workbook changed in Cavalry Cloud. Download or review it before uploading again.',
            { conflict: true }
          );
        }
        if (isQuotaError(result.error)) {
          return publicFailure(
            'cloud_quota_exceeded',
            'This workbook or account has reached its Cavalry Cloud storage limit.'
          );
        }
        throw result.error;
      }
      const metadata = normalizeCloudWorkbookMetadata(firstRecord(result.data));
      if (!metadata) throw new Error('invalid_cloud_metadata');
      return { ok: true, metadata };
    } catch (error) {
      if (error && error.code === 'invalid_workbook_id') {
        return publicFailure(
          'invalid_workbook_id',
          'Workbook IDs may contain only letters, numbers, dots, underscores, colons, and dashes.'
        );
      }
      if (isRevisionConflict(error)) {
        return publicFailure(
          'workbook_revision_conflict',
          'This workbook changed in Cavalry Cloud. Download or review it before uploading again.',
          { conflict: true }
        );
      }
      if (isQuotaError(error)) {
        return publicFailure(
          'cloud_quota_exceeded',
          'This workbook or account has reached its Cavalry Cloud storage limit.'
        );
      }
      if (isDatabaseContractError(error)) {
        return publicFailure(
          'cloud_database_update_required',
          'Cavalry Cloud needs a database update before this workbook can be uploaded.'
        );
      }
      return publicFailure('cloud_upload_failed', 'The workbook could not be uploaded securely.');
    }
  }

  async function downloadWorkbook(payload = {}) {
    const client = signedInClient();
    if (!client) return publicFailure('not_signed_in', 'Sign in to Cavalry Cloud first.');
    const workbookId = text(payload.id || payload.workbookId || payload.localWorkbookId, 256);
    if (!isSafeWorkbookId(workbookId)) {
      return publicFailure('invalid_workbook_id', 'Choose a valid cloud workbook.');
    }
    try {
      const result = await client.rpc('download_workbook_snapshot', {
        p_local_workbook_id: workbookId
      });
      if (result.error) throw result.error;
      const record = firstRecord(result.data);
      const portableHtml = record && record.portable_html;
      if (
        typeof portableHtml !== 'string' ||
        !portableHtml ||
        Buffer.byteLength(portableHtml, 'utf8') > MAX_PORTABLE_WORKBOOK_BYTES
      ) {
        throw new Error('invalid_cloud_workbook');
      }
      const persistence = await loadPersistence();
      const decoded = persistence.deserializeWorkbookFromFile(portableHtml, {
        rejectInvalid: true
      });
      if (text(decoded.workbook && decoded.workbook.id, 256) !== workbookId) {
        throw new Error('cloud_workbook_identity_mismatch');
      }
      const metadata = normalizeCloudWorkbookMetadata(record);
      if (!metadata) throw new Error('invalid_cloud_metadata');
      return { ok: true, workbook: decoded.workbook, metadata };
    } catch (_error) {
      return publicFailure('cloud_download_failed', 'The cloud workbook could not be downloaded.');
    }
  }

  async function deleteWorkbook(payload = {}) {
    const client = signedInClient();
    if (!client) return publicFailure('not_signed_in', 'Sign in to Cavalry Cloud first.');
    const workbookId = text(payload.id || payload.workbookId || payload.localWorkbookId, 256);
    if (!isSafeWorkbookId(workbookId)) {
      return publicFailure('invalid_workbook_id', 'Choose a valid cloud workbook.');
    }
    try {
      const result = await client.rpc('delete_workbook', { p_local_workbook_id: workbookId });
      if (result.error || result.data !== true) throw result.error || new Error('delete_failed');
      return { ok: true, id: workbookId };
    } catch (_error) {
      return publicFailure('cloud_delete_failed', 'The cloud workbook could not be removed.');
    }
  }

  return { deleteWorkbook, downloadWorkbook, listWorkbooks, uploadWorkbook };
}

module.exports = {
  MAX_PORTABLE_WORKBOOK_BYTES,
  createCloudWorkbookController,
  isDatabaseContractError,
  isRevisionConflict,
  isQuotaError,
  normalizeCloudWorkbookMetadata
};
