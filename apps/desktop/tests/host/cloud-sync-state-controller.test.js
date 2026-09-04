import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CLOUD_IPC_CHANNELS,
  createCloudController
} = require('../../src/host/cloud-controller.cjs');

function controllerHarness(overrides = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler)
  };
  const syncStateStorage = {
    load: vi.fn(async (scope) => ({
      ok: true,
      status: 'loaded',
      envelope: {
        version: 1,
        ...scope,
        accountId: scope.accountId,
        autoSyncEnabled: true,
        syncState: null
      }
    })),
    save: vi.fn(async (scope) => ({
      ok: true,
      status: 'saved',
      envelope: { version: 1, ...scope }
    })),
    remove: vi.fn(async () => ({ ok: true, status: 'removed' })),
    ...overrides.syncStateStorage
  };
  const cloudKit = {
    request: vi.fn(async (payload) => {
      if (payload.operation === 'status') {
        return {
          ok: true,
          cloudEnvironment: 'Production',
          account: { status: 'available', userId: '_native-account' },
          pendingCount: 0
        };
      }
      if (payload.operation === 'list') {
        return { ok: true, workbooks: [], pendingCount: 0 };
      }
      return { ok: true };
    }),
    ...overrides.cloudKit
  };
  const assertTrustedSender = vi.fn();
  const controller = createCloudController({
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain,
    cloudKit,
    syncStateStorage,
    assertTrustedSender
  });
  controller.registerHandlers();
  const invoke = (channel, payload = {}) => handlers.get(channel)({ sender: {} }, payload);
  return { assertTrustedSender, cloudKit, controller, handlers, invoke, syncStateStorage };
}

describe('durable cloud sync state host channels', () => {
  it('derives environment and account scope from native status', async () => {
    const harness = controllerHarness();
    const result = await harness.invoke(CLOUD_IPC_CHANNELS.loadSyncState, {
      workbookId: 'workbook-1',
      cloudEnvironment: '../../Development',
      accountId: 'renderer-controlled'
    });

    expect(result).toMatchObject({ ok: true, status: 'loaded' });
    expect(harness.syncStateStorage.load).toHaveBeenCalledWith({
      cloudEnvironment: 'Production',
      accountId: '_native-account',
      workbookId: 'workbook-1'
    });
    expect(harness.assertTrustedSender).toHaveBeenCalledTimes(1);
  });

  it('does not open durable state when native availability lacks a verified user ID', async () => {
    const harness = controllerHarness({
      cloudKit: {
        request: vi.fn(async (payload) =>
          payload.operation === 'status'
            ? {
                ok: true,
                cloudEnvironment: 'Production',
                account: { status: 'available', userId: null },
                pendingCount: 0
              }
            : { ok: true }
        )
      }
    });

    await expect(
      harness.invoke(CLOUD_IPC_CHANNELS.loadSyncState, { workbookId: 'workbook-1' })
    ).resolves.toMatchObject({
      ok: false,
      code: 'icloud_account_unavailable',
      failClosed: true
    });
    expect(harness.syncStateStorage.load).not.toHaveBeenCalled();
  });

  it('saves the merge base and autosave preference through a trusted channel', async () => {
    const harness = controllerHarness();
    const syncState = {
      version: 1,
      revision: 3,
      conflict: false,
      baseRevision: 3,
      baseWorkbook: { id: 'workbook-1', name: 'Main Plan' }
    };

    await expect(
      harness.invoke(CLOUD_IPC_CHANNELS.saveSyncState, {
        workbookId: 'workbook-1',
        syncState,
        autoSyncEnabled: false
      })
    ).resolves.toMatchObject({ ok: true, status: 'saved' });
    expect(harness.syncStateStorage.save).toHaveBeenCalledWith({
      cloudEnvironment: 'Production',
      accountId: '_native-account',
      workbookId: 'workbook-1',
      syncState,
      autoSyncEnabled: false
    });
  });

  it('fails closed for corrupt state and invalid workbook paths', async () => {
    const harness = controllerHarness({
      syncStateStorage: {
        load: vi.fn(async () => ({
          ok: false,
          status: 'corrupt',
          code: 'cloud_sync_state_corrupt'
        }))
      }
    });

    await expect(
      harness.invoke(CLOUD_IPC_CHANNELS.loadSyncState, { workbookId: 'workbook-1' })
    ).resolves.toMatchObject({
      ok: false,
      code: 'cloud_sync_state_corrupt',
      failClosed: true
    });
    await expect(
      harness.invoke(CLOUD_IPC_CHANNELS.removeSyncState, { workbookId: '../outside' })
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid_workbook_id',
      failClosed: true
    });
    expect(harness.syncStateStorage.remove).not.toHaveBeenCalled();
  });

  it('removes only the current native account and environment scope', async () => {
    const harness = controllerHarness();
    await expect(
      harness.invoke(CLOUD_IPC_CHANNELS.removeSyncState, { workbookId: 'workbook-1' })
    ).resolves.toMatchObject({ ok: true, status: 'removed' });
    expect(harness.syncStateStorage.remove).toHaveBeenCalledWith({
      cloudEnvironment: 'Production',
      accountId: '_native-account',
      workbookId: 'workbook-1'
    });
  });
});
