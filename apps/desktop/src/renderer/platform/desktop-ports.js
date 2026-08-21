import { fingerprintEntity } from '@cavalry/action-review/domain/checkpoints/entity-fingerprint.js';
import {
  deserializeWorkbookFromFile,
  normalizeLoadedWorkbook,
  serializeWorkbookForSave
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';

import { createIndexedDbWorkbookCache } from './indexeddb-cache.js';
import { createNullRendererPorts } from './ports.js';

function createWorkbookStorage(bridge) {
  let activeFileState = 'unknown';

  function noteLoadedFile(result) {
    if (result && result.status === 'loaded') activeFileState = 'available';
    return result;
  }

  function needsActiveFileResult() {
    return { ok: false, needsFile: true, error: 'No workbook file selected.' };
  }

  function decodeRecentWorkbooks(result) {
    const workbooks = Array.isArray(result && result.workbooks) ? result.workbooks : [];
    return {
      ok: result ? result.ok !== false : false,
      error: result && result.error ? String(result.error) : '',
      workbooks: workbooks
        .map((entry) => ({
          id: String((entry && entry.id) || '').slice(0, 128),
          fileName: String((entry && entry.fileName) || '').slice(0, 240),
          folderName: String((entry && entry.folderName) || '').slice(0, 240),
          lastUsedAt: String((entry && entry.lastUsedAt) || '').slice(0, 64),
          savedAt: String((entry && entry.savedAt) || '').slice(0, 64)
        }))
        .filter((entry) => entry.id && entry.fileName)
    };
  }

  function decodeFileResult(result) {
    if (result && result.ok && result.text) {
      const decoded = deserializeWorkbookFromFile(result.text, { rejectInvalid: true });
      return {
        status: 'loaded',
        source: 'native',
        workbook: decoded.workbook,
        warnings: [
          ...(Array.isArray(decoded.validation.warnings) ? decoded.validation.warnings : []),
          ...(result.warning
            ? [{ code: 'workbook.backup_recovered', message: result.warning }]
            : [])
        ],
        file: {
          fileName: result.fileName || '',
          savedAt: result.savedAt || '',
          recoveredFromBackup: result.recoveredFromBackup === true,
          backupFileName: result.backupFileName || ''
        }
      };
    }
    return {
      status:
        result && result.canceled
          ? 'canceled'
          : result && result.missing
            ? 'missing'
            : result && result.empty
              ? 'empty'
              : result && result.error
                ? 'error'
                : 'empty',
      source: 'native',
      error: result && result.error ? result.error : ''
    };
  }

  return {
    async listRecent() {
      if (!(bridge && typeof bridge.listRecentWorkbooks === 'function')) {
        return { ok: false, unavailable: true, workbooks: [] };
      }
      try {
        return decodeRecentWorkbooks(await bridge.listRecentWorkbooks());
      } catch (error) {
        return {
          ok: false,
          workbooks: [],
          error: error && error.message ? error.message : 'Recent workbooks could not be loaded.'
        };
      }
    },
    async load() {
      if (!(bridge && typeof bridge.getActiveWorkbookFile === 'function')) {
        return { status: 'unavailable', source: 'native' };
      }
      try {
        const result = decodeFileResult(await bridge.getActiveWorkbookFile());
        if (result.status === 'empty') activeFileState = 'missing';
        return noteLoadedFile(result);
      } catch (error) {
        return {
          status: 'error',
          source: 'native',
          error: error && error.message ? error.message : 'The workbook file could not be loaded.'
        };
      }
    },
    async open() {
      if (!(bridge && typeof bridge.openWorkbookFile === 'function')) {
        return { status: 'unavailable', source: 'native' };
      }
      try {
        return noteLoadedFile(decodeFileResult(await bridge.openWorkbookFile()));
      } catch (error) {
        return {
          status: 'error',
          source: 'native',
          error: error && error.message ? error.message : 'The workbook file could not be opened.'
        };
      }
    },
    async openRecent(id) {
      if (!(bridge && typeof bridge.openRecentWorkbook === 'function')) {
        return { status: 'unavailable', source: 'native' };
      }
      try {
        return noteLoadedFile(
          decodeFileResult(await bridge.openRecentWorkbook({ id: String(id || '') }))
        );
      } catch (error) {
        return {
          status: 'error',
          source: 'native',
          error: error && error.message ? error.message : 'The recent workbook could not be opened.'
        };
      }
    },
    async save(workbook) {
      if (!(bridge && typeof bridge.saveActiveWorkbook === 'function')) {
        return { ok: false, unavailable: true };
      }
      if (activeFileState === 'missing') return needsActiveFileResult();
      const serialized = serializeWorkbookForSave(workbook, { rejectInvalid: true });
      const result = await bridge.saveActiveWorkbook({ html: serialized.html });
      if (result && result.ok) activeFileState = 'available';
      else if (result && result.needsFile) activeFileState = 'missing';
      return result;
    },
    async saveAs(workbook, suggestedName) {
      if (!(bridge && typeof bridge.saveWorkbookAs === 'function')) {
        return { ok: false, unavailable: true };
      }
      const serialized = serializeWorkbookForSave(workbook, { rejectInvalid: true });
      const result = await bridge.saveWorkbookAs({ html: serialized.html, suggestedName });
      if (result && result.ok) activeFileState = 'available';
      return result;
    },
    async forget() {
      if (!(bridge && typeof bridge.forgetActiveWorkbookFile === 'function')) {
        return { ok: false, unavailable: true };
      }
      const result = await bridge.forgetActiveWorkbookFile();
      if (result && result.ok) activeFileState = 'missing';
      return result;
    },
    reveal: () =>
      bridge && typeof bridge.revealActiveWorkbookFile === 'function'
        ? bridge.revealActiveWorkbookFile()
        : Promise.resolve({ ok: false, unavailable: true }),
    subscribe(callback) {
      return bridge && typeof bridge.onCommand === 'function'
        ? bridge.onCommand(callback)
        : () => {};
    }
  };
}

function createAdvisorPort(bridge) {
  return {
    async invoke(command, payload) {
      const method = bridge && bridge[command];
      return typeof method === 'function'
        ? method(payload)
        : { ok: false, unavailable: true, error: `Assistant command ${command} is unavailable.` };
    },
    subscribe(callback) {
      if (!(bridge && typeof bridge.onStatus === 'function') || typeof callback !== 'function') {
        return () => {};
      }
      return bridge.onStatus((status) => {
        if (String(status?.phase || '').trim() === 'stream') {
          const requestId = String(status?.requestId || '').trim();
          const delta = String(status?.delta ?? '').slice(0, 16_384);
          // Stream text stays an ephemeral status event. The assistant view owns the
          // request-scoped accumulator and public-output sanitizer; this port never stores it.
          if (!requestId || (!delta && status?.reset !== true)) return;
          callback({
            phase: 'stream',
            requestId,
            delta,
            segment: Number(status?.segment) || 0,
            reset: status?.reset === true,
            final: status?.final === true
          });
          return;
        }
        callback(status);
      });
    }
  };
}

function createCompanionPort(bridge) {
  let enabledStatePromise = null;

  async function getEnabledState() {
    if (!(bridge && typeof bridge.getStatus === 'function')) return true;
    if (!enabledStatePromise) {
      enabledStatePromise = Promise.resolve()
        .then(() => bridge.getStatus())
        .then((result) => (result && result.status ? result.status.enabled !== false : true))
        .catch(() => true);
    }
    return enabledStatePromise;
  }

  return {
    async publish(payload) {
      if (!(bridge && typeof bridge.publishWorkbook === 'function')) {
        return { ok: false, unavailable: true };
      }
      if (!(await getEnabledState())) return { ok: false, disabled: true };
      const result = await bridge.publishWorkbook(payload);
      if (result && result.disabled) enabledStatePromise = Promise.resolve(false);
      return result;
    },
    getStatus: () =>
      bridge && typeof bridge.getStatus === 'function'
        ? bridge.getStatus()
        : Promise.resolve({ status: 'unavailable' }),
    subscribe(callback) {
      const disposers = [];
      if (bridge && typeof bridge.onWorkbookUpdated === 'function')
        disposers.push(bridge.onWorkbookUpdated(callback));
      if (bridge && typeof bridge.onStatus === 'function')
        disposers.push(bridge.onStatus(callback));
      return () => disposers.forEach((dispose) => typeof dispose === 'function' && dispose());
    }
  };
}

const CLOUD_BRIDGE_METHODS = Object.freeze({
  getState: 'getState',
  linkAppleIdentity: 'linkAppleIdentity',
  signInWithApple: 'signInWithApple',
  signInWithGoogle: 'signInWithGoogle',
  signOut: 'signOut',
  updateProfile: 'updateProfile',
  listWorkbooks: 'listWorkbooks',
  uploadWorkbook: 'uploadWorkbook',
  downloadWorkbook: 'downloadWorkbook',
  deleteWorkbook: 'deleteWorkbook'
});

function createCloudPort(bridge) {
  return {
    async invoke(command, payload = {}) {
      const methodName = CLOUD_BRIDGE_METHODS[command];
      const method = methodName && bridge && bridge[methodName];
      if (typeof method !== 'function') {
        return {
          ok: false,
          unavailable: true,
          error: 'Cavalry Cloud is unavailable in this build.'
        };
      }
      try {
        let bridgePayload = payload;
        if (command === 'uploadWorkbook' && payload && payload.workbook) {
          const workbook = normalizeLoadedWorkbook(payload.workbook);
          const portable = serializeWorkbookForSave(workbook, { rejectInvalid: true });
          bridgePayload = {
            localWorkbookId: workbook.id,
            name: workbook.name,
            year: workbook.year,
            currency: workbook.currency,
            schemaVersion: workbook.version,
            sourceUpdatedAt: workbook.updatedAt,
            expectedRevision: payload.expectedRevision,
            portableHtml: portable.html
          };
        }
        const result = await method(bridgePayload);
        if (command === 'downloadWorkbook' && result && result.ok) {
          const downloaded = result.workbook
            ? result.workbook
            : result.portableHtml
              ? deserializeWorkbookFromFile(result.portableHtml, { rejectInvalid: true }).workbook
              : null;
          if (!downloaded) {
            return { ok: false, error: 'The cloud workbook did not contain a valid snapshot.' };
          }
          return {
            ...result,
            portableHtml: undefined,
            workbook: normalizeLoadedWorkbook(downloaded)
          };
        }
        return result || { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : 'The cloud request failed.'
        };
      }
    },
    subscribe(callback) {
      return bridge && typeof bridge.onStateChanged === 'function'
        ? bridge.onStateChanged(callback)
        : () => {};
    }
  };
}

const FEEDBACK_BRIDGE_METHODS = Object.freeze({
  list: 'listFeedbackReports',
  submit: 'submitFeedbackReport',
  download: 'getFeedbackAttachment'
});

function createFeedbackPort(bridge) {
  return {
    async invoke(operation, payload = {}) {
      const methodName = FEEDBACK_BRIDGE_METHODS[operation];
      const method = methodName && bridge && bridge[methodName];
      if (typeof method !== 'function') {
        return {
          ok: false,
          unavailable: true,
          error: 'Cloud feedback is unavailable in this build.'
        };
      }
      try {
        return (await method(payload)) || { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : 'The feedback request failed.'
        };
      }
    }
  };
}

const UPDATE_BRIDGE_METHODS = Object.freeze({
  getState: 'getState',
  checkForUpdates: 'checkForUpdates',
  downloadUpdate: 'downloadUpdate',
  restartAndInstall: 'restartAndInstall'
});

function createUpdatePort(bridge) {
  return {
    async invoke(command) {
      const methodName = UPDATE_BRIDGE_METHODS[command];
      const method = methodName && bridge && bridge[methodName];
      if (typeof method !== 'function') {
        return {
          ok: false,
          unavailable: true,
          state: { enabled: false, status: 'disabled' }
        };
      }
      try {
        return (await method()) || { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : 'The update request failed.'
        };
      }
    },
    subscribe(callback) {
      return bridge && typeof bridge.onStateChanged === 'function'
        ? bridge.onStateChanged(callback)
        : () => {};
    }
  };
}

function createDownloadPort(browserWindow) {
  return {
    async save(payload = {}) {
      const documentObject = browserWindow && browserWindow.document;
      const URLObject = browserWindow && browserWindow.URL;
      const BlobConstructor = browserWindow && browserWindow.Blob;
      if (!(documentObject && URLObject && BlobConstructor)) {
        return { ok: false, unavailable: true, error: 'Browser download support is unavailable.' };
      }
      const blob = new BlobConstructor([String(payload.contents || '')], {
        type: String(payload.mimeType || 'application/octet-stream')
      });
      const objectUrl = URLObject.createObjectURL(blob);
      const anchor = documentObject.createElement('a');
      anchor.href = objectUrl;
      anchor.download = String(payload.suggestedName || 'cavalry-export.txt');
      anchor.style.display = 'none';
      documentObject.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        URLObject.revokeObjectURL(objectUrl);
      }
      return { ok: true, suggestedName: anchor.download };
    }
  };
}

