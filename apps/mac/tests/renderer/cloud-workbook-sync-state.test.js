import { describe, expect, it } from 'vitest';

import {
  cloudWorkbookSyncStorageKey,
  readCloudWorkbookSyncState,
  removeCloudWorkbookSyncState,
  writeCloudWorkbookSyncState
} from '../../src/renderer/app/cloud-workbook-sync-state.js';

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

describe('cloud workbook sync state', () => {
  it('persists account-scoped acknowledged revisions and conflict latches', () => {
    const storage = createStorage();

    expect(readCloudWorkbookSyncState(storage, 'user-1', 'workbook-1')).toEqual({
      known: false,
      revision: null,
      conflict: false
    });

    writeCloudWorkbookSyncState(storage, 'user-1', 'workbook-1', {
      revision: 7,
      conflict: true
    });
    expect(readCloudWorkbookSyncState(storage, 'user-1', 'workbook-1')).toEqual({
      known: true,
      revision: 7,
      conflict: true
    });
    expect(readCloudWorkbookSyncState(storage, 'user-2', 'workbook-1').known).toBe(false);

    removeCloudWorkbookSyncState(storage, 'user-1', 'workbook-1');
    expect(readCloudWorkbookSyncState(storage, 'user-1', 'workbook-1').known).toBe(false);
  });

  it('fails closed for malformed state without storing workbook contents', () => {
    const storage = createStorage();
    const key = cloudWorkbookSyncStorageKey('user@example.com', 'workbook/1');
    storage.setItem(key, '{"version":1,"revision":"invalid","conflict":true}');

    expect(key).not.toContain('user@example.com');
    expect(readCloudWorkbookSyncState(storage, 'user@example.com', 'workbook/1')).toEqual({
      known: true,
      revision: null,
      conflict: true
    });
    expect(storage.values.get(key)).not.toMatch(/portable|workbook contents/i);
  });

  it('retains a session fallback when durable application storage is blocked', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {}
    };

    writeCloudWorkbookSyncState(storage, 'blocked-user', 'blocked-workbook', {
      revision: 4,
      conflict: false
    });
    expect(readCloudWorkbookSyncState(storage, 'blocked-user', 'blocked-workbook')).toEqual({
      known: true,
      revision: 4,
      conflict: false
    });
    removeCloudWorkbookSyncState(storage, 'blocked-user', 'blocked-workbook');
    expect(readCloudWorkbookSyncState(storage, 'blocked-user', 'blocked-workbook').known).toBe(
      false
    );
  });
});
