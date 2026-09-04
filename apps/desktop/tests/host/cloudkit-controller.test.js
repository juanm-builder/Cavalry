import { createWorkbook } from '@cavalry/finance-core';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CLOUD_IPC_CHANNELS,
  createCloudController
} = require('../../src/host/cloud-controller.cjs');
const { createCloudWorkbookController } = require('../../src/host/cloud-workbook-controller.cjs');

function workbookFixture() {
  let sequence = 0;
  return createWorkbook(
    { id: 'workbook-cloudkit-1', name: 'Household' },
    {
      now: () => '2026-08-28T08:00:00.000Z',
      createId: (prefix) => `${prefix}_${++sequence}`
    }
  );
}

function conflictNoticeFixture() {
  return {
    id: 'conflict-1',
    sourceDevice: 'Mac',
    detectedAt: '2026-08-30T01:00:00.000Z',
    baseRevision: 5,
    remoteRevision: 6,
    summary: '1 change needs review',
    resolutionAvailable: true,
    report: {
      version: 1,
      workbookId: 'workbook-cloudkit-1',
      workbookName: 'Household',
      conflictCount: 1,
      omittedCount: 0,
      entries: [
        {
          key: 'transactions:tx-1',
          path: 'transactions["tx-1"]',
          kind: 'same_record_changed',
          section: 'Transactions',
          title: 'Groceries',
          message: 'Both copies changed this item differently.',
          local: {
            label: 'This Mac',
            action: 'edited',
            details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 650' }]
          },
          remote: {
            label: 'iCloud copy',
            action: 'edited',
            details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 700' }]
          }
        }
      ]
    }
  };
}

