import {
  cloudWorkbookAutoSyncStorageKey,
  cloudWorkbookSyncStorageKey,
  defaultCloudWorkbookAutoSyncPreference,
  parseCloudWorkbookAutoSyncPreferenceValue,
  parseCloudWorkbookSyncStateValue
} from './cloud-workbook-sync-state.js';

function asText(value, maximum = 256) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, maximum);
}

function normalizedEnvironment(value) {
  const environment = asText(value, 32).toLowerCase();
  if (environment === 'development') return 'Development';
  if (environment === 'production') return 'Production';
  return '';
}

function syncScope(value = {}) {
  const userId = asText(value.userId);
  const workbookId = asText(value.workbookId, 128);
  const cloudEnvironment = normalizedEnvironment(value.cloudEnvironment);
  if (!(userId && workbookId)) return null;
  return {
    userId,
    workbookId,
    cloudEnvironment,
    key: `${cloudEnvironment || 'Current'}\0${userId}\0${workbookId}`,
    syncStorageKey: cloudWorkbookSyncStorageKey(userId, workbookId),
    preferenceStorageKey: cloudWorkbookAutoSyncStorageKey(userId, workbookId)
  };
}

function normalizeEnvelope(value, expectedScope) {
  if (!(value && typeof value === 'object' && !Array.isArray(value)) || value.version !== 1) {
    return null;
  }
  const cloudEnvironment = normalizedEnvironment(value.cloudEnvironment);
  const accountId = asText(value.accountId);
  const workbookId = asText(value.workbookId, 128);
  if (
    !(cloudEnvironment && accountId && workbookId) ||
    accountId !== expectedScope.userId ||
    workbookId !== expectedScope.workbookId ||
    (expectedScope.cloudEnvironment && cloudEnvironment !== expectedScope.cloudEnvironment) ||
    typeof value.autoSyncEnabled !== 'boolean'
  ) {
    return null;
  }
  const syncState =
    value.syncState == null
      ? null
      : parseCloudWorkbookSyncStateValue(value.syncState, expectedScope.workbookId);
  if (value.syncState != null && !syncState) return null;
  return {
    version: 1,
    cloudEnvironment,
    accountId,
    workbookId,
    syncState,
    autoSyncEnabled: value.autoSyncEnabled
  };
}

