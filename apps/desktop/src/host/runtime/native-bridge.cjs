'use strict';

const { randomUUID } = require('node:crypto');

function createNativeBridge({ emitRequest, timeoutMs = 120_000 } = {}) {
  const pending = new Map();
  const send = typeof emitRequest === 'function' ? emitRequest : () => undefined;

  function request(method, payload = {}) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`Native desktop request timed out: ${method}`);
        error.code = 'native_request_timeout';
        reject(error);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      pending.set(id, { resolve, reject, timer });
      try {
        send({ id, method: String(method || ''), payload });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function respond(message = {}) {
    const id = String(message.id || '');
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (message.ok === false) {
      const error = new Error(
        String(
          (message.error && message.error.message) || message.error || 'Native request failed.'
        )
      );
      error.code = String((message.error && message.error.code) || 'native_request_failed');
      entry.reject(error);
    } else {
      entry.resolve(message.result);
    }
    return true;
  }

  function rejectAll(reason = 'The desktop host stopped.') {
    const error = new Error(reason);
    error.code = 'desktop_host_stopped';
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  return Object.freeze({ request, respond, rejectAll });
}

function createDialogAdapter(nativeBridge) {
  return Object.freeze({
    async showOpenDialog(options = {}) {
      const result = await nativeBridge.request('dialog.open', options);
      const filePaths = Array.isArray(result && result.filePaths)
        ? result.filePaths.map((value) => String(value || '')).filter(Boolean)
        : [];
      return { canceled: !!(result && result.canceled), filePaths };
    },
    async showSaveDialog(options = {}) {
      const result = await nativeBridge.request('dialog.save', options);
      return {
        canceled: !!(result && result.canceled),
        filePath: String((result && result.filePath) || '')
      };
    },
    async showMessageBox(options = {}) {
      const result = await nativeBridge.request('dialog.message', options);
      return {
        response: Number.isInteger(result && result.response) ? result.response : 0,
        checkboxChecked: !!(result && result.checkboxChecked)
      };
    }
  });
}

function createShellAdapter(nativeBridge) {
  return Object.freeze({
    openExternal(url) {
      return nativeBridge.request('opener.open-url', { url: String(url || '') });
    },
    showItemInFolder(filePath) {
      void nativeBridge
        .request('opener.reveal-item', { path: String(filePath || '') })
        .catch(() => undefined);
    }
  });
}

module.exports = {
  createDialogAdapter,
  createNativeBridge,
  createShellAdapter
};
