import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  readCloudWorkbookSyncState,
  writeCloudWorkbookAutoSyncPreference,
  writeCloudWorkbookSyncState
} from '../../src/renderer/app/cloud-workbook-sync-state.js';
import {
  isRetryableAutomaticSyncFailure,
  useCloudWorkbookController
} from '../../src/renderer/app/use-cloud-workbook-controller.js';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function signedInState() {
  return {
    configured: true,
    status: 'signed_in',
    user: { id: 'user-1', email: 'alex@example.com', name: 'Alex Example' },
    workbooks: [{ id: 'cloud-workbook', name: 'Cloud Plan', revision: 2 }]
  };
}

function syncTransaction(id, description = id) {
  return {
    id,
    date: '2026-08-29',
    description,
    lines: []
  };
}

function syncWorkbook(name, transactions = []) {
  const workbook = cloneFixture(makeMinimalWorkbook());
  workbook.id = 'cloud-workbook';
  workbook.name = name;
  workbook.transactions = transactions;
  return workbook;
}

function makeCloud(downloadResult) {
  return {
    invoke: vi.fn(async (command) => {
      if (command === 'getState') return { ok: true, state: signedInState() };
      if (command === 'downloadWorkbook') return downloadResult;
      return { ok: true, state: signedInState() };
    }),
    subscribe: () => () => {}
  };
}

function createSyncStorage(revision = null, conflict = false, baseWorkbook = null) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  if (revision || conflict) {
    writeCloudWorkbookSyncState(storage, 'user-1', 'cloud-workbook', {
      revision,
      conflict,
      ...(baseWorkbook ? { baseRevision: revision, baseWorkbook } : {})
    });
  }
  return storage;
}

function createAutoSyncTimers() {
  const timers = [];
  return {
    options: {
      scheduleTimer(callback, delay) {
        const timer = { callback, canceled: false, delay };
        timers.push(timer);
        return timer;
      },
      cancelTimer(timer) {
        timer.canceled = true;
      }
    },
    runLatest() {
      const timer = [...timers].reverse().find((candidate) => !candidate.canceled);
      timer.callback();
      return timer;
    },
    hasPending() {
      return timers.some((candidate) => !candidate.canceled);
    }
  };
}

