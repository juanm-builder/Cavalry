// Tests for the local sync change log.

import { describe, expect, it } from 'vitest';

import {
  getPendingSyncChanges,
  getWorkbookSyncHash,
  recordAccountChange,
  recordCategoryChange,
  recordDraftGroupChange,
  recordTransactionChange
} from '@cavalry/sync-foundation/application/sync/sync-change-log.js';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_' + String(counters[prefix]).padStart(3, '0');
  };
}

describe('sync change log foundation', () => {
  it('captures transaction, category, account, and draft changes with workbook hashes', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const createId = makeCreateId();
    const options = {
      createId,
      now: () => '2026-06-30T10:00:00.000Z',
      device: { deviceId: 'mac_a', deviceName: 'Mac A' }
    };
    const transaction = {
      id: 'txn_sync_1',
      date: '2026-06-30',
      description: 'Coffee',
      amount: 120,
      categoryId: 'food',
      lines: [{ accountId: 'cash', direction: 'credit', amount: 120 }]
    };
    const draftGroup = {
      draft_group_id: 'dg_sync_1',
      status: 'pending_review',
      drafts: [
        {
          draft_id: 'd_1',
          type: 'transaction',
          proposed_values: { category_id: 'food', payment_account_id: 'cash' }
        }
      ]
    };

    const transactionChange = recordTransactionChange(workbook, transaction, options);
    const categoryChange = recordCategoryChange(workbook, workbook.categories[0], options);
    const accountChange = recordAccountChange(workbook, workbook.accounts[0], options);
    const draftChange = recordDraftGroupChange(workbook, draftGroup, options);
    const pending = getPendingSyncChanges(workbook);

    expect(pending.map((change) => change.entity_type)).toEqual([
      'transaction',
      'category',
      'account',
      'draft_group'
    ]);
    expect(transactionChange).toMatchObject({
      change_id: 'sync_change_001',
      workbook_id: 'wb-minimal',
      workbook_version: 2,
      workbook_hash: getWorkbookSyncHash(workbook),
      entity_type: 'transaction',
      entity_id: 'txn_sync_1',
      device_id: 'mac_a',
      sync_status: 'pending'
    });
    expect(categoryChange.entity_hash).toMatch(/^fnv1a32_/);
    expect(accountChange.entity_hash).toMatch(/^fnv1a32_/);
    expect(draftChange.entity_id).toBe('dg_sync_1');
  });
});
