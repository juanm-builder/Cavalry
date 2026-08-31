import { describe, expect, it, vi } from 'vitest';

import {
  cloudWorkbookAutoSyncStorageKey,
  cloudWorkbookSyncStorageKey,
  readCloudWorkbookAutoSyncPreference,
  readCloudWorkbookSyncState,
  writeCloudWorkbookAutoSyncPreference,
  writeCloudWorkbookSyncState
} from '../../src/renderer/app/cloud-workbook-sync-state.js';
import { createDurableCloudWorkbookSyncStorage } from '../../src/renderer/app/durable-cloud-workbook-sync-storage.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function scope() {
  return {
    userId: '_icloud-user-1',
    workbookId: 'workbook-1',
    cloudEnvironment: 'Production'
  };
}

function envelope(syncState, autoSyncEnabled = true) {
  return {
    version: 1,
    cloudEnvironment: 'Production',
    accountId: '_icloud-user-1',
    workbookId: 'workbook-1',
    syncState,
    autoSyncEnabled
  };
}

function confirmedState(revision = 4, name = 'Confirmed') {
  return {
    version: 1,
    revision,
    conflict: false,
    baseRevision: revision,
    baseWorkbook: { id: 'workbook-1', name, transactions: [] }
  };
}

function hostHarness(initialEnvelope = null) {
  let stored = initialEnvelope;
  const invoke = vi.fn(async (command, payload) => {
    if (command === 'loadSyncState') {
      return stored
        ? { ok: true, status: 'loaded', envelope: structuredClone(stored) }
        : { ok: true, status: 'missing', envelope: null };
    }
    if (command === 'saveSyncState') {
      stored = envelope(structuredClone(payload.syncState), payload.autoSyncEnabled !== false);
      return { ok: true, status: 'saved', envelope: structuredClone(stored) };
    }
    if (command === 'removeSyncState') {
      stored = null;
      return { ok: true, status: 'removed' };
    }
    return { ok: false, code: 'unknown' };
  });
  return { invoke, stored: () => stored };
}