function sameEnvelope(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function durableFailure(result, fallback = 'Cavalry could not save its local iCloud sync state.') {
  return {
    ok: false,
    code: asText(result && result.code, 96) || 'cloud_sync_state_unavailable',
    error: asText(result && (result.error || result.message), 512) || fallback,
    failClosed: true
  };
}

export function createDurableCloudWorkbookSyncStorage({ invoke, legacyStorage } = {}) {
  const entries = new Map();
  const scopeByStorageKey = new Map();
  let seeding = false;

  async function call(command, payload) {
    if (typeof invoke !== 'function') return durableFailure(null);
    try {
      return (await invoke(command, payload || {})) || durableFailure(null);
    } catch (error) {
      return durableFailure(error);
    }
  }

  function entryFor(value) {
    const scope = syncScope(value);
    if (!scope) return null;
    let entry = entries.get(scope.key);
    if (!entry) {
      entry = {
        scope,
        status: 'idle',
        error: null,
        hydratePromise: null,
        writePromise: null,
        changeSequence: 0,
        dirty: false,
        values: new Map()
      };
      entries.set(scope.key, entry);
    } else if (!entry.scope.cloudEnvironment && scope.cloudEnvironment) {
      entry.scope = { ...scope };
    }
    scopeByStorageKey.set(scope.syncStorageKey, entry.scope.key);
    scopeByStorageKey.set(scope.preferenceStorageKey, entry.scope.key);
    return entry;
  }

  function readLegacy(key) {
    if (!(legacyStorage && typeof legacyStorage.getItem === 'function')) return null;
    return legacyStorage.getItem(key);
  }

  function removeLegacy(key) {
    if (!(legacyStorage && typeof legacyStorage.removeItem === 'function')) return;
    try {
      legacyStorage.removeItem(key);
    } catch (_error) {
      // Application Support is already authoritative. Legacy cleanup is best effort.
    }
  }

  function seed(entry, syncState, autoSyncEnabled) {
    seeding = true;
    try {
      if (syncState) entry.values.set(entry.scope.syncStorageKey, JSON.stringify(syncState));
      else entry.values.delete(entry.scope.syncStorageKey);
      entry.values.set(
        entry.scope.preferenceStorageKey,
        JSON.stringify({ version: 1, enabled: autoSyncEnabled !== false })
      );
    } finally {
      seeding = false;
    }
  }

  function currentPayload(entry) {
    const rawSyncState = entry.values.get(entry.scope.syncStorageKey);
    const rawPreference = entry.values.get(entry.scope.preferenceStorageKey);
    const syncState = rawSyncState
      ? parseCloudWorkbookSyncStateValue(rawSyncState, entry.scope.workbookId)
      : null;
    const preference = rawPreference
      ? parseCloudWorkbookAutoSyncPreferenceValue(rawPreference)
      : { version: 1, enabled: defaultCloudWorkbookAutoSyncPreference(entry.scope.workbookId) };
    if ((rawSyncState && !syncState) || !preference) return null;
    return {
      workbookId: entry.scope.workbookId,
      syncState,
      autoSyncEnabled: preference.enabled
    };
  }

  async function saveCurrent(entry) {
    const payload = currentPayload(entry);
    if (!payload) {
      const failure = durableFailure({
        code: 'cloud_sync_state_invalid',
        error: 'Cavalry refused to save invalid local iCloud sync state.'
      });
      entry.status = 'error';
      entry.error = failure;
      return failure;
    }
    const savedSequence = entry.changeSequence;
    const result = await call('saveSyncState', payload);
    const envelope = result && result.ok ? normalizeEnvelope(result.envelope, entry.scope) : null;
    if (!(result && result.ok && envelope)) {
      const failure = durableFailure(result);
      entry.status = 'error';
      entry.error = failure;
      return failure;
    }
    entry.status = 'ready';
    entry.error = null;
    if (entry.changeSequence === savedSequence) entry.dirty = false;
    return { ok: true, envelope };
  }

  function queueSave(entry) {
    if (!entry || seeding || entry.status !== 'ready') return;
    const previous = entry.writePromise || Promise.resolve({ ok: true });
    const operation = previous.catch(() => undefined).then(() => saveCurrent(entry));
    entry.writePromise = operation;
    void operation.catch(() => undefined);
  }

  const storage = Object.freeze({
    getItem(key) {
      const normalizedKey = String(key || '');
      const entry = entries.get(scopeByStorageKey.get(normalizedKey));
      return entry?.values.has(normalizedKey) ? entry.values.get(normalizedKey) : null;
    },
    setItem(key, value) {
      const normalizedKey = String(key || '');
      const entryKey = scopeByStorageKey.get(normalizedKey);
      if (entryKey && !seeding) {
        const entry = entries.get(entryKey);
        entry.values.set(normalizedKey, String(value));
        entry.changeSequence += 1;
        entry.dirty = true;
        queueSave(entry);
      }
    },
    removeItem(key) {
      const normalizedKey = String(key || '');
      const entryKey = scopeByStorageKey.get(normalizedKey);
      if (entryKey && !seeding) {
        const entry = entries.get(entryKey);
        entry.values.delete(normalizedKey);
        entry.changeSequence += 1;
        entry.dirty = true;
        queueSave(entry);
      }
    }
  });

  async function saveAndVerify(entry, syncState, autoSyncEnabled) {
    const payload = {
      workbookId: entry.scope.workbookId,
      syncState,
      autoSyncEnabled
    };
    const saved = await call('saveSyncState', payload);
    const savedEnvelope = saved && saved.ok ? normalizeEnvelope(saved.envelope, entry.scope) : null;
    if (!(saved && saved.ok && savedEnvelope)) return durableFailure(saved);

    const verified = await call('loadSyncState', { workbookId: entry.scope.workbookId });
    const verifiedEnvelope =
      verified && verified.ok && verified.status === 'loaded'
        ? normalizeEnvelope(verified.envelope, entry.scope)
        : null;
    if (!verifiedEnvelope || !sameEnvelope(savedEnvelope, verifiedEnvelope)) {
      return durableFailure({
        code: 'cloud_sync_state_migration_unverified',
        error: 'Cavalry could not verify its local iCloud sync state.'
      });
    }
    return { ok: true, envelope: verifiedEnvelope };
  }

  async function hydrate(value) {
    const entry = entryFor(value);
    if (!entry) return durableFailure({ code: 'cloud_sync_state_scope_invalid' });
    if (entry.status === 'ready') return { ok: true, status: 'ready' };
    if (entry.hydratePromise) return entry.hydratePromise;

    const operation = (async () => {
      if (entry.dirty) {
        const recovered = await saveCurrent(entry);
        return recovered && recovered.ok
          ? { ok: true, status: 'recovered' }
          : recovered || durableFailure(null);
      }
      entry.status = 'loading';
      entry.error = null;
      const loaded = await call('loadSyncState', { workbookId: entry.scope.workbookId });
      if (loaded && loaded.ok && loaded.status === 'loaded') {
        const envelope = normalizeEnvelope(loaded.envelope, entry.scope);
        if (!envelope) {
          const failure = durableFailure({
            code: 'cloud_sync_state_corrupt',
            error: 'Cavalry found unreadable local iCloud sync state.'
          });
          entry.status = 'error';
          entry.error = failure;
          return failure;
        }
        entry.scope.cloudEnvironment = envelope.cloudEnvironment;
        seed(entry, envelope.syncState, envelope.autoSyncEnabled);
        entry.status = 'ready';
        removeLegacy(entry.scope.syncStorageKey);
        removeLegacy(entry.scope.preferenceStorageKey);
        return { ok: true, status: 'loaded', migrated: false };
      }
      if (!(loaded && loaded.ok && loaded.status === 'missing')) {
        const legacySyncRaw = readLegacy(entry.scope.syncStorageKey);
        const legacySyncState = legacySyncRaw
          ? parseCloudWorkbookSyncStateValue(legacySyncRaw, entry.scope.workbookId)
          : null;
        const legacyPreference = parseCloudWorkbookAutoSyncPreferenceValue(
          readLegacy(entry.scope.preferenceStorageKey)
        );
        if (legacySyncState || legacyPreference) {
          seed(
            entry,
            legacySyncState,
            legacyPreference
              ? legacyPreference.enabled
              : defaultCloudWorkbookAutoSyncPreference(entry.scope.workbookId)
          );
        }
        const failure = durableFailure(loaded);
        entry.status = 'error';
        entry.error = failure;
        return failure;
      }

      const legacySyncRaw = readLegacy(entry.scope.syncStorageKey);
      const legacyPreferenceRaw = readLegacy(entry.scope.preferenceStorageKey);
      const legacySyncState = legacySyncRaw
        ? parseCloudWorkbookSyncStateValue(legacySyncRaw, entry.scope.workbookId)
        : null;
      const legacyPreference = legacyPreferenceRaw
        ? parseCloudWorkbookAutoSyncPreferenceValue(legacyPreferenceRaw)
        : null;
      if (legacySyncRaw && !legacySyncState) {
        const failure = durableFailure({
          code: 'cloud_sync_state_legacy_invalid',
          error: 'Cavalry found invalid legacy iCloud sync state and left it unchanged.'
        });
        entry.status = 'error';
        entry.error = failure;
        return failure;
      }

      const autoSyncEnabled = legacyPreference
        ? legacyPreference.enabled
        : defaultCloudWorkbookAutoSyncPreference(entry.scope.workbookId);
      seed(entry, legacySyncState, autoSyncEnabled);
      const persisted = await saveAndVerify(entry, legacySyncState, autoSyncEnabled);
      if (!(persisted && persisted.ok)) {
        const failure = persisted || durableFailure(null);
        entry.status = 'error';
        entry.error = failure;
        return failure;
      }
      const verifiedEnvelope = persisted.envelope;
      entry.scope.cloudEnvironment = verifiedEnvelope.cloudEnvironment;
      seed(entry, verifiedEnvelope.syncState, verifiedEnvelope.autoSyncEnabled);
      if (legacySyncState || legacyPreference) {
        removeLegacy(entry.scope.syncStorageKey);
        if (legacyPreference) removeLegacy(entry.scope.preferenceStorageKey);
      }
      entry.status = 'ready';
      entry.error = null;
      return { ok: true, status: legacySyncState || legacyPreference ? 'migrated' : 'missing' };
    })().catch((error) => {
      const failure = durableFailure(error);
      entry.status = 'error';
      entry.error = failure;
      return failure;
    });
    entry.hydratePromise = operation;
    try {
      return await operation;
    } finally {
      if (entry.hydratePromise === operation) entry.hydratePromise = null;
    }
  }

  async function flush(value) {
    const entry = entryFor(value);
    if (!entry) return durableFailure({ code: 'cloud_sync_state_scope_invalid' });
    while (entry.writePromise) {
      const pending = entry.writePromise;
      const result = await pending;
      if (!(result && result.ok)) return result || durableFailure(null);
      if (entry.writePromise === pending) break;
    }
    if (entry.status !== 'ready') return entry.error || durableFailure(null);
    return { ok: true };
  }

  async function remove(value) {
    const entry = entryFor(value);
    if (!entry) return durableFailure({ code: 'cloud_sync_state_scope_invalid' });
    entry.status = 'removing';
    if (entry.writePromise) await entry.writePromise.catch(() => undefined);
    const result = await call('removeSyncState', { workbookId: entry.scope.workbookId });
    if (!(result && result.ok)) {
      const failure = durableFailure(result);
      entry.status = 'error';
      entry.error = failure;
      return failure;
    }
    entry.values.clear();
    entries.delete(entry.scope.key);
    if (scopeByStorageKey.get(entry.scope.syncStorageKey) === entry.scope.key) {
      scopeByStorageKey.delete(entry.scope.syncStorageKey);
    }
    if (scopeByStorageKey.get(entry.scope.preferenceStorageKey) === entry.scope.key) {
      scopeByStorageKey.delete(entry.scope.preferenceStorageKey);
    }
    return { ok: true };
  }

  function status(value) {
    const entry = entryFor(value);
    return entry ? entry.status : 'error';
  }

  return Object.freeze({ flush, hydrate, remove, status, storage });
}
