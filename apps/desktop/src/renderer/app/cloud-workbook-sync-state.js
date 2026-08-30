const CLOUD_WORKBOOK_SYNC_STORAGE_PREFIX = 'cavalry.cloud-workbook-sync.v1';

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
  const normalized = {
    known: true,
    revision,
    conflict: options.conflict === true,
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
