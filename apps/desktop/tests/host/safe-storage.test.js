import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createSafeStorage } = require('../../src/host/safe-storage.cjs');

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function createTestStorage() {
  const directory = await mkdtemp(join(tmpdir(), 'cavalry-safe-storage-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    storage: createSafeStorage({ userDataDir: directory, isPackaged: false, platform: 'linux' })
  };
}

describe('desktop host secure-storage compatibility layer', () => {
  it('round-trips AES-GCM ciphertext with a development-only key', async () => {
    const { directory, storage } = await createTestStorage();
    const encrypted = storage.encryptString('private advisor credential');

    expect(storage.isEncryptionAvailable()).toBe(true);
    expect(storage.getSelectedStorageBackend()).toBe('development-file');
    expect(encrypted.toString('utf8')).not.toContain('private advisor credential');
    expect(storage.decryptString(encrypted)).toBe('private advisor credential');

    const keyFile = await readFile(join(directory, 'credentials-master-key.development'), 'utf8');
    expect(Buffer.from(keyFile.trim(), 'base64')).toHaveLength(32);
  });

  it('rejects tampered and legacy-incompatible envelopes', async () => {
    const { storage } = await createTestStorage();
    const encrypted = storage.encryptString('credential');
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;

    expect(() => storage.decryptString(tampered)).toThrow();
    expect(() => storage.decryptString(Buffer.from('electron-safe-storage-ciphertext'))).toThrow(
      /incompatible Cavalry runtime/i
    );
  });

  it('fails closed for packaged platforms without an OS-backed implementation', () => {
    const storage = createSafeStorage({
      userDataDir: '/tmp/cavalry-packaged-test',
      isPackaged: true,
      platform: 'linux'
    });

    expect(storage.isEncryptionAvailable()).toBe(false);
    expect(() => storage.encryptString('must-not-be-plaintext')).toThrow(/not configured/i);
  });
});
