const CLOUD_STATUSES = new Set([
  'unconfigured',
  'initializing',
  'unavailable',
  'signed_out',
  'signing_in',
  'signed_in',
  'error'
]);

export const EMPTY_CLOUD_STATE = Object.freeze({
  configured: true,
  status: 'initializing',
  user: null,
  workbooks: [],
  sessionGeneration: 0,
  sessionPersistence: true
});

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function asRevision(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizeCloudUser(value) {
  const source = asObject(value);
  const id = asString(source.id);
  if (!id) return null;
  return {
    id,
    email: asString(source.email),
    name: asString(source.name),
    avatarUrl: asString(source.avatarUrl),
    provider: asString(source.provider || 'icloud'),
    providers: Array.from(
      new Set(
        (Array.isArray(source.providers) ? source.providers : [])
          .map((provider) => asString(provider).toLowerCase())
          .filter(Boolean)
      )
    )
  };
}

function normalizeConflictSide(value) {
  const source = asObject(value);
  const action = asString(source.action);
  if (!['added', 'deleted', 'different', 'edited', 'unchanged'].includes(action)) return null;
  return {
    label: asString(source.label) || 'Device',
    action,
    details: (Array.isArray(source.details) ? source.details : []).slice(0, 8).map((item) => {
      const detail = asObject(item);
      return {
        label: asString(detail.label) || 'Value',
        before: asString(detail.before),
        after: asString(detail.after)
      };
    })
  };
}

export function normalizeConflictNotice(value, workbookId) {
  const source = asObject(value);
  const reportSource = asObject(source.report);
  const id = asString(source.id);
  const reportWorkbookId = asString(reportSource.workbookId);
  const remoteRevision = asRevision(source.remoteRevision);
  if (!(id && remoteRevision && reportWorkbookId === workbookId && reportSource.version === 1)) {
    return null;
  }
  const entries = (Array.isArray(reportSource.entries) ? reportSource.entries : [])
    .slice(0, 50)
    .map((item, index) => {
      const entry = asObject(item);
      const local = normalizeConflictSide(entry.local);
      const remote = normalizeConflictSide(entry.remote);
      if (!(local && remote)) return null;
      return {
        key: asString(entry.key) || `change-${index + 1}`,
        path: asString(entry.path) || '$',
        kind: asString(entry.kind) || 'both_changed',
        section: asString(entry.section) || 'Workbook',
        title: asString(entry.title) || 'Change',
        message: asString(entry.message) || 'Both copies changed this item differently.',
        local,
        remote
      };
    })
    .filter(Boolean);
  return {
    id,
    sourceDevice: asString(source.sourceDevice) || 'Another device',
    detectedAt: asString(source.detectedAt),
    baseRevision: asRevision(source.baseRevision) || null,
    remoteRevision,
    summary: asString(source.summary) || `${entries.length} changes need review`,
    resolutionAvailable: source.resolutionAvailable === true,
    report: {
      version: 1,
      workbookId: reportWorkbookId,
      workbookName: asString(reportSource.workbookName) || 'Workbook',
      conflictCount: Math.max(entries.length, Number(reportSource.conflictCount) || 0),
      omittedCount: Math.max(0, Number(reportSource.omittedCount) || 0),
      entries
    }
  };
}

export function createConflictNoticeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `conflict-${globalThis.crypto.randomUUID()}`;
  }
  return `conflict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeCloudWorkbook(value) {
  const source = asObject(value);
  const id = asString(source.id || source.localWorkbookId || source.local_workbook_id);
  if (!id) return null;
  const conflictNotice = normalizeConflictNotice(source.conflictNotice, id);
  return {
    id,
    name: asString(source.name) || 'Untitled workbook',
    year: Number(source.year) || 0,
    currency: asString(source.currency).toUpperCase(),
    revision: asRevision(source.revision || source.latestRevision || source.latest_revision),
    updatedAt: asString(source.updatedAt || source.updated_at),
    conflict: source.conflict === true,
    pending: source.pending === true,
    ...(conflictNotice ? { conflictNotice } : {})
  };
}

function normalizeCloudWorkbookChange(value) {
  const source = asObject(value);
  const sequence = Number(source.sequence);
  const eventType = asString(source.eventType).toUpperCase();
  const workbookId = asString(source.workbookId);
  if (!(Number.isSafeInteger(sequence) && sequence > 0 && workbookId)) return null;
  return {
    sequence,
    eventType: ['INSERT', 'UPDATE', 'DELETE'].includes(eventType) ? eventType : 'UPDATE',
    workbookId,
    revision: asRevision(source.revision),
    updatedAt: asString(source.updatedAt)
  };
}

export function normalizeCloudState(value) {
  const source = asObject(value);
  const workbookChange = normalizeCloudWorkbookChange(source.workbookChange);
  const configured = source.configured === true;
  const status = CLOUD_STATUSES.has(source.status)
    ? source.status
    : configured
      ? 'signed_out'
      : 'unconfigured';
  return {
    configured,
    status,
    user: normalizeCloudUser(source.user),
    sessionGeneration: Math.max(0, Number(source.sessionGeneration) || 0),
    pendingCount: Math.max(0, Number(source.pendingCount) || 0),
    lastSyncAt: asString(source.lastSyncAt),
    workbooks: (Array.isArray(source.workbooks) ? source.workbooks : [])
      .map(normalizeCloudWorkbook)
      .filter(Boolean),
    ...(workbookChange ? { workbookChange } : {}),
    sessionPersistence:
      source.sessionPersistence === true || source.sessionPersistence === 'secure',
    error: asString(asObject(source.error).message || source.error)
  };
}

export function stateFromResult(result) {
  const source = asObject(result);
  return source.state && typeof source.state === 'object' ? source.state : null;
}

export function errorMessageFromResult(result) {
  const source = asObject(result);
  const state = asObject(source.state);
  return asString(
    (typeof source.error === 'string' ? source.error : asObject(source.error).message) ||
      asObject(state.error).message
  );
}

export function isRetryableAutomaticSyncFailure(result) {
  const source = asObject(result);
  if (source.conflict === true || source.code === 'workbook_revision_conflict') return false;
  const code = asString(source.code || asObject(source.error).code);
  if (
    [
      'cloud_quota_exceeded',
      'cloud_change_rejected',
      'invalid_workbook_id',
      'invalid_revision',
      'icloud_account_unavailable'
    ].includes(code)
  ) {
    return false;
  }
  return !source.ok;
}

export function buildCloudSettingsModel(cloudState, workbook, uiState = {}) {
  const state = normalizeCloudState(cloudState);
  const workbookId = asString(workbook && workbook.id);
  const remote = state.workbooks.find((item) => item.id === workbookId) || null;
  const pendingOperation = asString(uiState.pendingOperation);
  const conflict = uiState.conflict === true;
  const conflictNotice =
    normalizeConflictNotice(uiState.conflictNotice, workbookId) || remote?.conflictNotice || null;
  return {
    ...state,
    pendingOperation,
    notice: asString(uiState.notice),
    error: asString(uiState.error) || state.error,
    current: {
      workbookId,
      linked: !!remote,
      conflict,
      conflictNotice,
      revision: remote ? remote.revision : 0,
      status: ['upload', 'keep-local', 'reconcile'].includes(pendingOperation)
        ? 'uploading'
        : conflict
          ? 'conflict'
          : state.pendingCount > 0 && remote
            ? 'pending'
            : remote
              ? 'synced'
              : 'local_only',
      lastSyncedAt: remote ? remote.updatedAt : ''
    }
  };
}
