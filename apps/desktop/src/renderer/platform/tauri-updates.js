import { getTauriGlobal } from './tauri-host-broker.js';

export function createTauriUpdateBridge({
  beforeExit = async () => {
    throw new Error('The workbook save guard is unavailable. Restart has been stopped.');
  },
  getTauri = getTauriGlobal,
  enabled = !import.meta.env.DEV
} = {}) {
  let state = !enabled
    ? { enabled: false, status: 'disabled', error: '', sequence: 0 }
    : { enabled: true, status: 'idle', error: '', sequence: 0 };
  let update = null;
  let restartPromise = null;
  const listeners = new Set();

  function publish(patch) {
    state = { ...state, ...patch, sequence: state.sequence + 1 };
    for (const listener of [...listeners]) listener({ ...state });
    return { ...state };
  }

  async function checkForUpdates() {
    if (!state.enabled) return { ok: false, disabled: true, state: { ...state } };
    publish({ status: 'checking', error: '' });
    try {
      const updater = getTauri().updater;
      if (!(updater && typeof updater.check === 'function')) {
        throw new Error('The signed desktop updater is unavailable.');
      }
      update = await updater.check({ timeout: 30_000 });
      if (!update) return { ok: true, state: publish({ status: 'up-to-date', available: null }) };
      const available = {
        version: String(update.version || ''),
        currentVersion: String(update.currentVersion || ''),
        date: String(update.date || ''),
        body: String(update.body || '')
      };
      return { ok: true, available, state: publish({ status: 'available', available }) };
    } catch (error) {
      const text = error && error.message ? error.message : 'Unable to check for updates.';
      return { ok: false, error: text, state: publish({ status: 'error', error: text }) };
    }
  }

  async function downloadUpdate() {
    if (!update) return { ok: false, error: 'Check for an update first.', state: { ...state } };
    let downloadedBytes = 0;
    let contentLength = 0;
    publish({ status: 'downloading', downloadedBytes: 0, contentLength: 0, error: '' });
    try {
      if (typeof update.download === 'function') {
        await update.download((event) => {
          const kind = String(event && event.event ? event.event : '').toLowerCase();
          if (kind === 'started') contentLength = Number(event.data?.contentLength) || 0;
          if (kind === 'progress') downloadedBytes += Number(event.data?.chunkLength) || 0;
          publish({ status: 'downloading', downloadedBytes, contentLength });
        });
      } else if (typeof update.downloadAndInstall === 'function') {
        await beforeExit('update');
        await update.downloadAndInstall((event) => {
          const kind = String(event && event.event ? event.event : '').toLowerCase();
          if (kind === 'started') contentLength = Number(event.data?.contentLength) || 0;
          if (kind === 'progress') downloadedBytes += Number(event.data?.chunkLength) || 0;
          publish({ status: 'downloading', downloadedBytes, contentLength });
        });
        update.__cavalryInstalled = true;
      } else {
        throw new Error('This updater does not support downloads.');
      }
      return { ok: true, state: publish({ status: 'ready', downloadedBytes, contentLength }) };
    } catch (error) {
      const text = error && error.message ? error.message : 'Unable to download the update.';
      return { ok: false, error: text, state: publish({ status: 'error', error: text }) };
    }
  }

  async function performRestart() {
    if (!update) return { ok: false, error: 'No downloaded update is ready.', state: { ...state } };
    const selectedUpdate = update;
    let saved = false;
    try {
      await beforeExit('update');
      saved = true;
      publish({ status: 'installing', error: '' });
      if (!selectedUpdate.__cavalryInstalled) {
        if (typeof selectedUpdate.install !== 'function') {
          throw new Error('This updater cannot install the downloaded update.');
        }
        await selectedUpdate.install();
        selectedUpdate.__cavalryInstalled = true;
      }
      // Installation can take time. Save again so edits made while it was running survive too.
      saved = false;
      await beforeExit('update');
      saved = true;
      await getTauri().core.invoke('relaunch_app');
      return { ok: true, state: { ...state } };
    } catch (error) {
      const text = error && error.message ? error.message : 'Unable to install the update.';
      return {
        ok: false,
        error: text,
        state: publish({ status: saved ? 'error' : 'ready', error: text })
      };
    }
  }

  function restartAndInstall() {
    if (!restartPromise) {
      restartPromise = performRestart().finally(() => {
        restartPromise = null;
      });
    }
    return restartPromise;
  }

  return Object.freeze({
    getState: async () => ({ ok: true, state: { ...state } }),
    checkForUpdates,
    downloadUpdate,
    restartAndInstall,
    onStateChanged(callback) {
      if (typeof callback !== 'function') return () => {};
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  });
}
