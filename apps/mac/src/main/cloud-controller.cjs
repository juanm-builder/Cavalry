// Composes main-only cloud auth, workbook RPCs, renderer-safe state, and narrow IPC.
'use strict';

const { createCloudAuthController } = require('./cloud-auth-controller.cjs');
const { createCloudFeedbackController } = require('./cloud-feedback-controller.cjs');
const { createTrustedCloudIpcGuard } = require('./cloud-ipc-security.cjs');
const { createCloudProfileController } = require('./cloud-profile-controller.cjs');
const { createCloudWorkbookController } = require('./cloud-workbook-controller.cjs');

const CLOUD_IPC_CHANNELS = Object.freeze({
  getState: 'cavalry-cloud:get-state',
  signInWithGoogle: 'cavalry-cloud:sign-in-google',
  signOut: 'cavalry-cloud:sign-out',
  updateProfile: 'cavalry-cloud:update-profile',
  listWorkbooks: 'cavalry-cloud:list-workbooks',
  uploadWorkbook: 'cavalry-cloud:upload-workbook',
  downloadWorkbook: 'cavalry-cloud:download-workbook',
  deleteWorkbook: 'cavalry-cloud:delete-workbook',
  listFeedbackReports: 'cavalry-cloud:list-feedback-reports',
  submitFeedbackReport: 'cavalry-cloud:submit-feedback-report',
  getFeedbackAttachment: 'cavalry-cloud:get-feedback-attachment',
  stateChanged: 'cavalry-cloud:state-changed'
});

function createCloudController(dependencies = {}) {
  const BrowserWindow = dependencies.BrowserWindow;
  const ipcMain = dependencies.ipcMain;
  const assertTrustedSender =
    dependencies.assertTrustedSender ||
    createTrustedCloudIpcGuard({
      getMainWindow: dependencies.getMainWindow,
      indexPath: dependencies.indexPath,
      rendererUrl: dependencies.rendererUrl
    });
  let workbooks = [];
  let profileName = '';
  let handlersRegistered = false;
  let cloudSession = { userId: '', generation: 0 };

  function updateCloudSession(authState) {
    const nextUserId =
      authState && authState.status === 'signed_in' && authState.user
        ? String(authState.user.id || '')
        : '';
    if (nextUserId === cloudSession.userId) return;
    cloudSession = { userId: nextUserId, generation: cloudSession.generation + 1 };
  }

  function getState() {
    const authState = auth.getState();
    return {
      ...authState,
      user:
        authState.user && profileName
          ? { ...authState.user, name: profileName }
          : authState.user
            ? { ...authState.user }
            : null,
      sessionGeneration: cloudSession.generation,
      workbooks: workbooks.map((workbook) => ({ ...workbook }))
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

  const auth = createCloudAuthController({
    app: dependencies.app,
    safeStorage: dependencies.safeStorage,
    shell: dependencies.shell,
    supabaseUrl: dependencies.supabaseUrl,
    publishableKey: dependencies.publishableKey,
    createClient: dependencies.createClient,
    createStorage: dependencies.createStorage,
    onStateChange(nextAuthState) {
      updateCloudSession(nextAuthState);
      if (nextAuthState.status !== 'signed_in') {
        workbooks = [];
        profileName = '';
      }
      broadcastState();
    }
  });
  const profileController = createCloudProfileController({ auth });
  const feedbackController = createCloudFeedbackController({
    app: dependencies.app,
    auth,
    getSessionBinding: () => ({ ...cloudSession }),
    nativeImage: dependencies.nativeImage,
    platform: dependencies.platform
  });
  const workbookController = createCloudWorkbookController({
    auth,
    getPersistenceService: dependencies.getPersistenceService
  });

  async function refreshWorkbooks() {
    const result = await workbookController.listWorkbooks();
    if (result.ok) workbooks = result.workbooks;
    return result;
  }

  async function refreshProfile() {
    const result = await profileController.getProfile();
    if (result.ok) profileName = result.profile.name;
    return result;
  }

  async function initialize() {
    await auth.initialize();
    if (auth.isSignedIn()) await Promise.all([refreshProfile(), refreshWorkbooks()]);
    return broadcastState();
  }

  async function restoreExistingSession() {
    await auth.restoreExistingSession();
    if (auth.isSignedIn()) await Promise.all([refreshProfile(), refreshWorkbooks()]);
    return broadcastState();
  }

  async function signInWithGoogle() {
    const result = await auth.signInWithGoogle();
    return { ...result, state: broadcastState() };
  }

  async function handleAuthCallback(callback) {
    const result = await auth.handleAuthCallback(callback);
    if (result.ok && !result.pending) await Promise.all([refreshProfile(), refreshWorkbooks()]);
    return { ...result, state: broadcastState() };
  }

  async function signOut() {
    workbooks = [];
    profileName = '';
    const result = await auth.signOut();
    return { ...result, state: broadcastState() };
  }

  async function listWorkbooks() {
    const [result] = await Promise.all([refreshWorkbooks(), refreshProfile()]);
    return { ...result, state: broadcastState() };
  }

  async function updateProfile(payload) {
    const result = await profileController.updateProfile(payload || {});
    if (result.ok) profileName = result.profile.name;
    return { ...result, state: broadcastState() };
  }

  async function mutateWorkbook(method, payload) {
    const result = await workbookController[method](payload || {});
    if (result.ok) {
      const refreshed = await refreshWorkbooks();
      if (!refreshed.ok && method === 'uploadWorkbook' && result.metadata) {
        workbooks = [
          result.metadata,
          ...workbooks.filter((workbook) => workbook.id !== result.metadata.id)
        ];
      } else if (!refreshed.ok && method === 'deleteWorkbook' && result.id) {
        workbooks = workbooks.filter((workbook) => workbook.id !== result.id);
      }
    }
    return { ...result, state: broadcastState() };
  }

  async function downloadWorkbook(payload) {
    const result = await workbookController.downloadWorkbook(payload || {});
    return { ...result, state: getState() };
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
      trusted(async () => ({ ok: true, state: getState() }))
    );
    ipcMain.handle(CLOUD_IPC_CHANNELS.signInWithGoogle, trusted(signInWithGoogle));
    ipcMain.handle(CLOUD_IPC_CHANNELS.signOut, trusted(signOut));
    ipcMain.handle(CLOUD_IPC_CHANNELS.updateProfile, trusted(updateProfile));
    ipcMain.handle(CLOUD_IPC_CHANNELS.listWorkbooks, trusted(listWorkbooks));
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.uploadWorkbook,
      trusted((payload) => mutateWorkbook('uploadWorkbook', payload))
    );
    ipcMain.handle(CLOUD_IPC_CHANNELS.downloadWorkbook, trusted(downloadWorkbook));
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.deleteWorkbook,
      trusted((payload) => mutateWorkbook('deleteWorkbook', payload))
    );
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.listFeedbackReports,
      trusted((payload) => feedbackController.listReports(payload))
    );
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.submitFeedbackReport,
      trusted((payload) => feedbackController.submitReport(payload))
    );
    ipcMain.handle(
      CLOUD_IPC_CHANNELS.getFeedbackAttachment,
      trusted((payload) => feedbackController.getAttachment(payload))
    );
  }

  function dispose() {
    auth.dispose();
  }

  return {
    dispose,
    getState,
    handleAuthCallback,
    initialize,
    registerHandlers,
    restoreExistingSession
  };
}

module.exports = { CLOUD_IPC_CHANNELS, createCloudController };
