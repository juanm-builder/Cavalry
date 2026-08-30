import { describe, expect, it } from 'vitest';

import {
  describeWorkbookConflicts,
  mergeWorkbookSnapshots,
  reconcileWorkbookSnapshots,
  shouldRefreshWorkbookConflictReview
} from '../../src/application/workbook/workbook-sync-merge-service.js';
import { cloneFixture, makeMinimalWorkbook } from '../fixtures/core-workbook-fixtures.js';

function transaction(id, overrides = {}) {
  return {
    id,
    date: '2026-08-29',
    description: id,
    lines: [],
    ...overrides
  };
}

function workbook(transactions = []) {
  const value = cloneFixture(makeMinimalWorkbook());
  value.id = 'main-plan';
  value.updatedAt = '2026-08-29T10:00:00.000Z';
  value.transactions = transactions;
  return value;
}

describe('workbook sync merge service', () => {
  it('combines independent offline transaction additions', () => {
    const base = workbook([transaction('base')]);
    const local = cloneFixture(base);
    local.updatedAt = '2026-08-29T10:01:00.000Z';
    local.transactions.push(transaction('phone'));
    const remote = cloneFixture(base);
    remote.updatedAt = '2026-08-29T10:02:00.000Z';
    remote.transactions.push(transaction('mac'));

    const result = mergeWorkbookSnapshots({ base, local, remote });

    expect(result).toMatchObject({ ok: true, needsUpload: true });
    expect(result.workbook.transactions.map(({ id }) => id)).toEqual(['base', 'mac', 'phone']);
    expect(result.workbook.updatedAt).toBe('2026-08-29T10:02:00.000Z');
  });

  it('keeps the latest bookkeeping timestamp while merging independent changes', () => {
    const base = workbook([transaction('base')]);
    base.settings.lastSavedAt = '2026-08-29T10:00:00.000Z';
    const local = cloneFixture(base);
    local.settings.lastSavedAt = '2026-08-29T10:01:00.000Z';
    local.transactions.push(transaction('phone'));
    const remote = cloneFixture(base);
    remote.settings.lastSavedAt = '2026-08-29T10:02:00.000Z';
    remote.transactions.push(transaction('mac'));

    const result = mergeWorkbookSnapshots({ base, local, remote });

    expect(result.ok).toBe(true);
    expect(result.workbook.settings.lastSavedAt).toBe('2026-08-29T10:02:00.000Z');
  });

  it('preserves a one-sided replacement alongside an independent addition', () => {
    const base = workbook([transaction('old')]);
    const local = cloneFixture(base);
    local.transactions.push(transaction('phone'));
    const remote = cloneFixture(base);
    remote.transactions = [transaction('replacement')];

    const result = mergeWorkbookSnapshots({ base, local, remote });

    expect(result.ok).toBe(true);
    expect(result.workbook.transactions.map(({ id }) => id)).toEqual(['phone', 'replacement']);
  });

  it('keeps a one-sided deletion when the other device changes something else', () => {
    const base = workbook([transaction('keep'), transaction('delete')]);
    const local = cloneFixture(base);
    local.transactions = [transaction('keep')];
    const remote = cloneFixture(base);
    remote.name = 'Renamed remotely';

    const result = mergeWorkbookSnapshots({ base, local, remote });

    expect(result.ok).toBe(true);
    expect(result.workbook.name).toBe('Renamed remotely');
    expect(result.workbook.transactions.map(({ id }) => id)).toEqual(['keep']);
  });

  it('refuses to guess when both devices changed the same transaction differently', () => {
    const base = workbook([
      transaction('shared', {
        description: 'Groceries',
        amount: 500,
        originalCurrency: 'PHP'
      })
    ]);
    const local = cloneFixture(base);
    local.transactions[0].amount = 650;
    const remote = cloneFixture(base);
    remote.transactions[0].amount = 700;

    const result = mergeWorkbookSnapshots({ base, local, remote });

    expect(result).toMatchObject({
      ok: false,
      conflicts: [
        {
          path: 'transactions["shared"]',
          kind: 'same_record_changed'
        }
      ],
      review: {
        conflictCount: 1,
        entries: [
          {
            section: 'Transactions',
            title: 'Groceries',
            message: 'Both copies changed this item differently.',
            local: {
              action: 'edited',
              details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 650' }]
            },
            remote: {
              action: 'edited',
              details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 700' }]
            }
          }
        ]
      }
    });
  });

  it('explains delete-versus-edit conflicts without dumping workbook JSON', () => {
    const base = workbook([transaction('shared', { description: 'Phone bill', note: '' })]);
    const local = cloneFixture(base);
    local.transactions = [];
    const remote = cloneFixture(base);
    remote.transactions[0].note = 'Paid early';

    const result = mergeWorkbookSnapshots({ base, local, remote });

    expect(result).toMatchObject({
      ok: false,
      review: {
        entries: [
          {
            title: 'Phone bill',
            message: 'This device deleted it while iCloud changed it.',
            local: { action: 'deleted' },
            remote: {
              action: 'edited',
              details: [{ label: 'Note', before: 'None', after: 'Paid early' }]
            }
          }
        ]
      }
    });
  });

  it('expands a missing merge base into the specific records that differ', () => {
    const local = workbook([
      transaction('shared', { amount: 500 }),
      transaction('phone', { amount: 125 })
    ]);
    local.name = 'Local plan';
    const remote = workbook([
      transaction('shared', { amount: 650 }),
      transaction('mac', { amount: 250 })
    ]);
    remote.name = 'Cloud plan';

    const result = mergeWorkbookSnapshots({ local, remote });

    expect(result.ok).toBe(false);
    expect(result.review.conflictCount).toBe(2);
    expect(result.review.entries.map((entry) => entry.title)).toEqual(['Name', 'shared']);
    expect(result.review.entries.find((entry) => entry.title === 'shared')).toMatchObject({
      section: 'Transactions',
      message: 'The two copies contain different versions of this item.'
    });
  });

  it('automatically merges bookkeeping and device UI metadata without asking the user', () => {
    const local = workbook([transaction('shared'), transaction('phone')]);
    local.updatedAt = '2026-08-29T10:01:00.000Z';
    local.settings.activeAdvisorThreadId = 'advisor-phone';
    local.settings.dashboardLayout = ['cash', 'bills'];
    local.settings.hiddenMonthlyMetrics = { savings: true };
    const remote = workbook([transaction('shared'), transaction('mac')]);
    remote.updatedAt = '2026-08-29T10:02:00.000Z';
    remote.settings.activeAdvisorThreadId = 'advisor-mac';
    remote.settings.dashboardLayout = ['net-worth'];
    remote.settings.hiddenMonthlyMetrics = { savings: false };

    const result = mergeWorkbookSnapshots({ local, remote });

    expect(result.ok).toBe(true);
    expect(result.workbook.transactions.map(({ id }) => id)).toEqual(['mac', 'phone', 'shared']);
    expect(result.workbook.updatedAt).toBe('2026-08-29T10:02:00.000Z');
    expect(result.workbook.settings).toMatchObject({
      activeAdvisorThreadId: 'advisor-mac',
      dashboardLayout: ['net-worth'],
      hiddenMonthlyMetrics: { savings: false }
    });
  });

  it('shows only the meaningful transaction when metadata also differs', () => {
    const local = workbook([
      transaction('shared', {
        description: 'Groceries',
        amount: 650,
        updatedAt: '2026-08-29T10:01:00.000Z'
      })
    ]);
    local.settings.activeAdvisorThreadId = 'advisor-phone';
    const remote = workbook([
      transaction('shared', {
        description: 'Groceries',
        amount: 700,
        updatedAt: '2026-08-29T10:02:00.000Z'
      })
    ]);
    remote.settings.activeAdvisorThreadId = 'advisor-mac';

    const result = mergeWorkbookSnapshots({ local, remote });

    expect(result.ok).toBe(false);
    expect(result.review).toMatchObject({
      conflictCount: 1,
      entries: [{ path: 'transactions["shared"]', title: 'Groceries' }]
    });
    expect(shouldRefreshWorkbookConflictReview(result.review)).toBe(false);
  });

  it('still asks about a financially meaningful exchange-rate setting', () => {
    const local = workbook([]);
    local.settings.usdToBaseRate = 58;
    local.settings.activeAdvisorThreadId = 'advisor-phone';
    const remote = workbook([]);
    remote.settings.usdToBaseRate = 59;
    remote.settings.activeAdvisorThreadId = 'advisor-mac';

    const result = mergeWorkbookSnapshots({ local, remote });

    expect(result.ok).toBe(false);
    expect(result.review).toMatchObject({
      conflictCount: 1,
      entries: [
        {
          path: 'settings.usdToBaseRate',
          section: 'Settings',
          title: 'USD exchange rate',
          local: { details: [{ label: 'Value', after: '58' }] },
          remote: { details: [{ label: 'Value', after: '59' }] }
        }
      ]
    });
  });

  it('does not create a transaction decision for bookkeeping-only item changes', () => {
    const local = workbook([transaction('shared', { updatedAt: '2026-08-29T10:01:00.000Z' })]);
    const remote = workbook([transaction('shared', { updatedAt: '2026-08-29T10:02:00.000Z' })]);

    const result = mergeWorkbookSnapshots({ local, remote });

    expect(result.ok).toBe(true);
    expect(result.workbook.transactions[0].updatedAt).toBe('2026-08-29T10:02:00.000Z');
  });

  it('marks legacy whole-workbook and internal-setting reviews for regeneration', () => {
    expect(
      shouldRefreshWorkbookConflictReview({
        conflictCount: 2,
        entries: [{ path: '$' }, { path: 'updatedAt' }]
      })
    ).toBe(true);
    expect(
      shouldRefreshWorkbookConflictReview({
        conflictCount: 1,
        entries: [{ path: 'settings.activeAdvisorThreadId' }]
      })
    ).toBe(true);

    const local = workbook([transaction('phone')]);
    const remote = workbook([transaction('mac')]);
    const review = describeWorkbookConflicts({
      local,
      remote,
      conflicts: [{ path: '$', kind: 'stale_resolution' }]
    });
    expect(review).toMatchObject({ conflictCount: 0, entries: [] });
  });

  it('uses a conservative no-loss union for legacy anchors without a base', () => {
    const local = workbook([transaction('shared'), transaction('phone')]);
    const remote = workbook([transaction('shared'), transaction('mac')]);
    local.settings.lastSavedAt = '2026-08-29T10:01:00.000Z';
    remote.settings.lastSavedAt = '2026-08-29T10:02:00.000Z';

    const result = mergeWorkbookSnapshots({ local, remote });

    expect(result).toMatchObject({ ok: true, usedConservativeUnion: true, needsUpload: true });
    expect(result.workbook.transactions.map(({ id }) => id)).toEqual(['mac', 'phone', 'shared']);
    expect(result.workbook.settings.lastSavedAt).toBe('2026-08-29T10:02:00.000Z');
  });

  it('keeps independent edits and applies the selected side only to a clashing transaction', () => {
    const base = workbook([
      transaction('shared', { amount: 100 }),
      transaction('base-only', { amount: 40 })
    ]);
    const local = cloneFixture(base);
    local.transactions.find((item) => item.id === 'shared').amount = 125;
    local.transactions.push(transaction('local-new', { amount: 20 }));
    const remote = cloneFixture(base);
    remote.transactions.find((item) => item.id === 'shared').amount = 150;
    remote.transactions.push(transaction('remote-new', { amount: 30 }));

    const result = reconcileWorkbookSnapshots({
      base,
      local,
      remote,
      choices: [{ path: 'transactions["shared"]', side: 'remote' }]
    });

    expect(result.ok).toBe(true);
    expect(result.workbook.transactions.find((item) => item.id === 'shared').amount).toBe(150);
    expect(result.workbook.transactions.map((item) => item.id)).toEqual(
      expect.arrayContaining(['shared', 'base-only', 'local-new', 'remote-new'])
    );
    expect(result.resolvedPaths).toEqual(['transactions["shared"]']);
  });

  it('can choose a deletion over a competing edit', () => {
    const base = workbook([transaction('shared', { amount: 100 })]);
    const local = cloneFixture(base);
    local.transactions = [];
    const remote = cloneFixture(base);
    remote.transactions[0].amount = 150;

    const result = reconcileWorkbookSnapshots({
      base,
      local,
      remote,
      choices: [{ path: 'transactions["shared"]', side: 'local' }]
    });

    expect(result.ok).toBe(true);
    expect(result.workbook.transactions).toEqual([]);
  });

  it('unions independent transactions when resolving a legacy conflict without a base', () => {
    const local = workbook([
      transaction('shared', { amount: 125 }),
      transaction('local-new', { amount: 20 })
    ]);
    const remote = workbook([
      transaction('shared', { amount: 150 }),
      transaction('remote-new', { amount: 30 })
    ]);

    const result = reconcileWorkbookSnapshots({
      local,
      remote,
      choices: [{ path: 'transactions["shared"]', side: 'remote' }]
    });

    expect(result.ok).toBe(true);
    expect(result.workbook.transactions.find((item) => item.id === 'shared').amount).toBe(150);
    expect(result.workbook.transactions.map((item) => item.id)).toEqual(
      expect.arrayContaining(['shared', 'local-new', 'remote-new'])
    );
  });

  it('rejects partial, invalid, and stale choices without producing a workbook', () => {
    const base = workbook([
      transaction('first', { amount: 100 }),
      transaction('second', { amount: 200 })
    ]);
    const local = cloneFixture(base);
    local.transactions[0].amount = 110;
    local.transactions[1].amount = 210;
    const remote = cloneFixture(base);
    remote.transactions[0].amount = 120;
    remote.transactions[1].amount = 220;

    expect(
      reconcileWorkbookSnapshots({
        base,
        local,
        remote,
        choices: [{ path: 'transactions["first"]', side: 'local' }]
      })
    ).toMatchObject({ ok: false, code: 'incomplete_resolution' });
    expect(
      reconcileWorkbookSnapshots({
        base,
        local,
        remote,
        choices: [
          { path: 'transactions["first"]', side: 'local' },
          { path: 'transactions["second"]', side: 'remote' },
          { path: 'transactions["unknown"]', side: 'remote' }
        ]
      })
    ).toMatchObject({ ok: false, code: 'stale_resolution' });
    expect(
      reconcileWorkbookSnapshots({
        base,
        local,
        remote,
        choices: [{ path: 'transactions["first"]', side: 'neither' }]
      })
    ).toMatchObject({ ok: false, code: 'invalid_resolution' });
  });
});
