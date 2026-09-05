import { getTauriGlobal } from './tauri-host-broker.js';

export function createTauriLifecycleBridge({ getTauri = getTauriGlobal } = {}) {
  const guards = new Set();
  let registration = null;

  async function reportFailure(error, reason) {
    const action = reason === 'quit' ? 'quit' : reason === 'reload' ? 'reload' : 'restart';
    const message = `Cavalry could not save your latest workbook and did not ${action}. ${
      error?.message || String(error || 'Please try saving again.')
    }`;
    try {
      await getTauri().dialog.message(message, {
        title: 'Workbook save needs attention',
        kind: 'error'
      });
    } catch (_error) {
      globalThis.alert?.(message);
    }
  }

  async function prepareToExit(reason = 'quit') {
    try {
      if (guards.size === 0) {
        throw new Error('The workbook is still opening. Please wait and try again.');
      }
      for (const guard of [...guards]) {
        const result = await guard({ reason });
        if (result?.ok !== true) {
          throw new Error(result?.error || 'Your latest changes have not been saved.');
        }
      }
      return { ok: true };
    } catch (error) {
      await reportFailure(error, reason);
      throw error;
    }
  }

  async function handleQuit() {
    let allow = false;
    try {
      await prepareToExit('quit');
      allow = true;
    } catch (_error) {
      // Keep the app and its current workbook open when saving fails.
    }
    await getTauri().core.invoke('complete_exit', { allow });
  }

  async function start() {
    if (!registration) {
      registration = (async () => {
        const tauri = getTauri();
        await tauri.event.listen('cavalry-before-exit', () => {
          void handleQuit().catch((error) => reportFailure(error, 'quit'));
        });
        await tauri.core.invoke('enable_exit_guard');
      })().catch((error) => {
        registration = null;
        throw error;
      });
    }
    return registration;
  }

  return Object.freeze({
    prepareToExit,
    start,
    onBeforeExit(callback) {
      if (typeof callback !== 'function') return () => {};
      guards.add(callback);
      void start().catch((error) => reportFailure(error, 'quit'));
      return () => guards.delete(callback);
    }
  });
}
