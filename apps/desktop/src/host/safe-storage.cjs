'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ENVELOPE_PREFIX = Buffer.from('CAVALRY1', 'ascii');
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEYCHAIN_SERVICE = 'com.juanmbuilder.cavalry.mac.credentials';
// `security` reports errSecItemNotFound (-25300) through an 8-bit process exit status.
const KEYCHAIN_ITEM_NOT_FOUND_STATUS = 44;

function safeMkdir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch (_error) {
    // Best effort for development filesystems that do not expose POSIX modes.
  }
}

function normalizeKey(value) {
  const key = Buffer.from(String(value || '').trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new Error('Invalid credential encryption key.');
  return key;
}

function loadMacKey(runCommand) {
  const account = os.userInfo().username || 'cavalry';
  const read = runCommand(
    'security',
    ['find-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w'],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (read.error || read.signal) {
    throw new Error('Unable to read the Cavalry key from Keychain.');
  }
  if (read.status === 0) {
    return normalizeKey(read.stdout);
  }
  if (read.status !== KEYCHAIN_ITEM_NOT_FOUND_STATUS) {
    throw new Error(String(read.stderr || 'Unable to read the Cavalry key from Keychain.').trim());
  }
  const key = crypto.randomBytes(KEY_BYTES);
  const write = runCommand(
    'security',
    ['add-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w', key.toString('base64')],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (write.status !== 0) {
    throw new Error(String(write.stderr || 'Unable to save the Cavalry key in Keychain.').trim());
  }
  return key;
}

function loadDevelopmentKey(userDataDir) {
  const keyPath = path.join(userDataDir, 'credentials-master-key.development');
  safeMkdir(path.dirname(keyPath));
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(KEY_BYTES).toString('base64'), {
      encoding: 'utf8',
      mode: 0o600
    });
  }
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch (_error) {
    // Best effort on non-POSIX filesystems.
  }
  return normalizeKey(fs.readFileSync(keyPath, 'utf8'));
}

function createSafeStorage({
  userDataDir,
  isPackaged = false,
  platform = process.platform,
  spawnSync: runCommand = spawnSync
} = {}) {
  let key = null;
  let backend = 'unavailable';
  let loadError = null;

  function loadKey() {
    if (key) return key;
    if (loadError) throw loadError;
    try {
      if (platform === 'darwin') {
        backend = 'keychain';
        key = loadMacKey(runCommand);
      } else if (!isPackaged || process.env.CAVALRY_ALLOW_INSECURE_DEV_STORAGE === '1') {
        backend = 'development-file';
        key = loadDevelopmentKey(userDataDir);
      } else {
        throw new Error('Cavalry credential storage requires macOS Keychain.');
      }
      return key;
    } catch (error) {
      backend = 'unavailable';
      loadError = error instanceof Error ? error : new Error(String(error));
      throw loadError;
    }
  }

  return {
    isEncryptionAvailable() {
      try {
        loadKey();
        return true;
      } catch (_error) {
        return false;
      }
    },
    getSelectedStorageBackend() {
      this.isEncryptionAvailable();
      return backend;
    },
    encryptString(value) {
      const nonce = crypto.randomBytes(NONCE_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), nonce);
      const ciphertext = Buffer.concat([
        cipher.update(String(value == null ? '' : value), 'utf8'),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([ENVELOPE_PREFIX, nonce, tag, ciphertext]);
    },
    decryptString(value) {
      const envelope = Buffer.from(value || []);
      const minimum = ENVELOPE_PREFIX.length + NONCE_BYTES + TAG_BYTES;
      if (
        envelope.length < minimum ||
        !crypto.timingSafeEqual(envelope.subarray(0, ENVELOPE_PREFIX.length), ENVELOPE_PREFIX)
      ) {
        throw new Error('This credential was encrypted by an incompatible Cavalry runtime.');
      }
      let offset = ENVELOPE_PREFIX.length;
      const nonce = envelope.subarray(offset, (offset += NONCE_BYTES));
      const tag = envelope.subarray(offset, (offset += TAG_BYTES));
      const ciphertext = envelope.subarray(offset);
      const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    }
  };
}

module.exports = { createSafeStorage };