describe('cloud workbook controller interactions', () => {
  it('does not retry a permanent CloudKit rejection automatically', () => {
    expect(
      isRetryableAutomaticSyncFailure({
        ok: false,
        code: 'cloud_change_rejected',
        error: 'CloudKit rejected this record.'
      })
    ).toBe(false);
    expect(
      isRetryableAutomaticSyncFailure({
        ok: false,
        code: 'cloud_database_update_required',
        error: 'The Production database schema needs an update.'
      })
    ).toBe(false);
    expect(
      isRetryableAutomaticSyncFailure({
        ok: false,
        code: 'cloud_upload_failed',
        error: 'The network is offline.'
      })
    ).toBe(true);
  });

  it('does not carry a failed workbook action into a different open workbook', async () => {
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') {
          return { ok: true, state: { ...signedInState(), workbooks: [] } };
        }
        if (command === 'uploadWorkbook') {
          return {
            ok: false,
            code: 'cloud_database_update_required',
            error: 'iCloud needs a Cavalry database update.',
            retryable: false
          };
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage();
    const hook = renderHook(
      ({ currentWorkbook }) =>
        useCloudWorkbookController({ cloud, workbook: currentWorkbook, syncStorage }),
      { initialProps: { currentWorkbook: { id: 'workbook-one', name: 'Plan One' } } }
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await hook.result.current.execute('upload');
    });
    expect(hook.result.current.model).toMatchObject({
      error: 'iCloud needs a Cavalry database update.',
      failedOperation: 'upload',
      failedWorkbookId: 'workbook-one'
    });

    hook.rerender({ currentWorkbook: { id: 'workbook-two', name: 'Plan Two' } });
    await waitFor(() => expect(hook.result.current.model.error).toBe(''));
    expect(hook.result.current.model.failedOperation).toBe('');
  });

  it('clears a retryable UI error after a newer successful native sync state', async () => {
    let listener = null;
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') {
          return {
            ok: true,
            state: { ...signedInState(), workbooks: [], lastSyncAt: '2026-08-31T01:00:00Z' }
          };
        }
        if (command === 'uploadWorkbook') {
          return {
            ok: false,
            code: 'cloud_upload_failed',
            error: 'iCloud is temporarily unavailable.',
            retryable: true
          };
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe(callback) {
        listener = callback;
        return () => {};
      }
    };
    const syncStorage = createSyncStorage();
    const hook = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'workbook-one', name: 'Plan One' },
        syncStorage
      })
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await hook.result.current.execute('upload');
    });
    expect(hook.result.current.model.error).toBe('iCloud is temporarily unavailable.');

    act(() => {
      listener({
        ...signedInState(),
        workbooks: [{ id: 'workbook-one', name: 'Plan One', revision: 1 }],
        lastSyncAt: '2026-08-31T01:05:00Z',
        error: ''
      });
    });
    await waitFor(() => expect(hook.result.current.model.error).toBe(''));
  });

  it('automatically uploads the latest workbook after its local file save succeeds', async () => {
    const timers = createAutoSyncTimers();
    const initialState = { ...signedInState(), workbooks: [] };
    let uploadedRevision = 0;
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: initialState };
        if (command === 'uploadWorkbook') {
          uploadedRevision += 1;
          const metadata = {
            id: 'cloud-workbook',
            name: 'Latest local plan',
            revision: uploadedRevision
          };
          return {
            ok: true,
            metadata,
            state: { ...signedInState(), workbooks: [metadata] }
          };
        }
        return { ok: true, state: initialState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage();
    const hook = renderHook(
      ({ workbook, saveStatus, localSaveSequence }) =>
        useCloudWorkbookController({
          cloud,
          workbook,
          saveStatus,
          localSaveSequence,
          syncStorage,
          autoSyncSchedulerOptions: timers.options
        }),
      {
        initialProps: {
          workbook: { id: 'cloud-workbook', name: 'Draft' },
          saveStatus: 'dirty',
          localSaveSequence: 0
        }
      }
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    hook.rerender({
      workbook: { id: 'cloud-workbook', name: 'Latest local plan' },
      saveStatus: 'saved',
      localSaveSequence: 1
    });
    act(() => {
      expect(timers.runLatest().delay).toBe(800);
    });
    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
        workbook: { id: 'cloud-workbook', name: 'Latest local plan' },
        expectedRevision: null
      })
    );
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      known: true,
      revision: 1,
      conflict: false,
      baseRevision: 1,
      baseWorkbook: { id: 'cloud-workbook', name: 'Latest local plan' }
    });

    hook.rerender({
      workbook: { id: 'cloud-workbook', name: 'Second draft' },
      saveStatus: 'dirty',
      localSaveSequence: 1
    });
    hook.rerender({
      workbook: { id: 'cloud-workbook', name: 'Second saved plan' },
      saveStatus: 'saved',
      localSaveSequence: 2
    });
    act(() => {
      timers.runLatest();
    });
    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
        workbook: { id: 'cloud-workbook', name: 'Second saved plan' },
        expectedRevision: 1
      })
    );
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook').revision).toBe(2);
  });

  it('publishes waiting and retrying instead of reporting a queued autosave as synced', async () => {
    const timers = createAutoSyncTimers();
    const workbook = { id: 'cloud-workbook', name: 'Cloud Plan' };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'uploadWorkbook') {
          return {
            ok: false,
            code: 'cloud_upload_failed',
            error: 'The network is offline.'
          };
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(2, false, workbook);
    const hook = renderHook(
      ({ localSaveSequence, saveStatus }) =>
        useCloudWorkbookController({
          cloud,
          workbook,
          localSaveSequence,
          saveStatus,
          syncStorage,
          autoSyncSchedulerOptions: timers.options
        }),
      { initialProps: { localSaveSequence: 0, saveStatus: 'dirty' } }
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    hook.rerender({ localSaveSequence: 1, saveStatus: 'saved' });
    await waitFor(() => expect(hook.result.current.model.current.status).toBe('waiting'));
    act(() => {
      timers.runLatest();
    });
    await waitFor(() => expect(hook.result.current.model.current.status).toBe('retrying'));

    expect(hook.result.current.model.error).toBe('');
    expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook,
      expectedRevision: 2
    });
  });

  it('surfaces a terminal autosave failure and lets an explicit retry recover', async () => {
    const timers = createAutoSyncTimers();
    const workbook = { id: 'cloud-workbook', name: 'Cloud Plan' };
    let finishAutomaticUpload;
    let uploadCount = 0;
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'uploadWorkbook') {
          uploadCount += 1;
          if (uploadCount === 1) {
            return new Promise((resolve) => {
              finishAutomaticUpload = resolve;
            });
          }
          const metadata = { id: workbook.id, name: workbook.name, revision: 3 };
          return {
            ok: true,
            metadata,
            state: { ...signedInState(), workbooks: [metadata] }
          };
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(2, false, workbook);
    const hook = renderHook(
      ({ localSaveSequence, saveStatus }) =>
        useCloudWorkbookController({
          cloud,
          workbook,
          localSaveSequence,
          saveStatus,
          syncStorage,
          autoSyncSchedulerOptions: timers.options
        }),
      { initialProps: { localSaveSequence: 0, saveStatus: 'dirty' } }
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    hook.rerender({ localSaveSequence: 1, saveStatus: 'saved' });
    await waitFor(() => expect(hook.result.current.model.current.status).toBe('waiting'));
    act(() => {
      timers.runLatest();
    });
    await waitFor(() => expect(hook.result.current.model.current.status).toBe('uploading'));

    await act(async () => {
      finishAutomaticUpload({
        ok: false,
        retry: false,
        code: 'cloud_record_invalid',
        error: 'iCloud rejected this workbook.'
      });
    });
    await waitFor(() =>
      expect(hook.result.current.model).toMatchObject({
        error: 'iCloud rejected this workbook.',
        errorOperation: 'upload',
        failedOperation: 'upload',
        current: { status: 'attention' }
      })
    );

    await act(async () => {
      expect(await hook.result.current.execute('upload')).toMatchObject({ ok: true });
    });
    await waitFor(() =>
      expect(hook.result.current.model).toMatchObject({
        error: '',
        current: { status: 'synced', revision: 3 }
      })
    );
  });

  it('ignores a terminal autosave result after the active workbook changes', async () => {
    const timers = createAutoSyncTimers();
    let finishUpload;
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'uploadWorkbook') {
          return new Promise((resolve) => {
            finishUpload = resolve;
          });
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe: () => () => {}
    };
    const firstWorkbook = { id: 'cloud-workbook', name: 'Cloud Plan' };
    const syncStorage = createSyncStorage(2, false, firstWorkbook);
    const hook = renderHook(
      ({ workbook, localSaveSequence, saveStatus }) =>
        useCloudWorkbookController({
          cloud,
          workbook,
          localSaveSequence,
          saveStatus,
          syncStorage,
          autoSyncSchedulerOptions: timers.options
        }),
      {
        initialProps: {
          workbook: firstWorkbook,
          localSaveSequence: 0,
          saveStatus: 'dirty'
        }
      }
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    hook.rerender({ workbook: firstWorkbook, localSaveSequence: 1, saveStatus: 'saved' });
    act(() => {
      timers.runLatest();
    });
    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', expect.anything())
    );
    hook.rerender({
      workbook: { id: 'other-workbook', name: 'Other Plan' },
      localSaveSequence: 1,
      saveStatus: 'saved'
    });

    await act(async () => {
      finishUpload({
        ok: false,
        retry: false,
        code: 'cloud_record_invalid',
        error: 'Old workbook failure.'
      });
    });
    await waitFor(() =>
      expect(hook.result.current.model.current.workbookId).toBe('other-workbook')
    );
    expect(hook.result.current.model.error).toBe('');
  });

  it('automatically enrolls an already-saved Mac workbook on first iCloud connection', async () => {
    const timers = createAutoSyncTimers();
    const initialState = { ...signedInState(), workbooks: [] };
    const workbook = { id: 'local-plan', name: 'Main Plan' };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: initialState };
        if (command === 'uploadWorkbook') {
          const metadata = { ...workbook, revision: 1 };
          return {
            ok: true,
            metadata,
            state: { ...signedInState(), workbooks: [metadata] }
          };
        }
        return { ok: true, state: initialState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook,
        saveStatus: 'saved',
        localSaveSequence: 0,
        syncStorage,
        autoSyncSchedulerOptions: timers.options
      })
    );

    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));
    act(() => {
      expect(timers.runLatest().delay).toBe(800);
    });
    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
        workbook,
        expectedRevision: null
      })
    );

    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'local-plan')).toMatchObject({
      known: true,
      revision: 1,
      conflict: false,
      baseRevision: 1,
      baseWorkbook: workbook
    });
    await waitFor(() =>
      expect(result.current.model.current).toMatchObject({
        linked: true,
        revision: 1,
        status: 'synced'
      })
    );
  });

  it.each([
    { id: 'local-plan', explicitPause: true },
    { id: 'workbook-recovered-historical-copy', explicitPause: false }
  ])(
    'keeps $id local through startup and later saves while manual Add remains available',
    async ({ id, explicitPause }) => {
      const timers = createAutoSyncTimers();
      const workbook = { id, name: 'Main Plan' };
      const initialState = signedInState();
      const metadata = { ...workbook, revision: 1 };
      const cloud = {
        invoke: vi.fn(async (command) => {
          if (command === 'getState') return { ok: true, state: initialState };
          if (command === 'uploadWorkbook') {
            return {
              ok: true,
              metadata,
              state: { ...signedInState(), workbooks: [metadata] }
            };
          }
          return { ok: true, state: initialState };
        }),
        subscribe: () => () => {}
      };
      // The original workbook has a valid anchor. A recovered copy must never
      // apply its older content to that server record or automatically enroll.
      const original = syncWorkbook('Current original');
      const syncStorage = createSyncStorage(2, false, original);
      if (explicitPause)
        writeCloudWorkbookAutoSyncPreference(syncStorage, 'user-1', workbook.id, false);
      const hook = renderHook(
        ({ currentWorkbook, localSaveSequence }) =>
          useCloudWorkbookController({
            cloud,
            workbook: currentWorkbook,
            saveStatus: 'saved',
            localSaveSequence,
            syncStorage,
            autoSyncSchedulerOptions: timers.options
          }),
        { initialProps: { currentWorkbook: workbook, localSaveSequence: 0 } }
      );

      await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));
      expect(hook.result.current.model.current.autoSyncEnabled).toBe(false);
      expect(timers.hasPending()).toBe(false);

      hook.rerender({
        currentWorkbook: { ...workbook, name: 'Saved while paused' },
        localSaveSequence: 1
      });
      await act(async () => Promise.resolve());
      expect(timers.hasPending()).toBe(false);
      expect(cloud.invoke).not.toHaveBeenCalledWith('uploadWorkbook', expect.anything());

      await act(async () => {
        await hook.result.current.execute('upload');
      });
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
        workbook: { ...workbook, name: 'Saved while paused' },
        expectedRevision: null
      });
      expect(hook.result.current.model.current.autoSyncEnabled).toBe(false);
      expect(readCloudWorkbookSyncState(syncStorage, 'user-1', original.id)).toMatchObject({
        revision: 2,
        baseWorkbook: original
      });
    }
  );

  it('resumes automatic sync when the persistent workbook preference is turned back on', async () => {
    const timers = createAutoSyncTimers();
    const workbook = { id: 'cloud-workbook', name: 'Paused Plan' };
    const initialState = { ...signedInState(), workbooks: [] };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: initialState };
        if (command === 'uploadWorkbook') {
          const metadata = { ...workbook, revision: 1 };
          return {
            ok: true,
            metadata,
            state: { ...signedInState(), workbooks: [metadata] }
          };
        }
        return { ok: true, state: initialState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage();
    writeCloudWorkbookAutoSyncPreference(syncStorage, 'user-1', workbook.id, false);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook,
        saveStatus: 'saved',
        syncStorage,
        autoSyncSchedulerOptions: timers.options
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    await act(async () => {
      expect(await result.current.execute('set-auto-sync', { enabled: true })).toEqual({
        ok: true,
        enabled: true
      });
    });
    expect(result.current.model.current.autoSyncEnabled).toBe(true);
    act(() => {
      timers.runLatest();
    });
    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
        workbook,
        expectedRevision: null
      })
    );
  });

  it('does not recreate a manually deleted iCloud copy until Add to iCloud is chosen', async () => {
    const timers = createAutoSyncTimers();
    const workbook = { id: 'cloud-workbook', name: 'Mac Plan' };
    const deletedState = { ...signedInState(), workbooks: [] };
    const recreatedMetadata = { id: workbook.id, name: workbook.name, revision: 1 };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'deleteWorkbook') {
          return { ok: true, id: workbook.id, state: deletedState };
        }
        if (command === 'uploadWorkbook') {
          return {
            ok: true,
            metadata: recreatedMetadata,
            state: { ...signedInState(), workbooks: [recreatedMetadata] }
          };
        }
        return { ok: true, state: deletedState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(2, false, workbook);
    const hook = renderHook(
      ({ currentWorkbook, localSaveSequence }) =>
        useCloudWorkbookController({
          cloud,
          workbook: currentWorkbook,
          saveStatus: 'saved',
          localSaveSequence,
          syncStorage,
          autoSyncSchedulerOptions: timers.options
        }),
      { initialProps: { currentWorkbook: workbook, localSaveSequence: 0 } }
    );
    await waitFor(() => expect(hook.result.current.model.current.linked).toBe(true));

    await act(async () => {
      await hook.result.current.execute('delete', { workbookId: workbook.id });
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', workbook.id)).toMatchObject({
      revision: null,
      conflict: false,
      remoteDeleted: true
    });
    expect(hook.result.current.model.current).toMatchObject({
      linked: false,
      status: 'local_only'
    });

    hook.rerender({
      currentWorkbook: { ...workbook, name: 'Mac Plan edited locally' },
      localSaveSequence: 1
    });
    await act(async () => Promise.resolve());
    expect(timers.hasPending()).toBe(false);
    expect(cloud.invoke).not.toHaveBeenCalledWith('uploadWorkbook', expect.anything());

    await act(async () => {
      await hook.result.current.execute('upload');
    });
    expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: { ...workbook, name: 'Mac Plan edited locally' },
      expectedRevision: null,
      conflictResolution: 'keep_local'
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', workbook.id)).toMatchObject({
      revision: 1,
      conflict: false
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', workbook.id).remoteDeleted).toBe(
      undefined
    );
    expect(hook.result.current.model.current.autoSyncEnabled).toBe(true);
  });

  it('combines both devices after CloudKit rejects two queued copies of the same revision', async () => {
    const baseWorkbook = syncWorkbook('Shared Plan');
    const macWorkbook = cloneFixture(baseWorkbook);
    macWorkbook.transactions = [syncTransaction('mac-transaction')];
    macWorkbook.updatedAt = '2026-08-29T10:01:00.000Z';
    const phoneWorkbook = cloneFixture(baseWorkbook);
    phoneWorkbook.transactions = [syncTransaction('phone-transaction')];
    phoneWorkbook.updatedAt = '2026-08-29T10:02:00.000Z';
    const conflictedState = {
      ...signedInState(),
      pendingCount: 0,
      workbooks: [
        {
          ...signedInState().workbooks[0],
          revision: 6,
          conflict: true
        }
      ]
    };
    const mergedState = {
      ...signedInState(),
      pendingCount: 0,
      workbooks: [{ ...signedInState().workbooks[0], revision: 7 }]
    };
    let uploadedWorkbook;
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: conflictedState };
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: phoneWorkbook,
            metadata: conflictedState.workbooks[0],
            state: conflictedState
          };
        }
        if (command === 'uploadWorkbook') {
          uploadedWorkbook = payload.workbook;
          return {
            ok: true,
            metadata: { ...mergedState.workbooks[0], id: 'cloud-workbook' },
            state: mergedState
          };
        }
        return { ok: true, state: mergedState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage();
    writeCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook', {
      revision: 6,
      conflict: false,
      baseRevision: 5,
      baseWorkbook
    });
    const setWorkbook = vi.fn((_workbook) => _workbook);
    const saveWorkbook = vi.fn(async () => ({ ok: true }));

    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: macWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        syncStorage,
        setWorkbook
      })
    );

    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
        workbook: expect.any(Object),
        expectedRevision: 6,
        conflictResolution: 'keep_local'
      })
    );
    expect(uploadedWorkbook.transactions.map(({ id }) => id)).toEqual([
      'mac-transaction',
      'phone-transaction'
    ]);
    expect(saveWorkbook).toHaveBeenCalledWith(uploadedWorkbook);
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      revision: 7,
      conflict: false,
      baseRevision: 7,
      baseWorkbook: uploadedWorkbook
    });
    expect(result.current.model.current.conflict).toBe(false);
  });

  it('verifies a legacy same-revision anchor before merging a restored local file', async () => {
    const remoteWorkbook = syncWorkbook('Shared Plan', [syncTransaction('mac-transaction')]);
    remoteWorkbook.updatedAt = '2026-08-29T10:01:00.000Z';
    remoteWorkbook.settings.lastSavedAt = '2026-08-29T10:01:00.000Z';
    const restoredWorkbook = cloneFixture(remoteWorkbook);
    restoredWorkbook.transactions.push(syncTransaction('phone-transaction'));
    restoredWorkbook.updatedAt = '2026-08-29T10:02:00.000Z';
    restoredWorkbook.settings.lastSavedAt = '2026-08-29T10:02:00.000Z';
    const legacyState = {
      ...signedInState(),
      pendingCount: 0,
      workbooks: [{ ...signedInState().workbooks[0], revision: 7 }]
    };
    const mergedState = {
      ...legacyState,
      workbooks: [{ ...legacyState.workbooks[0], revision: 8 }]
    };
    let uploadedWorkbook;
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: legacyState };
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: remoteWorkbook,
            metadata: legacyState.workbooks[0],
            state: legacyState
          };
        }
        if (command === 'uploadWorkbook') {
          uploadedWorkbook = payload.workbook;
          return {
            ok: true,
            metadata: { ...mergedState.workbooks[0], id: 'cloud-workbook' },
            state: mergedState
          };
        }
        return { ok: true, state: mergedState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(7);
    const setWorkbook = vi.fn((nextWorkbook) => nextWorkbook);
    const saveWorkbook = vi.fn(async () => ({ ok: true }));

    renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: restoredWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        syncStorage,
        setWorkbook
      })
    );

    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
        workbook: expect.any(Object),
        expectedRevision: 7,
        conflictResolution: 'keep_local'
      })
    );
    expect(uploadedWorkbook.transactions.map(({ id }) => id)).toEqual([
      'mac-transaction',
      'phone-transaction'
    ]);
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      revision: 8,
      conflict: false,
      baseRevision: 8,
      baseWorkbook: uploadedWorkbook
    });
  });

  it('ignores a realtime echo of the exact acknowledged revision', async () => {
    const workbook = { id: 'cloud-workbook', name: 'Cloud Plan' };
    let publishState = () => {};
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'downloadWorkbook') throw new Error('self events must not download');
        return { ok: true, state: signedInState() };
      }),
      subscribe(callback) {
        publishState = callback;
        return () => {};
      }
    };
    const syncStorage = createSyncStorage(2, false, workbook);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook,
        saveStatus: 'saved',
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    act(() => {
      publishState({
        ...signedInState(),
        workbookChange: {
          sequence: 1,
          eventType: 'UPDATE',
          workbookId: 'cloud-workbook',
          revision: 2
        }
      });
    });
    await waitFor(() => expect(result.current.model.current.conflict).toBe(false));
    expect(cloud.invoke).not.toHaveBeenCalledWith('downloadWorkbook', expect.anything());
  });

  it('downloads and locally saves a newer realtime revision when the workbook is clean', async () => {
    const localWorkbook = { id: 'cloud-workbook', name: 'Revision two' };
    let publishState = () => {};
    const downloadedWorkbook = cloneFixture(makeMinimalWorkbook());
    downloadedWorkbook.id = 'cloud-workbook';
    downloadedWorkbook.name = 'Remote revision three';
    const changedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 3 }],
      workbookChange: {
        sequence: 1,
        eventType: 'UPDATE',
        workbookId: 'cloud-workbook',
        revision: 3
      }
    };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: downloadedWorkbook,
            metadata: changedState.workbooks[0],
            state: changedState
          };
        }
        return { ok: true, state: changedState };
      }),
      subscribe(callback) {
        publishState = callback;
        return () => {};
      }
    };
    const syncStorage = createSyncStorage(2, false, localWorkbook);
    const setWorkbook = vi.fn();
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        syncStorage,
        setWorkbook
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    act(() => publishState(changedState));
    await waitFor(() => expect(saveWorkbook).toHaveBeenCalledWith(downloadedWorkbook));
    expect(setWorkbook).toHaveBeenCalledWith(downloadedWorkbook, {
      source: 'cloud-merge',
      markDirty: true
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      known: true,
      revision: 3,
      conflict: false,
      baseRevision: 3,
      baseWorkbook: downloadedWorkbook
    });
    expect(result.current.model.current.conflict).toBe(false);
  });

  it('defers a newer realtime revision until unsaved local changes are durable', async () => {
    let publishState = () => {};
    const changedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 3 }],
      workbookChange: {
        sequence: 1,
        eventType: 'UPDATE',
        workbookId: 'cloud-workbook',
        revision: 3
      }
    };
    const cloud = {
      invoke: vi.fn(async (command) =>
        command === 'getState'
          ? { ok: true, state: signedInState() }
          : { ok: true, state: changedState }
      ),
      subscribe(callback) {
        publishState = callback;
        return () => {};
      }
    };
    const syncStorage = createSyncStorage(2);
    const setWorkbook = vi.fn();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Unsaved local edits' },
        saveStatus: 'dirty',
        syncStorage,
        setWorkbook
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    act(() => publishState(changedState));
    await waitFor(() => expect(result.current.model.current.revision).toBe(3));
    expect(result.current.model.current.conflict).toBe(false);
    expect(setWorkbook).not.toHaveBeenCalled();
    expect(cloud.invoke).not.toHaveBeenCalledWith('downloadWorkbook', expect.anything());
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toEqual({
      known: true,
      revision: 2,
      conflict: false
    });
  });

  it('caches the validated Cloud workbook before disconnecting and replacing native state', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.id = 'cloud-workbook';
    workbook.name = 'Cloud Plan';
    const cloud = makeCloud({ ok: true, workbook });
    const forget = vi.fn(async () => ({ ok: true }));
    const save = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn();
    const navigate = vi.fn();
    const syncStorage = createSyncStorage();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'local-workbook', name: 'Local Plan' },
        browserCache: { save },
        workbookStorage: {
          forget,
          load: async () => ({
            status: 'loaded',
            workbook: { id: 'local-workbook', name: 'Local Plan' }
          })
        },
        saveStatus: 'saved',
        setWorkbook,
        navigate,
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });

    expect(forget).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(workbook);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(forget.mock.invocationCallOrder[0]);
    expect(setWorkbook).toHaveBeenCalledWith(workbook, {
      source: 'cloud',
      markDirty: false,
      saveStatus: 'cache'
    });
    expect(navigate).toHaveBeenCalledWith('dashboard');
  });

  it('leaves the active workbook untouched when its native file cannot be disconnected', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.id = 'cloud-workbook';
    const cloud = makeCloud({ ok: true, workbook });
    const setWorkbook = vi.fn();
    const syncStorage = createSyncStorage();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'local-workbook' },
        browserCache: { save: vi.fn() },
        workbookStorage: {
          forget: async () => ({ ok: false, error: 'busy' }),
          load: async () => ({ status: 'loaded', workbook: { id: 'local-workbook' } })
        },
        saveStatus: 'saved',
        setWorkbook,
        navigate: vi.fn(),
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let opened;
    await act(async () => {
      opened = await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });

    expect(opened).toMatchObject({ ok: false });
    expect(result.current.model.error).toContain('disconnect the current file');
    expect(result.current.model).toMatchObject({
      errorOperation: 'open',
      errorWorkbookId: 'cloud-workbook',
      errorWorkbookName: 'Cloud Plan'
    });
    expect(setWorkbook).not.toHaveBeenCalled();
  });

  it('does not overwrite the only cache copy of the active workbook', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.id = 'cloud-workbook';
    const cloud = makeCloud({ ok: true, workbook });
    const save = vi.fn(async () => ({ ok: true }));
    const forget = vi.fn(async () => ({ ok: true }));
    const syncStorage = createSyncStorage();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'local-workbook' },
        browserCache: { save },
        workbookStorage: { forget },
        saveStatus: 'cache',
        setWorkbook: vi.fn(),
        navigate: vi.fn(),
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let opened;
    await act(async () => {
      opened = await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });

    expect(opened).toMatchObject({ ok: false });
    expect(opened.error).toContain('Save the current workbook to a file');
    expect(cloud.invoke).not.toHaveBeenCalledWith('downloadWorkbook', expect.anything());
    expect(save).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it('recreates a deleted iCloud copy only after an explicit keep-local choice', async () => {
    const localWorkbook = { id: 'cloud-workbook', name: 'Local Plan' };
    let uploadCount = 0;
    const recreatedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 1 }]
    };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'listWorkbooks') {
          return { ok: true, state: { ...signedInState(), workbooks: [] } };
        }
        if (command === 'uploadWorkbook') {
          uploadCount += 1;
          return uploadCount === 1
            ? {
                ok: false,
                code: 'workbook_revision_conflict',
                conflict: true,
                error: 'This workbook changed in Cavalry Cloud.',
                state: { ...signedInState(), workbooks: [] }
              }
            : {
                ok: true,
                metadata: recreatedState.workbooks[0],
                state: recreatedState
              };
        }
        return { ok: true, state: recreatedState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(2, false, localWorkbook);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        workbookStorage: {
          load: async () => ({
            status: 'loaded',
            workbook: { id: 'cloud-workbook', name: 'Local Plan' }
          })
        },
        saveStatus: 'saved',
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let conflicted;
    await act(async () => {
      conflicted = await result.current.execute('upload');
    });
    expect(conflicted.error).toContain('was deleted');
    expect(result.current.model.current).toMatchObject({
      conflict: true,
      linked: false,
      status: 'conflict'
    });

    let recreated;
    await act(async () => {
      recreated = await result.current.execute('keep-local');
    });
    expect(recreated).toMatchObject({ ok: true });
    expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: { id: 'cloud-workbook', name: 'Local Plan' },
      expectedRevision: null,
      conflictResolution: 'keep_local'
    });
    expect(cloud.invoke).toHaveBeenCalledWith('clearConflictNotice', {
      workbookId: 'cloud-workbook'
    });
    expect(result.current.model.current).toMatchObject({
      conflict: false,
      linked: true,
      revision: 1
    });
  });

  it('shows a retryable compact error when iCloud wins two consecutive CAS races', async () => {
    const baseWorkbook = syncWorkbook('Shared Plan', [syncTransaction('shared', 'Original')]);
    const localWorkbook = cloneFixture(baseWorkbook);
    localWorkbook.transactions[0].description = 'Mac edit';
    const downloadedWorkbook = cloneFixture(baseWorkbook);
    downloadedWorkbook.transactions[0].description = 'Phone edit';
    const changedState = {
      ...signedInState(),
      workbooks: [
        {
          ...signedInState().workbooks[0],
          name: downloadedWorkbook.name,
          revision: 3
        }
      ]
    };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'uploadWorkbook') {
          return {
            ok: false,
            code: 'workbook_revision_conflict',
            conflict: true,
            error: 'This workbook changed in Cavalry Cloud.',
            state: changedState
          };
        }
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: downloadedWorkbook,
            metadata: changedState.workbooks[0],
            state: changedState
          };
        }
        return { ok: true, state: changedState };
      }),
      subscribe: () => () => {}
    };
    const setWorkbook = vi.fn();
    const syncStorage = createSyncStorage(2, false, baseWorkbook);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        browserCache: { save: vi.fn(async () => ({ ok: true })) },
        saveStatus: 'saved',
        syncStorage,
        setWorkbook,
        navigate: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let raced;
    await act(async () => {
      raced = await result.current.execute('upload');
    });
    expect(raced).toMatchObject({
      ok: false,
      code: 'cloud_workbook_changed_again',
      retryable: true,
      error: 'iCloud kept changing. Try again.'
    });
    expect(result.current.model.current).toMatchObject({
      conflict: false,
      revision: 3,
      status: 'synced',
      conflictNotice: null
    });
    expect(result.current.model.error).toBe('iCloud kept changing. Try again.');
    expect(cloud.invoke).not.toHaveBeenCalledWith('publishConflictNotice', expect.anything());
  });

  it('automatically resolves same-item races while retaining independent transactions', async () => {
    const baseWorkbook = syncWorkbook('Shared Plan', [syncTransaction('shared', 'Original')]);
    const localWorkbook = cloneFixture(baseWorkbook);
    localWorkbook.transactions[0].description = 'Mac edit';
    localWorkbook.transactions.push(syncTransaction('mac-only', 'Mac only'));
    const remoteWorkbook = cloneFixture(baseWorkbook);
    remoteWorkbook.transactions[0].description = 'Phone edit';
    remoteWorkbook.transactions.push(syncTransaction('phone-only', 'Phone only'));
    const changedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 3 }]
    };
    const resolvedState = {
      ...changedState,
      workbooks: [{ ...changedState.workbooks[0], revision: 4 }]
    };
    let uploadCount = 0;
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'uploadWorkbook') {
          uploadCount += 1;
          return uploadCount === 1
            ? {
                ok: false,
                code: 'workbook_revision_conflict',
                conflict: true,
                error: 'This workbook changed in iCloud.',
                state: changedState
              }
            : {
                ok: true,
                metadata: resolvedState.workbooks[0],
                state: resolvedState
              };
        }
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: remoteWorkbook,
            metadata: changedState.workbooks[0],
            state: changedState
          };
        }
        return {
          ok: true,
          state: command === 'clearConflictNotice' ? resolvedState : changedState
        };
      }),
      subscribe: () => () => {}
    };
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn();
    const syncStorage = createSyncStorage(2, false, baseWorkbook);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        workbookStorage: {
          load: async () => ({ status: 'loaded', workbook: localWorkbook })
        },
        saveStatus: 'saved',
        saveWorkbook,
        syncStorage,
        setWorkbook
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await result.current.execute('upload');
    });
    const savedWorkbook = saveWorkbook.mock.calls[0][0];
    expect(savedWorkbook.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared', description: 'Mac edit' }),
        expect.objectContaining({ id: 'mac-only' }),
        expect.objectContaining({ id: 'phone-only' })
      ])
    );
    expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: savedWorkbook,
      expectedRevision: 3,
      conflictResolution: 'keep_local'
    });
    expect(cloud.invoke).not.toHaveBeenCalledWith('publishConflictNotice', expect.anything());
    expect(result.current.model.current.conflict).toBe(false);
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      revision: 4,
      conflict: false,
      baseRevision: 4
    });
  });

  it('replaces legacy settings and timestamp decisions with the real transaction clash', async () => {
    const baseWorkbook = syncWorkbook('Shared Plan', [syncTransaction('shared', 'Original')]);
    const localWorkbook = cloneFixture(baseWorkbook);
    localWorkbook.updatedAt = '2026-08-30T05:00:00.000Z';
    localWorkbook.settings = {
      ...localWorkbook.settings,
      activeAdvisorThreadId: 'advisor-mac',
      dashboardLayout: ['cash']
    };
    localWorkbook.transactions[0].description = 'Mac edit';
    localWorkbook.transactions.push(syncTransaction('mac-only', 'Mac only'));
    const remoteWorkbook = cloneFixture(baseWorkbook);
    remoteWorkbook.updatedAt = '2026-08-30T05:01:00.000Z';
    remoteWorkbook.settings = {
      ...remoteWorkbook.settings,
      activeAdvisorThreadId: 'advisor-phone',
      dashboardLayout: ['net-worth']
    };
    remoteWorkbook.transactions[0].description = 'Phone edit';
    remoteWorkbook.transactions.push(syncTransaction('phone-only', 'Phone only'));
    const legacyNotice = {
      id: 'legacy-internal-review',
      sourceDevice: 'Mac',
      detectedAt: '2026-08-30T05:02:00.000Z',
      baseRevision: 2,
      remoteRevision: 3,
      summary: '3 changes need review',
      resolutionAvailable: true,
      report: {
        version: 1,
        workbookId: 'cloud-workbook',
        workbookName: 'Shared Plan',
        conflictCount: 3,
        omittedCount: 0,
        entries: [
          { path: 'settings', title: 'Settings' },
          { path: 'updatedAt', title: 'Updated At' },
          { path: 'transactions["shared"]', title: 'Original' }
        ]
      }
    };
    const conflictState = {
      ...signedInState(),
      workbooks: [
        {
          ...signedInState().workbooks[0],
          revision: 3,
          conflictNotice: legacyNotice
        }
      ]
    };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: conflictState };
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: remoteWorkbook,
            metadata: conflictState.workbooks[0],
            state: conflictState
          };
        }
        return { ok: true, state: conflictState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(2, true, baseWorkbook);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        syncStorage
      })
    );

    await waitFor(() =>
      expect(cloud.invoke).toHaveBeenCalledWith(
        'publishConflictNotice',
        expect.objectContaining({
          conflictNotice: expect.objectContaining({
            report: expect.objectContaining({
              conflictCount: 1,
              entries: [
                expect.objectContaining({
                  path: 'transactions["shared"]',
                  section: 'Transactions'
                })
              ]
            })
          })
        })
      )
    );
    const published = cloud.invoke.mock.calls
      .filter(([command]) => command === 'publishConflictNotice')
      .at(-1)[1].conflictNotice;
    expect(
      published.report.entries.some(({ path }) => ['$', 'settings', 'updatedAt'].includes(path))
    ).toBe(false);
    expect(result.current.model.current.conflict).toBe(true);
  });

  it('automatically settles a legacy whole-workbook review when both copies safely combine', async () => {
    const baseWorkbook = syncWorkbook('Shared Plan', [syncTransaction('shared', 'Original')]);
    const localWorkbook = cloneFixture(baseWorkbook);
    localWorkbook.settings = {
      ...localWorkbook.settings,
      activeAdvisorThreadId: 'advisor-mac'
    };
    localWorkbook.transactions.push(syncTransaction('mac-only', 'Mac only'));
    const remoteWorkbook = cloneFixture(baseWorkbook);
    remoteWorkbook.settings = {
      ...remoteWorkbook.settings,
      activeAdvisorThreadId: 'advisor-phone'
    };
    remoteWorkbook.transactions.push(syncTransaction('phone-only', 'Phone only'));
    const legacyNotice = {
      id: 'legacy-whole-workbook-review',
      sourceDevice: 'Mac',
      detectedAt: '2026-08-30T06:02:00.000Z',
      baseRevision: 2,
      remoteRevision: 3,
      summary: '1 change needs review',
      resolutionAvailable: true,
      report: {
        version: 1,
        workbookId: 'cloud-workbook',
        workbookName: 'Shared Plan',
        conflictCount: 1,
        omittedCount: 0,
        entries: [{ path: '$', title: 'Workbook' }]
      }
    };
    const conflictState = {
      ...signedInState(),
      workbooks: [
        {
          ...signedInState().workbooks[0],
          revision: 3,
          conflictNotice: legacyNotice
        }
      ]
    };
    const resolvedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 4 }]
    };
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: conflictState };
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: remoteWorkbook,
            metadata: conflictState.workbooks[0],
            state: conflictState
          };
        }
        if (command === 'uploadWorkbook') {
          return {
            ok: true,
            metadata: resolvedState.workbooks[0],
            state: resolvedState
          };
        }
        if (command === 'clearConflictNotice') return { ok: true, state: resolvedState };
        return { ok: true, state: conflictState, payload };
      }),
      subscribe: () => () => {}
    };
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn();
    const syncStorage = createSyncStorage(2, true, baseWorkbook);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        setWorkbook,
        syncStorage
      })
    );

    await waitFor(() => expect(saveWorkbook).toHaveBeenCalled());
    await waitFor(() => expect(result.current.model.current.conflict).toBe(false));
    expect(
      cloud.invoke.mock.calls.filter(([command]) => command === 'publishConflictNotice')
    ).toHaveLength(0);
    const mergedWorkbook = saveWorkbook.mock.calls[0][0];
    expect(mergedWorkbook.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared' }),
        expect.objectContaining({ id: 'mac-only' }),
        expect.objectContaining({ id: 'phone-only' })
      ])
    );
    expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: mergedWorkbook,
      expectedRevision: 3,
      conflictResolution: 'keep_local'
    });
    expect(cloud.invoke).toHaveBeenCalledWith('clearConflictNotice', {
      workbookId: 'cloud-workbook'
    });
  });

  it('reconciles a shared conflict on the Mac even when the iPhone reported it', async () => {
    const baseWorkbook = syncWorkbook('Shared Plan', [syncTransaction('shared', 'Original')]);
    const sourceWorkbook = cloneFixture(baseWorkbook);
    sourceWorkbook.transactions[0].description = 'Mac edit';
    sourceWorkbook.transactions.push(syncTransaction('mac-only', 'Mac only'));
    const currentWorkbook = cloneFixture(baseWorkbook);
    currentWorkbook.transactions[0].description = 'Phone edit';
    currentWorkbook.transactions.push(syncTransaction('phone-only', 'Phone only'));
    const conflictNotice = {
      id: 'conflict-from-mac',
      sourceDevice: 'iPhone',
      detectedAt: '2026-08-30T03:00:00.000Z',
      baseRevision: 2,
      remoteRevision: 3,
      summary: '1 change needs review',
      resolutionAvailable: true,
      report: {
        version: 1,
        workbookId: 'cloud-workbook',
        workbookName: 'Shared Plan',
        conflictCount: 1,
        omittedCount: 0,
        entries: [
          {
            key: 'transactions:shared',
            path: 'transactions["shared"]',
            kind: 'same_record_changed',
            section: 'Transactions',
            title: 'Original',
            message: 'Both copies changed this item differently.',
            local: { label: 'This iPhone', action: 'edited', details: [] },
            remote: { label: 'iCloud copy', action: 'edited', details: [] }
          }
        ]
      }
    };
    const reviewingState = {
      ...signedInState(),
      workbooks: [
        {
          ...signedInState().workbooks[0],
          revision: 3,
          conflictNotice
        }
      ]
    };
    const resolvedState = {
      ...reviewingState,
      workbooks: [{ ...reviewingState.workbooks[0], revision: 4, conflictNotice: undefined }]
    };
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: reviewingState };
        if (command === 'downloadConflictPackage') {
          return {
            ok: true,
            conflictNoticeId: payload.conflictNoticeId,
            sourceWorkbook,
            baseWorkbook
          };
        }
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: currentWorkbook,
            metadata: reviewingState.workbooks[0],
            state: reviewingState
          };
        }
        if (command === 'uploadWorkbook') {
          return {
            ok: true,
            metadata: resolvedState.workbooks[0],
            state: resolvedState
          };
        }
        if (command === 'clearConflictNotice') {
          return { ok: true, state: resolvedState };
        }
        return { ok: true, state: reviewingState };
      }),
      subscribe: () => () => {}
    };
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const syncStorage = createSyncStorage(3, false, currentWorkbook);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: currentWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        syncStorage
      })
    );
    await waitFor(() =>
      expect(result.current.model.current.conflictNotice).toMatchObject({
        id: 'conflict-from-mac',
        resolutionAvailable: true
      })
    );

    let resolved;
    await act(async () => {
      resolved = await result.current.execute('reconcile', {
        conflictNoticeId: 'conflict-from-mac',
        choices: [{ path: 'transactions["shared"]', side: 'local' }]
      });
    });

    expect(resolved).toMatchObject({ ok: true, reconciled: true });
    expect(saveWorkbook.mock.calls[0][0].transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared', description: 'Mac edit' }),
        expect.objectContaining({ id: 'mac-only' }),
        expect.objectContaining({ id: 'phone-only' })
      ])
    );
    expect(cloud.invoke).toHaveBeenCalledWith('downloadConflictPackage', {
      workbookId: 'cloud-workbook',
      conflictNoticeId: 'conflict-from-mac'
    });
    expect(cloud.invoke).toHaveBeenCalledWith('clearConflictNotice', {
      workbookId: 'cloud-workbook'
    });
  });

  it('persists the acknowledged LWW result without a legacy conflict latch across remounts', async () => {
    const baseWorkbook = syncWorkbook('Shared Plan', [syncTransaction('shared', 'Original')]);
    const localWorkbook = cloneFixture(baseWorkbook);
    localWorkbook.transactions[0].description = 'Mac edit';
    const remoteWorkbook = cloneFixture(baseWorkbook);
    remoteWorkbook.transactions[0].description = 'Phone edit';
    const baseState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 7 }]
    };
    const latestState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 8 }]
    };
    const resolvedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 9 }]
    };
    let serverState = baseState;
    let uploadCount = 0;
    const syncStorage = createSyncStorage(7, false, baseWorkbook);
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: serverState };
        if (command === 'uploadWorkbook') {
          uploadCount += 1;
          if (uploadCount === 1) {
            serverState = latestState;
            return {
              ok: false,
              code: 'workbook_revision_conflict',
              conflict: true,
              error: 'This workbook changed in Cavalry Cloud.',
              state: latestState
            };
          }
          serverState = resolvedState;
          return {
            ok: true,
            metadata: { ...resolvedState.workbooks[0], id: 'cloud-workbook' },
            state: resolvedState
          };
        }
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: remoteWorkbook,
            metadata: latestState.workbooks[0],
            state: latestState
          };
        }
        return { ok: true, state: latestState };
      }),
      subscribe: () => () => {}
    };
    const first = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        saveWorkbook: async () => ({ ok: true }),
        setWorkbook: (nextWorkbook) => nextWorkbook,
        syncStorage
      })
    );
    await waitFor(() => expect(first.result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await first.result.current.execute('upload');
    });
    expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: localWorkbook,
      expectedRevision: 7
    });
    expect(first.result.current.model.current).toMatchObject({
      conflict: false,
      revision: 9,
      status: 'synced'
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      revision: 9,
      conflict: false,
      baseRevision: 9
    });
    first.unmount();

    const second = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: localWorkbook,
        syncStorage
      })
    );
    await waitFor(() => expect(second.result.current.model.current.revision).toBe(9));
    expect(second.result.current.model.current.conflict).toBe(false);
  });

  it('adopts a completed resolution from the other device', async () => {
    const conflictedWorkbook = syncWorkbook('Shared Plan', [
      syncTransaction('shared', 'Unresolved Mac copy')
    ]);
    const resolvedWorkbook = syncWorkbook('Shared Plan', [
      syncTransaction('shared', 'Resolved on iPhone')
    ]);
    const conflictNotice = {
      id: 'conflict-before-iphone-resolution',
      sourceDevice: 'Mac',
      detectedAt: '2026-08-30T03:00:00.000Z',
      baseRevision: 4,
      remoteRevision: 5,
      summary: '1 change needs review',
      resolutionAvailable: true,
      report: {
        version: 1,
        workbookId: 'cloud-workbook',
        workbookName: 'Shared Plan',
        conflictCount: 1,
        omittedCount: 0,
        entries: [
          {
            key: 'transactions:shared',
            path: 'transactions["shared"]',
            kind: 'same_record_changed',
            section: 'Transactions',
            title: 'Unresolved Mac copy',
            message: 'Both copies changed this item differently.',
            local: { label: 'This Mac', action: 'edited', details: [] },
            remote: { label: 'iCloud copy', action: 'edited', details: [] }
          }
        ]
      }
    };
    const conflictState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 5, conflictNotice }]
    };
    const resolvedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 6 }]
    };
    let listener = null;
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: conflictState };
        if (command === 'downloadWorkbook') {
          return {
            ok: true,
            workbook: resolvedWorkbook,
            metadata: resolvedState.workbooks[0],
            state: resolvedState
          };
        }
        return { ok: true, state: resolvedState };
      }),
      subscribe: vi.fn((callback) => {
        listener = callback;
        return () => {};
      })
    };
    const syncStorage = createSyncStorage(4, true, conflictedWorkbook);
    writeCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook', {
      revision: 4,
      conflict: true,
      conflictNoticeId: conflictNotice.id,
      conflictRemoteRevision: 5
    });
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: conflictedWorkbook,
        saveStatus: 'saved',
        saveWorkbook,
        setWorkbook,
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.current.conflict).toBe(true));

    act(() => listener({ state: resolvedState }));

    await waitFor(() =>
      expect(setWorkbook).toHaveBeenCalledWith(resolvedWorkbook, {
        source: 'cloud-merge',
        markDirty: true
      })
    );
    await waitFor(() => expect(result.current.model.current.conflict).toBe(false));
    expect(saveWorkbook).toHaveBeenCalledWith(resolvedWorkbook);
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      revision: 6,
      conflict: false,
      baseRevision: 6,
      baseWorkbook: resolvedWorkbook
    });
  });

  it('prevents a same-tick duplicate upload from reaching the main process', async () => {
    let resolveUpload;
    const uploadResult = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    const cloud = {
      invoke: vi.fn((command) => {
        if (command === 'getState') return Promise.resolve({ ok: true, state: signedInState() });
        if (command === 'uploadWorkbook') return uploadResult;
        return Promise.resolve({ ok: true, state: signedInState() });
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(2);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Cloud Plan' },
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let firstUpload;
    act(() => {
      firstUpload = result.current.execute('upload');
    });
    let duplicateUpload;
    await act(async () => {
      duplicateUpload = await result.current.execute('upload');
    });

    expect(duplicateUpload).toMatchObject({
      ok: false,
      code: 'cloud_operation_in_progress'
    });
    expect(
      cloud.invoke.mock.calls.filter(([command]) => command === 'uploadWorkbook')
    ).toHaveLength(1);

    let firstResult;
    await act(async () => {
      resolveUpload({ ok: true, state: signedInState() });
      firstResult = await firstUpload;
    });
    expect(firstResult).toMatchObject({ ok: true });
  });

  it('records a slow upload against the workbook that started it', async () => {
    let resolveUpload;
    const uploadResult = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    const syncStorage = createSyncStorage(2);
    const cloud = {
      invoke: vi.fn((command) => {
        if (command === 'getState') return Promise.resolve({ ok: true, state: signedInState() });
        if (command === 'uploadWorkbook') return uploadResult;
        return Promise.resolve({ ok: true, state: signedInState() });
      }),
      subscribe: () => () => {}
    };
    const hook = renderHook(
      ({ workbook }) =>
        useCloudWorkbookController({
          cloud,
          workbook,
          syncStorage
        }),
      {
        initialProps: {
          workbook: { id: 'cloud-workbook', name: 'Cloud Plan' }
        }
      }
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    let pendingUpload;
    act(() => {
      pendingUpload = hook.result.current.execute('upload');
    });
    hook.rerender({ workbook: { id: 'other-workbook', name: 'Other Plan' } });

    await act(async () => {
      resolveUpload({
        ok: true,
        metadata: { id: 'cloud-workbook', revision: 3 },
        state: {
          ...signedInState(),
          workbooks: [{ ...signedInState().workbooks[0], revision: 3 }]
        }
      });
      await pendingUpload;
    });

    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toMatchObject({
      known: true,
      revision: 3,
      conflict: false,
      baseRevision: 3,
      baseWorkbook: { id: 'cloud-workbook', name: 'Cloud Plan' }
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'other-workbook').known).toBe(false);
    expect(hook.result.current.model.current.workbookId).toBe('other-workbook');
  });

  it('does not attach a slow conflict to a workbook opened afterward', async () => {
    let resolveUpload;
    const uploadResult = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    const syncStorage = createSyncStorage(2);
    const cloud = {
      invoke: vi.fn((command) => {
        if (command === 'getState') return Promise.resolve({ ok: true, state: signedInState() });
        if (command === 'uploadWorkbook') return uploadResult;
        return Promise.resolve({ ok: true, state: signedInState() });
      }),
      subscribe: () => () => {}
    };
    const hook = renderHook(
      ({ workbook }) =>
        useCloudWorkbookController({
          cloud,
          workbook,
          syncStorage
        }),
      {
        initialProps: {
          workbook: { id: 'cloud-workbook', name: 'Cloud Plan' }
        }
      }
    );
    await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));

    let pendingUpload;
    act(() => {
      pendingUpload = hook.result.current.execute('upload');
    });
    hook.rerender({ workbook: { id: 'other-workbook', name: 'Other Plan' } });

    await act(async () => {
      resolveUpload({
        ok: false,
        code: 'workbook_revision_conflict',
        conflict: true,
        error: 'This workbook changed in Cavalry Cloud.',
        state: {
          ...signedInState(),
          workbooks: [{ ...signedInState().workbooks[0], revision: 3 }]
        }
      });
      await pendingUpload;
    });

    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toEqual({
      known: true,
      revision: 2,
      conflict: false
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'other-workbook').known).toBe(false);
    expect(hook.result.current.model.current).toMatchObject({
      workbookId: 'other-workbook',
      conflict: false
    });
  });

  it('rejects mismatched workbook metadata from an upload response', async () => {
    const syncStorage = createSyncStorage(2);
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'uploadWorkbook') {
          return {
            ok: true,
            metadata: { id: 'other-workbook', revision: 3 },
            state: signedInState()
          };
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Cloud Plan' },
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let uploaded;
    await act(async () => {
      uploaded = await result.current.execute('upload');
    });

    expect(uploaded).toMatchObject({
      ok: false,
      code: 'cloud_workbook_identity_mismatch'
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook').revision).toBe(2);
  });
});
