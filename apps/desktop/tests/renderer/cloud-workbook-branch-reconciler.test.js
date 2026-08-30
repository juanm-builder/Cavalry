import { describe, expect, it, vi } from 'vitest';

import { reconcileReviewedCloudWorkbookConflict } from '../../src/renderer/app/cloud-workbook-branch-reconciler.js';
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
