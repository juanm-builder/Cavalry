// Seals the Advisor API key at rest with Electron safeStorage when the OS keychain is available.
'use strict';

const SECURE_ADVISOR_STORAGE_ERROR = 'Secure operating-system credential storage is unavailable.';

function canEncryptAdvisorApiKey(safeStorage) {
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

function sealAdvisorApiKey(safeStorage, stored, apiKey) {
  delete stored.apiKey;
  delete stored.apiKeyEncrypted;
  if (!apiKey) return stored;
  if (!canEncryptAdvisorApiKey(safeStorage)) {
    throw new Error(SECURE_ADVISOR_STORAGE_ERROR);
  }
  stored.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64');
  return stored;
}

function unsealAdvisorApiKey(safeStorage, stored) {
  if (!stored || typeof stored !== 'object') return stored;
  const { apiKeyEncrypted, apiKey: legacyApiKey, ...rest } = stored;
  if (canEncryptAdvisorApiKey(safeStorage)) {
    try {
      if (apiKeyEncrypted) {
        rest.apiKey = safeStorage.decryptString(Buffer.from(String(apiKeyEncrypted), 'base64'));
      } else if (legacyApiKey) {
        rest.apiKey = String(legacyApiKey);
      }
    } catch (_error) {
      // A keychain reset or copied profile drops the unusable secret in memory.
    }
  }
  return rest;
}

function hasLegacyPlaintextAdvisorApiKey(stored) {
  return !!(
    stored &&
    typeof stored === 'object' &&
    Object.prototype.hasOwnProperty.call(stored, 'apiKey')
  );
}

function hasStoredAdvisorApiKey(stored) {
  return !!(
    stored &&
    typeof stored === 'object' &&
    (Object.prototype.hasOwnProperty.call(stored, 'apiKey') ||
      Object.prototype.hasOwnProperty.call(stored, 'apiKeyEncrypted'))
  );
}

module.exports = {
  SECURE_ADVISOR_STORAGE_ERROR,
  canEncryptAdvisorApiKey,
  hasLegacyPlaintextAdvisorApiKey,
  hasStoredAdvisorApiKey,
  sealAdvisorApiKey,
  unsealAdvisorApiKey
};
