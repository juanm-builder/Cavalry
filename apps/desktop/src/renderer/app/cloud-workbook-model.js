const CLOUD_STATUSES = new Set([
  'unconfigured',
  'initializing',
  'unavailable',
  'signed_out',
  'disconnected',
  'signing_in',
  'signed_in',
  'error'
]);

export const EMPTY_CLOUD_STATE = Object.freeze({
  configured: true,
  status: 'initializing',
  user: null,
  cloudEnvironment: '',
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

// Republishing the same base/remote revision pair describes the same conflict,
// so the key lets callers skip a redundant publication.
export function conflictNoticePublicationKey(workbookId, baseRevision, remoteRevision) {
  return `${asString(workbookId)}:${asRevision(baseRevision) || 'none'}:${asRevision(remoteRevision)}`;
}

export function buildConflictNotice({ review, baseRevision, remoteRevision }) {
  const count = Math.max(0, Number(review && review.conflictCount) || 0);
  return {
    id: createConflictNoticeId(),
    sourceDevice: 'Mac',
    detectedAt: new Date().toISOString(),
    baseRevision: asRevision(baseRevision) || null,
    remoteRevision: asRevision(remoteRevision),
    summary: `${count} ${count === 1 ? 'change needs' : 'changes need'} review`,
    resolutionAvailable: true,
    report: review
  };
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
    inCloud: source.inCloud === true || source.pending !== true,
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
    cloudEnvironment: asString(source.cloudEnvironment),
    sessionGeneration: Math.max(0, Number(source.sessionGeneration) || 0),
    pendingCount: Math.max(0, Number(source.pendingCount) || 0),
    lastSyncAt: asString(source.lastSyncAt),
    workbooks: (Array.isArray(source.workbooks) ? source.workbooks : [])
      .map(normalizeCloudWorkbook)
      .filter(Boolean),
    ...(workbookChange ? { workbookChange } : {}),
    sessionPersistence:
      source.sessionPersistence === true || source.sessionPersistence === 'secure',
    error: asString(asObject(source.error).message || source.error),
    errorCode: asString(source.errorCode || asObject(source.error).code),
    errorDetails: asString(source.errorDetails),
    errorRetryable: source.errorRetryable === true,
    errorOperation: asString(source.errorOperation),
    errorWorkbookId: asString(source.errorWorkbookId),
    errorWorkbookName: asString(source.errorWorkbookName)
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

export function errorDetailsFromResult(result) {
  const source = asObject(result);
  const state = asObject(source.state);
  return asString(source.errorDetails || state.errorDetails);
}

export function isRetryableAutomaticSyncFailure(result) {
  const source = asObject(result);
  if (source.conflict === true || source.code === 'workbook_revision_conflict') return false;
  const code = asString(source.code || asObject(source.error).code);
  if (
    [
      'cloud_quota_exceeded',
      'cloud_change_rejected',
      'cloud_database_update_required',
      'cloud_record_invalid',
      'icloud_access_denied',
      'invalid_workbook_id',
      'invalid_revision',
      'icloud_configuration_error',
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
  const currentRemoteDeleted = uiState.remoteDeleted === true;
  const anchorRevision = asRevision(uiState.anchorRevision);
  const workbooks = currentRemoteDeleted
    ? state.workbooks.filter((item) => item.id !== workbookId)
    : state.workbooks;
  const remote = workbooks.find((item) => item.id === workbookId) || null;
  const revisionRegressed =
    !!remote && !!anchorRevision && (!remote.revision || remote.revision < anchorRevision);
  const pendingOperation = asString(uiState.pendingOperation);
  const autoSyncPhase = ['failed', 'idle', 'retrying', 'syncing', 'waiting'].includes(
    asString(uiState.autoSyncPhase)
  )
    ? asString(uiState.autoSyncPhase)
    : 'idle';
  const conflict = uiState.conflict === true;
  const conflictNotice =
    normalizeConflictNotice(uiState.conflictNotice, workbookId) || remote?.conflictNotice || null;
  const failedWorkbookId = asString(uiState.failedWorkbookId);
  const uiErrorOperation = asString(uiState.errorOperation || uiState.failedOperation);
  const uiErrorIsLibraryScoped = ['delete', 'open'].includes(uiErrorOperation);
  const uiErrorApplies =
    !!asString(uiState.error) &&
    (uiErrorIsLibraryScoped || !failedWorkbookId || failedWorkbookId === workbookId);
  const stateErrorWorkbookId = asString(state.errorWorkbookId);
  const stateErrorIsLibraryScoped = ['delete', 'open'].includes(state.errorOperation);
  const stateErrorApplies =
    !!state.error &&
    (stateErrorIsLibraryScoped || !stateErrorWorkbookId || stateErrorWorkbookId === workbookId);
  return {
    ...state,
    workbooks,
    pendingOperation,
    notice: asString(uiState.notice),
    error: uiErrorApplies ? asString(uiState.error) : stateErrorApplies ? state.error : '',
    errorCode: uiErrorApplies
      ? asString(uiState.errorCode)
      : stateErrorApplies
        ? state.errorCode
        : '',
    errorDetails: uiErrorApplies
      ? asString(uiState.errorDetails)
      : stateErrorApplies
        ? state.errorDetails
        : '',
    errorRetryable: uiErrorApplies
      ? uiState.errorRetryable === true
      : stateErrorApplies && state.errorRetryable === true,
    errorOperation: uiErrorApplies
      ? asString(uiState.errorOperation || uiState.failedOperation)
      : stateErrorApplies
        ? state.errorOperation
        : '',
    errorWorkbookId: uiErrorApplies
      ? asString(uiState.errorWorkbookId || failedWorkbookId)
      : stateErrorApplies
        ? stateErrorWorkbookId
        : '',
    errorWorkbookName: uiErrorApplies
      ? asString(uiState.errorWorkbookName)
      : stateErrorApplies
        ? state.errorWorkbookName
        : '',
    failedOperation: uiErrorApplies ? asString(uiState.failedOperation) : '',
    failedWorkbookId: uiErrorApplies ? failedWorkbookId : '',
    current: {
      workbookId,
      autoSyncEnabled: uiState.autoSyncEnabled !== false,
      remoteDeleted: currentRemoteDeleted,
      linked: !!remote,
      conflict,
      conflictNotice,
      syncBlocked: revisionRegressed,
      anchorRevision,
      revision: remote ? remote.revision : 0,
      status: ['upload', 'keep-local', 'reconcile'].includes(pendingOperation)
        ? 'uploading'
        : conflict
          ? 'conflict'
          : revisionRegressed
            ? 'attention'
            : autoSyncPhase === 'failed'
              ? 'attention'
              : autoSyncPhase === 'syncing'
                ? 'uploading'
                : autoSyncPhase === 'retrying'
                  ? 'retrying'
                  : autoSyncPhase === 'waiting'
                    ? 'waiting'
                    : remote?.pending === true
                      ? 'pending'
                      : remote
                        ? 'synced'
                        : 'local_only',
      cloudUpdatedAt: remote ? remote.updatedAt : ''
    }
  };
}
