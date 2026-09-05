import { describe, expect, it, vi } from 'vitest';

import { createIndexedDbWorkbookCache } from '../../src/renderer/platform/indexeddb-cache.js';

function createDatabaseHarness() {
  const requests = [];
  const transactions = [];
  let resolveTransaction;
  const transactionStarted = new Promise((resolve) => {
    resolveTransaction = resolve;
  });
  const database = {
    transaction: vi.fn((_storeName, mode) => {
      const request = {};
      const store = {
        get: vi.fn(() => request),
        put: vi.fn(() => request),
        delete: vi.fn(() => request)
      };
      const transaction = { mode, objectStore: () => store, request, store };
      transactions.push(transaction);
      resolveTransaction(transaction);
      return transaction;
    })
  };
  const indexedDB = {
    open: vi.fn(() => {
      const request = { result: database };
      requests.push(request);
      return request;
    })
  };
  return {
    cache: createIndexedDbWorkbookCache(indexedDB),
    indexedDB,
    requests,
    transactions,
    transactionStarted
  };
}

async function openDatabase(harness) {
  harness.requests.at(-1).onsuccess();
  return harness.transactionStarted;
}

describe('IndexedDB workbook cache', () => {
  it('waits for the transaction commit before reporting a successful save', async () => {
    const harness = createDatabaseHarness();
    const workbook = { id: 'saved-workbook' };
    const settled = vi.fn();
    const save = harness.cache.save(workbook);
    void save.then(settled);
    const transaction = await openDatabase(harness);

    expect(transaction.mode).toBe('readwrite');
    expect(transaction.store.put).toHaveBeenCalledWith({ key: 'activeWorkbook', value: workbook });
    transaction.request.result = 'activeWorkbook';
    transaction.request.onsuccess?.();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    transaction.oncomplete();
    await expect(save).resolves.toEqual({ ok: true });
  });

  it.each(['save', 'clear'])('rejects an aborted %s even after request success', async (method) => {
    const harness = createDatabaseHarness();
    const operation = harness.cache[method]({ id: 'unsaved-workbook' });
    const failed = expect(operation).rejects.toThrow('Browser cache transaction was aborted.');
    const transaction = await openDatabase(harness);

    transaction.request.onsuccess?.();
    transaction.onabort();

    await failed;
  });

  it('preserves the transaction error when a commit fails', async () => {
    const harness = createDatabaseHarness();
    const save = harness.cache.save({ id: 'unsaved-workbook' });
    const error = new Error('Storage quota exceeded.');
    const failed = expect(save).rejects.toBe(error);
    const transaction = await openDatabase(harness);
    transaction.error = error;
    transaction.onerror();

    await failed;
  });

  it('loads committed records and reuses the connection for subsequent operations', async () => {
    const harness = createDatabaseHarness();
    const load = harness.cache.load();
    const transaction = await openDatabase(harness);
    transaction.request.result = { key: 'activeWorkbook', value: { id: 'cached-workbook' } };
    transaction.oncomplete();

    await expect(load).resolves.toEqual({
      status: 'loaded',
      source: 'cache',
      workbook: { id: 'cached-workbook' }
    });
    const clear = harness.cache.clear();
    await Promise.resolve();
    const clearTransaction = harness.transactions.at(-1);
    expect(clearTransaction.store.delete).toHaveBeenCalledWith('activeWorkbook');
    clearTransaction.oncomplete();
    await expect(clear).resolves.toEqual({ ok: true });
    expect(harness.indexedDB.open).toHaveBeenCalledOnce();
  });

  it('does not report writes as saved when browser storage is unavailable', async () => {
    const cache = createIndexedDbWorkbookCache(undefined);

    await expect(cache.load()).resolves.toEqual({ status: 'empty', source: 'cache' });
    await expect(cache.save({ id: 'unsaved-workbook' })).resolves.toEqual({
      ok: false,
      unavailable: true
    });
    await expect(cache.clear()).resolves.toEqual({ ok: false, unavailable: true });
  });

  it('retries opening storage after a failed connection attempt', async () => {
    const harness = createDatabaseHarness();
    const failedSave = harness.cache.save({ id: 'retry-workbook' });
    harness.requests[0].onerror();
    await expect(failedSave).resolves.toEqual({ ok: false, unavailable: true });

    const saved = harness.cache.save({ id: 'retry-workbook' });
    const transaction = await openDatabase(harness);
    transaction.oncomplete();

    await expect(saved).resolves.toEqual({ ok: true });
    expect(harness.indexedDB.open).toHaveBeenCalledTimes(2);
  });

  it('retries opening storage after a synchronous access error', async () => {
    const harness = createDatabaseHarness();
    harness.indexedDB.open.mockImplementationOnce(() => {
      throw new Error('Storage access denied.');
    });
    await expect(harness.cache.save({ id: 'retry-workbook' })).rejects.toThrow(
      'Storage access denied.'
    );

    const saved = harness.cache.save({ id: 'retry-workbook' });
    const transaction = await openDatabase(harness);
    transaction.oncomplete();

    await expect(saved).resolves.toEqual({ ok: true });
    expect(harness.indexedDB.open).toHaveBeenCalledTimes(2);
  });
});
