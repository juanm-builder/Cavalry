import { useRef, useState } from 'react';
import { useCloudWorkbookSaveAcknowledgement } from '../../src/renderer/app/use-cloud-workbook-save-acknowledgement.js';
import { createRequire } from 'node:module';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCloudWorkbookController } from '../../src/renderer/app/use-cloud-workbook-controller.js';
import {
  readCloudWorkbookSyncState,
  writeCloudWorkbookAutoSyncPreference,
  writeCloudWorkbookSyncState
} from '../../src/renderer/app/cloud-workbook-sync-state.js';

const require = createRequire(import.meta.url);
const { createCloudKitAccountRouter } = require('../../src/host/cloudkit-account-router.cjs');
const {
  createCloudController,
  CLOUD_IPC_CHANNELS
} = require('../../src/host/cloud-controller.cjs');
const { CONTAINER, ENVIRONMENT } = require('../../src/host/cloudkit-web-api.cjs');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

async function harness(initialRevision) {
  const owner = 'owner-b';
  const workbook = { id: 'current-book', name: 'Local plan', year: 2026, currency: 'PHP' };
  const disk = new Map([
    [
      'selection',
      {
        version: 1,
        source: 'browser',
        paused: false,
        signedOut: false,
        userId: owner,
        environment: ENVIRONMENT
      }
    ],
    [
      `browser-session:${owner}`,
      {
        userId: owner,
        token: 'synthetic-session-token',
        container: CONTAINER,
        environment: ENVIRONMENT
      }
    ]
  ]);
  const remote = new Map(
    initialRevision ? [[workbook.id, { ...workbook, revision: initialRevision }]] : []
  );
  const remotePayloads = new Map(initialRevision ? [[workbook.id, JSON.stringify(workbook)]] : []);
  const failures = new Set([workbook.id, 'other-book']);
  const saves = [];
  const downloads = [];
  const downloadControl = { fail: false, wait: null };
  const listeners = new Set();
  const router = createCloudKitAccountRouter({
    userDataDir: '/unused',
    config: { apiToken: 'synthetic-public-api-token' },
    storage: {
      read: async (key) => disk.get(key) || null,
      write: async (key, value) => disk.set(key, structuredClone(value)),
      remove: async (key) => disk.delete(key)
    },
    native: { request: async () => ({ ok: true }) },
    createApi:
      ({ session }) =>
      async () => ({ userRecordName: session.userId }),
    createLibrary: () => ({
      request: async (payload) => {
        if (payload.operation === 'list') return { ok: true, workbooks: [...remote.values()] };
        if (payload.operation === 'download') {
          downloads.push(payload);
          if (downloadControl.wait) await downloadControl.wait;
          return downloadControl.fail
            ? {
                ok: false,
                code: 'cloud_asset_request_failed',
                retryable: true,
                error: 'The saved snapshot could not be downloaded.'
              }
            : {
                ok: true,
                workbook: {
                  metadata: remote.get(payload.workbookId),
                  portableHtml: remotePayloads.get(payload.workbookId)
                }
              };
        }
        if (payload.operation !== 'save') throw new Error(`Unexpected ${payload.operation}`);
        if (failures.has(payload.workbookId))
          return {
            ok: false,
            code: 'cloudkit_request_rejected',
            error: 'This save did not complete.',
            retryable: false
          };
        saves.push(payload);
        const metadata = {
          id: payload.workbookId,
          name: payload.name,
          revision: (remote.get(payload.workbookId)?.revision || 0) + 1
        };
        remote.set(payload.workbookId, metadata);
        remotePayloads.set(payload.workbookId, payload.portableHtml);
        return { ok: true, metadata, pending: false };
      }
    })
  });
  const handlers = new Map();
  const controller = createCloudController({
    cloudKit: router,
    assertTrustedSender: () => {},
    getPersistenceService: async () => ({
      serializeWorkbookForSave: (value) => ({ html: JSON.stringify(value) }),
      deserializeWorkbookFromFile: (html) => ({ workbook: JSON.parse(html) })
    }),
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    BrowserWindow: {
      getAllWindows: () => [
        {
          webContents: {
            send: (_channel, state) => listeners.forEach((listener) => listener(state))
          }
        }
      ]
    }
  });
  controller.registerHandlers();
  await controller.initialize();
  const cloud = {
    invoke: vi.fn((command, payload) => handlers.get(CLOUD_IPC_CHANNELS[command])({}, payload)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  const syncStorage = memoryStorage();
  if (initialRevision)
    writeCloudWorkbookSyncState(syncStorage, owner, workbook.id, {
      revision: initialRevision,
      conflict: false,
      baseRevision: initialRevision,
      baseWorkbook: workbook
    });
  return {
    owner,
    workbook,
    cloud,
    controller,
    router,
    syncStorage,
    failures,
    saves,
    listeners,
    disk,
    remote,
    remotePayloads,
    downloads,
    downloadControl
  };
}

describe('Browser outbox save acknowledgments through the host and renderer', () => {
  it.each([0, 2])(
    'recovers revision %i without another renderer upload and isolates other saves',
    async (revision) => {
      const h = await harness(revision);
      const hook = renderHook(() =>
        useCloudWorkbookController({
          cloud: h.cloud,
          workbook: h.workbook,
          syncStorage: h.syncStorage
        })
      );
      try {
        await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));
        let failed;
        await act(async () => {
          failed = await hook.result.current.execute('upload');
        });
        expect(failed).toMatchObject({ ok: false, saveOperationId: expect.any(String) });
        expect(hook.result.current.model.current.status).toBe('attention');

        await h.router.request({
          operation: 'save',
          workbookId: 'other-book',
          portableHtml: 'synthetic'
        });
        h.failures.delete('other-book');
        await act(async () => {
          await h.controller.restoreExistingSession();
        });
        expect(hook.result.current.model.current.status).toBe('attention');
        expect(hook.result.current.model.error).toBe('This save did not complete.');
        expect(h.controller.getState().workbookSaveAcknowledgements).toEqual([
          expect.objectContaining({ userId: h.owner, workbookId: 'other-book' })
        ]);

        act(() =>
          h.listeners.forEach((listener) =>
            listener({
              ...h.controller.getState(),
              error: '',
              workbookSaveAcknowledgements: [
                {
                  id: failed.saveOperationId,
                  userId: 'owner-c',
                  workbookId: h.workbook.id,
                  revision: revision + 1
                }
              ]
            })
          )
        );
        expect(hook.result.current.model.current.status).toBe('attention');

        h.failures.delete(h.workbook.id);
        await act(async () => {
          await h.controller.restoreExistingSession();
        });
        await waitFor(() =>
          expect(hook.result.current.model).toMatchObject({
            error: '',
            current: { status: 'synced', revision: revision + 1 }
          })
        );
        expect(
          h.cloud.invoke.mock.calls.filter(([command]) => command === 'uploadWorkbook')
        ).toHaveLength(1);
        expect(h.saves.filter((payload) => payload.workbookId === h.workbook.id)).toHaveLength(1);
        expect(readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id)).toMatchObject({
          revision: revision + 1,
          baseRevision: revision + 1,
          baseWorkbook: h.workbook,
          conflict: false
        });
        expect(h.disk.get(`outbox:${CONTAINER}:${ENVIRONMENT}:${h.owner}`)).toEqual([]);

        h.failures.add(h.workbook.id);
        await act(async () => {
          await hook.result.current.execute('upload');
        });
        await act(async () => {
          await h.controller.restoreExistingSession();
        });
        expect(hook.result.current.model.current.status).toBe('attention');
        expect(hook.result.current.model.error).toBeTruthy();
      } finally {
        hook.unmount();
        h.controller.dispose();
      }
    }
  );
  it('establishes the first merge base after relaunch without an in-memory failed upload', async () => {
    const h = await harness(0);
    await h.router.request({
      operation: 'save',
      workbookId: h.workbook.id,
      portableHtml: JSON.stringify(h.workbook)
    });
    h.failures.delete(h.workbook.id);
    await h.controller.restoreExistingSession();
    const hook = renderHook(() =>
      useCloudWorkbookController({
        cloud: h.cloud,
        workbook: h.workbook,
        syncStorage: h.syncStorage
      })
    );
    try {
      await waitFor(() =>
        expect(readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id)).toMatchObject({
          revision: 1,
          conflict: false,
          baseRevision: 1,
          baseWorkbook: h.workbook
        })
      );
      expect(hook.result.current.model.current.status).toBe('synced');
      expect(h.downloads).toHaveLength(1);
      expect(
        h.cloud.invoke.mock.calls.filter(([command]) => command === 'uploadWorkbook')
      ).toHaveLength(0);
    } finally {
      hook.unmount();
      h.controller.dispose();
    }
  });

  it('keeps newer local edits while establishing the exact saved merge base', async () => {
    const h = await harness(0);
    const setWorkbook = vi.fn();
    const hook = renderHook(
      ({ workbook }) =>
        useCloudWorkbookController({
          cloud: h.cloud,
          workbook,
          syncStorage: h.syncStorage,
          saveStatus: 'dirty',
          setWorkbook
        }),
      { initialProps: { workbook: h.workbook } }
    );
    try {
      await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));
      await act(async () => {
        await hook.result.current.execute('upload');
      });
      const edited = { ...h.workbook, name: 'Newer local edits' };
      hook.rerender({ workbook: edited });
      h.failures.delete(h.workbook.id);
      await act(async () => {
        await h.controller.restoreExistingSession();
      });
      await waitFor(() =>
        expect(readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id)).toMatchObject({
          revision: 1,
          baseWorkbook: h.workbook,
          conflict: false
        })
      );
      expect(setWorkbook).not.toHaveBeenCalled();
      expect(edited.name).toBe('Newer local edits');
      expect(h.saves).toHaveLength(1);
      await act(async () => {
        await hook.result.current.execute('upload');
      });
      expect(h.saves.at(-1)).toMatchObject({ expectedRevision: 1, name: edited.name });
    } finally {
      hook.unmount();
      h.controller.dispose();
    }
  });

  it('does not use a later server revision as the acknowledged first-save baseline', async () => {
    const h = await harness(0);
    await h.router.request({
      operation: 'save',
      workbookId: h.workbook.id,
      portableHtml: JSON.stringify(h.workbook)
    });
    h.failures.delete(h.workbook.id);
    await h.controller.restoreExistingSession();
    writeCloudWorkbookAutoSyncPreference(h.syncStorage, h.owner, h.workbook.id, false);
    h.remote.set(h.workbook.id, { ...h.remote.get(h.workbook.id), revision: 2 });
    h.remotePayloads.set(
      h.workbook.id,
      JSON.stringify({ ...h.workbook, name: 'Changed on another device' })
    );
    const hook = renderHook(() =>
      useCloudWorkbookController({
        cloud: h.cloud,
        workbook: h.workbook,
        syncStorage: h.syncStorage
      })
    );
    try {
      await waitFor(() => expect(h.downloads).toHaveLength(1));
      expect(
        readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id).baseWorkbook
      ).toBeUndefined();
      expect(h.downloads).toHaveLength(1);
    } finally {
      hook.unmount();
      h.controller.dispose();
    }
  });

  it('retains a verification failure without immediately redownloading in a loop', async () => {
    const h = await harness(0);
    await h.router.request({
      operation: 'save',
      workbookId: h.workbook.id,
      portableHtml: JSON.stringify(h.workbook)
    });
    h.failures.delete(h.workbook.id);
    await h.controller.restoreExistingSession();
    h.downloadControl.fail = true;
    const hook = renderHook(() =>
      useCloudWorkbookController({
        cloud: h.cloud,
        workbook: h.workbook,
        syncStorage: h.syncStorage
      })
    );
    try {
      await waitFor(() =>
        expect(hook.result.current.model.errorCode).toBe('cloud_save_confirmation_failed')
      );
      await act(async () => {
        await h.controller.restoreExistingSession();
      });
      expect(h.downloads).toHaveLength(1);
      expect(readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id).known).toBe(false);
      h.downloadControl.fail = false;
      await act(async () => {
        await hook.result.current.execute('retry-sync-state');
      });
      await waitFor(() =>
        expect(readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id).revision).toBe(1)
      );
      expect(h.downloads).toHaveLength(2);
    } finally {
      hook.unmount();
      h.controller.dispose();
    }
  });

  it('ignores a saved snapshot arriving after the selected account changes', async () => {
    const h = await harness(0);
    await h.router.request({
      operation: 'save',
      workbookId: h.workbook.id,
      portableHtml: JSON.stringify(h.workbook)
    });
    h.failures.delete(h.workbook.id);
    await h.controller.restoreExistingSession();
    let finish;
    h.downloadControl.wait = new Promise((resolve) => {
      finish = resolve;
    });
    const hook = renderHook(() =>
      useCloudWorkbookController({
        cloud: h.cloud,
        workbook: h.workbook,
        syncStorage: h.syncStorage
      })
    );
    try {
      await waitFor(() => expect(h.downloads).toHaveLength(1));
      act(() =>
        h.listeners.forEach((listener) =>
          listener({
            ...h.controller.getState(),
            user: { id: 'owner-c' },
            sessionGeneration: h.controller.getState().sessionGeneration + 1,
            workbooks: [],
            workbookSaveAcknowledgements: []
          })
        )
      );
      await act(async () => {
        finish();
        await h.downloadControl.wait;
      });
      expect(readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id).known).toBe(false);
      expect(readCloudWorkbookSyncState(h.syncStorage, 'owner-c', h.workbook.id).known).toBe(false);
      expect(hook.result.current.model.user.id).toBe('owner-c');
    } finally {
      hook.unmount();
      h.controller.dispose();
    }
  });
  it('keeps a durable anchor failure visible despite the newer in-memory revision', async () => {
    const workbook = { id: 'saved-workbook', name: 'Saved plan' };
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const cloudState = {
      status: 'signed_in',
      user: { id: 'owner-b' },
      sessionGeneration: 1,
      workbookSaveAcknowledgements: [
        { id, userId: 'owner-b', workbookId: workbook.id, revision: 1 }
      ]
    };
    const storage = memoryStorage();
    const flush = vi.fn(async () => ({ ok: false, error: 'Disk write failed.' }));
    const invoke = vi.fn(async () => ({
      ok: true,
      metadata: { id: workbook.id, revision: 1 },
      workbook
    }));
    const applyRemoteState = vi.fn();
    const emptyState = { error: '', errorSaveOperationId: '', pendingOperation: '' };
    const hook = renderHook(() => {
      const [uiState, setUiState] = useState({
        ...emptyState,
        error: 'Previous save failed.',
        errorSaveOperationId: id,
        errorOperation: 'upload'
      });
      const stateRef = useRef(cloudState);
      const workbookRef = useRef(workbook);
      const saveStatusRef = useRef('dirty');
      const pendingOperationRef = useRef('');
      const autoSyncSchedulerRef = useRef(null);
      useCloudWorkbookSaveAcknowledgement({
        cloudState,
        workbook,
        uiState,
        stateRef,
        workbookRef,
        saveStatusRef,
        resolvedSyncStorage: storage,
        syncAnchorHydrated: true,
        accountChangePending: false,
        pendingOperationRef,
        autoSyncSchedulerRef,
        invoke,
        applyRemoteState,
        flushDurableSyncState: flush,
        setUiState,
        emptyState
      });
      return uiState;
    });
    try {
      await waitFor(() =>
        expect(hook.result.current.errorCode).toBe('cloud_save_confirmation_failed')
      );
      expect(readCloudWorkbookSyncState(storage, 'owner-b', workbook.id).revision).toBe(1);
      hook.rerender();
      await act(async () => {});
      expect(hook.result.current.error).toBe('Disk write failed.');
      expect(flush).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally {
      hook.unmount();
    }
  });
  it('defers an autosaved edit during confirmation then uploads it with the verified revision', async () => {
    const h = await harness(0);
    const schedulerOptions = { debounceMs: 0 };
    const hook = renderHook(
      ({ workbook, saveStatus, sequence }) =>
        useCloudWorkbookController({
          cloud: h.cloud,
          workbook,
          syncStorage: h.syncStorage,
          saveStatus,
          localSaveSequence: sequence,
          autoSyncSchedulerOptions: schedulerOptions
        }),
      { initialProps: { workbook: h.workbook, saveStatus: 'dirty', sequence: 0 } }
    );
    try {
      await waitFor(() => expect(hook.result.current.model.status).toBe('signed_in'));
      await act(async () => {
        await hook.result.current.execute('upload');
      });
      let finish;
      h.downloadControl.wait = new Promise((resolve) => {
        finish = resolve;
      });
      h.failures.delete(h.workbook.id);
      await act(async () => {
        await h.controller.restoreExistingSession();
      });
      await waitFor(() => expect(h.downloads).toHaveLength(1));
      const edited = { ...h.workbook, name: 'Autosaved during confirmation' };
      hook.rerender({ workbook: edited, saveStatus: 'saved', sequence: 1 });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(h.saves).toHaveLength(1);
      await act(async () => {
        finish();
        await h.downloadControl.wait;
      });
      await waitFor(() => expect(h.saves).toHaveLength(2));
      expect(h.saves[1]).toMatchObject({ expectedRevision: 1, name: edited.name });
      expect(readCloudWorkbookSyncState(h.syncStorage, h.owner, h.workbook.id)).toMatchObject({
        revision: 2,
        baseWorkbook: edited,
        conflict: false
      });
    } finally {
      hook.unmount();
      h.controller.dispose();
    }
  });
});
