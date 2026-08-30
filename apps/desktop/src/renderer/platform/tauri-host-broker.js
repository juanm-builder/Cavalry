const HOST_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:']);
const ALLOWED_SYSTEM_PROTOCOLS = new Set(['x-apple.systempreferences:']);

// Tauri rejects a command promise with the plain value returned by `Err(String)`, so callers
// reading `error.message` would otherwise drop the host's reason and report a generic failure.
function toHostError(error, channel) {
  if (error instanceof Error) return error;
  const message =
    typeof error === 'string' && error.trim()
      ? error.trim()
      : error && typeof error.message === 'string' && error.message.trim()
        ? error.message.trim()
        : `The Cavalry desktop host failed to handle ${channel}.`;
  const hostError = new Error(message);
  hostError.channel = String(channel || '');
  return hostError;
}

function getTauriGlobal() {
  const tauri = globalThis && globalThis.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') {
    throw new Error('Cavalry is not running inside the Tauri desktop shell.');
  }
  return tauri;
}

function normalizeFilters(filters) {
  return (Array.isArray(filters) ? filters : [])
    .map((filter) => ({
      name: String((filter && filter.name) || 'Files').slice(0, 80),
      extensions: (Array.isArray(filter && filter.extensions) ? filter.extensions : [])
        .map((extension) => String(extension || '').replace(/^\./, ''))
        .filter(Boolean)
    }))
    .filter((filter) => filter.extensions.length);
}

function assertAllowedUrl(rawUrl) {
  const value = String(rawUrl || '').slice(0, 4096);
  const parsed = new URL(value);
  if (
    !ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol) &&
    !ALLOWED_SYSTEM_PROTOCOLS.has(parsed.protocol)
  ) {
    throw new Error(`Cavalry cannot open URLs using ${parsed.protocol}`);
  }
  if (['https:', 'http:'].includes(parsed.protocol) && (parsed.username || parsed.password)) {
    throw new Error('Credential-bearing URLs are not allowed.');
  }
  return value;
}

export async function openExternalUrl(rawUrl) {
  const tauri = getTauriGlobal();
  const value = assertAllowedUrl(rawUrl);
  if (!(tauri.opener && typeof tauri.opener.openUrl === 'function')) {
    throw new Error('The native URL opener is unavailable.');
  }
  await tauri.opener.openUrl(value);
  return { ok: true, opened: true, url: value };
}

async function handleNativeRequest(messageValue) {
  const tauri = getTauriGlobal();
  const request = messageValue && messageValue.request ? messageValue.request : messageValue || {};
  const method = String(request.method || request.operation || '');
  const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};

  if (method === 'dialog.open') {
    if (!(tauri.dialog && typeof tauri.dialog.open === 'function')) {
      throw new Error('The native file picker is unavailable.');
    }
    const selected = await tauri.dialog.open({
      title: String(payload.title || ''),
      multiple: Array.isArray(payload.properties) && payload.properties.includes('multiSelections'),
      directory: Array.isArray(payload.properties) && payload.properties.includes('openDirectory'),
      defaultPath: payload.defaultPath ? String(payload.defaultPath) : undefined,
      filters: normalizeFilters(payload.filters)
    });
    const filePaths = selected == null ? [] : Array.isArray(selected) ? selected : [selected];
    return { canceled: filePaths.length === 0, filePaths: filePaths.map(String) };
  }

  if (method === 'dialog.save') {
    if (!(tauri.dialog && typeof tauri.dialog.save === 'function')) {
      throw new Error('The native save dialog is unavailable.');
    }
    const filePath = await tauri.dialog.save({
      title: String(payload.title || ''),
      defaultPath: payload.defaultPath ? String(payload.defaultPath) : undefined,
      filters: normalizeFilters(payload.filters)
    });
    return { canceled: !filePath, filePath: filePath ? String(filePath) : '' };
  }

  if (method === 'dialog.message') {
    if (!(tauri.dialog && typeof tauri.dialog.message === 'function')) {
      throw new Error('The native message dialog is unavailable.');
    }
    await tauri.dialog.message(String(payload.message || payload.detail || ''), {
      title: String(payload.title || 'Cavalry'),
      kind: payload.type === 'error' ? 'error' : payload.type === 'warning' ? 'warning' : 'info'
    });
    return { response: 0, checkboxChecked: false };
  }

  if (method === 'opener.open-url') {
    await openExternalUrl(payload.url);
    return { ok: true };
  }

  if (method === 'opener.reveal-item') {
    if (!(tauri.opener && typeof tauri.opener.revealItemInDir === 'function')) {
      throw new Error('The native file reveal action is unavailable.');
    }
    await tauri.opener.revealItemInDir(String(payload.path || ''));
    return { ok: true };
  }

  if (method === 'cloudkit.request') {
    return tauri.core.invoke('cloudkit_request', { request: payload });
  }

  throw new Error(`Unsupported native Cavalry request: ${method || 'unknown'}`);
}

