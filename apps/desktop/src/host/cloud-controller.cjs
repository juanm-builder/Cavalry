// Composes main-only cloud auth, workbook RPCs, renderer-safe state, and narrow IPC.
'use strict';

const { createCloudAuthController } = require('./cloud-auth-controller.cjs');
const { createCloudFeedbackController } = require('./cloud-feedback-controller.cjs');
const { createCloudProfileController } = require('./cloud-profile-controller.cjs');
const { createCloudWorkbookController } = require('./cloud-workbook-controller.cjs');

const REALTIME_REFRESH_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 10_000]);

const CLOUD_IPC_CHANNELS = Object.freeze({
  getState: 'cavalry-cloud:get-state',
  linkAppleIdentity: 'cavalry-cloud:link-apple',
  signInWithApple: 'cavalry-cloud:sign-in-apple',
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
  const assertTrustedSender = dependencies.assertTrustedSender;
  if (typeof assertTrustedSender !== 'function') {
    throw new Error('A trusted IPC sender guard is required.');
  }
  let workbooks = [];
  let profileName = '';
  let handlersRegistered = false;
  let cloudSession = { userId: '', generation: 0 };
  let workbookMutationInProgress = false;
  let workbookChange = null;
  let workbookChangeSequence = 0;
  let realtimeChannel = null;
  let realtimeClient = null;
  let realtimeUserId = '';
  let queuedRealtimeChange = null;
  let realtimeRefreshPromise = null;
  let realtimeRetryTimer = null;

  function updateCloudSession(authState) {
    const nextUserId =
      authState && authState.status === 'signed_in' && authState.user
        ? String(authState.user.id || '')
        : '';
    if (nextUserId === cloudSession.userId) return;
    cloudSession = { userId: nextUserId, generation: cloudSession.generation + 1 };
    workbooks = [];
    profileName = '';
    workbookChange = null;
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
      workbooks: workbooks.map((workbook) => ({ ...workbook })),
      workbookChange: workbookChange ? { ...workbookChange } : null
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

  function normalizeRealtimeWorkbookChange(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const eventType = String(source.eventType || '').toUpperCase();
    if (!['INSERT', 'UPDATE', 'DELETE'].includes(eventType)) return null;
    // DELETE subscriptions are deliberately unfiltered because Supabase cannot
    // authorize them with the deleted row's owner column under RLS. Treat every
    // DELETE payload as opaque: only the subsequent RLS-authorized list result
    // may cross IPC, even if a future server happens to include more old fields.
    if (eventType === 'DELETE') {
      return {
        sequence: ++workbookChangeSequence,
        eventType,
        workbookId: '',
        revision: 0,
        updatedAt: ''
      };
    }
    const record = source.new && typeof source.new === 'object' ? source.new : {};
    const workbookId = String(record.local_workbook_id || '')
      .trim()
      .slice(0, 128);
    if (!workbookId) return null;
    const rawRevision = Number(record.latest_revision);
    const revision = Number.isSafeInteger(rawRevision) && rawRevision > 0 ? rawRevision : 0;
    return {
      sequence: ++workbookChangeSequence,
      eventType,
      workbookId,
      revision,
      updatedAt: String(record.updated_at || '').slice(0, 64)
    };
  }

  function captureCloudSession() {
    return { userId: cloudSession.userId, generation: cloudSession.generation };
  }

  function isCurrentCloudSession(binding) {
    return !!(
      binding &&
      binding.userId === cloudSession.userId &&
      binding.generation === cloudSession.generation
    );
  }

  function cloudSessionChangedFailure() {
    return {
      ok: false,
      code: 'cloud_session_changed',
      error: 'The Cavalry Cloud account changed before the operation finished.'
    };
  }

  function cloudSessionChangedResponse() {
    return { ...cloudSessionChangedFailure(), state: getState() };
  }

  function cancelRealtimeRetry() {
    if (realtimeRetryTimer === null) return;
    clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = null;
  }

  function stopRealtimeSubscription() {
    const channel = realtimeChannel;
    const client = realtimeClient;
    realtimeChannel = null;
    realtimeClient = null;
    realtimeUserId = '';
    queuedRealtimeChange = null;
    cancelRealtimeRetry();
    if (!channel) return;
    try {
      if (client && typeof client.removeChannel === 'function') {
        void Promise.resolve(client.removeChannel(channel)).catch(() => undefined);
      } else if (typeof channel.unsubscribe === 'function') {
        void Promise.resolve(channel.unsubscribe()).catch(() => undefined);
      }
    } catch (_error) {
      // Realtime teardown is best effort; the authenticated session remains authoritative.
    }
  }

  function drainRealtimeWorkbookRefreshes() {
    if (realtimeRefreshPromise || realtimeRetryTimer !== null) return;
    const entry = queuedRealtimeChange;
    queuedRealtimeChange = null;
    if (!entry || !isCurrentCloudSession(entry.session)) return;

    const operation = (async () => {
      const result = await refreshWorkbooks(entry.session);
      if (!isCurrentCloudSession(entry.session)) return;
      if (!result.ok) {
        const delay = REALTIME_REFRESH_RETRY_DELAYS_MS[entry.retryAttempt];
        if (delay !== undefined && !queuedRealtimeChange) {
          queuedRealtimeChange = {
            ...entry,
            retryAttempt: entry.retryAttempt + 1
          };
          const timer = setTimeout(() => {
            if (realtimeRetryTimer !== timer) return;
            realtimeRetryTimer = null;
            drainRealtimeWorkbookRefreshes();
          }, delay);
          realtimeRetryTimer = timer;
          if (timer && typeof timer.unref === 'function') timer.unref();
        }
        return;
      }
      workbookChange = entry.change;
      broadcastState();
    })();
    realtimeRefreshPromise = operation;
    void operation
      .catch(() => undefined)
      .finally(() => {
        if (realtimeRefreshPromise === operation) realtimeRefreshPromise = null;
        if (queuedRealtimeChange && realtimeRetryTimer === null) {
          // A completed request may belong to an old owner. Always allow the
          // queued binding to decide whether current-session work can run next.
          drainRealtimeWorkbookRefreshes();
        }
      });
  }

  function enqueueRealtimeWorkbookRefresh(session, change) {
    if (!change || !session.userId || !isCurrentCloudSession(session)) return;
    cancelRealtimeRetry();
    queuedRealtimeChange = {
      session: { ...session },
      change,
      retryAttempt: 0
    };
    drainRealtimeWorkbookRefreshes();
  }

  function queueRealtimeWorkbookRefresh(session, payload) {
    enqueueRealtimeWorkbookRefresh(session, normalizeRealtimeWorkbookChange(payload));
  }

  function queueRealtimeReconciliation(session) {
    if (!session.userId || !isCurrentCloudSession(session)) return;
    enqueueRealtimeWorkbookRefresh(session, {
      sequence: ++workbookChangeSequence,
      eventType: 'UPDATE',
      workbookId: '',
      revision: 0,
      updatedAt: ''
    });
  }

  function bindRealtimeChange(channel, filter, callback) {
    return channel.on('postgres_changes', filter, callback) || channel;
  }

  function syncRealtimeSubscription() {
    const userId = cloudSession.userId;
    const client = auth && auth.isSignedIn() ? auth.getClient() : null;
    if (!userId || !(client && typeof client.channel === 'function')) {
      stopRealtimeSubscription();
      return;
    }
    if (realtimeChannel && realtimeClient === client && realtimeUserId === userId) return;
    stopRealtimeSubscription();
    try {
      const channel = client.channel(`cavalry-workbooks-${userId}`);
      if (!(channel && typeof channel.on === 'function')) return;
      const session = captureCloudSession();
      const handleChange = (payload) => queueRealtimeWorkbookRefresh(session, payload);
      let subscribedChannel = bindRealtimeChange(
        channel,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'workbooks',
          filter: `owner_id=eq.${userId}`
        },
        handleChange
      );
      subscribedChannel = bindRealtimeChange(
        subscribedChannel,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'workbooks',
          filter: `owner_id=eq.${userId}`
        },
        handleChange
      );
      subscribedChannel = bindRealtimeChange(
        subscribedChannel,
        {
          event: 'DELETE',
          schema: 'public',
          table: 'workbooks'
        },
        handleChange
      );
      realtimeClient = client;
      realtimeUserId = userId;
      realtimeChannel = subscribedChannel;
      if (typeof realtimeChannel.subscribe === 'function') {
        realtimeChannel.subscribe((status) => {
          if (
            status === 'SUBSCRIBED' &&
            realtimeChannel === subscribedChannel &&
            realtimeClient === client &&
            realtimeUserId === userId &&
            isCurrentCloudSession(session)
          ) {
            // Realtime does not replay events missed while disconnected. A
            // successful initial subscription or reconnect therefore performs
            // a metadata reconciliation before relying on live events again.
            queueRealtimeReconciliation(session);
          }
        });
      }
    } catch (_error) {
      stopRealtimeSubscription();
    }
  }

  let auth;
  auth = createCloudAuthController({
    app: dependencies.app,
    safeStorage: dependencies.safeStorage,
    shell: dependencies.shell,
    supabaseUrl: dependencies.supabaseUrl,
    publishableKey: dependencies.publishableKey,
    createClient: dependencies.createClient,
    createStorage: dependencies.createStorage,
    onStateChange(nextAuthState) {
      updateCloudSession(nextAuthState);
      syncRealtimeSubscription();
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

  async function refreshWorkbooks(expectedSession) {
    if (!isCurrentCloudSession(expectedSession)) return cloudSessionChangedFailure();
    const result = await workbookController.listWorkbooks();
    if (!isCurrentCloudSession(expectedSession)) return cloudSessionChangedFailure();
    if (result.ok) workbooks = result.workbooks;
    return result;
  }

  async function refreshProfile(expectedSession) {
    if (!isCurrentCloudSession(expectedSession)) return cloudSessionChangedFailure();
    const result = await profileController.getProfile();
    if (!isCurrentCloudSession(expectedSession)) return cloudSessionChangedFailure();
    if (result.ok) profileName = result.profile.name;
    return result;
  }

  async function initialize() {
    await auth.initialize();
    const session = captureCloudSession();
    if (auth.isSignedIn()) {
      await Promise.all([refreshProfile(session), refreshWorkbooks(session)]);
    }
    if (!isCurrentCloudSession(session)) return getState();
    syncRealtimeSubscription();
    return broadcastState();
  }

  async function restoreExistingSession() {
    await auth.restoreExistingSession();
    const session = captureCloudSession();
    if (auth.isSignedIn()) {
      await Promise.all([refreshProfile(session), refreshWorkbooks(session)]);
    }
    if (!isCurrentCloudSession(session)) return getState();
    syncRealtimeSubscription();
    return broadcastState();
  }

  async function signInWithGoogle() {
    const result = await auth.signInWithGoogle();
    return { ...result, state: broadcastState() };
  }

  async function signInWithApple() {
    const result = await auth.signInWithApple();
    return { ...result, state: broadcastState() };
  }

  async function linkAppleIdentity() {
    const result = await auth.linkAppleIdentity();
    return { ...result, state: broadcastState() };
  }

  async function handleAuthCallback(callback) {
    const result = await auth.handleAuthCallback(callback);
    const session = captureCloudSession();
    if (result.ok && !result.pending) {
      await Promise.all([refreshProfile(session), refreshWorkbooks(session)]);
    }
    if (!isCurrentCloudSession(session)) return cloudSessionChangedResponse();
    return { ...result, state: broadcastState() };
  }

  async function signOut() {
    workbooks = [];
    profileName = '';
    const result = await auth.signOut();
    return { ...result, state: broadcastState() };
  }

  async function listWorkbooks() {
    const session = captureCloudSession();
    const [result] = await Promise.all([refreshWorkbooks(session), refreshProfile(session)]);
    if (!isCurrentCloudSession(session)) return cloudSessionChangedResponse();
    return { ...result, state: broadcastState() };
  }

  async function updateProfile(payload) {
    const session = captureCloudSession();
    const result = await profileController.updateProfile(payload || {});
    if (!isCurrentCloudSession(session)) return cloudSessionChangedResponse();
    if (result.ok) profileName = result.profile.name;
    return { ...result, state: broadcastState() };
  }

  function mutateWorkbook(method, payload) {
    const safePayload = payload || {};
    if (workbookMutationInProgress) {
      return {
        ok: false,
        code: 'cloud_operation_in_progress',
        error: 'Another Cavalry Cloud operation is already in progress.',
        state: getState()
      };
    }
    workbookMutationInProgress = true;
    const session = captureCloudSession();

    const mutation = (async () => {
      try {
        const result = await workbookController[method](safePayload);
        if (!isCurrentCloudSession(session)) return cloudSessionChangedResponse();
        const revisionConflict =
          result.conflict === true || result.code === 'workbook_revision_conflict';
        if (result.ok || revisionConflict) {
          const refreshed = await refreshWorkbooks(session);
          if (!isCurrentCloudSession(session)) return cloudSessionChangedResponse();
          if (result.ok && !refreshed.ok && method === 'uploadWorkbook' && result.metadata) {
            workbooks = [
              result.metadata,
              ...workbooks.filter((workbook) => workbook.id !== result.metadata.id)
            ];
          } else if (result.ok && !refreshed.ok && method === 'deleteWorkbook' && result.id) {
            workbooks = workbooks.filter((workbook) => workbook.id !== result.id);
          }
        }
        return { ...result, state: broadcastState() };
      } finally {
        workbookMutationInProgress = false;
      }
    })();

    return mutation;
  }

  async function downloadWorkbook(payload) {
    const session = captureCloudSession();
    const result = await workbookController.downloadWorkbook(payload || {});
    if (!isCurrentCloudSession(session)) return cloudSessionChangedResponse();
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
    ipcMain.handle(CLOUD_IPC_CHANNELS.linkAppleIdentity, trusted(linkAppleIdentity));
    ipcMain.handle(CLOUD_IPC_CHANNELS.signInWithApple, trusted(signInWithApple));
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
    stopRealtimeSubscription();
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
