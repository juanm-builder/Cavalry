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
const KEYCHAIN_SERVICE = 'com.local.cavalry.desktop.credentials';

function safeMkdir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch (_error) {
    // Windows does not expose POSIX modes; current-user DPAPI still protects the key.
  }
}

function normalizeKey(value) {
  const key = Buffer.from(String(value || '').trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new Error('Invalid credential encryption key.');
  return key;
}

function loadMacKey() {
  const account = os.userInfo().username || 'cavalry';
  const read = spawnSync(
    'security',
    ['find-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w'],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (read.status === 0 && String(read.stdout || '').trim()) {
    return normalizeKey(read.stdout);
  }
  const key = crypto.randomBytes(KEY_BYTES);
  const write = spawnSync(
    'security',
    [
      'add-generic-password',
      '-U',
      '-a',
      account,
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
      key.toString('base64')
    ],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (write.status !== 0) {
    throw new Error(String(write.stderr || 'Unable to save the Cavalry key in Keychain.').trim());
  }
  return key;
}

function runPowerShell(script, environment) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      env: { ...process.env, ...environment },
      timeout: 15_000,
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    throw new Error(String(result.stderr || 'Windows credential protection failed.').trim());
  }
  return String(result.stdout || '').trim();
}

function loadWindowsKey(userDataDir) {
  const keyPath = path.join(userDataDir, 'credentials-master-key.dpapi');
  safeMkdir(path.dirname(keyPath));
  if (!fs.existsSync(keyPath)) {
    const key = crypto.randomBytes(KEY_BYTES);
    runPowerShell(
      [
        '$raw=[Convert]::FromBase64String($env:CAVALRY_MASTER_KEY);',
        '$scope=[Security.Cryptography.DataProtectionScope]::CurrentUser;',
        '$protected=[Security.Cryptography.ProtectedData]::Protect($raw,$null,$scope);',
        '[IO.File]::WriteAllText($env:CAVALRY_KEY_PATH,[Convert]::ToBase64String($protected));'
      ].join(' '),
      { CAVALRY_MASTER_KEY: key.toString('base64'), CAVALRY_KEY_PATH: keyPath }
    );
    return key;
  }
  const output = runPowerShell(
    [
      '$protected=[Convert]::FromBase64String([IO.File]::ReadAllText($env:CAVALRY_KEY_PATH));',
      '$scope=[Security.Cryptography.DataProtectionScope]::CurrentUser;',
      '$raw=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,$scope);',
      '[Console]::Out.Write([Convert]::ToBase64String($raw));'
    ].join(' '),
    { CAVALRY_KEY_PATH: keyPath }
  );
  return normalizeKey(output);
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

function createSafeStorage({ userDataDir, isPackaged = false, platform = process.platform } = {}) {
  let key = null;
  let backend = 'unavailable';
  let loadError = null;

  function loadKey() {
    if (key) return key;
    if (loadError) throw loadError;
    try {
      if (platform === 'darwin') {
        backend = 'keychain';
        key = loadMacKey();
      } else if (platform === 'win32') {
        backend = 'dpapi';
        key = loadWindowsKey(userDataDir);
      } else if (!isPackaged || process.env.CAVALRY_ALLOW_INSECURE_DEV_STORAGE === '1') {
        backend = 'development-file';
        key = loadDevelopmentKey(userDataDir);
      } else {
        throw new Error('Secure credential storage is not configured for this operating system.');
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
