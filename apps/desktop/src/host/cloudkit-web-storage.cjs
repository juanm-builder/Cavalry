'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_ENVELOPE_BYTES = 160 * 1024 * 1024;

// The token and any unsent workbook remain encrypted with the existing Keychain
// key. A failed read is never interpreted as an empty account or empty outbox.
function createCloudKitWebStorage({ rootDir, safeStorage, fileSystem = fs }) {
  const root = path.resolve(rootDir);
  function location(key) {
    const name = crypto.createHash('sha256').update(String(key)).digest('hex');
    return path.join(root, `${name}.sealed`);
  }
  return {
    async read(key) {
      let data;
      try {
        const target = location(key);
        if ((await fileSystem.stat(target)).size > MAX_ENVELOPE_BYTES) throw new Error('size');
        data = await fileSystem.readFile(target);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error('Cavalry could not read its saved browser iCloud session.');
      }
      try {
        const envelope = JSON.parse(safeStorage.decryptString(data));
        if (envelope.version !== 1 || envelope.key !== key) throw new Error('scope');
        return envelope.value;
      } catch (_error) {
        throw new Error('Cavalry found unreadable browser iCloud data. Existing copies were kept.');
      }
    },
    async write(key, value) {
      const data = safeStorage.encryptString(JSON.stringify({ version: 1, key, value }));
      if (data.length > MAX_ENVELOPE_BYTES)
        throw new Error('Browser iCloud data exceeds the save limit.');
      await fileSystem.mkdir(root, { recursive: true, mode: 0o700 });
      const temporary = `${location(key)}.${crypto.randomUUID()}.tmp`;
      let handle;
      try {
        handle = await fileSystem.open(temporary, 'wx', 0o600);
        await handle.writeFile(data);
        await handle.sync();
        await handle.close();
        handle = null;
        await fileSystem.rename(temporary, location(key));
        const directory = await fileSystem.open(root, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } finally {
        if (handle) await handle.close().catch(() => undefined);
        await fileSystem.unlink(temporary).catch(() => undefined);
      }
    },
    async remove(key) {
      await fileSystem.unlink(location(key)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      const directory = await fileSystem.open(root, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  };
}

module.exports = { createCloudKitWebStorage };
