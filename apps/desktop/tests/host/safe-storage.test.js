import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('reuses an existing Keychain master key without replacing it', () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: Buffer.alloc(32, 7).toString('base64') }));
    const storage = createSafeStorage({ platform: 'darwin', isPackaged: true, spawnSync });
    const encrypted = storage.encryptString('saved credential');

    expect(storage.decryptString(encrypted)).toBe('saved credential');
    expect(storage.getSelectedStorageBackend()).toBe('keychain');
    expect(spawnSync).toHaveBeenCalledOnce();
    expect(spawnSync.mock.calls[0][1][0]).toBe('find-generic-password');
  });

  it.each([
    { status: 36, stderr: 'User interaction is not allowed.' },
    { status: 51, stderr: 'Authorization denied.' },
    { status: null, signal: 'SIGTERM', error: new Error('command timed out') },
    { status: null, error: new Error('command unavailable') },
    { status: 0, stdout: '' },
    { status: 0, stdout: 'invalid-existing-key' }
  ])('preserves the master key when Keychain cannot be read: %j', (readResult) => {
    const spawnSync = vi.fn(() => readResult);
    const storage = createSafeStorage({ platform: 'darwin', isPackaged: true, spawnSync });

    expect(storage.isEncryptionAvailable()).toBe(false);
    expect(storage.getSelectedStorageBackend()).toBe('unavailable');
    expect(() => storage.encryptString('private credential')).toThrow();
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it('creates a missing Keychain key without allowing an existing key to be overwritten', () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({ status: 44, stderr: 'The specified item could not be found.' })
      .mockReturnValueOnce({ status: 0 });
    const storage = createSafeStorage({ platform: 'darwin', isPackaged: true, spawnSync });
    const encrypted = storage.encryptString('new credential');

    expect(storage.decryptString(encrypted)).toBe('new credential');
    expect(spawnSync).toHaveBeenCalledTimes(2);
    const args = spawnSync.mock.calls[1][1];
    expect(args[0]).toBe('add-generic-password');
    expect(args).not.toContain('-U');
    expect(Buffer.from(args[args.indexOf('-w') + 1], 'base64')).toHaveLength(32);
  });

  it('fails closed if another process creates the Keychain item before Cavalry does', () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({ status: 44 })
      .mockReturnValueOnce({ status: 45, stderr: 'The specified item already exists.' });
    const storage = createSafeStorage({ platform: 'darwin', isPackaged: true, spawnSync });

    expect(storage.isEncryptionAvailable()).toBe(false);
    expect(() => storage.encryptString('private credential')).toThrow('already exists');
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync.mock.calls[1][1]).not.toContain('-U');
  });

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

  it('fails closed when the macOS Keychain backend is unavailable', () => {
    const storage = createSafeStorage({
      userDataDir: '/tmp/cavalry-packaged-test',
      isPackaged: true,
      platform: 'linux'
    });

    expect(storage.isEncryptionAvailable()).toBe(false);
    expect(() => storage.encryptString('must-not-be-plaintext')).toThrow(
      /requires macOS Keychain/i
    );
  });
});
