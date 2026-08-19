const DATABASE_NAME = 'LedgerGroveDB';
const STORE_NAME = 'app_state';
const ACTIVE_WORKBOOK_KEY = 'activeWorkbook';

function openDatabase(indexedDB) {
  return new Promise((resolve) => {
    if (!indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function transact(database, mode, operation) {
  return new Promise((resolve, reject) => {
    if (!database) {
      resolve(undefined);
      return;
    }
    try {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Browser cache request failed.'));
    } catch (error) {
      reject(error);
    }
  });
}

export function createIndexedDbWorkbookCache(indexedDB) {
  let databasePromise = null;
  const getDatabase = () => {
    databasePromise ||= openDatabase(indexedDB);
    return databasePromise;
  };
  return {
    async load() {
      const record = await transact(await getDatabase(), 'readonly', (store) =>
        store.get(ACTIVE_WORKBOOK_KEY)
      );
      return record && record.value
        ? { status: 'loaded', source: 'cache', workbook: record.value }
        : { status: 'empty', source: 'cache' };
    },
    async save(workbook) {
      await transact(await getDatabase(), 'readwrite', (store) =>
        store.put({
          key: ACTIVE_WORKBOOK_KEY,
          value: workbook
        })
      );
      return { ok: true };
    },
    async clear() {
      await transact(await getDatabase(), 'readwrite', (store) =>
        store.delete(ACTIVE_WORKBOOK_KEY)
      );
      return { ok: true };
    }
  };
}