describe('durable cloud workbook sync repository', () => {
  it('uses Application Support state as authoritative and clears stale localStorage', async () => {
    const syncKey = cloudWorkbookSyncStorageKey(scope().userId, scope().workbookId);
    const preferenceKey = cloudWorkbookAutoSyncStorageKey(scope().userId, scope().workbookId);
    const legacy = memoryStorage({
      [syncKey]: JSON.stringify(confirmedState(2, 'Stale browser copy')),
      [preferenceKey]: JSON.stringify({ version: 1, enabled: true })
    });
    const host = hostHarness(envelope(confirmedState(5, 'Durable copy'), false));
    const repository = createDurableCloudWorkbookSyncStorage({
      invoke: host.invoke,
      legacyStorage: legacy
    });

    await expect(repository.hydrate(scope())).resolves.toMatchObject({
      ok: true,
      status: 'loaded',
      migrated: false
    });
    expect(
      readCloudWorkbookSyncState(repository.storage, scope().userId, scope().workbookId)
    ).toMatchObject({
      revision: 5,
      baseWorkbook: { name: 'Durable copy' }
    });
    expect(
      readCloudWorkbookAutoSyncPreference(repository.storage, scope().userId, scope().workbookId)
    ).toBe(false);
    expect(legacy.values.has(syncKey)).toBe(false);
    expect(legacy.values.has(preferenceKey)).toBe(false);
    expect(host.invoke).not.toHaveBeenCalledWith('saveSyncState', expect.anything());
  });

  it('migrates only after save and re-read verification', async () => {
    const syncKey = cloudWorkbookSyncStorageKey(scope().userId, scope().workbookId);
    const preferenceKey = cloudWorkbookAutoSyncStorageKey(scope().userId, scope().workbookId);
    const legacyState = confirmedState(4);
    const legacy = memoryStorage({
      [syncKey]: JSON.stringify(legacyState),
      [preferenceKey]: JSON.stringify({ version: 1, enabled: false })
    });
    const host = hostHarness();
    const repository = createDurableCloudWorkbookSyncStorage({
      invoke: host.invoke,
      legacyStorage: legacy
    });

    await expect(repository.hydrate(scope())).resolves.toMatchObject({
      ok: true,
      status: 'migrated'
    });
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual([
      'loadSyncState',
      'saveSyncState',
      'loadSyncState'
    ]);
    expect(host.stored()).toEqual(envelope(legacyState, false));
    expect(legacy.values.has(syncKey)).toBe(false);
    expect(legacy.values.has(preferenceKey)).toBe(false);
  });

  it('preserves legacy data and fails closed when host persistence fails', async () => {
    const syncKey = cloudWorkbookSyncStorageKey(scope().userId, scope().workbookId);
    const raw = JSON.stringify(confirmedState());
    const legacy = memoryStorage({ [syncKey]: raw });
    const invoke = vi.fn(async (command) =>
      command === 'loadSyncState'
        ? { ok: true, status: 'missing', envelope: null }
        : { ok: false, code: 'cloud_sync_state_save_failed', error: 'disk full' }
    );
    const repository = createDurableCloudWorkbookSyncStorage({ invoke, legacyStorage: legacy });

    await expect(repository.hydrate(scope())).resolves.toMatchObject({
      ok: false,
      code: 'cloud_sync_state_save_failed',
      failClosed: true
    });
    expect(repository.status(scope())).toBe('error');
    expect(legacy.values.get(syncKey)).toBe(raw);
  });

  it('refuses malformed legacy state instead of enrolling a new cloud workbook', async () => {
    const syncKey = cloudWorkbookSyncStorageKey(scope().userId, scope().workbookId);
    const legacy = memoryStorage({
      [syncKey]: JSON.stringify({ version: 1, revision: 'bad', conflict: false })
    });
    const host = hostHarness();
    const repository = createDurableCloudWorkbookSyncStorage({
      invoke: host.invoke,
      legacyStorage: legacy
    });

    await expect(repository.hydrate(scope())).resolves.toMatchObject({
      ok: false,
      code: 'cloud_sync_state_legacy_invalid',
      failClosed: true
    });
    expect(host.invoke).not.toHaveBeenCalledWith('saveSyncState', expect.anything());
    expect(legacy.values.has(syncKey)).toBe(true);
  });

  it('persists merge base, remote-deletion tombstone, and autosave preference together', async () => {
    const host = hostHarness();
    const repository = createDurableCloudWorkbookSyncStorage({
      invoke: host.invoke,
      legacyStorage: memoryStorage()
    });
    await repository.hydrate(scope());

    writeCloudWorkbookSyncState(repository.storage, scope().userId, scope().workbookId, {
      revision: 7,
      conflict: false,
      baseRevision: 7,
      baseWorkbook: { id: 'workbook-1', name: 'Latest', transactions: [] }
    });
    writeCloudWorkbookAutoSyncPreference(
      repository.storage,
      scope().userId,
      scope().workbookId,
      false
    );
    await expect(repository.flush(scope())).resolves.toEqual({ ok: true });
    expect(host.stored()).toMatchObject({
      syncState: { revision: 7, baseWorkbook: { name: 'Latest' } },
      autoSyncEnabled: false
    });

    writeCloudWorkbookSyncState(repository.storage, scope().userId, scope().workbookId, {
      revision: null,
      conflict: false,
      remoteDeleted: true,
      baseWorkbook: null
    });
    await repository.flush(scope());
    expect(host.stored()).toMatchObject({
      syncState: { revision: null, conflict: false, remoteDeleted: true },
      autoSyncEnabled: false
    });
  });

  it('defaults autosave to on when both stores are empty', async () => {
    const host = hostHarness();
    const repository = createDurableCloudWorkbookSyncStorage({
      invoke: host.invoke,
      legacyStorage: memoryStorage()
    });
    await expect(repository.hydrate(scope())).resolves.toMatchObject({
      ok: true,
      status: 'missing'
    });
    expect(
      readCloudWorkbookAutoSyncPreference(repository.storage, scope().userId, scope().workbookId)
    ).toBe(true);
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual([
      'loadSyncState',
      'saveSyncState',
      'loadSyncState'
    ]);
    expect(host.stored()).toEqual(envelope(null, true));
  });

  it('keeps renderer values isolated when the native CloudKit environment changes', async () => {
    let nativeEnvironment = 'Production';
    const stored = new Map([
      ['Production', envelope(confirmedState(2, 'Production base'), false)],
      [
        'Development',
        {
          ...envelope(confirmedState(5, 'Development base'), true),
          cloudEnvironment: 'Development'
        }
      ]
    ]);
    const invoke = vi.fn(async (command, payload) => {
      if (command === 'loadSyncState') {
        return {
          ok: true,
          status: 'loaded',
          envelope: structuredClone(stored.get(nativeEnvironment))
        };
      }
      if (command === 'saveSyncState') {
        const next = {
          ...envelope(payload.syncState, payload.autoSyncEnabled !== false),
          cloudEnvironment: nativeEnvironment
        };
        stored.set(nativeEnvironment, next);
        return { ok: true, status: 'saved', envelope: structuredClone(next) };
      }
      return { ok: false, code: 'unexpected_command' };
    });
    const repository = createDurableCloudWorkbookSyncStorage({
      invoke,
      legacyStorage: memoryStorage()
    });
    const productionScope = scope();
    const developmentScope = { ...scope(), cloudEnvironment: 'Development' };

    await repository.hydrate(productionScope);
    expect(
      readCloudWorkbookSyncState(repository.storage, scope().userId, scope().workbookId)
    ).toMatchObject({ revision: 2, baseWorkbook: { name: 'Production base' } });
    expect(
      readCloudWorkbookAutoSyncPreference(repository.storage, scope().userId, scope().workbookId)
    ).toBe(false);

    nativeEnvironment = 'Development';
    await repository.hydrate(developmentScope);
    expect(
      readCloudWorkbookSyncState(repository.storage, scope().userId, scope().workbookId)
    ).toMatchObject({ revision: 5, baseWorkbook: { name: 'Development base' } });

    nativeEnvironment = 'Production';
    await repository.hydrate(productionScope);
    expect(
      readCloudWorkbookSyncState(repository.storage, scope().userId, scope().workbookId)
    ).toMatchObject({ revision: 2, baseWorkbook: { name: 'Production base' } });
    expect(
      readCloudWorkbookAutoSyncPreference(repository.storage, scope().userId, scope().workbookId)
    ).toBe(false);
  });

  it('waits for an in-flight atomic save before removing the durable target', async () => {
    let finishSave;
    const savePending = new Promise((resolve) => {
      finishSave = resolve;
    });
    const commands = [];
    let savedPayload = null;
    const invoke = vi.fn(async (command, payload) => {
      commands.push(command);
      if (command === 'loadSyncState') {
        return {
          ok: true,
          status: 'loaded',
          envelope: envelope(confirmedState(2), true)
        };
      }
      if (command === 'saveSyncState') {
        savedPayload = payload;
        return savePending;
      }
      if (command === 'removeSyncState') return { ok: true, status: 'removed' };
      return { ok: false, code: 'unexpected_command' };
    });
    const repository = createDurableCloudWorkbookSyncStorage({
      invoke,
      legacyStorage: memoryStorage()
    });
    await repository.hydrate(scope());
    writeCloudWorkbookSyncState(repository.storage, scope().userId, scope().workbookId, {
      revision: 3,
      conflict: false,
      baseRevision: 3,
      baseWorkbook: { id: scope().workbookId, name: 'Third', transactions: [] }
    });

    const removed = repository.remove(scope());
    await vi.waitFor(() => expect(commands).toEqual(['loadSyncState', 'saveSyncState']));
    expect(commands).not.toContain('removeSyncState');
    finishSave({
      ok: true,
      status: 'saved',
      envelope: envelope(savedPayload.syncState, savedPayload.autoSyncEnabled)
    });

    await expect(removed).resolves.toEqual({ ok: true });
    expect(commands).toEqual(['loadSyncState', 'saveSyncState', 'removeSyncState']);
  });
});
