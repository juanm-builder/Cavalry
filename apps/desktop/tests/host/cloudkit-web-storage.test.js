import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createCloudKitWebStorage } = require('../../src/host/cloudkit-web-storage.cjs');
const roots = [];

async function fixture(fileSystem = fs) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cavalry-web-storage-'));
  roots.push(rootDir);
  const key = randomBytes(32);
  const safeStorage = {
    encryptString(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(data) {
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    }
  };
  return {
    rootDir,
    safeStorage,
    store: createCloudKitWebStorage({ rootDir, safeStorage, fileSystem })
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('encrypted browser iCloud disk storage', () => {
  it('retains an encrypted owner session and outbox across process restarts', async () => {
    const h = await fixture();
    const value = {
      userId: 'account-b',
      token: 'private-session-token',
      payload: 'unsent-workbook'
    };
    await h.store.write('session:account-b', value);
    const files = await fs.readdir(h.rootDir);
    expect(files).toHaveLength(1);
    const onDisk = await fs.readFile(path.join(h.rootDir, files[0]));
    expect(onDisk.includes(Buffer.from(value.token))).toBe(false);
    expect(onDisk.includes(Buffer.from(value.payload))).toBe(false);
    expect((await fs.stat(path.join(h.rootDir, files[0]))).mode & 0o777).toBe(0o600);
    const restarted = createCloudKitWebStorage(h);
    expect(await restarted.read('session:account-b')).toEqual(value);
    expect(await restarted.read('session:account-a')).toBe(null);
  });

  it('rejects an otherwise valid encrypted session copied under another owner key', async () => {
    const h = await fixture();
    await h.store.write('account-a', { token: 'a' });
    const [a] = await fs.readdir(h.rootDir);
    await h.store.write('account-b', { token: 'b' });
    const b = (await fs.readdir(h.rootDir)).find((name) => name !== a);
    await fs.copyFile(path.join(h.rootDir, a), path.join(h.rootDir, b));
    await expect(h.store.read('account-b')).rejects.toThrow('unreadable browser iCloud data');
    expect(await h.store.read('account-a')).toEqual({ token: 'a' });
    expect(await fs.readdir(h.rootDir)).toHaveLength(2);
  });

  it('keeps corrupt data visible as an error and leaves the encrypted file in place', async () => {
    const h = await fixture();
    await h.store.write('selection', { source: 'browser' });
    const [name] = await fs.readdir(h.rootDir);
    const target = path.join(h.rootDir, name);
    await fs.writeFile(target, Buffer.from('damaged'));
    await expect(h.store.read('selection')).rejects.toThrow('Existing copies were kept');
    expect(await fs.readFile(target, 'utf8')).toBe('damaged');
  });

  it('does not overwrite the previous acknowledged session when an atomic replacement fails', async () => {
    let fail = false;
    const h = await fixture({
      ...fs,
      rename: async (...args) => {
        if (fail) throw new Error('disk write failure');
        return fs.rename(...args);
      }
    });
    await h.store.write('session', { token: 'previous' });
    fail = true;
    await expect(h.store.write('session', { token: 'next' })).rejects.toThrow('disk write failure');
    expect(await h.store.read('session')).toEqual({ token: 'previous' });
    expect(await fs.readdir(h.rootDir)).toHaveLength(1);
  });

  it('flushes payload then replacement directory before reporting a durable write', async () => {
    const events = [];
    const h = await fixture({
      ...fs,
      open: async (target, flags, ...args) => {
        const handle = await fs.open(target, flags, ...args);
        return {
          writeFile: (...values) => handle.writeFile(...values),
          close: () => handle.close(),
          sync: async () => {
            events.push(flags === 'r' ? 'directory-sync' : 'payload-sync');
            return handle.sync();
          }
        };
      },
      rename: async (...args) => {
        events.push('replace');
        return fs.rename(...args);
      }
    });
    await h.store.write('outbox:account-b', { pending: 'workbook' });
    expect(events).toEqual(['payload-sync', 'replace', 'directory-sync']);
    await h.store.remove('outbox:account-b');
    expect(await h.store.read('outbox:account-b')).toBe(null);
  });
});
