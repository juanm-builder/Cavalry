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
  loadSyncState: 'cavalry-cloud:load-sync-state',
  saveSyncState: 'cavalry-cloud:save-sync-state',
  removeSyncState: 'cavalry-cloud:remove-sync-state',
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
  const syncStateStorage = dependencies.syncStateStorage;
  let handlersRegistered = false;
  let disposed = false;
  let account = { status: 'could_not_determine', userId: '' };
  let cloudEnvironment = '';
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
  let queuedNativeEvents = [];

  function userForAccount() {
    if (account.status !== 'available' || !account.userId) return null;
    return {
      id: account.userId,
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
      cloudEnvironment,
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
    const reportedStatus = text(nextAccount.status, 64) || 'could_not_determine';
    const reportedUserId = text(nextAccount.userId, 256);
    const hasVerifiedIdentity = reportedStatus === 'available' && Boolean(reportedUserId);
    const next = {
      status:
        reportedStatus === 'available' && !hasVerifiedIdentity
          ? 'could_not_determine'
          : reportedStatus,
      userId: hasVerifiedIdentity ? reportedUserId : ''
    };
    const nextCloudEnvironment = text(result.cloudEnvironment, 32);
    const previousIdentity = `${cloudEnvironment}:${account.status}:${account.userId}`;
    const nextIdentity = `${nextCloudEnvironment}:${next.status}:${next.userId}`;
    if (previousIdentity !== nextIdentity) {
      sessionGeneration += 1;
      workbooks = [];
      workbookChange = null;
    }
    account = next;
    cloudEnvironment = nextCloudEnvironment;
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

  function syncStateFailure(error, fallbackCode = 'cloud_sync_state_unavailable') {
    return {
      ok: false,
      code: text(error && error.code, 96) || fallbackCode,
      error:
        text(error && error.message, 512) ||
        'Cavalry could not access its local iCloud sync state.',
      failClosed: true
    };
  }

  async function currentSyncStateScope(payload = {}) {
    if (!statusChecked) await refreshStatus();
    const workbookId = String(payload.workbookId || payload.id || '').trim();
    if (workbookId.length > 128 || !/^[A-Za-z0-9._:-]{1,128}$/.test(workbookId)) {
      return {
        error: syncStateFailure(
          Object.assign(new Error('Choose a valid iCloud workbook.'), {
            code: 'invalid_workbook_id'
          })
        )
      };
    }
    if (
      account.status !== 'available' ||
      !account.userId ||
      !['Development', 'Production'].includes(cloudEnvironment)
    ) {
      return {
        error: syncStateFailure(
          Object.assign(new Error('Connect iCloud before loading its local sync state.'), {
            code: 'icloud_account_unavailable'
          })
        )
      };
    }
    if (
      !syncStateStorage ||
      typeof syncStateStorage.load !== 'function' ||
      typeof syncStateStorage.save !== 'function' ||
      typeof syncStateStorage.remove !== 'function'
    ) {
      return {
        error: syncStateFailure(
          Object.assign(new Error('Durable iCloud sync state is unavailable in this build.'), {
            code: 'cloud_sync_state_unavailable'
          })
        )
      };
    }
    return {
      scope: {
        cloudEnvironment,
        accountId: account.userId,
        workbookId
      }
    };
  }

  async function loadSyncState(payload) {
    const resolved = await currentSyncStateScope(payload);
    if (resolved.error) return resolved.error;
    try {
      const result = await syncStateStorage.load(resolved.scope);
      if (!(result && result.ok)) {
        return {
          ok: false,
          code: text(result && result.code, 96) || 'cloud_sync_state_corrupt',
          error: 'Cavalry found unreadable local iCloud sync state.',
          status: text(result && result.status, 32) || 'corrupt',
          failClosed: true
        };
      }
      return result;
    } catch (error) {
      return syncStateFailure(error);
    }
  }

  async function saveSyncState(payload = {}) {
    const resolved = await currentSyncStateScope(payload);
    if (resolved.error) return resolved.error;
    try {
      return await syncStateStorage.save({
        ...resolved.scope,
        syncState: payload.syncState == null ? null : payload.syncState,
        autoSyncEnabled: payload.autoSyncEnabled
      });
    } catch (error) {
      return syncStateFailure(error, 'cloud_sync_state_save_failed');
    }
  }

  async function removeSyncState(payload) {
    const resolved = await currentSyncStateScope(payload);
    if (resolved.error) return resolved.error;
    try {
      return await syncStateStorage.remove(resolved.scope);
    } catch (error) {
      return syncStateFailure(error, 'cloud_sync_state_remove_failed');
    }
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
    // An exact record download is stronger evidence than a cached renderer
    // listing. Refresh the native-cache projection before returning so a stale
    // lower revision can be repaired without the renderer pretending it is
    // already synced.
    if (result && result.ok) await refreshLibrary({ refresh: false });
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
    const events = queuedNativeEvents.length ? queuedNativeEvents : [{}];
    queuedNativeEvents = [];
    nativeRefreshQueued = false;
    const operation = (async () => {
      if (events.some((event) => event.reason === 'account_changed')) await refreshStatus();
      if (account.status === 'available') await refreshLibrary({ refresh: false });
      events.forEach((event) => {
        noteWorkbookChange(event);
        broadcastState();
      });
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
    const event = payload && typeof payload === 'object' ? payload : {};
    const eventKey = `${text(event.reason, 32)}:${text(event.workbookId, 128)}`;
    if (
      !queuedNativeEvents.some(
        (candidate) =>
          `${text(candidate.reason, 32)}:${text(candidate.workbookId, 128)}` === eventKey
      )
    ) {
      queuedNativeEvents.push(event);
    }
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
    ipcMain.handle(CLOUD_IPC_CHANNELS.loadSyncState, trusted(loadSyncState));
    ipcMain.handle(CLOUD_IPC_CHANNELS.saveSyncState, trusted(saveSyncState));
    ipcMain.handle(CLOUD_IPC_CHANNELS.removeSyncState, trusted(removeSyncState));
  }

  function dispose() {
    disposed = true;
    queuedNativeEvents = [];
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
