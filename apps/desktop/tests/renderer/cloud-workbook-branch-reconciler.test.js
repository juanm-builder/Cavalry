import { describe, expect, it, vi } from 'vitest';

import {
  reconcileCloudWorkbookBranches,
  reconcileReviewedCloudWorkbookConflict
} from '../../src/renderer/app/cloud-workbook-branch-reconciler.js';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function transaction(id, description) {
  return { id, date: '2026-08-30', description, lines: [] };
}

function workbook(transactions) {
  const value = cloneFixture(makeMinimalWorkbook());
  value.id = 'shared-plan';
  value.name = 'Shared Plan';
  value.transactions = transactions;
  return value;
}

function notice() {
  return {
    id: 'conflict-1',
    sourceDevice: 'Mac',
    resolutionAvailable: true,
    baseRevision: 4,
    remoteRevision: 5,
    report: {
      version: 1,
      workbookId: 'shared-plan',
      workbookName: 'Shared Plan',
      conflictCount: 1,
      omittedCount: 0,
      entries: [{ path: 'transactions["shared"]' }]
    }
  };
}

describe('reviewed Cloud workbook reconciliation', () => {
  it('commits a safe union when an old choice is no longer needed', async () => {
    const base = workbook([transaction('shared', 'Original')]);
    const source = workbook([
      transaction('shared', 'Resolved value'),
      transaction('mac-only', 'Mac only')
    ]);
    const remote = workbook([
      transaction('shared', 'Resolved value'),
      transaction('phone-only', 'Phone only')
    ]);
    const publishConflictReport = vi.fn();
    const persistMergedWorkbook = vi.fn(async (_current, merged) => ({
      ok: true,
      workbook: merged
    }));
    const invoke = vi.fn(async (command) => {
      if (command === 'downloadConflictPackage') {
        return {
          ok: true,
          conflictNoticeId: 'conflict-1',
          sourceWorkbook: source,
          baseWorkbook: base
        };
      }
      if (command === 'downloadWorkbook') {
        return { ok: true, workbook: remote, metadata: { revision: 5 } };
      }
      if (command === 'uploadWorkbook') {
        return { ok: true, metadata: { id: 'shared-plan', revision: 6 } };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { result } = await reconcileReviewedCloudWorkbookConflict({
      currentWorkbook: remote,
      userId: 'owner-1',
      notice: notice(),
      payload: {
        conflictNoticeId: 'conflict-1',
        choices: [{ path: 'transactions["shared"]', side: 'local' }]
      },
      invoke,
      applyRemoteState: vi.fn(),
      persistMergedWorkbook,
      publishConflictReport
    });

    expect(result).toMatchObject({ ok: true, reconciled: true });
    expect(publishConflictReport).not.toHaveBeenCalled();
    const merged = persistMergedWorkbook.mock.calls[0][1];
    expect(merged.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared' }),
        expect.objectContaining({ id: 'mac-only' }),
        expect.objectContaining({ id: 'phone-only' })
      ])
    );
    expect(invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: merged,
      expectedRevision: 5,
      conflictResolution: 'keep_local'
    });
  });

  it('refreshes an invalid choice with the real transaction conflict, never a workbook fallback', async () => {
    const base = workbook([transaction('shared', 'Original')]);
    const source = workbook([transaction('shared', 'Mac edit')]);
    const remote = workbook([transaction('shared', 'Phone edit')]);
    const publishConflictReport = vi.fn(async () => ({ ok: true }));
    const invoke = vi.fn(async (command) => {
      if (command === 'downloadConflictPackage') {
        return {
          ok: true,
          conflictNoticeId: 'conflict-1',
          sourceWorkbook: source,
          baseWorkbook: base
        };
      }
      if (command === 'downloadWorkbook') {
        return { ok: true, workbook: remote, metadata: { revision: 5 } };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { result } = await reconcileReviewedCloudWorkbookConflict({
      currentWorkbook: remote,
      userId: 'owner-1',
      notice: notice(),
      payload: {
        conflictNoticeId: 'conflict-1',
        choices: [{ path: 'settings', side: 'local' }]
      },
      invoke,
      applyRemoteState: vi.fn(),
      persistMergedWorkbook: vi.fn(),
      publishConflictReport
    });

    expect(result).toMatchObject({ ok: false, code: 'incomplete_resolution' });
    const refreshedReview = publishConflictReport.mock.calls[0][0].review;
    expect(refreshedReview.entries).toEqual([
      expect.objectContaining({ path: 'transactions["shared"]' })
    ]);
    expect(refreshedReview.entries.some(({ path }) => path === '$')).toBe(false);
  });
});

describe('automatic Cloud workbook reconciliation', () => {
  it('keeps the later local edit to the same item and preserves independent remote items', async () => {
    const base = workbook([transaction('shared', 'Original')]);
    const local = workbook([
      transaction('shared', 'Mac edit'),
      transaction('mac-only', 'Mac only')
    ]);
    const remote = workbook([
      transaction('shared', 'Phone edit'),
      transaction('phone-only', 'Phone only')
    ]);
    let currentWorkbook = local;
    const persistMergedWorkbook = vi.fn(async (_current, merged) => {
      currentWorkbook = merged;
      return { ok: true, workbook: merged };
    });
    const invoke = vi.fn(async (command, payload) => {
      if (command === 'downloadWorkbook') {
        return { ok: true, workbook: remote, metadata: { revision: 5 } };
      }
      if (command === 'uploadWorkbook') {
        return {
          ok: true,
          metadata: { id: 'shared-plan', revision: 6 },
          workbook: payload.workbook
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await reconcileCloudWorkbookBranches({
      userId: 'owner-1',
      workbookId: 'shared-plan',
      localWorkbook: local,
      syncState: { revision: 4, baseRevision: 4, baseWorkbook: base },
      invoke,
      applyRemoteState: vi.fn(),
      refreshState: vi.fn(),
      isRetryableFailure: () => false,
      getCurrentWorkbook: () => currentWorkbook,
      persistMergedWorkbook,
      latchConflict: vi.fn(),
      reportConflict: vi.fn(),
      writeSyncState: vi.fn(),
      clearConflict: vi.fn()
    });

    expect(result).toMatchObject({ ok: true, merged: true });
    const merged = persistMergedWorkbook.mock.calls[0][1];
    expect(merged.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared', description: 'Mac edit' }),
        expect.objectContaining({ id: 'mac-only' }),
        expect.objectContaining({ id: 'phone-only' })
      ])
    );
    expect(invoke).toHaveBeenCalledWith('uploadWorkbook', {
      workbook: merged,
      expectedRevision: 5,
      conflictResolution: 'keep_local'
    });
  });

  it('returns a retryable compact error after a second CAS race without creating a review', async () => {
    const base = workbook([transaction('shared', 'Original')]);
    const local = workbook([transaction('shared', 'Mac edit')]);
    const remotes = [
      workbook([transaction('shared', 'Phone edit 1')]),
      workbook([transaction('shared', 'Phone edit 2')])
    ];
    let currentWorkbook = local;
    let downloadIndex = 0;
    const persistMergedWorkbook = vi.fn(async (_current, merged) => {
      currentWorkbook = merged;
      return { ok: true, workbook: merged };
    });
    const invoke = vi.fn(async (command) => {
      if (command === 'downloadWorkbook') {
        const index = downloadIndex;
        downloadIndex += 1;
        return {
          ok: true,
          workbook: remotes[index],
          metadata: { revision: 5 + index }
        };
      }
      if (command === 'uploadWorkbook') {
        return { ok: false, conflict: true, code: 'workbook_revision_conflict' };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const latchConflict = vi.fn();
    const reportConflict = vi.fn();

    const result = await reconcileCloudWorkbookBranches({
      userId: 'owner-1',
      workbookId: 'shared-plan',
      localWorkbook: local,
      syncState: { revision: 4, baseRevision: 4, baseWorkbook: base },
      invoke,
      applyRemoteState: vi.fn(),
      refreshState: vi.fn(),
      isRetryableFailure: () => false,
      getCurrentWorkbook: () => currentWorkbook,
      persistMergedWorkbook,
      latchConflict,
      reportConflict,
      writeSyncState: vi.fn(),
      clearConflict: vi.fn()
    });

    expect(result).toEqual({
      ok: false,
      retry: true,
      retryable: true,
      code: 'cloud_workbook_changed_again',
      error: 'iCloud kept changing. Try again.'
    });
    expect(reportConflict).not.toHaveBeenCalled();
    expect(latchConflict).not.toHaveBeenCalled();
  });

  it('awaits durable conflict persistence before returning a manual conflict', async () => {
    const local = workbook([transaction('shared', 'Mac edit')]);
    const wrongRemote = { ...workbook([]), id: 'different-workbook' };
    const latchConflict = vi.fn(async () => ({
      ok: false,
      code: 'cloud_sync_state_save_failed',
      error: 'Application Support is read-only.'
    }));

    const result = await reconcileCloudWorkbookBranches({
      userId: 'owner-1',
      workbookId: 'shared-plan',
      localWorkbook: local,
      syncState: { revision: 4 },
      invoke: vi.fn(async () => ({
        ok: true,
        workbook: wrongRemote,
        metadata: { revision: 5 }
      })),
      applyRemoteState: vi.fn(),
      refreshState: vi.fn(),
      isRetryableFailure: () => false,
      getCurrentWorkbook: () => local,
      persistMergedWorkbook: vi.fn(),
      latchConflict,
      reportConflict: vi.fn(),
      writeSyncState: vi.fn(),
      clearConflict: vi.fn()
    });

    expect(latchConflict).toHaveBeenCalledWith(4);
    expect(result).toMatchObject({
      ok: false,
      retry: false,
      conflict: true,
      code: 'cloud_sync_state_save_failed'
    });
  });
});