class CavalryHostBroker {
  constructor() {
    this.channels = new Map();
    this.disposers = [];
    this.installPromise = null;
    this.closed = false;
  }

  emit(channel, payload) {
    const callbacks = this.channels.get(String(channel || ''));
    if (!callbacks) return;
    for (const callback of [...callbacks]) {
      try {
        callback(payload);
      } catch (error) {
        console.error('A Cavalry desktop event listener failed.', error);
      }
    }
  }

  subscribe(channel, callback) {
    if (typeof callback !== 'function') return () => {};
    const name = String(channel || '');
    const callbacks = this.channels.get(name) || new Set();
    callbacks.add(callback);
    this.channels.set(name, callbacks);
    void this.install();
    return () => {
      callbacks.delete(callback);
      if (!callbacks.size) this.channels.delete(name);
    };
  }

  async invoke(channel, payload = {}) {
    await this.install();
    const tauri = getTauriGlobal();
    const operation = tauri.core.invoke('host_invoke', {
      channel: String(channel || ''),
      payload: payload == null ? {} : payload
    });
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = globalThis.setTimeout(
        () => reject(new Error(`Cavalry desktop host request timed out: ${channel}`)),
        HOST_REQUEST_TIMEOUT_MS
      );
    });
    try {
      return await Promise.race([operation, timeout]);
    } catch (error) {
      throw toHostError(error, channel);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  async respondToNativeRequest(messageValue) {
    const tauri = getTauriGlobal();
    const request =
      messageValue && messageValue.request ? messageValue.request : messageValue || {};
    const id = String(request.id || '');
    if (!id) return;
    try {
      const result = await handleNativeRequest(messageValue);
      await tauri.core.invoke('host_native_response', {
        response: { id, ok: true, result }
      });
    } catch (error) {
      await tauri.core.invoke('host_native_response', {
        response: {
          id,
          ok: false,
          error: {
            code: String((error && error.code) || 'native_request_failed'),
            message: String((error && error.message) || 'Native request failed.')
          }
        }
      });
    }
  }

  async forwardDeepLink(rawUrl) {
    const url = String(rawUrl || '').slice(0, 8192);
    if (!url.toLowerCase().startsWith('cavalry://')) return;
    try {
      await this.invoke('cavalry-host:deep-link', { url });
    } catch (error) {
      console.error('Cavalry could not process a desktop link.', error);
    }
  }

  async install() {
    if (this.installPromise) return this.installPromise;
    this.installPromise = (async () => {
      const tauri = getTauriGlobal();
      if (!(tauri.event && typeof tauri.event.listen === 'function')) {
        throw new Error('The Tauri event API is unavailable.');
      }

      this.disposers.push(
        await tauri.event.listen('cavalry-host-event', (event) => {
          const value =
            event && event.payload && typeof event.payload === 'object' ? event.payload : {};
          this.emit(value.channel, value.payload);
        })
      );
      this.disposers.push(
        await tauri.event.listen('cavalry-native-request', (event) => {
          void this.respondToNativeRequest(event && event.payload);
        })
      );
      this.disposers.push(
        await tauri.event.listen('cavalry-command', (event) => {
          this.emit('cavalry-command', event && event.payload);
        })
      );
      this.disposers.push(
        await tauri.event.listen('cavalry-deep-link', (event) => {
          const urls = Array.isArray(event && event.payload)
            ? event.payload
            : [event && event.payload];
          urls.filter(Boolean).forEach((url) => void this.forwardDeepLink(url));
        })
      );
      this.disposers.push(
        await tauri.event.listen('cavalry-host-fatal', (event) => {
          this.emit('cavalry-host:error', event && event.payload);
        })
      );

      const deepLink = tauri.deepLink;
      if (deepLink && typeof deepLink.onOpenUrl === 'function') {
        try {
          this.disposers.push(
            await deepLink.onOpenUrl((urls) => {
              (Array.isArray(urls) ? urls : [urls])
                .filter(Boolean)
                .forEach((url) => void this.forwardDeepLink(url));
            })
          );
          if (typeof deepLink.getCurrent === 'function') {
            const current = await deepLink.getCurrent();
            (Array.isArray(current) ? current : [current])
              .filter(Boolean)
              .forEach((url) => void this.forwardDeepLink(url));
          }
        } catch (error) {
          console.warn('Cavalry deep-link registration was unavailable.', error);
        }
      }

      globalThis.addEventListener?.('beforeunload', () => this.shutdown(), { once: true });
      return true;
    })().catch((error) => {
      this.installPromise = null;
      throw error;
    });
    return this.installPromise;
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    for (const dispose of this.disposers.splice(0)) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch (_error) {
        // Best effort during application shutdown.
      }
    }
  }
}

let broker = null;

export function getCavalryHostBroker() {
  if (!broker) broker = new CavalryHostBroker();
  return broker;
}

export { getTauriGlobal };