function createFilePickerPort(browserWindow) {
  return {
    openText(payload = {}) {
      const documentObject = browserWindow && browserWindow.document;
      if (!documentObject) {
        return Promise.resolve({
          ok: false,
          unavailable: true,
          error: 'File picker support is unavailable.'
        });
      }
      return new Promise((resolve) => {
        const input = documentObject.createElement('input');
        input.type = 'file';
        input.accept = String(payload.accept || '');
        input.style.display = 'none';
        documentObject.body.appendChild(input);
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          input.remove();
          resolve(result);
        };
        input.addEventListener(
          'change',
          async () => {
            const file = input.files && input.files[0];
            if (!file) {
              finish({ ok: false, canceled: true });
              return;
            }
            try {
              finish({ ok: true, fileName: file.name, text: await file.text() });
            } catch (error) {
              finish({
                ok: false,
                error:
                  error && error.message ? error.message : 'The selected file could not be read.'
              });
            }
          },
          { once: true }
        );
        input.addEventListener('cancel', () => finish({ ok: false, canceled: true }), {
          once: true
        });
        input.click();
      });
    }
  };
}

export function createDesktopRendererPorts(bridge = {}, globalObject = globalThis) {
  const hasNativeBridge = Boolean(
    bridge && (bridge.files || bridge.advisor || bridge.companion || bridge.cloud || bridge.updates)
  );
  const hasLegacyBridge = Boolean(
    bridge &&
    (bridge.window ||
      bridge.cavalryFiles ||
      bridge.cavalryAdvisor ||
      bridge.cavalryCompanion ||
      bridge.cavalryCloud ||
      bridge.cavalryUpdates)
  );
  const legacyGlobal = !hasNativeBridge && hasLegacyBridge ? bridge : null;
  const sourceGlobal = legacyGlobal || globalObject;
  const browserWindow = sourceGlobal && sourceGlobal.window ? sourceGlobal.window : sourceGlobal;
  const fallbackWindow = globalObject && globalObject.window ? globalObject.window : globalObject;
  const legacyWindow = legacyGlobal ? browserWindow : !hasNativeBridge ? fallbackWindow : null;
  const nativeBridge = legacyWindow
    ? {
        files: legacyWindow.cavalryFiles,
        advisor: legacyWindow.cavalryAdvisor,
        companion: legacyWindow.cavalryCompanion,
        cloud: legacyWindow.cavalryCloud,
        updates: legacyWindow.cavalryUpdates
      }
    : bridge;
  const cache = createIndexedDbWorkbookCache(browserWindow && browserWindow.indexedDB);
  const browserCache = {
    async load() {
      const result = await cache.load();
      if (result.status !== 'loaded') return result;
      try {
        return { ...result, workbook: normalizeLoadedWorkbook(result.workbook) };
      } catch (error) {
        return {
          status: 'error',
          source: 'cache',
          error: error && error.message ? error.message : 'The cached workbook could not be loaded.'
        };
      }
    },
    save: (workbook) => cache.save(workbook),
    clear: () => cache.clear()
  };
  let idSequence = 0;
  return createNullRendererPorts({
    workbookStorage: createWorkbookStorage(nativeBridge.files),
    browserCache,
    advisor: createAdvisorPort(nativeBridge.advisor),
    companion: createCompanionPort(nativeBridge.companion),
    cloud: createCloudPort(nativeBridge.cloud),
    feedback: createFeedbackPort(nativeBridge.cloud),
    updates: createUpdatePort(nativeBridge.updates),
    downloads: createDownloadPort(browserWindow),
    filePicker: createFilePickerPort(browserWindow),
    ids: {
      create(prefix = 'id') {
        idSequence += 1;
        return `${prefix}_${Date.now().toString(36)}_${idSequence.toString(36)}`;
      }
    },
    fingerprint: { create: fingerprintEntity }
  });
}
