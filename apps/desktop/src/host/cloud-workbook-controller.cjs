// Validates portable workbooks and delegates durable synchronization to native CKSyncEngine.
'use strict';

const MAX_PORTABLE_WORKBOOK_BYTES = 25 * 1024 * 1024;
const MAX_CONFLICT_REPORT_BYTES = 128 * 1024;
const CONFLICT_ACTIONS = new Set(['added', 'deleted', 'different', 'edited', 'unchanged']);

function text(value, maximum = 512) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maximum);
}

function publicFailure(code, message, extra = {}) {
  return { ok: false, code, error: message, ...extra };
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeConflictSide(raw) {
  const source = object(raw);
  const action = text(source && source.action, 24);
  if (!source || !CONFLICT_ACTIONS.has(action)) return null;
  return {
    label: text(source.label, 40) || 'Device',
    action,
    details: (Array.isArray(source.details) ? source.details : [])
      .slice(0, 8)
      .map((rawDetail) => {
        const detail = object(rawDetail);
        if (!detail) return null;
        return {
          label: text(detail.label, 80) || 'Value',
          before: text(detail.before, 160),
          after: text(detail.after, 160)
        };
      })
      .filter(Boolean)
  };
}

function normalizeConflictReport(raw, workbookId) {
  let source = raw;
  if (typeof source === 'string') {
    if (!source || Buffer.byteLength(source, 'utf8') > MAX_CONFLICT_REPORT_BYTES) return null;
    try {
      source = JSON.parse(source);
    } catch (_error) {
      return null;
    }
  }
  source = object(source);
  if (!source || Number(source.version) !== 1) return null;
  const reportWorkbookId = text(source.workbookId, 128);
  if (!reportWorkbookId || reportWorkbookId !== workbookId) return null;
  const entries = (Array.isArray(source.entries) ? source.entries : [])
    .slice(0, 50)
    .map((rawEntry, index) => {
      const entry = object(rawEntry);
      const local = normalizeConflictSide(entry && entry.local);
      const remote = normalizeConflictSide(entry && entry.remote);
      if (!entry || !local || !remote) return null;
      return {
        key: text(entry.key, 320) || `change-${index + 1}`,
        path: text(entry.path, 256) || '$',
        kind: text(entry.kind, 64) || 'both_changed',
        section: text(entry.section, 80) || 'Workbook',
        title: text(entry.title, 160) || 'Change',
        message: text(entry.message, 320) || 'Both copies changed this item differently.',
        local,
        remote
      };
    })
    .filter(Boolean);
  const conflictCount = Number(source.conflictCount);
  const omittedCount = Number(source.omittedCount);
  return {
    version: 1,
    workbookId: reportWorkbookId,
    workbookName: text(source.workbookName, 160) || 'Workbook',
    conflictCount:
      Number.isSafeInteger(conflictCount) && conflictCount >= entries.length
        ? conflictCount
        : entries.length,
    omittedCount: Number.isSafeInteger(omittedCount) && omittedCount >= 0 ? omittedCount : 0,
    entries
  };
}

function normalizeConflictNotice(raw, workbookId) {
  const source = object(raw);
  if (!source) return null;
  const id = text(source.id, 160);
  const sourceDevice = text(source.sourceDevice, 80);
  const detectedAt = text(source.detectedAt, 64);
  const remoteRevision = Number(source.remoteRevision);
  const baseRevision = Number(source.baseRevision);
  const report = normalizeConflictReport(source.report, workbookId);
  if (
    !id ||
    !sourceDevice ||
    !detectedAt ||
    !Number.isSafeInteger(remoteRevision) ||
    remoteRevision < 1 ||
    !report
  ) {
    return null;
  }
  return {
    id,
    sourceDevice,
    detectedAt,
    baseRevision: Number.isSafeInteger(baseRevision) && baseRevision > 0 ? baseRevision : null,
    remoteRevision,
    summary: text(source.summary, 160) || `${report.conflictCount} changes need review`,
    resolutionAvailable: source.resolutionAvailable === true,
    report
  };
}

function normalizeCloudWorkbookMetadata(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = text(source.id || source.workbookId, 256);
  const revision = Number(source.revision);
  const year = source.year == null ? null : Number(source.year);
  if (!id || !Number.isSafeInteger(revision) || revision < 1) return null;
  const conflictNotice = normalizeConflictNotice(source.conflictNotice, id);
  return {
    id,
    name: text(source.name, 160) || 'Cavalry',
    year: Number.isInteger(year) ? year : null,
    currency: text(source.currency, 12).toUpperCase(),
    revision,
    updatedAt: text(source.updatedAt, 64),
    ...(source.conflict === true ? { conflict: true } : {}),
    ...(source.pending === true ? { pending: true } : {}),
    ...(conflictNotice ? { conflictNotice } : {})
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

function nativeFailure(result, fallbackCode, fallbackMessage) {
  const source = result && typeof result === 'object' ? result : {};
  const conflict = source.conflict === true || source.code === 'workbook_revision_conflict';
  return publicFailure(
    conflict ? 'workbook_revision_conflict' : text(source.code, 96) || fallbackCode,
    text(source.error, 512) || fallbackMessage,
    conflict ? { conflict: true } : {}
  );
}

function createCloudWorkbookController(dependencies = {}) {
  const cloudKit = dependencies.cloudKit;
  let persistencePromise = null;

  function loadPersistence() {
    if (typeof dependencies.getPersistenceService === 'function') {
      return dependencies.getPersistenceService();
    }
    persistencePromise ||=
      import('@cavalry/finance-core/application/workbook/workbook-persistence-service.js');
    return persistencePromise;
  }

  async function request(payload) {
    if (!(cloudKit && typeof cloudKit.request === 'function')) {
      return publicFailure(
        'cloudkit_unavailable',
        'Native iCloud sync is unavailable in this build.'
      );
    }
    try {
      const result = await cloudKit.request(payload);
      return result && typeof result === 'object'
        ? result
        : publicFailure('cloudkit_invalid_response', 'iCloud returned an invalid response.');
    } catch (error) {
      return publicFailure(
        text(error && error.code, 96) || 'cloudkit_request_failed',
        text(error && error.message, 512) || 'iCloud sync is temporarily unavailable.'
      );
    }
  }

  async function status() {
    return request({ operation: 'status' });
  }

  async function sync() {
    return request({ operation: 'sync' });
  }

  async function listWorkbooks(options = {}) {
    const result = await request({
      operation: 'list',
      refresh: options.refresh !== false
    });
    if (!result.ok) {
      return nativeFailure(result, 'cloud_list_failed', 'iCloud workbooks could not be loaded.');
    }
    return {
      ok: true,
      workbooks: (Array.isArray(result.workbooks) ? result.workbooks : [])
        .map(normalizeCloudWorkbookMetadata)
        .filter(Boolean),
      pendingCount: Number.isSafeInteger(Number(result.pendingCount))
        ? Number(result.pendingCount)
        : 0,
      lastSyncAt: text(result.lastSyncAt, 64)
    };
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
    const expectedRevision = normalizeExpectedRevision(payload.expectedRevision);
    if (Number.isNaN(expectedRevision)) {
      return publicFailure('invalid_revision', 'The expected iCloud revision is invalid.');
    }
    try {
      const prepared = await preparePortableWorkbook(payload);
      const workbook = prepared.workbook;
      const result = await request({
        operation: 'save',
        workbookId: workbook.id,
        name: text(workbook.name, 160),
        year: Number.isInteger(Number(workbook.year)) ? Number(workbook.year) : null,
        currency: text(workbook.currency, 12).toUpperCase(),
        updatedAt: text(workbook.updatedAt, 64),
        portableHtml: prepared.portableHtml,
        expectedRevision,
        conflictResolution: payload.conflictResolution === 'keep_local' ? 'keep_local' : undefined
      });
      if (!result.ok) {
        return nativeFailure(
          result,
          'cloud_upload_failed',
          'The workbook is saved locally and will sync when iCloud is available.'
        );
      }
      const metadata = normalizeCloudWorkbookMetadata(result.metadata);
      if (!metadata || metadata.id !== workbook.id) {
        return publicFailure(
          'cloud_workbook_identity_mismatch',
          'The saved iCloud workbook identity did not match.'
        );
      }
      return { ok: true, metadata, pending: result.pending === true };
    } catch (error) {
      if (error && error.code === 'invalid_workbook_id') {
        return publicFailure(
          'invalid_workbook_id',
          'Workbook IDs may contain only letters, numbers, dots, underscores, colons, and dashes.'
        );
      }
      if (error && error.message === 'portable_workbook_size') {
        return publicFailure(
          'cloud_quota_exceeded',
          "The workbook exceeds Cavalry's 25 MiB iCloud sync limit."
        );
      }
      return publicFailure(
        'cloud_snapshot_invalid',
        'The workbook failed validation before iCloud sync.'
      );
    }
  }

  async function downloadWorkbook(payload = {}) {
    const workbookId = text(payload.id || payload.workbookId || payload.localWorkbookId, 256);
    if (!isSafeWorkbookId(workbookId)) {
      return publicFailure('invalid_workbook_id', 'Choose a valid iCloud workbook.');
    }
    const result = await request({ operation: 'download', workbookId });
    if (!result.ok) {
      return nativeFailure(
        result,
        'cloud_download_failed',
        'The iCloud workbook could not be downloaded.'
      );
    }
    const nativeWorkbook =
      result.workbook && typeof result.workbook === 'object' ? result.workbook : {};
    const portableHtml = nativeWorkbook.portableHtml;
    const metadata = normalizeCloudWorkbookMetadata(nativeWorkbook.metadata);
    if (
      typeof portableHtml !== 'string' ||
      !portableHtml ||
      Buffer.byteLength(portableHtml, 'utf8') > MAX_PORTABLE_WORKBOOK_BYTES ||
      !metadata ||
      metadata.id !== workbookId
    ) {
      return publicFailure('cloud_snapshot_invalid', 'The iCloud workbook snapshot is invalid.');
    }
    try {
      const persistence = await loadPersistence();
      const decoded = persistence.deserializeWorkbookFromFile(portableHtml, {
        rejectInvalid: true
      });
      if (text(decoded.workbook && decoded.workbook.id, 256) !== workbookId) {
        return publicFailure(
          'cloud_workbook_identity_mismatch',
          'The downloaded iCloud workbook identity did not match.'
        );
      }
      return { ok: true, workbook: decoded.workbook, metadata };
    } catch (_error) {
      return publicFailure(
        'cloud_snapshot_invalid',
        'The iCloud workbook failed validation after download.'
      );
    }
  }

  async function deleteWorkbook(payload = {}) {
    const workbookId = text(payload.id || payload.workbookId || payload.localWorkbookId, 256);
    if (!isSafeWorkbookId(workbookId)) {
      return publicFailure('invalid_workbook_id', 'Choose a valid iCloud workbook.');
    }
    const result = await request({ operation: 'delete', workbookId });
    if (!result.ok) {
      return nativeFailure(
        result,
        'cloud_delete_failed',
        'The iCloud workbook could not be removed.'
      );
    }
    return { ok: true, id: text(result.id, 256) || workbookId, pending: result.pending === true };
  }

  async function updateConflictNotice(payload = {}, clear = false) {
    const workbookId = text(payload.id || payload.workbookId || payload.localWorkbookId, 256);
    if (!isSafeWorkbookId(workbookId)) {
      return publicFailure('invalid_workbook_id', 'Choose a valid iCloud workbook.');
    }
    const notice = clear ? null : normalizeConflictNotice(payload.conflictNotice, workbookId);
    if (!clear && !notice) {
      return publicFailure('invalid_conflict_notice', 'The conflict details were invalid.');
    }
    let conflictPackage = null;
    if (!clear) {
      try {
        const source = await preparePortableWorkbook({
          workbook: payload.sourceWorkbook,
          portableHtml: payload.conflictPortableHtml
        });
        if (source.workbook.id !== workbookId) {
          return publicFailure(
            'cloud_workbook_identity_mismatch',
            'The conflict copy did not match this workbook.'
          );
        }
        let base = null;
        if (payload.baseWorkbook || payload.conflictBasePortableHtml) {
          base = await preparePortableWorkbook({
            workbook: payload.baseWorkbook,
            portableHtml: payload.conflictBasePortableHtml
          });
          if (base.workbook.id !== workbookId) {
            return publicFailure(
              'cloud_workbook_identity_mismatch',
              'The conflict base did not match this workbook.'
            );
          }
        }
        conflictPackage = {
          conflictPortableHtml: source.portableHtml,
          ...(base ? { conflictBasePortableHtml: base.portableHtml } : {})
        };
      } catch (error) {
        return publicFailure(
          error && error.message === 'portable_workbook_size'
            ? 'cloud_quota_exceeded'
            : 'cloud_snapshot_invalid',
          'The workbook copies needed for conflict review failed validation.'
        );
      }
    }
    const result = await request({
      operation: clear ? 'clear_conflict' : 'publish_conflict',
      workbookId,
      ...(notice
        ? {
            conflictNotice: {
              ...notice,
              resolutionAvailable: true,
              report: JSON.stringify(notice.report)
            },
            ...conflictPackage
          }
        : {})
    });
    if (!result.ok) {
      return nativeFailure(
        result,
        'cloud_upload_failed',
        clear
          ? 'The conflict notice could not be cleared yet.'
          : 'The conflict details could not be shared with your other devices.'
      );
    }
    const metadata = normalizeCloudWorkbookMetadata(result.metadata);
    if (!metadata || metadata.id !== workbookId) {
      return publicFailure(
        'cloud_workbook_identity_mismatch',
        'iCloud returned invalid workbook metadata.'
      );
    }
    return { ok: true, metadata, pending: result.pending === true };
  }

  async function downloadConflictPackage(payload = {}) {
    const workbookId = text(payload.id || payload.workbookId || payload.localWorkbookId, 256);
    const conflictNoticeId = text(payload.conflictNoticeId, 160);
    if (!isSafeWorkbookId(workbookId) || !conflictNoticeId) {
      return publicFailure(
        'invalid_conflict_notice',
        'Open the latest conflict review and try again.'
      );
    }
    const result = await request({
      operation: 'download_conflict',
      workbookId,
      conflictNoticeId
    });
    if (!result.ok) {
      return nativeFailure(
        result,
        'cloud_download_failed',
        'The conflict details could not be downloaded.'
      );
    }
    const source = object(result.conflictPackage);
    if (
      !source ||
      text(source.noticeId, 160) !== conflictNoticeId ||
      typeof source.sourcePortableHtml !== 'string' ||
      !source.sourcePortableHtml ||
      Buffer.byteLength(source.sourcePortableHtml, 'utf8') > MAX_PORTABLE_WORKBOOK_BYTES ||
      (source.basePortableHtml != null &&
        (typeof source.basePortableHtml !== 'string' ||
          !source.basePortableHtml ||
          Buffer.byteLength(source.basePortableHtml, 'utf8') > MAX_PORTABLE_WORKBOOK_BYTES))
    ) {
      return publicFailure(
        'cloud_snapshot_invalid',
        'The conflict details returned by iCloud were invalid.'
      );
    }
    try {
      const persistence = await loadPersistence();
      const sourceWorkbook = persistence.deserializeWorkbookFromFile(source.sourcePortableHtml, {
        rejectInvalid: true
      }).workbook;
      const baseWorkbook = source.basePortableHtml
        ? persistence.deserializeWorkbookFromFile(source.basePortableHtml, { rejectInvalid: true })
            .workbook
        : null;
      if (
        text(sourceWorkbook && sourceWorkbook.id, 256) !== workbookId ||
        (baseWorkbook && text(baseWorkbook.id, 256) !== workbookId)
      ) {
        return publicFailure(
          'cloud_workbook_identity_mismatch',
          'The conflict details did not match this workbook.'
        );
      }
      return { ok: true, conflictNoticeId, sourceWorkbook, baseWorkbook };
    } catch (_error) {
      return publicFailure(
        'cloud_snapshot_invalid',
        'The conflict details failed validation after download.'
      );
    }
  }

  return {
    clearConflictNotice: (payload) => updateConflictNotice(payload, true),
    deleteWorkbook,
    downloadConflictPackage,
    downloadWorkbook,
    listWorkbooks,
    publishConflictNotice: (payload) => updateConflictNotice(payload, false),
    status,
    sync,
    uploadWorkbook
  };
}

module.exports = {
  MAX_CONFLICT_REPORT_BYTES,
  MAX_PORTABLE_WORKBOOK_BYTES,
  createCloudWorkbookController,
  isSafeWorkbookId,
  normalizeConflictNotice,
  normalizeCloudWorkbookMetadata
};
