// V1 anchors did not record the CloudKit environment. Never reuse those
// optimistic-concurrency revisions after moving a development-signed Mac app
// to the Production database: the same workbook can have unrelated revisions
// in each environment. The native Production store is separately scoped too.
const CLOUD_WORKBOOK_SYNC_STORAGE_PREFIX = 'cavalry.cloud-workbook-sync.v2';
const CLOUD_WORKBOOK_AUTO_SYNC_STORAGE_PREFIX = 'cavalry.cloud-workbook-auto-sync.v1';

const memoryValues = new Map();
const fallbackKeys = new Set();
const memoryStorage = {
  getItem(key) {
    return memoryValues.has(key) ? memoryValues.get(key) : null;
  },
  setItem(key, value) {
    memoryValues.set(key, String(value));
  },
  removeItem(key) {
    memoryValues.delete(key);
  }
};

function asId(value) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, 256);
}

function asRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function asConflictNoticeId(value) {
  const id = asId(value);
  return /^[A-Za-z0-9._:-]{1,160}$/.test(id) ? id : '';
}

function asWorkbook(value, workbookId) {
  if (!(value && typeof value === 'object' && !Array.isArray(value))) return null;
  if (asId(value.id) !== asId(workbookId)) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return null;
  }
}

function normalizedStoredState(parsed, workbookId) {
  if (!(parsed && typeof parsed === 'object' && parsed.version === 1)) {
    return { known: false, revision: null, conflict: false };
  }
  const baseWorkbook = asWorkbook(parsed.baseWorkbook, workbookId);
  const baseRevision = baseWorkbook ? asRevision(parsed.baseRevision || parsed.revision) : null;
  const conflict = parsed.conflict === true;
  const conflictNoticeId = conflict ? asConflictNoticeId(parsed.conflictNoticeId) : '';
  const conflictRemoteRevision = conflict ? asRevision(parsed.conflictRemoteRevision) : null;
  return {
    known: true,
    revision: asRevision(parsed.revision),
    conflict,
    ...(parsed.remoteDeleted === true ? { remoteDeleted: true } : {}),
    ...(conflictNoticeId && conflictRemoteRevision
      ? { conflictNoticeId, conflictRemoteRevision }
      : {}),
    ...(baseWorkbook && baseRevision ? { baseRevision, baseWorkbook } : {})
  };
}

export function resolveCloudWorkbookSyncStorage(storage) {
  if (
    storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
  ) {
    return storage;
  }
  try {
    if (
      typeof window !== 'undefined' &&
      window.localStorage &&
      typeof window.localStorage.getItem === 'function'
    ) {
      return window.localStorage;
    }
  } catch (_error) {
    // A session-only fallback keeps optimistic-concurrency anchors fail-safe.
  }
  return memoryStorage;
}

export function cloudWorkbookSyncStorageKey(userId, workbookId) {
  const owner = asId(userId);
  const workbook = asId(workbookId);
  if (!owner || !workbook) return '';
  return `${CLOUD_WORKBOOK_SYNC_STORAGE_PREFIX}:${encodeURIComponent(owner)}:${encodeURIComponent(workbook)}`;
}

export function cloudWorkbookAutoSyncStorageKey(userId, workbookId) {
  const owner = asId(userId);
  const workbook = asId(workbookId);
  if (!owner || !workbook) return '';
  return `${CLOUD_WORKBOOK_AUTO_SYNC_STORAGE_PREFIX}:${encodeURIComponent(owner)}:${encodeURIComponent(workbook)}`;
}

