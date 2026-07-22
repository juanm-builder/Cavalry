// Persists Supabase auth state only when Electron can encrypt it with the OS keychain.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function canEncrypt(safeStorage) {
  try {
    const available = !!(
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable() &&
      typeof safeStorage.encryptString === 'function' &&
      typeof safeStorage.decryptString === 'function'
    );
    if (!available) return false;
    return !(
      typeof safeStorage.getSelectedStorageBackend === 'function' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    );
  } catch (_error) {
    return false;
  }
}

function asStoredObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createCloudSessionStorage(options = {}) {
  const fileSystem = options.fs || fs;
  const pathApi = options.path || path;
  const safeStorage = options.safeStorage || null;
  const filePath = String(options.filePath || '');
  const memory = new Map();
  let loaded = false;
  let loadPromise = null;
  let writeQueue = Promise.resolve();

  const persistent = () => !!filePath && canEncrypt(safeStorage);

  async function load() {
    if (loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (!persistent()) return;
      try {
        const document = asStoredObject(JSON.parse(await fileSystem.readFile(filePath, 'utf8')));
        const values = asStoredObject(document.values);
        Object.entries(values).forEach(([key, encrypted]) => {
          try {
            const value = safeStorage.decryptString(Buffer.from(String(encrypted), 'base64'));
            memory.set(String(key), String(value));
          } catch (_error) {
            // A keychain reset invalidates the session. Never fall back to plaintext.
          }
        });
      } catch (_error) {
        // A missing or malformed auth file behaves like a signed-out session.
      }
    })()
      .then(() => {
        loaded = true;
      })
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  }

  async function persist() {
    if (!persistent()) {
      throw new Error('Secure operating-system credential storage is unavailable.');
    }
    const values = {};
    memory.forEach((value, key) => {
      values[key] = safeStorage.encryptString(String(value)).toString('base64');
    });
    const tempPath = `${filePath}.tmp`;
    await fileSystem.mkdir(pathApi.dirname(filePath), { recursive: true, mode: 0o700 });
    await fileSystem.writeFile(
      tempPath,
      JSON.stringify({ version: 1, encryption: 'electron-safe-storage', values }),
      { encoding: 'utf8', mode: 0o600 }
    );
    if (typeof fileSystem.chmod === 'function') {
      await fileSystem.chmod(tempPath, 0o600);
    }
    await fileSystem.rename(tempPath, filePath);
  }

  function enqueuePersist() {
    writeQueue = writeQueue.catch(() => undefined).then(persist);
    return writeQueue;
  }

  return {
    isPersistent: persistent,
    async getItem(key) {
      await load();
      return memory.has(String(key)) ? memory.get(String(key)) : null;
    },
    async setItem(key, value) {
      await load();
      memory.set(String(key), String(value));
      await enqueuePersist();
    },
    async removeItem(key) {
      await load();
      memory.delete(String(key));
      await enqueuePersist();
    },
    async clear() {
      await load();
      memory.clear();
      await enqueuePersist();
    }
  };
}

module.exports = {
  canEncrypt,
  createCloudSessionStorage
};