describe('native CloudKit workbook boundary', () => {
  it('validates a portable workbook and marks an explicit keep-local resolution', async () => {
    const requests = [];
    const cloudKit = {
      async request(payload) {
        requests.push(payload);
        return {
          ok: true,
          metadata: {
            id: payload.workbookId,
            name: payload.name,
            year: payload.year,
            currency: payload.currency,
            revision: 6,
            updatedAt: payload.updatedAt
          },
          pending: true
        };
      }
    };
    const controller = createCloudWorkbookController({ cloudKit });

    await expect(
      controller.uploadWorkbook({
        workbook: workbookFixture(),
        expectedRevision: 5,
        conflictResolution: 'keep_local'
      })
    ).resolves.toMatchObject({
      ok: true,
      pending: true,
      metadata: { id: 'workbook-cloudkit-1', revision: 6 }
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      operation: 'save',
      workbookId: 'workbook-cloudkit-1',
      expectedRevision: 5,
      conflictResolution: 'keep_local',
      updatedAt: '2026-08-28T08:00:00.000Z'
    });
    expect(requests[0].portableHtml).toContain('ledger-grove-export');
  });

  it('supports explicit iCloud recreation and idempotent removal by workbook ID', async () => {
    const requests = [];
    const cloudKit = {
      async request(payload) {
        requests.push(payload);
        if (payload.operation === 'save') {
          return {
            ok: true,
            metadata: {
              id: payload.workbookId,
              name: payload.name,
              year: payload.year,
              currency: payload.currency,
              revision: 1,
              updatedAt: payload.updatedAt
            },
            pending: true
          };
        }
        return { ok: true, id: payload.workbookId, pending: true };
      }
    };
    const controller = createCloudWorkbookController({ cloudKit });

    await expect(
      controller.uploadWorkbook({
        workbook: workbookFixture(),
        expectedRevision: null,
        conflictResolution: 'keep_local'
      })
    ).resolves.toMatchObject({
      ok: true,
      pending: true,
      metadata: { id: 'workbook-cloudkit-1', revision: 1 }
    });
    await expect(controller.deleteWorkbook({ workbookId: 'workbook-cloudkit-1' })).resolves.toEqual(
      {
        ok: true,
        id: 'workbook-cloudkit-1',
        pending: true
      }
    );

    expect(requests[0]).toMatchObject({
      operation: 'save',
      workbookId: 'workbook-cloudkit-1',
      expectedRevision: null,
      conflictResolution: 'keep_local'
    });
    expect(requests[1]).toEqual({
      operation: 'delete',
      workbookId: 'workbook-cloudkit-1'
    });
  });

  it('preserves a native missing-workbook result after exact-record recovery', async () => {
    const controller = createCloudWorkbookController({
      cloudKit: {
        request: vi.fn(async () => ({
          ok: false,
          code: 'cloud_workbook_not_found',
          error: 'That workbook is no longer in iCloud.'
        }))
      }
    });

    await expect(
      controller.downloadWorkbook({ workbookId: 'workbook-cloudkit-1' })
    ).resolves.toEqual({
      ok: false,
      code: 'cloud_workbook_not_found',
      error: 'That workbook is no longer in iCloud.',
      retryable: false
    });
  });

  it('preserves native revision conflicts without retrying or replacing data', async () => {
    const request = vi.fn(async () => ({
      ok: false,
      code: 'workbook_revision_conflict',
      error: 'Changed on another device.',
      conflict: true
    }));
    const controller = createCloudWorkbookController({ cloudKit: { request } });

    await expect(
      controller.uploadWorkbook({ workbook: workbookFixture(), expectedRevision: 5 })
    ).resolves.toEqual({
      ok: false,
      code: 'workbook_revision_conflict',
      error: 'Changed on another device.',
      conflict: true,
      retryable: false
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('preserves an actionable terminal Production schema rejection', async () => {
    const controller = createCloudWorkbookController({
      cloudKit: {
        request: vi.fn(async () => ({
          ok: false,
          code: 'cloud_database_update_required',
          error: 'iCloud needs a Cavalry database update before it can save this workbook.',
          errorDetails:
            'Technical code: CKError.serverRejectedRequest. Deploy CavalryWorkbook to Production.',
          errorOperation: 'upload',
          errorWorkbookId: 'workbook-cloudkit-1',
          retryable: false
        }))
      }
    });

    await expect(controller.uploadWorkbook({ workbook: workbookFixture() })).resolves.toMatchObject(
      {
        ok: false,
        code: 'cloud_database_update_required',
        error: 'iCloud needs a Cavalry database update before it can save this workbook.',
        errorDetails:
          'Technical code: CKError.serverRejectedRequest. Deploy CavalryWorkbook to Production.',
        errorOperation: 'upload',
        errorWorkbookId: 'workbook-cloudkit-1',
        retryable: false
      }
    );
  });

  it('surfaces a same-revision native conflict in library metadata', async () => {
    const controller = createCloudWorkbookController({
      cloudKit: {
        request: vi.fn(async () => ({
          ok: true,
          workbooks: [
            {
              id: 'workbook-cloudkit-1',
              name: 'Household',
              year: 2026,
              currency: 'PHP',
              revision: 6,
              updatedAt: '2026-08-28T08:00:00.000Z',
              conflict: true
            }
          ],
          pendingCount: 0
        }))
      }
    });

    await expect(controller.listWorkbooks()).resolves.toMatchObject({
      ok: true,
      workbooks: [{ id: 'workbook-cloudkit-1', revision: 6, conflict: true }]
    });
  });

  it('keeps queued workbook metadata distinct from a server-confirmed revision', async () => {
    const controller = createCloudWorkbookController({
      cloudKit: {
        request: vi.fn(async () => ({
          ok: true,
          workbooks: [
            {
              id: 'workbook-cloudkit-1',
              name: 'Household',
              year: 2026,
              currency: 'PHP',
              revision: 6,
              updatedAt: '2026-08-28T08:00:00.000Z',
              pending: true,
              inCloud: false
            }
          ],
          pendingCount: 1
        }))
      }
    });

    await expect(controller.listWorkbooks()).resolves.toMatchObject({
      ok: true,
      workbooks: [{ id: 'workbook-cloudkit-1', revision: 6, pending: true, inCloud: false }],
      pendingCount: 1
    });
  });

  it('shares validated conflict copies only when a workbook needs review', async () => {
    const request = vi.fn(async (payload) => ({
      ok: true,
      metadata: {
        id: payload.workbookId,
        name: 'Household',
        year: 2026,
        currency: 'PHP',
        revision: 6,
        updatedAt: '2026-08-30T01:00:00.000Z',
        conflictNotice: payload.conflictNotice
      }
    }));
    const controller = createCloudWorkbookController({ cloudKit: { request } });

    await expect(
      controller.publishConflictNotice({
        workbookId: 'workbook-cloudkit-1',
        conflictNotice: conflictNoticeFixture(),
        sourceWorkbook: workbookFixture()
      })
    ).resolves.toMatchObject({
      ok: true,
      metadata: {
        conflictNotice: {
          sourceDevice: 'Mac',
          report: { entries: [{ title: 'Groceries' }] }
        }
      }
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'publish_conflict',
        workbookId: 'workbook-cloudkit-1',
        conflictNotice: expect.objectContaining({
          resolutionAvailable: true,
          report: expect.any(String)
        }),
        conflictPortableHtml: expect.stringContaining('ledger-grove-export')
      })
    );
    expect(request.mock.calls[0][0]).not.toHaveProperty('conflictBasePortableHtml');
  });

  it('downloads and validates the conflict copies needed for either device to resolve', async () => {
    const persistence =
      await import('@cavalry/finance-core/application/workbook/workbook-persistence-service.js');
    const sourceWorkbook = workbookFixture();
    sourceWorkbook.name = 'Source copy';
    const baseWorkbook = workbookFixture();
    baseWorkbook.name = 'Common base';
    const request = vi.fn(async () => ({
      ok: true,
      conflictPackage: {
        noticeId: 'conflict-1',
        sourcePortableHtml: persistence.serializeWorkbookForSave(sourceWorkbook, {
          rejectInvalid: true
        }).html,
        basePortableHtml: persistence.serializeWorkbookForSave(baseWorkbook, {
          rejectInvalid: true
        }).html
      }
    }));
    const controller = createCloudWorkbookController({ cloudKit: { request } });

    await expect(
      controller.downloadConflictPackage({
        workbookId: 'workbook-cloudkit-1',
        conflictNoticeId: 'conflict-1'
      })
    ).resolves.toMatchObject({
      ok: true,
      conflictNoticeId: 'conflict-1',
      sourceWorkbook: { id: 'workbook-cloudkit-1', name: 'Source copy' },
      baseWorkbook: { id: 'workbook-cloudkit-1', name: 'Common base' }
    });
    expect(request).toHaveBeenCalledWith({
      operation: 'download_conflict',
      workbookId: 'workbook-cloudkit-1',
      conflictNoticeId: 'conflict-1'
    });
  });
});

describe('desktop iCloud state controller', () => {
  it('waits for the renderer get-state handshake before making native requests', async () => {
    const handlers = new Map();
    const request = vi.fn(async ({ operation }) => {
      if (operation === 'status') {
        return {
          ok: true,
          account: { status: 'available', userId: 'icloud-owner-startup' },
          pendingCount: 0,
          lastSyncAt: '2026-08-28T08:01:00Z'
        };
      }
      if (operation === 'list') {
        return {
          ok: true,
          workbooks: [],
          pendingCount: 0,
          lastSyncAt: '2026-08-28T08:01:00Z'
        };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const controller = createCloudController({
      assertTrustedSender: () => {},
      cloudKit: { request },
      ipcMain: {
        handle(channel, handler) {
          handlers.set(channel, handler);
        }
      },
      BrowserWindow: { getAllWindows: () => [] }
    });

    controller.registerHandlers();
    expect(controller.getState()).toMatchObject({ status: 'initializing', error: '' });
    expect(controller.handleNativeEvent('cloudkit', { reason: 'fetched' })).toBe(true);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();

    await expect(handlers.get(CLOUD_IPC_CHANNELS.getState)({ sender: {} })).resolves.toMatchObject({
      ok: true,
      state: {
        status: 'signed_in',
        user: { id: 'icloud-owner-startup' }
      }
    });
    expect(request.mock.calls[0][0]).toEqual({ operation: 'status' });
    expect(request.mock.calls[1][0]).toEqual({ operation: 'list', refresh: true });
    controller.dispose();
  });

  it('maps the system iCloud account to eight narrow renderer commands', async () => {
    const handlers = new Map();
    const sent = [];
    const assertTrustedSender = vi.fn();
    const request = vi.fn(async ({ operation }) => {
      if (operation === 'status') {
        return {
          ok: true,
          account: { status: 'available', userId: 'icloud-owner-1' },
          pendingCount: 1,
          lastSyncAt: '2026-08-28T08:01:00.000Z'
        };
      }
      if (operation === 'list') {
        return {
          ok: true,
          workbooks: [
            {
              id: 'workbook-cloudkit-1',
              name: 'Household',
              year: 2026,
              currency: 'PHP',
              revision: 3,
              updatedAt: '2026-08-28T08:00:00.000Z'
            }
          ],
          pendingCount: 1,
          lastSyncAt: '2026-08-28T08:01:00.000Z'
        };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const controller = createCloudController({
      assertTrustedSender,
      cloudKit: { request },
      ipcMain: {
        handle(channel, handler) {
          handlers.set(channel, handler);
        }
      },
      BrowserWindow: {
        getAllWindows: () => [
          {
            isDestroyed: () => false,
            webContents: {
              isDestroyed: () => false,
              send: (...args) => sent.push(args)
            }
          }
        ]
      }
    });

    controller.registerHandlers();
    await controller.initialize();

    expect([...handlers.keys()].sort()).toEqual(
      [
        CLOUD_IPC_CHANNELS.deleteWorkbook,
        CLOUD_IPC_CHANNELS.downloadConflictPackage,
        CLOUD_IPC_CHANNELS.downloadWorkbook,
        CLOUD_IPC_CHANNELS.getState,
        CLOUD_IPC_CHANNELS.listWorkbooks,
        CLOUD_IPC_CHANNELS.loadSyncState,
        CLOUD_IPC_CHANNELS.publishConflictNotice,
        CLOUD_IPC_CHANNELS.clearConflictNotice,
        CLOUD_IPC_CHANNELS.removeSyncState,
        CLOUD_IPC_CHANNELS.saveSyncState,
        CLOUD_IPC_CHANNELS.uploadWorkbook
      ].sort()
    );
    expect(controller.getState()).toMatchObject({
      configured: true,
      status: 'signed_in',
      user: { id: 'icloud-owner-1', provider: 'icloud' },
      pendingCount: 1,
      workbooks: [{ id: 'workbook-cloudkit-1', revision: 3 }]
    });
    expect(sent.at(-1)).toEqual([
      CLOUD_IPC_CHANNELS.stateChanged,
      expect.objectContaining({ status: 'signed_in' })
    ]);

    const result = await handlers.get(CLOUD_IPC_CHANNELS.getState)({ sender: {} });
    expect(assertTrustedSender).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, state: { status: 'signed_in' } });

    expect(controller.handleNativeEvent('cloudkit', { reason: 'fetched' })).toBe(true);
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([payload]) => payload.operation === 'list')).toHaveLength(
        2
      );
    });
    controller.dispose();
    expect(controller.handleNativeEvent('cloudkit', { reason: 'fetched' })).toBe(false);
  });

  it('publishes an exact DELETE signal only after the native library refresh', async () => {
    const sent = [];
    let remotePresent = true;
    const request = vi.fn(async ({ operation }) => {
      if (operation === 'status') {
        return {
          ok: true,
          account: { status: 'available', userId: 'icloud-owner-1' },
          cloudEnvironment: 'Production'
        };
      }
      if (operation === 'list') {
        return {
          ok: true,
          workbooks: remotePresent
            ? [{ id: 'workbook-cloudkit-1', name: 'Household', revision: 3 }]
            : []
        };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const controller = createCloudController({
      assertTrustedSender: () => {},
      cloudKit: { request },
      ipcMain: { handle() {} },
      BrowserWindow: {
        getAllWindows: () => [
          {
            isDestroyed: () => false,
            webContents: {
              isDestroyed: () => false,
              send: (...args) => sent.push(args)
            }
          }
        ]
      }
    });
    await controller.initialize();
    remotePresent = false;

    expect(
      controller.handleNativeEvent('cloudkit', {
        reason: 'deleted',
        workbookId: 'workbook-cloudkit-1'
      })
    ).toBe(true);
    await vi.waitFor(() =>
      expect(sent.at(-1)).toEqual([
        CLOUD_IPC_CHANNELS.stateChanged,
        expect.objectContaining({
          workbooks: [],
          workbookChange: {
            sequence: 1,
            eventType: 'DELETE',
            workbookId: 'workbook-cloudkit-1',
            revision: 0,
            updatedAt: ''
          }
        })
      ])
    );
  });

  it('finishes account checks as unavailable instead of remaining in a loading state', async () => {
    const controller = createCloudController({
      assertTrustedSender: () => {},
      cloudKit: {
        request: async () => ({
          ok: true,
          account: { status: 'could_not_determine', userId: null },
          pendingCount: 0
        })
      },
      ipcMain: { handle() {} },
      BrowserWindow: { getAllWindows: () => [] }
    });

    expect(controller.getState().status).toBe('initializing');
    await controller.initialize();
    expect(controller.getState()).toMatchObject({
      status: 'unavailable',
      error: expect.stringContaining('could not determine')
    });
  });

  it('rejects an available account response without a verified private user ID', async () => {
    const controller = createCloudController({
      assertTrustedSender: () => {},
      cloudKit: {
        request: async () => ({
          ok: true,
          account: { status: 'available', userId: null },
          cloudEnvironment: 'Production',
          pendingCount: 0
        })
      },
      ipcMain: { handle() {} },
      BrowserWindow: { getAllWindows: () => [] }
    });

    await controller.initialize();
    expect(controller.getState()).toMatchObject({
      status: 'unavailable',
      user: null,
      error: expect.stringContaining('could not determine')
    });
  });

  it('keeps account connectivity separate from a retained terminal sync diagnosis', async () => {
    const detail =
      'Technical code: CKError.serverRejectedRequest. Deploy CavalryWorkbook to Production.';
    const controller = createCloudController({
      assertTrustedSender: () => {},
      cloudKit: {
        request: vi.fn(async ({ operation }) => {
          if (operation === 'status') {
            return {
              ok: true,
              account: { status: 'available', userId: 'icloud-owner-1' },
              error: 'iCloud needs a Cavalry database update.',
              code: 'cloud_database_update_required',
              errorDetails: detail,
              errorOperation: 'upload',
              errorWorkbookId: 'workbook-cloudkit-1',
              retryable: false
            };
          }
          if (operation === 'list') {
            return {
              ok: true,
              workbooks: [],
              pendingCount: 0,
              error: 'iCloud needs a Cavalry database update.',
              code: 'cloud_database_update_required',
              errorDetails: detail,
              errorOperation: 'upload',
              errorWorkbookId: 'workbook-cloudkit-1',
              retryable: false
            };
          }
          throw new Error(`Unexpected operation: ${operation}`);
        })
      },
      ipcMain: { handle() {} },
      BrowserWindow: { getAllWindows: () => [] }
    });

    await controller.initialize();

    expect(controller.getState()).toMatchObject({
      status: 'signed_in',
      user: { id: 'icloud-owner-1' },
      workbooks: [],
      error: 'iCloud needs a Cavalry database update.',
      errorCode: 'cloud_database_update_required',
      errorDetails: detail,
      errorRetryable: false,
      errorOperation: 'upload',
      errorWorkbookId: 'workbook-cloudkit-1'
    });
  });
});
