// Owns renderer-safe iCloud state while native CKSyncEngine handles transport and retries.
'use strict';

const { createCloudWorkbookController } = require('./cloud-workbook-controller.cjs');

const CLOUD_IPC_CHANNELS = Object.freeze({
  getState: 'cavalry-cloud:get-state',
  listWorkbooks: 'cavalry-cloud:list-workbooks',
  uploadWorkbook: 'cavalry-cloud:upload-workbook',
  downloadWorkbook: 'cavalry-cloud:download-workbook',
  downloadConflictPackage: 'cavalry-cloud:download-conflict-package',
  deleteWorkbook: 'cavalry-cloud:delete-workbook',
  publishConflictNotice: 'cavalry-cloud:publish-conflict-notice',
  clearConflictNotice: 'cavalry-cloud:clear-conflict-notice',
  stateChanged: 'cavalry-cloud:state-changed'
});

function text(value, maximum = 512) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, maximum);
}

function createCloudController(dependencies = {}) {
  const BrowserWindow = dependencies.BrowserWindow;
  const ipcMain = dependencies.ipcMain;
  const assertTrustedSender = dependencies.assertTrustedSender;
  if (typeof assertTrustedSender !== 'function') {
    throw new Error('A trusted IPC sender guard is required.');
  }

  const workbookController = createCloudWorkbookController({
    cloudKit: dependencies.cloudKit,
    getPersistenceService: dependencies.getPersistenceService
  });
  let handlersRegistered = false;
  let disposed = false;
  let account = { status: 'could_not_determine', userId: '' };
  let statusChecked = false;
  let workbooks = [];
  let pendingCount = 0;
  let lastSyncAt = '';
  let stateError = '';
  let stateErrorCode = '';
  let stateErrorDetails = '';
  let stateErrorRetryable = false;
  let stateErrorOperation = '';
  let stateErrorWorkbookId = '';
  let sessionGeneration = 0;
  let workbookChange = null;
  let workbookChangeSequence = 0;
  let workbookMutationInProgress = false;
  let initializationPromise = null;
  let nativeRefreshPromise = null;
  let nativeRefreshQueued = false;
  let queuedNativeEvent = null;

  function userForAccount() {
    if (account.status !== 'available') return null;
    return {
      id: text(account.userId, 256) || 'icloud-private',
      name: 'iCloud',
      email: '',
      avatarUrl: '',
      provider: 'icloud',
      providers: ['icloud']
    };
  }

  function publicStatus() {
    if (!statusChecked) return 'initializing';
    if (account.status === 'available') return 'signed_in';
    if (account.status === 'no_account') return 'signed_out';
    return 'unavailable';
  }

  function accountMessage() {
    if (!statusChecked) return '';
    if (stateError) return stateError;
    if (account.status === 'no_account') {
      return 'Sign in to iCloud in System Settings to sync Cavalry across your Apple devices.';
    }
    if (account.status === 'restricted') {
      return 'iCloud access is restricted for this Mac account.';
    }
    if (account.status === 'temporarily_unavailable') {
      return 'iCloud is temporarily unavailable. Cavalry will retry automatically.';
    }
    if (account.status === 'could_not_determine') {
      return 'Cavalry could not determine the iCloud account status. Try Sync Now again.';
    }
    return '';
  }

  function getState() {
    return {
      configured: true,
      status: publicStatus(),
      user: userForAccount(),
      sessionGeneration,
      sessionPersistence: true,
      workbooks: workbooks.map((workbook) => ({ ...workbook })),
      pendingCount,
      lastSyncAt,
      error: accountMessage(),
      errorCode: stateErrorCode,
      errorDetails: stateErrorDetails,
      errorRetryable: stateErrorRetryable,
      errorOperation: stateErrorOperation,
      errorWorkbookId: stateErrorWorkbookId,
      ...(workbookChange ? { workbookChange: { ...workbookChange } } : {})
    };
  }

  function broadcastState() {
    const nextState = getState();
    const windows =
      BrowserWindow && BrowserWindow.getAllWindows ? BrowserWindow.getAllWindows() : [];
    windows.forEach((window) => {
      const windowAlive =
        window && (typeof window.isDestroyed !== 'function' || !window.isDestroyed());
      const contentsAlive =
        windowAlive &&
        window.webContents &&
        (typeof window.webContents.isDestroyed !== 'function' || !window.webContents.isDestroyed());
      if (contentsAlive && typeof window.webContents.send === 'function') {
        window.webContents.send(CLOUD_IPC_CHANNELS.stateChanged, nextState);
      }
    });
    return nextState;
  }

  function applyStatus(result) {
    statusChecked = true;
    if (!(result && result.ok)) {
      stateError = text(result && result.error) || 'iCloud status is temporarily unavailable.';
      stateErrorCode = text(result && result.code, 96);
      stateErrorDetails = text(result && result.errorDetails, 1024);
      stateErrorRetryable = result && result.retryable === true;
      stateErrorOperation = text(result && result.errorOperation, 32);
      stateErrorWorkbookId = text(result && result.errorWorkbookId, 128);
      return false;
    }
    const nextAccount = result.account && typeof result.account === 'object' ? result.account : {};
    const next = {
      status: text(nextAccount.status, 64) || 'could_not_determine',
      userId: text(nextAccount.userId, 256)
    };
    const previousIdentity = `${account.status}:${account.userId}`;
    const nextIdentity = `${next.status}:${next.userId}`;
    if (previousIdentity !== nextIdentity) {
      sessionGeneration += 1;
      workbooks = [];
      workbookChange = null;
    }
    account = next;
    pendingCount = Number.isSafeInteger(Number(result.pendingCount))
      ? Number(result.pendingCount)
      : pendingCount;
    lastSyncAt = text(result.lastSyncAt, 64) || lastSyncAt;
    stateError = text(result.error, 512);
    stateErrorCode = text(result.code, 96);
    stateErrorDetails = text(result.errorDetails, 1024);
    stateErrorRetryable = result.retryable === true;
    stateErrorOperation = text(result.errorOperation, 32);
    stateErrorWorkbookId = text(result.errorWorkbookId, 128);
    return true;
  }

  function applyLibrary(result) {
    if (!(result && result.ok)) {
      stateError = text(result && result.error) || 'iCloud workbooks could not be loaded.';
      stateErrorCode = text(result && result.code, 96);
      stateErrorDetails = text(result && result.errorDetails, 1024);
      stateErrorRetryable = result && result.retryable === true;
      stateErrorOperation = text(result && result.errorOperation, 32);
      stateErrorWorkbookId = text(result && result.errorWorkbookId, 128);
      return false;
    }
    workbooks = result.workbooks;
    pendingCount = Number.isSafeInteger(Number(result.pendingCount))
      ? Number(result.pendingCount)
      : pendingCount;
    lastSyncAt = text(result.lastSyncAt, 64) || lastSyncAt;
    stateError = text(result.error, 512);
    stateErrorCode = text(result.errorCode, 96);
    stateErrorDetails = text(result.errorDetails, 1024);
    stateErrorRetryable = result.retryable === true;
    stateErrorOperation = text(result.errorOperation, 32);
    stateErrorWorkbookId = text(result.errorWorkbookId, 128);
    return true;
  }

  async function refreshStatus() {
    const result = await workbookController.status();
    applyStatus(result);
    return result;
  }

  async function refreshLibrary({ refresh = true } = {}) {
    const result = await workbookController.listWorkbooks({ refresh });
    applyLibrary(result);
    return result;
  }

  async function initialize() {
    if (initializationPromise) return initializationPromise;
    const operation = (async () => {
      await refreshStatus();
      if (account.status === 'available') await refreshLibrary({ refresh: true });
      return broadcastState();
    })();
    initializationPromise = operation;
    try {
      return await operation;
    } finally {
      if (initializationPromise === operation) initializationPromise = null;
      if (nativeRefreshQueued) drainNativeRefreshes();
    }
  }

  async function initializedState() {
    return statusChecked ? getState() : initialize();
  }

  async function restoreExistingSession() {
    return initialize();
  }

  async function listWorkbooks() {
    await refreshStatus();
    if (account.status !== 'available') {
      return {
        ok: false,
        code: 'icloud_account_unavailable',
        error: accountMessage() || 'iCloud is unavailable.',
        state: broadcastState()
      };
    }
    const result = await refreshLibrary({ refresh: true });
    return { ...result, state: broadcastState() };
  }

  function mutateWorkbook(method, payload) {
    if (workbookMutationInProgress) {
      return {
        ok: false,
        code: 'cloud_operation_in_progress',
        error: 'Another iCloud workbook operation is already in progress.',
        state: getState()
      };
    }
    workbookMutationInProgress = true;
    return (async () => {
      try {
        const result = await workbookController[method](payload || {});
        await refreshLibrary({ refresh: false });
        return { ...result, state: broadcastState() };
      } finally {
        workbookMutationInProgress = false;
      }
    })();
  }

  async function downloadWorkbook(payload) {
    const result = await workbookController.downloadWorkbook(payload || {});
    return { ...result, state: getState() };
  }

  async function downloadConflictPackage(payload) {
    const result = await workbookController.downloadConflictPackage(payload || {});
    return { ...result, state: getState() };
  }

  function noteWorkbookChange(event) {
    const workbookId = text(event && event.workbookId, 128);
    if (!workbookId) return;
    const remote = workbooks.find((candidate) => candidate.id === workbookId);
    workbookChange = {
      sequence: ++workbookChangeSequence,
      eventType: event && event.reason === 'deleted' ? 'DELETE' : 'UPDATE',
      workbookId,
      revision: remote ? remote.revision : 0,
      updatedAt: remote ? remote.updatedAt : ''
    };
  }

  function drainNativeRefreshes() {
    if (disposed || nativeRefreshPromise || initializationPromise || !statusChecked) return;
    const event = queuedNativeEvent || {};
    queuedNativeEvent = null;
    nativeRefreshQueued = false;
    const operation = (async () => {
      if (event.reason === 'account_changed') await refreshStatus();
      if (account.status === 'available') await refreshLibrary({ refresh: false });
      noteWorkbookChange(event);
      broadcastState();
    })();
    nativeRefreshPromise = operation;
    void operation
      .catch((error) => {
        stateError = text(error && error.message) || 'iCloud state could not be refreshed.';
        stateErrorCode = 'cloud_state_refresh_failed';
        stateErrorDetails = '';
        stateErrorRetryable = true;
        stateErrorOperation = 'refresh';
        stateErrorWorkbookId = '';
        broadcastState();
      })
      .finally(() => {
        if (nativeRefreshPromise === operation) nativeRefreshPromise = null;
        if (nativeRefreshQueued) drainNativeRefreshes();
      });
  }

  function handleNativeEvent(source, payload) {
    if (disposed || source !== 'cloudkit') return false;
    queuedNativeEvent = payload && typeof payload === 'object' ? payload : {};
    nativeRefreshQueued = true;
    drainNativeRefreshes();
    return true;
  }

  function trusted(handler) {
    return async (event, payload) => {
      assertTrustedSender(event);
      return handler(payload || {});
    };
  }

  function registerHandlers() {
    if (handlersRegistered) return;
    handlersRegistered = true;
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.getState,
      trusted(async () => ({ ok: true, state: await initializedState() }))
    );
    ipcMain.handle(CLOUD_IPC_CHANNELS.listWorkbooks, trusted(listWorkbooks));
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.uploadWorkbook,
      trusted((payload) => mutateWorkbook('uploadWorkbook', payload))
    );
    ipcMain.handle(CLOUD_IPC_CHANNELS.downloadWorkbook, trusted(downloadWorkbook));
    ipcMain.handle(CLOUD_IPC_CHANNELS.downloadConflictPackage, trusted(downloadConflictPackage));
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.deleteWorkbook,
      trusted((payload) => mutateWorkbook('deleteWorkbook', payload))
    );
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.publishConflictNotice,
      trusted((payload) => mutateWorkbook('publishConflictNotice', payload))
    );
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.clearConflictNotice,
      trusted((payload) => mutateWorkbook('clearConflictNotice', payload))
    );
  }

  function dispose() {
    disposed = true;
    queuedNativeEvent = null;
    nativeRefreshQueued = false;
  }

  return {
    dispose,
    getState,
    handleNativeEvent,
    initialize,
    registerHandlers,
    restoreExistingSession
  };
}

module.exports = { CLOUD_IPC_CHANNELS, createCloudController };
