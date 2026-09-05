import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCloudWorkbookController } from '../../src/renderer/app/use-cloud-workbook-controller.js';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

const ACCOUNT_ID = 'user-1';
const WORKBOOK_ID = 'cloud-workbook';
const CLOUD_ENVIRONMENT = 'Production';

function workbook(name = 'Main Plan') {
  const result = cloneFixture(makeMinimalWorkbook());
  result.id = WORKBOOK_ID;
  result.name = name;
  return result;
}

function transaction(description) {
  return {
    id: 'shared-transaction',
    date: '2026-08-31',
    description,
    lines: []
  };
}

function cloudState(revision = 0) {
  return {
    configured: true,
    status: 'signed_in',
    cloudEnvironment: CLOUD_ENVIRONMENT,
    user: { id: ACCOUNT_ID, name: 'iCloud' },
    workbooks: revision ? [{ id: WORKBOOK_ID, name: 'Main Plan', revision, pending: false }] : [],
    pendingCount: 0
  };
}

function durableEnvelope({
  revision = null,
  baseWorkbook = null,
  remoteDeleted = false,
  autoSyncEnabled = true
} = {}) {
  return {
    version: 1,
    cloudEnvironment: CLOUD_ENVIRONMENT,
    accountId: ACCOUNT_ID,
    workbookId: WORKBOOK_ID,
    syncState:
      revision || remoteDeleted
        ? {
            version: 1,
            revision,
            conflict: false,
            ...(remoteDeleted ? { remoteDeleted: true } : {}),
            ...(baseWorkbook
              ? { baseRevision: revision, baseWorkbook: structuredClone(baseWorkbook) }
              : {})
          }
        : null,
    autoSyncEnabled
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function autoSyncTimers() {
  const timers = [];
  return {
    options: {
      scheduleTimer(callback, delay) {
        const timer = { callback, delay, canceled: false };
        timers.push(timer);
        return timer;
      },
      cancelTimer(timer) {
        timer.canceled = true;
      }
    },
    hasPending() {
      return timers.some((timer) => !timer.canceled);
    },
    runLatest() {
      const timer = [...timers].reverse().find((candidate) => !candidate.canceled);
      if (!timer) throw new Error('Expected an automatic iCloud sync timer.');
      timer.canceled = true;
      timer.callback();
      return timer;
    }
  };
}

function durableCloudHarness({
  initialEnvelope = null,
  initialState = cloudState(),
  firstLoad = null,
  failSaves = false,
  handleCloudCommand = null
} = {}) {
  let stored = initialEnvelope ? structuredClone(initialEnvelope) : null;
  let state = structuredClone(initialState);
  let firstLoadPending = firstLoad;
  const listeners = new Set();
  const invoke = vi.fn(async (command, payload = {}) => {
    if (command === 'getState' || command === 'listWorkbooks') {
      return { ok: true, state: structuredClone(state) };
    }
    if (command === 'loadSyncState') {
      if (firstLoadPending) {
        const pending = firstLoadPending;
        firstLoadPending = null;
        return pending.promise;
      }
      return stored
        ? { ok: true, status: 'loaded', envelope: structuredClone(stored) }
        : { ok: true, status: 'missing', envelope: null };
    }
    if (command === 'saveSyncState') {
      if (typeof failSaves === 'function' ? failSaves() : failSaves) {
        return {
          ok: false,
          code: 'cloud_sync_state_save_failed',
          error: 'Application Support is read-only.'
        };
      }
      stored = {
        version: 1,
        cloudEnvironment: CLOUD_ENVIRONMENT,
        accountId: ACCOUNT_ID,
        workbookId: payload.workbookId,
        syncState: payload.syncState ? structuredClone(payload.syncState) : null,
        autoSyncEnabled: payload.autoSyncEnabled !== false
      };
      return { ok: true, status: 'saved', envelope: structuredClone(stored) };
    }
    if (command === 'removeSyncState') {
      stored = null;
      return { ok: true, status: 'removed' };
    }
    if (typeof handleCloudCommand === 'function') {
      const result = await handleCloudCommand(command, payload, {
        getState: () => state,
        setState: (nextState) => {
          state = structuredClone(nextState);
        }
      });
      if (result) return result;
    }
    return { ok: false, code: 'unexpected_command', error: `Unexpected ${command}` };
  });
  return {
    cloud: {
      invoke,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    },
    invoke,
    publish(nextState) {
      state = structuredClone(nextState);
      listeners.forEach((listener) => listener(structuredClone(state)));
    },
    stored: () => (stored ? structuredClone(stored) : null)
  };
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch (_error) {
    // The durable host remains the authoritative test surface.
  }
});

describe('durable cloud workbook controller integration', () => {
  it('retries the failed durable scope instead of refreshing the iCloud library', async () => {
    let rejectSaves = true;
    const localWorkbook = workbook();
    const timers = autoSyncTimers();
    const host = durableCloudHarness({
      initialState: cloudState(),
      failSaves: () => rejectSaves
    });
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        autoSyncSchedulerOptions: timers.options
      })
    );

    await waitFor(() =>
      expect(result.current.model).toMatchObject({
        errorCode: 'cloud_sync_state_save_failed',
        errorOperation: 'sync-state'
      })
    );
    const listCallsBeforeRetry = host.invoke.mock.calls.filter(
      ([command]) => command === 'listWorkbooks'
    ).length;
    rejectSaves = false;

    let retryResult;
    await act(async () => {
      retryResult = await result.current.execute('retry-sync-state');
    });

    expect(retryResult).toMatchObject({ ok: true });
    expect(result.current.model).toMatchObject({
      error: '',
      notice: 'iCloud sync recovered.'
    });
    expect(host.invoke.mock.calls.filter(([command]) => command === 'listWorkbooks')).toHaveLength(
      listCallsBeforeRetry
    );
    expect(host.invoke).toHaveBeenCalledWith('saveSyncState', {
      expectedUserId: 'user-1',
      workbookId: WORKBOOK_ID,
      syncState: null,
      autoSyncEnabled: true
    });
    expect(host.stored()).toEqual(durableEnvelope());
  });

  it('does not enroll a saved workbook before durable anchor hydration finishes', async () => {
    const pendingLoad = deferred();
    const timers = autoSyncTimers();
    const localWorkbook = workbook();
    const host = durableCloudHarness({
      firstLoad: pendingLoad,
      handleCloudCommand(command, payload, controls) {
        if (command !== 'uploadWorkbook') return null;
        const nextState = cloudState(1);
        controls.setState(nextState);
        return {
          ok: true,
          metadata: { id: payload.workbook.id, revision: 1 },
          state: nextState
        };
      }
    });
    renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        autoSyncSchedulerOptions: timers.options
      })
    );

    await waitFor(() =>
      expect(host.invoke).toHaveBeenCalledWith('loadSyncState', {
        expectedUserId: 'user-1',
        workbookId: WORKBOOK_ID
      })
    );
    expect(timers.hasPending()).toBe(false);
    expect(host.invoke).not.toHaveBeenCalledWith('uploadWorkbook', expect.anything());

    await act(async () => {
      pendingLoad.resolve({ ok: true, status: 'missing', envelope: null });
      await pendingLoad.promise;
    });
    await waitFor(() => expect(timers.hasPending()).toBe(true));
    await act(async () => {
      timers.runLatest();
      await waitFor(() =>
        expect(host.invoke).toHaveBeenCalledWith('uploadWorkbook', {
          expectedUserId: 'user-1',
          workbook: localWorkbook,
          expectedRevision: null
        })
      );
    });
  });

  it('does not pull a newer iCloud revision before durable anchor hydration finishes', async () => {
    const pendingLoad = deferred();
    const baseWorkbook = workbook('Revision one');
    const remoteWorkbook = workbook('Revision two');
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn((nextWorkbook) => nextWorkbook);
    const host = durableCloudHarness({
      initialEnvelope: durableEnvelope({ revision: 1, baseWorkbook }),
      initialState: cloudState(2),
      firstLoad: pendingLoad,
      handleCloudCommand(command) {
        if (command !== 'downloadWorkbook') return null;
        return {
          ok: true,
          workbook: remoteWorkbook,
          metadata: { id: WORKBOOK_ID, revision: 2 },
          state: cloudState(2)
        };
      }
    });
    renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: baseWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        setWorkbook
      })
    );

    await waitFor(() =>
      expect(host.invoke).toHaveBeenCalledWith('loadSyncState', {
        expectedUserId: 'user-1',
        workbookId: WORKBOOK_ID
      })
    );
    expect(host.invoke).not.toHaveBeenCalledWith('downloadWorkbook', expect.anything());

    await act(async () => {
      pendingLoad.resolve({
        ok: true,
        status: 'loaded',
        envelope: durableEnvelope({ revision: 1, baseWorkbook })
      });
      await pendingLoad.promise;
    });
    await waitFor(() =>
      expect(host.invoke).toHaveBeenCalledWith('downloadWorkbook', {
        expectedUserId: 'user-1',
        workbookId: WORKBOOK_ID
      })
    );
    await waitFor(() => expect(saveWorkbook).toHaveBeenCalledWith(remoteWorkbook));
    expect(setWorkbook).toHaveBeenCalledWith(remoteWorkbook, {
      source: 'cloud-merge',
      markDirty: true
    });
  });

  it('resolves an explicit Sync CAS conflict through the prefer-local reconciler', async () => {
    const baseWorkbook = workbook('Shared Plan');
    baseWorkbook.transactions = [transaction('Original')];
    const localWorkbook = cloneFixture(baseWorkbook);
    localWorkbook.transactions[0].description = 'Mac winner';
    const remoteWorkbook = cloneFixture(baseWorkbook);
    remoteWorkbook.transactions[0].description = 'iPhone value';
    let uploadAttempt = 0;
    let reconciledUpload = null;
    const host = durableCloudHarness({
      initialEnvelope: durableEnvelope({ revision: 2, baseWorkbook }),
      initialState: cloudState(2),
      handleCloudCommand(command, payload, controls) {
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: remoteWorkbook,
            metadata: { id: WORKBOOK_ID, revision: 3 },
            state: cloudState(3)
          };
        }
        if (command === 'uploadWorkbook') {
          uploadAttempt += 1;
          if (uploadAttempt === 1) {
            controls.setState(cloudState(3));
            return {
              ok: false,
              conflict: true,
              code: 'workbook_revision_conflict',
              state: cloudState(3)
            };
          }
          reconciledUpload = structuredClone(payload);
          controls.setState(cloudState(4));
          return {
            ok: true,
            metadata: { id: WORKBOOK_ID, revision: 4 },
            state: cloudState(4)
          };
        }
        return null;
      }
    });
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        saveWorkbook: vi.fn(async () => ({ ok: true })),
        setWorkbook: vi.fn((nextWorkbook) => nextWorkbook)
      })
    );
    await waitFor(() =>
      expect(host.invoke).toHaveBeenCalledWith('loadSyncState', {
        expectedUserId: 'user-1',
        workbookId: WORKBOOK_ID
      })
    );

    let syncResult;
    await act(async () => {
      syncResult = await result.current.execute('upload');
    });

    expect(syncResult).toMatchObject({ ok: true });
    expect(host.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      expectedUserId: 'user-1',
      workbook: localWorkbook,
      expectedRevision: 2
    });
    expect(reconciledUpload).toMatchObject({
      expectedRevision: 3,
      conflictResolution: 'keep_local'
    });
    expect(reconciledUpload.workbook.transactions[0].description).toBe('Mac winner');
    expect(result.current.model.current.conflict).toBe(false);
    expect(host.stored()).toMatchObject({
      syncState: { revision: 4, conflict: false, baseRevision: 4 },
      autoSyncEnabled: true
    });
  });

  it('blocks later automatic sync after a durable save failure without changing the workbook', async () => {
    const timers = autoSyncTimers();
    const baseWorkbook = workbook('Revision two');
    const setWorkbook = vi.fn();
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const host = durableCloudHarness({
      initialEnvelope: durableEnvelope({ revision: 2, baseWorkbook }),
      initialState: cloudState(2),
      failSaves: true,
      handleCloudCommand(command, payload, controls) {
        if (command !== 'uploadWorkbook') return null;
        const nextState = cloudState(3);
        controls.setState(nextState);
        return {
          ok: true,
          metadata: { id: payload.workbook.id, revision: 3 },
          state: nextState
        };
      }
    });
    const hook = renderHook(
      ({ currentWorkbook, localSaveSequence }) =>
        useCloudWorkbookController({
          cloud: host.cloud,
          workbook: currentWorkbook,
          saveStatus: 'saved',
          localSaveSequence,
          saveWorkbook,
          setWorkbook,
          autoSyncSchedulerOptions: timers.options
        }),
      { initialProps: { currentWorkbook: baseWorkbook, localSaveSequence: 0 } }
    );
    await waitFor(() =>
      expect(host.invoke).toHaveBeenCalledWith('loadSyncState', {
        expectedUserId: 'user-1',
        workbookId: WORKBOOK_ID
      })
    );

    const firstEdit = { ...baseWorkbook, name: 'First saved edit' };
    hook.rerender({ currentWorkbook: firstEdit, localSaveSequence: 1 });
    await waitFor(() => expect(timers.hasPending()).toBe(true));
    await act(async () => {
      timers.runLatest();
      await waitFor(() =>
        expect(host.invoke).toHaveBeenCalledWith('saveSyncState', expect.anything())
      );
    });
    await waitFor(() => expect(timers.hasPending()).toBe(false));

    const secondEdit = { ...baseWorkbook, name: 'Second saved edit' };
    hook.rerender({ currentWorkbook: secondEdit, localSaveSequence: 2 });
    await act(async () => Promise.resolve());
    expect(timers.hasPending()).toBe(false);
    expect(host.invoke.mock.calls.filter(([command]) => command === 'uploadWorkbook')).toHaveLength(
      1
    );
    expect(setWorkbook).not.toHaveBeenCalled();
    expect(saveWorkbook).not.toHaveBeenCalled();
    expect(hook.result.current.model.current.workbookId).toBe(WORKBOOK_ID);
  });

  it.each(['saved', 'dirty'])(
    'persists an exact remote deletion for a %s local copy without replacing it',
    async (saveStatus) => {
      const timers = autoSyncTimers();
      const localWorkbook = workbook('Local survivor');
      const saveWorkbook = vi.fn(async () => ({ ok: true }));
      const setWorkbook = vi.fn();
      const host = durableCloudHarness({
        initialEnvelope: durableEnvelope({ revision: 2, baseWorkbook: localWorkbook }),
        initialState: cloudState(2)
      });
      const hook = renderHook(
        ({ currentWorkbook, localSaveSequence }) =>
          useCloudWorkbookController({
            cloud: host.cloud,
            workbook: currentWorkbook,
            saveStatus,
            localSaveSequence,
            saveWorkbook,
            setWorkbook,
            autoSyncSchedulerOptions: timers.options
          }),
        { initialProps: { currentWorkbook: localWorkbook, localSaveSequence: 0 } }
      );
      await waitFor(() =>
        expect(host.invoke).toHaveBeenCalledWith('loadSyncState', {
          expectedUserId: 'user-1',
          workbookId: WORKBOOK_ID
        })
      );

      act(() => {
        host.publish({
          ...cloudState(),
          workbookChange: {
            sequence: 1,
            eventType: 'DELETE',
            workbookId: WORKBOOK_ID,
            revision: 0
          }
        });
      });

      await waitFor(() =>
        expect(host.stored()).toMatchObject({
          syncState: { revision: null, conflict: false, remoteDeleted: true },
          autoSyncEnabled: false
        })
      );
      expect(hook.result.current.model.current).toMatchObject({
        linked: false,
        remoteDeleted: true,
        autoSyncEnabled: false,
        status: 'local_only'
      });
      expect(saveWorkbook).not.toHaveBeenCalled();
      expect(setWorkbook).not.toHaveBeenCalled();

      hook.rerender({
        currentWorkbook: { ...localWorkbook, name: 'Still local' },
        localSaveSequence: 1
      });
      await act(async () => Promise.resolve());
      expect(timers.hasPending()).toBe(false);
      expect(host.invoke).not.toHaveBeenCalledWith('uploadWorkbook', expect.anything());
    }
  );

  it('confirms a missed deletion by exact record lookup before persisting the tombstone', async () => {
    const localWorkbook = workbook('Local survivor');
    const host = durableCloudHarness({
      initialEnvelope: durableEnvelope({ revision: 2, baseWorkbook: localWorkbook }),
      initialState: cloudState(),
      handleCloudCommand(command) {
        if (command !== 'downloadWorkbook') return null;
        return {
          ok: false,
          code: 'cloud_workbook_not_found',
          error: 'That workbook is no longer in iCloud.'
        };
      }
    });
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'dirty'
      })
    );

    await waitFor(() =>
      expect(host.invoke).toHaveBeenCalledWith('downloadWorkbook', {
        expectedUserId: 'user-1',
        workbookId: WORKBOOK_ID
      })
    );
    await waitFor(() =>
      expect(host.stored()).toMatchObject({
        syncState: { remoteDeleted: true },
        autoSyncEnabled: false
      })
    );
    expect(result.current.model.current).toMatchObject({
      remoteDeleted: true,
      linked: false,
      autoSyncEnabled: false
    });
  });

  it('repairs a stale lower library revision from an exact current download', async () => {
    const localWorkbook = workbook('Revision two');
    const host = durableCloudHarness({
      initialEnvelope: durableEnvelope({ revision: 2, baseWorkbook: localWorkbook }),
      initialState: cloudState(1),
      handleCloudCommand(command, _payload, controls) {
        if (command !== 'downloadWorkbook') return null;
        controls.setState(cloudState(2));
        return {
          ok: true,
          workbook: structuredClone(localWorkbook),
          metadata: { id: WORKBOOK_ID, revision: 2 },
          state: cloudState(2)
        };
      }
    });
    const setWorkbook = vi.fn();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        setWorkbook
      })
    );

    await waitFor(() => expect(result.current.model.current.revision).toBe(2));
    expect(result.current.model.current).toMatchObject({
      status: 'synced',
      syncBlocked: false
    });
    expect(host.stored()).toMatchObject({ syncState: { revision: 2, conflict: false } });
    expect(setWorkbook).not.toHaveBeenCalled();
  });

  it('fails closed when an exact iCloud revision is below the durable anchor', async () => {
    const localWorkbook = workbook('Mac revision two');
    const remoteWorkbook = workbook('Recreated iCloud revision one');
    const timers = autoSyncTimers();
    const host = durableCloudHarness({
      initialEnvelope: durableEnvelope({ revision: 2, baseWorkbook: localWorkbook }),
      initialState: cloudState(1),
      handleCloudCommand(command) {
        if (command !== 'downloadWorkbook') return null;
        return {
          ok: true,
          workbook: structuredClone(remoteWorkbook),
          metadata: { id: WORKBOOK_ID, revision: 1 },
          state: cloudState(1)
        };
      }
    });
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        setWorkbook,
        autoSyncSchedulerOptions: timers.options
      })
    );

    await waitFor(() => expect(result.current.model.errorCode).toBe('cloud_revision_regressed'));
    await waitFor(() => expect(result.current.model.current.conflict).toBe(true));
    expect(result.current.model.current).toMatchObject({
      conflict: true,
      status: 'conflict'
    });
    expect(host.stored()).toMatchObject({
      syncState: { revision: 2, conflict: true },
      autoSyncEnabled: true
    });
    expect(timers.hasPending()).toBe(false);
    expect(saveWorkbook).not.toHaveBeenCalled();
    expect(setWorkbook).not.toHaveBeenCalled();
    expect(result.current.model.error).toContain('older copy');
  });

  it('persists remoteDeleted and autosave-off across a controller restart', async () => {
    const timers = autoSyncTimers();
    const localWorkbook = workbook();
    const host = durableCloudHarness({
      initialEnvelope: durableEnvelope({ revision: 2, baseWorkbook: localWorkbook }),
      initialState: cloudState(2),
      handleCloudCommand(command, _payload, controls) {
        if (command !== 'deleteWorkbook') return null;
        controls.setState(cloudState());
        return { ok: true, id: WORKBOOK_ID, state: cloudState() };
      }
    });
    const first = renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        autoSyncSchedulerOptions: timers.options
      })
    );
    await waitFor(() =>
      expect(host.invoke).toHaveBeenCalledWith('loadSyncState', {
        expectedUserId: 'user-1',
        workbookId: WORKBOOK_ID
      })
    );
    await act(async () => {
      await first.result.current.execute('delete', { workbookId: WORKBOOK_ID });
    });
    expect(host.stored()).toMatchObject({
      syncState: { revision: null, conflict: false, remoteDeleted: true },
      autoSyncEnabled: false
    });
    first.unmount();

    const restartedTimers = autoSyncTimers();
    const restarted = renderHook(() =>
      useCloudWorkbookController({
        cloud: host.cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        autoSyncSchedulerOptions: restartedTimers.options
      })
    );
    await waitFor(() => expect(restarted.result.current.model.current.autoSyncEnabled).toBe(false));
    expect(restartedTimers.hasPending()).toBe(false);
    expect(host.invoke.mock.calls.filter(([command]) => command === 'uploadWorkbook')).toHaveLength(
      0
    );
    expect(host.stored()).toMatchObject({
      syncState: { remoteDeleted: true },
      autoSyncEnabled: false
    });
  });
});
