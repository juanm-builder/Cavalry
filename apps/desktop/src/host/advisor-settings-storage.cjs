// Loads and atomically persists Advisor settings while keeping API keys fail-closed.
'use strict';

const {
  canEncryptAdvisorApiKey,
  hasLegacyPlaintextAdvisorApiKey,
  hasStoredAdvisorApiKey,
  unsealAdvisorApiKey
} = require('./advisor-key-encryption.cjs');

function createAdvisorSettingsStorage({
  fs,
  path,
  safeStorage,
  getSettingsPath,
  getDefaultSettings,
  normalizeSettings,
  getPersistentSettings
} = {}) {
  let writeQueue = Promise.resolve();

  function persist(stored) {
    const operation = writeQueue.then(async () => {
      const settingsPath = getSettingsPath();
      const tempPath = `${settingsPath}.tmp`;
      await fs.mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(tempPath, JSON.stringify(stored, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
      if (typeof fs.chmod === 'function') await fs.chmod(tempPath, 0o600);
      if (typeof fs.rename !== 'function') {
        throw new Error('Atomic Advisor settings persistence is unavailable.');
      }
      await fs.rename(tempPath, settingsPath);
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async function load() {
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(getSettingsPath(), 'utf8'));
    } catch (_error) {
      return getDefaultSettings();
    }
    const hadLegacyPlaintextKey = hasLegacyPlaintextAdvisorApiKey(parsed);
    const hadStoredKey = hasStoredAdvisorApiKey(parsed);
    const secureStorageAvailable = hadStoredKey && canEncryptAdvisorApiKey(safeStorage);
    let settings = normalizeSettings(
      hadStoredKey ? unsealAdvisorApiKey(safeStorage, parsed) : parsed
    );
    if (hadLegacyPlaintextKey || (hadStoredKey && !secureStorageAvailable)) {
      if (!secureStorageAvailable) settings = normalizeSettings({ ...settings, apiKey: '' });
      await persist(getPersistentSettings(settings));
    }
    return settings;
  }

  return Object.freeze({ load, persist });
}

module.exports = { createAdvisorSettingsStorage };