export function parseCloudWorkbookAutoSyncPreferenceValue(value) {
  let parsed = value;
  try {
    if (typeof value === 'string') parsed = JSON.parse(value);
  } catch (_error) {
    return null;
  }
  if (
    !(parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ||
    Number(parsed.version) !== 1 ||
    typeof parsed.enabled !== 'boolean'
  ) {
    return null;
  }
  return { version: 1, enabled: parsed.enabled };
}

// Migration is intentionally stricter than the runtime reader. Older malformed
// values may fail closed in place, but they must never become authoritative
// Application Support state.
export function parseCloudWorkbookSyncStateValue(value, workbookId) {
  let parsed = value;
  try {
    if (typeof value === 'string') parsed = JSON.parse(value);
  } catch (_error) {
    return null;
  }
  if (
    !(parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ||
    Number(parsed.version) !== 1 ||
    typeof parsed.conflict !== 'boolean'
  ) {
    return null;
  }
  const revision = parsed.revision == null ? null : asRevision(parsed.revision);
  if (parsed.revision != null && !revision) return null;
  if (parsed.remoteDeleted != null && typeof parsed.remoteDeleted !== 'boolean') return null;

  const conflictNoticeId =
    parsed.conflictNoticeId == null ? '' : asConflictNoticeId(parsed.conflictNoticeId);
  const conflictRemoteRevision =
    parsed.conflictRemoteRevision == null ? null : asRevision(parsed.conflictRemoteRevision);
  const hasConflictNoticeId = parsed.conflictNoticeId != null;
  const hasConflictRemoteRevision = parsed.conflictRemoteRevision != null;
  if (
    hasConflictNoticeId !== hasConflictRemoteRevision ||
    (hasConflictNoticeId && (!parsed.conflict || !conflictNoticeId || !conflictRemoteRevision))
  ) {
    return null;
  }
  if (hasConflictRemoteRevision && !conflictRemoteRevision) return null;

  const hasBaseWorkbook = Object.prototype.hasOwnProperty.call(parsed, 'baseWorkbook');
  const hasBaseRevision = Object.prototype.hasOwnProperty.call(parsed, 'baseRevision');
  let baseWorkbook = null;
  let baseRevision = null;
  if (hasBaseWorkbook || hasBaseRevision) {
    baseWorkbook = asWorkbook(parsed.baseWorkbook, workbookId);
    baseRevision = asRevision(parsed.baseRevision);
    if (!(baseWorkbook && baseRevision) || (revision && baseRevision > revision)) return null;
  }

  return {
    version: 1,
    revision,
    conflict: parsed.conflict,
    ...(parsed.remoteDeleted === true ? { remoteDeleted: true } : {}),
    ...(conflictNoticeId && conflictRemoteRevision
      ? { conflictNoticeId, conflictRemoteRevision }
      : {}),
    ...(baseWorkbook && baseRevision ? { baseRevision, baseWorkbook } : {})
  };
}

// Existing linked workbooks have always synced automatically. Missing or
// unreadable preferences therefore preserve that behavior and fail open to ON.
export function readCloudWorkbookAutoSyncPreference(storage, userId, workbookId) {
  const key = cloudWorkbookAutoSyncStorageKey(userId, workbookId);
  if (!key || !(storage && typeof storage.getItem === 'function')) return true;
  try {
    const raw = storage.getItem(key) || (fallbackKeys.has(key) ? memoryStorage.getItem(key) : null);
    if (!raw) return true;
    return JSON.parse(raw)?.enabled !== false;
  } catch (_error) {
    try {
      const fallback = memoryStorage.getItem(key);
      return fallback ? JSON.parse(fallback)?.enabled !== false : true;
    } catch (_fallbackError) {
      return true;
    }
  }
}

export function writeCloudWorkbookAutoSyncPreference(storage, userId, workbookId, enabled) {
  const key = cloudWorkbookAutoSyncStorageKey(userId, workbookId);
  const value = enabled !== false;
  if (!key || !(storage && typeof storage.setItem === 'function')) return value;
  const serialized = JSON.stringify({ version: 1, enabled: value });
  memoryStorage.setItem(key, serialized);
  try {
    storage.setItem(key, serialized);
    fallbackKeys.delete(key);
  } catch (_error) {
    fallbackKeys.add(key);
  }
  return value;
}

export function readCloudWorkbookSyncState(storage, userId, workbookId) {
  const key = cloudWorkbookSyncStorageKey(userId, workbookId);
  if (!key || !(storage && typeof storage.getItem === 'function')) {
    return { known: false, revision: null, conflict: false };
  }
  try {
    const raw = storage.getItem(key) || (fallbackKeys.has(key) ? memoryStorage.getItem(key) : null);
    if (!raw) return { known: false, revision: null, conflict: false };
    return normalizedStoredState(JSON.parse(raw), workbookId);
  } catch (_error) {
    try {
      const fallback = memoryStorage.getItem(key);
      if (!fallback) return { known: false, revision: null, conflict: false };
      return normalizedStoredState(JSON.parse(fallback), workbookId);
    } catch (_fallbackError) {
      return { known: false, revision: null, conflict: false };
    }
  }
}

export function writeCloudWorkbookSyncState(storage, userId, workbookId, options = {}) {
  const key = cloudWorkbookSyncStorageKey(userId, workbookId);
  const previous = readCloudWorkbookSyncState(storage, userId, workbookId);
  const revision = asRevision(options.revision);
  const hasBaseWorkbook = Object.prototype.hasOwnProperty.call(options, 'baseWorkbook');
  const baseWorkbook = hasBaseWorkbook
    ? asWorkbook(options.baseWorkbook, workbookId)
    : previous.baseWorkbook || null;
  const baseRevision = baseWorkbook
    ? hasBaseWorkbook
      ? asRevision(options.baseRevision || revision)
      : asRevision(previous.baseRevision)
    : null;
  const hasRemoteDeleted = Object.prototype.hasOwnProperty.call(options, 'remoteDeleted');
  const remoteDeleted = hasRemoteDeleted
    ? options.remoteDeleted === true
    : previous.remoteDeleted === true;
  const normalized = {
    known: true,
    revision,
    conflict: options.conflict === true,
    ...(remoteDeleted ? { remoteDeleted: true } : {}),
    ...(options.conflict === true &&
    (asConflictNoticeId(options.conflictNoticeId) || previous.conflictNoticeId) &&
    (asRevision(options.conflictRemoteRevision) || previous.conflictRemoteRevision)
      ? {
          conflictNoticeId:
            asConflictNoticeId(options.conflictNoticeId) || previous.conflictNoticeId,
          conflictRemoteRevision:
            asRevision(options.conflictRemoteRevision) || previous.conflictRemoteRevision
        }
      : {}),
    ...(baseWorkbook && baseRevision ? { baseRevision, baseWorkbook } : {})
  };
  if (!key || !(storage && typeof storage.setItem === 'function')) return normalized;
  const serialized = JSON.stringify({
    version: 1,
    revision: normalized.revision,
    conflict: normalized.conflict,
    ...(remoteDeleted ? { remoteDeleted: true } : {}),
    ...(normalized.conflictNoticeId && normalized.conflictRemoteRevision
      ? {
          conflictNoticeId: normalized.conflictNoticeId,
          conflictRemoteRevision: normalized.conflictRemoteRevision
        }
      : {}),
    ...(baseWorkbook && baseRevision ? { baseRevision, baseWorkbook } : {})
  });
  memoryStorage.setItem(key, serialized);
  try {
    storage.setItem(key, serialized);
    fallbackKeys.delete(key);
  } catch (_error) {
    fallbackKeys.add(key);
  }
  return normalized;
}

export function removeCloudWorkbookSyncState(storage, userId, workbookId) {
  const key = cloudWorkbookSyncStorageKey(userId, workbookId);
  if (!key || !(storage && typeof storage.removeItem === 'function')) return;
  memoryStorage.removeItem(key);
  fallbackKeys.delete(key);
  try {
    storage.removeItem(key);
  } catch (_error) {
    // A failed best-effort removal cannot weaken the database revision check.
  }
}
