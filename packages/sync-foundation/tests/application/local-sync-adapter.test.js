// Tests for the local-only sync adapter.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalSyncAdapter } from '@cavalry/sync-foundation/application/sync/local-sync-adapter.js';
import {
  getPendingSyncChanges,
  recordTransactionChange
} from '@cavalry/sync-foundation/application/sync/sync-change-log.js';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

const originalFetch = globalThis.fetch;

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_' + String(counters[prefix]).padStart(3, '0');
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('local sync adapter foundation', () => {
  it('pushes and pulls changes through a local mock without network or secrets', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network should not be called')));
    globalThis.fetch = fetchSpy;
    const workbook = cloneFixture(makeMinimalWorkbook());
    const adapter = createLocalSyncAdapter();
    recordTransactionChange(
      workbook,
      {
        id: 'txn_local_push',
        date: '2026-06-30',
        description: 'Local push',
        amount: 1,
        categoryId: 'food',
        lines: [{ accountId: 'cash', amount: 1 }]
      },
      {
        createId: makeCreateId(),
        device: { deviceId: 'mac_a' }
      }
    );

    const pushed = await adapter.pushChanges({
      workbookId: workbook.id,
      device: { deviceId: 'mac_a' },
      changes: getPendingSyncChanges(workbook)
    });
    const pulled = await adapter.pullChanges({
      workbookId: workbook.id,
      excludeDeviceId: 'mac_b'
    });

    expect(adapter.metadata).toMatchObject({
      kind: 'local_mock',
      network: false,
      requiresSecrets: false
    });
    expect(pushed).toMatchObject({
      ok: true,
      network: false,
      requiresSecrets: false,
      pushed: 1,
      remoteVersion: 1
    });
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0]).toMatchObject({
      entity_type: 'transaction',
      entity_id: 'txn_local_push',
      remote_version: 1
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('can filter out changes from the requesting device', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const adapter = createLocalSyncAdapter();
    recordTransactionChange(
      workbook,
      { id: 'txn_same_device', amount: 2 },
      {
        createId: makeCreateId(),
        device: { deviceId: 'mac_a' }
      }
    );

    await adapter.pushChanges({
      workbookId: workbook.id,
      changes: getPendingSyncChanges(workbook),
      device: { deviceId: 'mac_a' }
    });
    const pulled = await adapter.pullChanges({
      workbookId: workbook.id,
      excludeDeviceId: 'mac_a'
    });

    expect(pulled.changes).toEqual([]);
  });
});
