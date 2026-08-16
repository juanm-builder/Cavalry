import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  readCloudWorkbookSyncState,
  writeCloudWorkbookSyncState
} from '../../src/renderer/app/cloud-workbook-sync-state.js';
import { useCloudWorkbookController } from '../../src/renderer/app/use-cloud-workbook-controller.js';
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

function createSyncStorage(revision = null, conflict = false) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  if (revision || conflict) {
    writeCloudWorkbookSyncState(storage, 'user-1', 'cloud-workbook', {
      revision,
      conflict
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
    }
  };
}

describe('cloud workbook controller interactions', () => {
  it('automatically uploads the latest workbook after its local file save succeeds', async () => {
    const timers = createAutoSyncTimers();
    const initialState = { ...signedInState(), workbooks: [] };
    let uploadedRevision = 0;
    const cloud = {
      invoke: vi.fn(async (command) => {
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
    await act(async () => {
      expect(timers.runLatest().delay).toBe(800);
      await vi.waitFor(() =>
        expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
          workbook: { id: 'cloud-workbook', name: 'Latest local plan' },
          expectedRevision: null
        })
      );
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toEqual({
      known: true,
      revision: 1,
      conflict: false
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
    await act(async () => {
      timers.runLatest();
      await vi.waitFor(() =>
        expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
          workbook: { id: 'cloud-workbook', name: 'Second saved plan' },
          expectedRevision: 1
        })
      );
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook').revision).toBe(2);
  });

  it('ignores a realtime echo of the exact acknowledged revision', async () => {
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
    const syncStorage = createSyncStorage(2);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Cloud Plan' },
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
    const syncStorage = createSyncStorage(2);
    const setWorkbook = vi.fn();
    const saveWorkbook = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Revision two' },
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
      source: 'cloud-realtime',
      markDirty: true
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toEqual({
      known: true,
      revision: 3,
      conflict: false
    });
    expect(result.current.model.current.conflict).toBe(false);
  });

  it('latches a newer realtime revision instead of replacing unsaved local changes', async () => {
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
    await waitFor(() => expect(result.current.model.current.conflict).toBe(true));
    expect(setWorkbook).not.toHaveBeenCalled();
    expect(cloud.invoke).not.toHaveBeenCalledWith('downloadWorkbook', expect.anything());
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toEqual({
      known: true,
      revision: 2,
      conflict: true
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
        navigate
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
        navigate: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let opened;
    await act(async () => {
      opened = await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });

    expect(opened).toMatchObject({ ok: false });
    expect(result.current.model.error).toContain('disconnect the current file');
    expect(setWorkbook).not.toHaveBeenCalled();
  });

  it('does not overwrite the only cache copy of the active workbook', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.id = 'cloud-workbook';
    const cloud = makeCloud({ ok: true, workbook });
    const save = vi.fn(async () => ({ ok: true }));
    const forget = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'local-workbook' },
        browserCache: { save },
        workbookStorage: { forget },
        saveStatus: 'cache',
        setWorkbook: vi.fn(),
        navigate: vi.fn()
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

  it('shows the specific main-process sign-in failure', async () => {
    const signedOut = { configured: true, status: 'signed_out', user: null, workbooks: [] };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'signInWithGoogle') {
          return {
            ok: false,
            state: {
              ...signedOut,
              error: {
                code: 'google_sign_in_failed',
                message: 'Google sign-in could not be started.'
              }
            }
          };
        }
        return { ok: true, state: signedOut };
      }),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.status).toBe('signed_out'));

    await act(async () => {
      await result.current.execute('sign-in');
    });

    expect(result.current.model.error).toBe('Google sign-in could not be started.');
  });

  it('routes Apple sign-in through the named Cloud bridge method', async () => {
    const signedOut = { configured: true, status: 'signed_out', user: null, workbooks: [] };
    const cloud = {
      invoke: vi.fn(async () => ({ ok: true, state: signedOut })),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.status).toBe('signed_out'));

    await act(async () => {
      await result.current.execute('sign-in-apple');
    });

    expect(cloud.invoke).toHaveBeenCalledWith('signInWithApple', {});
  });

  it('routes Apple identity linking through the named Cloud bridge method', async () => {
    const cloud = {
      invoke: vi.fn(async (command) => ({
        ok: true,
        state:
          command === 'getState'
            ? signedInState()
            : {
                ...signedInState(),
                user: { ...signedInState().user, providers: ['google', 'apple'] }
              }
      })),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await result.current.execute('link-apple');
    });

    expect(cloud.invoke).toHaveBeenCalledWith('linkAppleIdentity', {});
    expect(result.current.model.user.providers).toContain('apple');
  });

  it('updates the Cavalry profile name and publishes the returned Cloud state', async () => {
    const updatedState = {
      ...signedInState(),
      user: { ...signedInState().user, name: 'Alex Example' }
    };
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'updateProfile') {
          return { ok: true, profile: { name: payload.name }, state: updatedState };
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.user?.name).toBe('Alex Example'));

    let updated;
    await act(async () => {
      updated = await result.current.execute('profile-update', { name: '  Alex Example  ' });
    });

    expect(updated).toMatchObject({ ok: true, profile: { name: 'Alex Example' } });
    expect(cloud.invoke).toHaveBeenCalledWith('updateProfile', { name: 'Alex Example' });
    expect(result.current.model.user?.name).toBe('Alex Example');
    expect(result.current.model.notice).toBe('Profile name updated.');
  });

  it('rejects invalid profile names before invoking the main process', async () => {
    const cloud = makeCloud();
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await result.current.execute('profile-update', { name: '   ' });
    });

    expect(result.current.model.error).toBe('Enter a profile name.');
    expect(cloud.invoke).not.toHaveBeenCalledWith('updateProfile', expect.anything());
  });

  it('clears a deleted Cloud link so the local workbook can be added again deliberately', async () => {
    let uploadCount = 0;
    const recreatedState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 1 }]
    };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
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
            : { ok: true, state: recreatedState };
        }
        return { ok: true, state: recreatedState };
      }),
      subscribe: () => () => {}
    };
    const syncStorage = createSyncStorage(2);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Local Plan' },
        syncStorage
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let conflicted;
    await act(async () => {
      conflicted = await result.current.execute('upload');
    });
    expect(conflicted.error).toContain('no longer exists');
    expect(result.current.model.current).toMatchObject({
      conflict: false,
      linked: false,
      status: 'local_only'
    });

    let recreated;
    await act(async () => {
      recreated = await result.current.execute('upload');
    });
    expect(recreated).toMatchObject({ ok: true });
    expect(cloud.invoke).toHaveBeenLastCalledWith('uploadWorkbook', {
      workbook: { id: 'cloud-workbook', name: 'Local Plan' },
      expectedRevision: null
    });
    expect(result.current.model.current).toMatchObject({
      conflict: false,
      linked: true,
      revision: 1
    });
  });

  it('latches a newer Cloud copy until the saved local workbook is explicitly replaced', async () => {
    const downloadedWorkbook = cloneFixture(makeMinimalWorkbook());
    downloadedWorkbook.id = 'cloud-workbook';
    downloadedWorkbook.name = 'Newer Cloud Plan';
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
          return { ok: true, workbook: downloadedWorkbook, state: changedState };
        }
        return { ok: true, state: changedState };
      }),
      subscribe: () => () => {}
    };
    const forget = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn();
    const syncStorage = createSyncStorage(2);
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Stale Local Plan' },
        browserCache: { save: vi.fn(async () => ({ ok: true })) },
        workbookStorage: {
          forget,
          load: async () => ({
            status: 'loaded',
            workbook: { id: 'cloud-workbook', name: 'Stale Local Plan' }
          })
        },
        saveStatus: 'saved',
        syncStorage,
        setWorkbook,
        navigate: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let conflicted;
    await act(async () => {
      conflicted = await result.current.execute('upload');
    });
    expect(conflicted).toMatchObject({ ok: false, code: 'workbook_revision_conflict' });
    expect(result.current.model.current).toMatchObject({
      conflict: true,
      revision: 3,
      status: 'conflict'
    });

    let blockedUpload;
    await act(async () => {
      blockedUpload = await result.current.execute('upload');
    });
    expect(blockedUpload).toMatchObject({ ok: false, code: 'workbook_revision_conflict' });
    expect(
      cloud.invoke.mock.calls.filter(([command]) => command === 'uploadWorkbook')
    ).toHaveLength(1);

    let opened;
    await act(async () => {
      opened = await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });
    expect(opened).toMatchObject({ ok: true, workbook: downloadedWorkbook });
    expect(cloud.invoke).toHaveBeenCalledWith('downloadWorkbook', {
      workbookId: 'cloud-workbook'
    });
    expect(forget).toHaveBeenCalledOnce();
    expect(setWorkbook).toHaveBeenCalledWith(downloadedWorkbook, {
      source: 'cloud',
      markDirty: false,
      saveStatus: 'cache'
    });
    expect(result.current.model.current.conflict).toBe(false);
  });

  it('keeps the acknowledged revision and conflict latch across a remount', async () => {
    const baseState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 7 }]
    };
    const latestState = {
      ...signedInState(),
      workbooks: [{ ...signedInState().workbooks[0], revision: 8 }]
    };
    let serverState = baseState;
    const syncStorage = createSyncStorage(7);
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { ok: true, state: serverState };
        if (command === 'uploadWorkbook') {
          serverState = latestState;
          return {
            ok: false,
            code: 'workbook_revision_conflict',
            conflict: true,
            error: 'This workbook changed in Cavalry Cloud.',
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
        workbook: { id: 'cloud-workbook', name: 'Stale Local Plan' },
        syncStorage
      })
    );
    await waitFor(() => expect(first.result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await first.result.current.execute('upload');
    });
    expect(cloud.invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: { id: 'cloud-workbook', name: 'Stale Local Plan' },
      expectedRevision: 7
    });
    expect(first.result.current.model.current.conflict).toBe(true);
    first.unmount();

    const second = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'cloud-workbook', name: 'Stale Local Plan' },
        syncStorage
      })
    );
    await waitFor(() => expect(second.result.current.model.current.conflict).toBe(true));

    let blocked;
    await act(async () => {
      blocked = await second.result.current.execute('upload');
    });
    expect(blocked).toMatchObject({ ok: false, code: 'workbook_revision_conflict' });
    expect(
      cloud.invoke.mock.calls.filter(([command]) => command === 'uploadWorkbook')
    ).toHaveLength(1);
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

    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'cloud-workbook')).toEqual({
      known: true,
      revision: 3,
      conflict: false
    });
    expect(readCloudWorkbookSyncState(syncStorage, 'user-1', 'other-workbook').known).toBe(false);
    expect(hook.result.current.model.current.workbookId).toBe('other-workbook');
  });

  it('records a slow conflict against the workbook that started it', async () => {
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
      conflict: true
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
