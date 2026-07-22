// Tests for local sync conflict detection.

import { describe, expect, it } from 'vitest';

import { createSyncChange } from '@cavalry/sync-foundation/application/sync/sync-change-log.js';
import { detectSyncConflicts } from '@cavalry/sync-foundation/application/sync/sync-conflict-service.js';
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

describe('sync conflict service foundation', () => {
  it('detects the same transaction changed on two devices', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const createId = makeCreateId();
    const before = {
      id: 'txn_conflict',
      date: '2026-06-30',
      description: 'Coffee',
      amount: 100,
      categoryId: 'food',
      lines: [{ accountId: 'cash', amount: 100 }]
    };
    const localChange = createSyncChange({
      workbook,
      entityType: 'transaction',
      entityId: 'txn_conflict',
      before,
      after: Object.assign({}, before, { amount: 120 }),
      device: { deviceId: 'mac_a' },
      createId
    });
    const remoteChange = createSyncChange({
      workbook,
      entityType: 'transaction',
      entityId: 'txn_conflict',
      before,
      after: Object.assign({}, before, { amount: 140 }),
      device: { deviceId: 'mac_b' },
      createId
    });

    const result = detectSyncConflicts({
      workbook,
      localChanges: [localChange],
      remoteChanges: [remoteChange]
    });

    expect(result.ok).toBe(false);
    expect(result.blockingConflicts).toEqual([
      expect.objectContaining({
        code: 'concurrent_entity_update',
        entity_type: 'transaction',
        entity_id: 'txn_conflict',
        local_device_id: 'mac_a',
        remote_device_id: 'mac_b'
      })
    ]);
  });

  it('detects missing account and category references in incoming transaction changes', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const change = createSyncChange({
      workbook,
      entityType: 'transaction',
      entityId: 'txn_missing_refs',
      after: {
        id: 'txn_missing_refs',
        date: '2026-06-30',
        description: 'Needs references',
        amount: 300,
        categoryId: 'missing-category',
        lines: [{ accountId: 'missing-account', amount: 300 }]
      },
      device: { deviceId: 'mac_b' },
      createId: makeCreateId()
    });

    const result = detectSyncConflicts({
      workbook,
      remoteChanges: [change]
    });

    expect(result.ok).toBe(false);
    expect(result.blockingConflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(['missing_account_reference', 'missing_category_reference'])
    );
  });
});
