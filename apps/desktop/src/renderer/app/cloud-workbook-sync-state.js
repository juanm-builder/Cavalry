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
    const parsed = JSON.parse(raw);
    if (!(parsed && typeof parsed === 'object' && parsed.version === 1)) {
      return { known: false, revision: null, conflict: false };
    }
    return {
      known: true,
      revision: asRevision(parsed.revision),
      conflict: parsed.conflict === true
    };
  } catch (_error) {
    try {
      const fallback = memoryStorage.getItem(key);
      if (!fallback) return { known: false, revision: null, conflict: false };
      const parsed = JSON.parse(fallback);
      return {
        known: parsed && parsed.version === 1,
        revision: asRevision(parsed && parsed.revision),
        conflict: !!(parsed && parsed.version === 1 && parsed.conflict === true)
      };
    } catch (_fallbackError) {
      return { known: false, revision: null, conflict: false };
    }
  }
}

export function writeCloudWorkbookSyncState(
  storage,
  userId,
  workbookId,
  { revision, conflict = false } = {}
) {
  const key = cloudWorkbookSyncStorageKey(userId, workbookId);
  const normalized = {
    known: true,
    revision: asRevision(revision),
    conflict: conflict === true
  };
  if (!key || !(storage && typeof storage.setItem === 'function')) return normalized;
  const serialized = JSON.stringify({
    version: 1,
    revision: normalized.revision,
    conflict: normalized.conflict
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
