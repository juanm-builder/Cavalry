import { describe, expect, it } from 'vitest';

import {
  buildCloudSettingsModel,
  normalizeCloudState
} from '../../src/renderer/app/use-cloud-workbook-controller.js';

describe('cloud workbook controller model', () => {
  it('normalizes only renderer-safe account and workbook metadata', () => {
    const state = normalizeCloudState({
      configured: true,
      status: 'signed_in',
      access_token: 'must-not-cross-the-bridge',
      user: {
        id: 'user-1',
        email: 'alex@example.com',
        name: 'Alex Example',
        avatar_url: 'ignored-alias'
      },
      workbooks: [
        {
          local_workbook_id: 'workbook-1',
          name: 'Home',
          year: 2026,
          currency: 'php',
          latest_revision: 4,
          updated_at: '2026-07-20T04:00:00.000Z',
          portable_html: '<secret>'
        }
      ]
    });

    expect(state).toEqual({
      accountSource: 'system',
      browserSignInAvailable: false,
      browserSignInUnavailableReason: '',
      syncPaused: false,
      configured: true,
      status: 'signed_in',
      cloudEnvironment: '',
      user: {
        id: 'user-1',
        email: 'alex@example.com',
        name: 'Alex Example',
        avatarUrl: '',
        provider: 'icloud',
        providers: []
      },
      workbooks: [
        {
          id: 'workbook-1',
          name: 'Home',
          year: 2026,
          currency: 'PHP',
          revision: 4,
          updatedAt: '2026-07-20T04:00:00.000Z',
          conflict: false,
          pending: false,
          inCloud: true
        }
      ],
      sessionGeneration: 0,
      sessionPersistence: false,
      pendingCount: 0,
      lastSyncAt: '',
      error: '',
      errorCode: '',
      errorDetails: '',
      errorRetryable: false,
      errorOperation: '',
      errorWorkbookId: '',
      errorWorkbookName: ''
    });
    expect(JSON.stringify(state)).not.toContain('must-not-cross');
    expect(JSON.stringify(state)).not.toContain('<secret>');
  });

  it('marks only an explicitly uploaded current workbook as linked', () => {
    const localOnly = buildCloudSettingsModel(
      { configured: true, status: 'signed_in', workbooks: [] },
      { id: 'workbook-1', name: 'Home' }
    );
    expect(localOnly.current).toMatchObject({
      workbookId: 'workbook-1',
      linked: false,
      status: 'local_only'
    });

    const linked = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [
          {
            id: 'workbook-1',
            name: 'Home',
            revision: 2,
            updatedAt: '2026-07-20T04:00:00.000Z'
          }
        ]
      },
      { id: 'workbook-1', name: 'Home' },
      { pendingOperation: 'upload' }
    );
    expect(linked.current).toMatchObject({
      linked: true,
      revision: 2,
      status: 'uploading',
      cloudUpdatedAt: '2026-07-20T04:00:00.000Z'
    });
  });

  it("uses the current record's pending flag instead of another workbook's outbox state", () => {
    const confirmedCurrent = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        pendingCount: 1,
        workbooks: [
          { id: 'workbook-1', name: 'Home', revision: 4, pending: false },
          { id: 'workbook-2', name: 'Business', revision: 2, pending: true }
        ]
      },
      { id: 'workbook-1', name: 'Home' }
    );
    expect(confirmedCurrent.current).toMatchObject({
      workbookId: 'workbook-1',
      linked: true,
      status: 'synced'
    });

    const queuedCurrent = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        pendingCount: 1,
        workbooks: [{ id: 'workbook-1', name: 'Home', revision: 5, pending: true }]
      },
      { id: 'workbook-1', name: 'Home' }
    );
    expect(queuedCurrent.current).toMatchObject({
      workbookId: 'workbook-1',
      linked: true,
      status: 'pending'
    });
  });

  it.each([
    ['waiting', 'waiting'],
    ['syncing', 'uploading'],
    ['retrying', 'retrying'],
    ['failed', 'attention']
  ])('projects the automatic %s phase into current workbook status', (autoSyncPhase, status) => {
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [{ id: 'workbook-1', name: 'Home', revision: 2 }]
      },
      { id: 'workbook-1', name: 'Home' },
      { autoSyncPhase }
    );

    expect(model.current.status).toBe(status);
  });

  it('retains actionable error metadata and the failed operation for Settings', () => {
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [],
        error: 'The saved Production error',
        errorCode: 'cloud_database_update_required',
        errorDetails: 'Technical code: CKError.serverRejectedRequest.',
        errorRetryable: false
      },
      { id: 'workbook-1', name: 'Home' },
      {
        error: 'iCloud needs a Cavalry database update.',
        errorCode: 'cloud_database_update_required',
        errorDetails: 'Technical code: CKError.serverRejectedRequest.',
        errorRetryable: false,
        errorOperation: 'upload',
        errorWorkbookId: 'workbook-1',
        failedOperation: 'upload',
        failedWorkbookId: 'workbook-1'
      }
    );

    expect(model).toMatchObject({
      error: 'iCloud needs a Cavalry database update.',
      errorCode: 'cloud_database_update_required',
      errorDetails: 'Technical code: CKError.serverRejectedRequest.',
      errorRetryable: false,
      errorOperation: 'upload',
      errorWorkbookId: 'workbook-1',
      failedOperation: 'upload',
      failedWorkbookId: 'workbook-1',
      current: { linked: false, status: 'local_only' },
      workbooks: []
    });
  });

  it('does not project a workbook-scoped UI failure onto another workbook', () => {
    const model = buildCloudSettingsModel(
      { configured: true, status: 'signed_in', workbooks: [] },
      { id: 'workbook-2', name: 'Business' },
      {
        error: 'Plan One failed to upload.',
        errorCode: 'cloud_upload_failed',
        failedOperation: 'upload',
        failedWorkbookId: 'workbook-1'
      }
    );

    expect(model.error).toBe('');
    expect(model.failedOperation).toBe('');
    expect(model.failedWorkbookId).toBe('');
  });

  it('does not project a persisted native workbook failure onto another workbook', () => {
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [],
        error: 'Plan One failed to upload.',
        errorCode: 'cloud_upload_failed',
        errorDetails: 'Technical code: CKError.networkFailure.',
        errorRetryable: true,
        errorOperation: 'upload',
        errorWorkbookId: 'workbook-1'
      },
      { id: 'workbook-2', name: 'Business' }
    );

    expect(model).toMatchObject({
      error: '',
      errorCode: '',
      errorDetails: '',
      errorRetryable: false,
      errorOperation: '',
      errorWorkbookId: ''
    });
  });

  it('keeps a non-current library delete failure visible without attributing it to the current workbook', () => {
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [
          { id: 'workbook-1', name: 'Home', revision: 2 },
          { id: 'workbook-2', name: 'Business', revision: 1 }
        ],
        error: 'Business could not be removed from iCloud.',
        errorCode: 'cloud_delete_failed',
        errorOperation: 'delete',
        errorWorkbookId: 'workbook-2'
      },
      { id: 'workbook-1', name: 'Home' }
    );

    expect(model).toMatchObject({
      error: 'Business could not be removed from iCloud.',
      errorCode: 'cloud_delete_failed',
      errorOperation: 'delete',
      errorWorkbookId: 'workbook-2',
      current: { workbookId: 'workbook-1' }
    });
  });

  it('preserves a compact conflict notice for the current workbook without latching this Mac', () => {
    const notice = {
      id: 'conflict-1',
      sourceDevice: 'iPhone',
      resolutionAvailable: true,
      detectedAt: '2026-08-30T01:00:00.000Z',
      baseRevision: 3,
      remoteRevision: 4,
      summary: '1 change needs review',
      report: {
        version: 1,
        workbookId: 'workbook-1',
        workbookName: 'Home',
        conflictCount: 1,
        omittedCount: 0,
        entries: [
          {
            key: 'tx-1',
            path: 'transactions["tx-1"]',
            kind: 'same_record_changed',
            section: 'Transactions',
            title: 'Groceries',
            message: 'Both copies changed this item differently.',
            local: {
              label: 'This iPhone',
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
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [{ id: 'workbook-1', name: 'Home', revision: 4, conflictNotice: notice }]
      },
      { id: 'workbook-1', name: 'Home' }
    );

    expect(model.current).toMatchObject({
      conflict: false,
      status: 'synced',
      conflictNotice: {
        sourceDevice: 'iPhone',
        report: { entries: [{ title: 'Groceries' }] }
      }
    });
  });

  it('never labels a listed revision below the durable anchor as synced', () => {
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [{ id: 'workbook-1', name: 'Home', revision: 2 }]
      },
      { id: 'workbook-1', name: 'Home' },
      { anchorRevision: 3 }
    );

    expect(model.current).toMatchObject({
      linked: true,
      revision: 2,
      anchorRevision: 3,
      syncBlocked: true,
      status: 'attention'
    });
  });

  it('projects a durable remote deletion as a safe local-only workbook', () => {
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [{ id: 'workbook-1', name: 'Stale listing', revision: 2 }]
      },
      { id: 'workbook-1', name: 'Home' },
      { anchorRevision: 2, autoSyncEnabled: false, remoteDeleted: true }
    );

    expect(model.current).toMatchObject({
      linked: false,
      remoteDeleted: true,
      autoSyncEnabled: false,
      status: 'local_only'
    });
    expect(model.workbooks).toEqual([]);
  });
});
