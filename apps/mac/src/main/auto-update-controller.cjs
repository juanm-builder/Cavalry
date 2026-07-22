// Owns packaged desktop update checks, native prompts, downloads, and installer handoff.

'use strict';

const INITIAL_UPDATE_CHECK_DELAY_MS = 15 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const SUPPORTED_UPDATE_PLATFORMS = new Set(['darwin', 'win32']);
const UPDATE_STATUS = Object.freeze({
  AVAILABLE: 'available',
  CHECKING: 'checking',
  DISABLED: 'disabled',
  DOWNLOADING: 'downloading',
  ERROR: 'error',
  IDLE: 'idle',
  READY: 'ready',
  UP_TO_DATE: 'up-to-date'
});

function getCavalryAppTitle(platform) {
  return platform === 'win32' ? 'Cavalry' : 'Cavalry for Mac';
}

function envFlag(environment, name) {
  const raw = String((environment && environment[name]) || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function envFlagIsFalse(environment, name) {
  const raw = String((environment && environment[name]) || '')
    .trim()
    .toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'no' || raw === 'off';
}

function isAutoUpdateDisabled(environment) {
  return (
    envFlag(environment, 'CAVALRY_AUTO_UPDATE_DISABLED') ||
    envFlag(environment, 'CAVALRY_DISABLE_AUTO_UPDATE') ||
    envFlagIsFalse(environment, 'CAVALRY_AUTO_UPDATE_ENABLED')
  );
}

function shouldEnableAutoUpdates({ app, environment, platform } = {}) {
  return !!(
    app &&
    app.isPackaged &&
    SUPPORTED_UPDATE_PLATFORMS.has(platform) &&
    !isAutoUpdateDisabled(environment)
  );
}

function getUpdateVersion(updateInfo) {
  return String((updateInfo && updateInfo.version) || '').trim();
}

function getUpdateKey(updateInfo) {
  const version = getUpdateVersion(updateInfo);
  if (version) return version;

  const releaseName = String((updateInfo && updateInfo.releaseName) || '').trim();
  if (releaseName) return releaseName;

  const firstFile =
    updateInfo && Array.isArray(updateInfo.files) && updateInfo.files.length
      ? updateInfo.files[0]
      : null;
  return String((firstFile && firstFile.url) || 'unknown-update').trim();
}

function normalizeFiniteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

function normalizeUpdateProgress(progressInfo) {
  const source = progressInfo && typeof progressInfo === 'object' ? progressInfo : {};
  const rawPercent = Number(source.percent);
  return {
    percent: Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, rawPercent)) : 0,
    transferred: normalizeFiniteCount(source.transferred),
    total: normalizeFiniteCount(source.total),
    bytesPerSecond: normalizeFiniteCount(source.bytesPerSecond)
  };
}

function createAutoUpdateController(dependencies = {}) {
  const app = dependencies.app;
  const dialog = dependencies.dialog;
  const process = dependencies.process || global.process;
  const environment = dependencies.environment || (process && process.env) || {};
  const platform = dependencies.platform || (process && process.platform) || '';
  const logger = dependencies.logger || console;
  const initialCheckDelayMs =
    dependencies.initialCheckDelayMs === undefined
      ? INITIAL_UPDATE_CHECK_DELAY_MS
      : dependencies.initialCheckDelayMs;
  const checkIntervalMs =
    dependencies.checkIntervalMs === undefined
      ? UPDATE_CHECK_INTERVAL_MS
      : dependencies.checkIntervalMs;
  const scheduleTimeout = dependencies.setTimeout || global.setTimeout;
  const cancelTimeout = dependencies.clearTimeout || global.clearTimeout;
  const scheduleInterval = dependencies.setInterval || global.setInterval;
  const cancelInterval = dependencies.clearInterval || global.clearInterval;
  const beforeQuitAndInstall = dependencies.beforeQuitAndInstall || (async () => {});
  const afterQuitAndInstallFailure = dependencies.afterQuitAndInstallFailure || (async () => {});
  const loadAutoUpdater = dependencies.loadAutoUpdater || (() => require('electron-updater'));
  const now = dependencies.now || (() => new Date().toISOString());

  let autoUpdater = dependencies.autoUpdater || null;
  let started = false;
  let initialCheckTimer = null;
  let periodicCheckTimer = null;
  let checkInFlight = false;
  let availablePromptOpen = false;
  let readyPromptOpen = false;
  let downloadErrorPromptOpen = false;
  let installErrorPromptOpen = false;
  let installErrorPromptPending = false;
  let updateStatusPromptOpen = false;
  let postDownloadFailureHandling = false;
  let downloadInFlight = false;
  let downloadReady = false;
  let downloadAttemptSequence = 0;
  let activeDownloadAttempt = 0;
  let readyDownloadAttempt = 0;
  let quitAndInstallRequested = false;
  let availableUpdateInfo = null;
  let checkPromise = null;
  let checkInteractiveRequested = false;
  let checkOutcomeHandled = false;
  let stateBeforeCheck = null;
  const promptedAvailableUpdates = new Set();
  const promptedReadyUpdates = new Set();
  const handledDownloadFailures = new Set();
  const stateListeners = new Set();

  function getCurrentVersion() {
    if (app && typeof app.getVersion === 'function') {
      return String(app.getVersion() || '').trim();
    }
    return String((app && app.version) || '').trim();
  }

  function createInitialPublicState() {
    const enabled = shouldStart();
    return {
      sequence: 0,
      enabled,
      status: enabled ? UPDATE_STATUS.IDLE : UPDATE_STATUS.DISABLED,
      currentVersion: getCurrentVersion(),
      availableVersion: '',
      releaseName: '',
      checkedAt: null,
      progress: null,
      error: null
    };
  }

  let publicState = createInitialPublicState();

  function shouldStart() {
    return shouldEnableAutoUpdates({ app, environment, platform });
  }

  function getTimestamp() {
    try {
      const value = now();
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    } catch (_error) {
      return null;
    }
  }

  function getPublicState() {
    return {
      ...publicState,
      progress: publicState.progress ? { ...publicState.progress } : null,
      error: publicState.error ? { ...publicState.error } : null
    };
  }

  function publishPublicState(patch = {}) {
    publicState = {
      ...publicState,
      ...patch,
      sequence: publicState.sequence + 1,
      progress:
        Object.prototype.hasOwnProperty.call(patch, 'progress') && patch.progress
          ? { ...patch.progress }
          : Object.prototype.hasOwnProperty.call(patch, 'progress')
            ? null
            : publicState.progress,
      error:
        Object.prototype.hasOwnProperty.call(patch, 'error') && patch.error
          ? { ...patch.error }
          : Object.prototype.hasOwnProperty.call(patch, 'error')
            ? null
            : publicState.error
    };
    const snapshot = getPublicState();
    stateListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (_error) {
        // A renderer observer must never interrupt the updater.
      }
    });
    return snapshot;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }

  function getSafeUpdateDetails(updateInfo) {
    return {
      availableVersion: getUpdateVersion(updateInfo).slice(0, 64),
      releaseName: String((updateInfo && updateInfo.releaseName) || '')
        .trim()
        .slice(0, 240)
    };
  }

  function restoreStateBeforeCheck() {
    const previous = stateBeforeCheck;
    if (!previous) {
      publishPublicState({ status: UPDATE_STATUS.IDLE, error: null });
      return;
    }
    publishPublicState({
      enabled: previous.enabled,
      status: previous.status === UPDATE_STATUS.CHECKING ? UPDATE_STATUS.IDLE : previous.status,
      currentVersion: previous.currentVersion,
      availableVersion: previous.availableVersion,
      releaseName: previous.releaseName,
      checkedAt: previous.checkedAt,
      progress: previous.progress,
      error: previous.error
    });
  }

  function resolveAutoUpdater() {
    if (autoUpdater) return autoUpdater;
    const loaded = loadAutoUpdater();
    autoUpdater = loaded && loaded.autoUpdater ? loaded.autoUpdater : loaded;
    if (
      !autoUpdater ||
      typeof autoUpdater.on !== 'function' ||
      typeof autoUpdater.checkForUpdates !== 'function' ||
      typeof autoUpdater.downloadUpdate !== 'function' ||
      typeof autoUpdater.quitAndInstall !== 'function'
    ) {
      throw new Error('electron-updater did not provide a usable autoUpdater instance.');
    }
    return autoUpdater;
  }

  function getAppName() {
    if (app && typeof app.getName === 'function') {
      return String(app.getName() || 'Cavalry');
    }
    return String((app && app.name) || 'Cavalry');
  }

  function unrefTimer(timer) {
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function showUpToDatePrompt() {
    const version = getCurrentVersion();
    try {
      await dialog.showMessageBox({
        type: 'info',
        title: `${getAppName()} Update`,
        message: `${getAppName()} is up to date.`,
        detail: version
          ? `You're using version ${version}.`
          : 'You already have the latest version.',
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function showCheckFailurePrompt() {
    try {
      await dialog.showMessageBox({
        type: 'warning',
        title: `${getAppName()} Update`,
        message: "Cavalry couldn't check for updates.",
        detail:
          'Please check your internet connection and try again. You can keep using the app in the meantime.',
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function handleCheckFailure() {
    if (checkOutcomeHandled) return false;
    checkOutcomeHandled = true;
    const userInitiated = checkInteractiveRequested;
    if (!userInitiated) {
      restoreStateBeforeCheck();
      return false;
    }
    const knownUpdateStatus = stateBeforeCheck && stateBeforeCheck.status;
    if (
      knownUpdateStatus === UPDATE_STATUS.AVAILABLE ||
      (knownUpdateStatus === UPDATE_STATUS.ERROR &&
        stateBeforeCheck.error &&
        stateBeforeCheck.error.kind === 'download')
    ) {
      restoreStateBeforeCheck();
      await showCheckFailurePrompt();
      return true;
    }
    publishPublicState({
      status: UPDATE_STATUS.ERROR,
      checkedAt: getTimestamp(),
      progress: null,
      error: {
        kind: 'check',
        message: "Cavalry couldn't check for updates. Check your internet connection and try again."
      }
    });
    await showCheckFailurePrompt();
    return true;
  }

  async function showDownloadStatusPrompt() {
    if (updateStatusPromptOpen) return false;
    updateStatusPromptOpen = true;
    const version = getUpdateVersion(availableUpdateInfo);
    const percent = Math.round(Number(publicState.progress && publicState.progress.percent) || 0);
    try {
      await dialog.showMessageBox({
        type: 'info',
        title: `${getAppName()} Update`,
        message: 'The update is already downloading.',
        detail: version
          ? `Version ${version} is ${percent}% downloaded. You can keep using the app.`
          : `The update is ${percent}% downloaded. You can keep using the app.`,
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return true;
    } catch (_error) {
      return false;
    } finally {
      updateStatusPromptOpen = false;
    }
  }

  async function checkForUpdates(options = {}) {
    const userInitiated = options === true || options.userInitiated === true;
    if (!started) return false;
    if (downloadReady) {
      if (userInitiated) await showUpdateReadyPrompt(availableUpdateInfo, { force: true });
      return null;
    }
    if (downloadInFlight) {
      if (userInitiated) await showDownloadStatusPrompt();
      return null;
    }
    if (checkPromise) {
      if (userInitiated) checkInteractiveRequested = true;
      return checkPromise;
    }

    checkInteractiveRequested = userInitiated;
    checkOutcomeHandled = false;
    stateBeforeCheck = getPublicState();
    checkInFlight = true;
    publishPublicState({ status: UPDATE_STATUS.CHECKING, progress: null, error: null });

    const operation = (async () => {
      try {
        return await resolveAutoUpdater().checkForUpdates();
      } catch (_error) {
        await handleCheckFailure();
        return null;
      } finally {
        if (!checkOutcomeHandled) {
          if (checkInteractiveRequested) await handleCheckFailure();
          else restoreStateBeforeCheck();
        }
        checkInFlight = false;
        checkPromise = null;
        checkInteractiveRequested = false;
        checkOutcomeHandled = false;
        stateBeforeCheck = null;
      }
    })();
    checkPromise = operation;
    return operation;
  }

  async function showUpdateAvailablePrompt(updateInfo, options = {}) {
    availableUpdateInfo = updateInfo || availableUpdateInfo || {};
    const updateKey = getUpdateKey(availableUpdateInfo);
    if (
      availablePromptOpen ||
      downloadInFlight ||
      downloadReady ||
      (!options.force && promptedAvailableUpdates.has(updateKey))
    ) {
      return false;
    }

    promptedAvailableUpdates.add(updateKey);
    availablePromptOpen = true;
    const version = getUpdateVersion(availableUpdateInfo);
    const appName = getAppName();

    try {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: `${appName} Update`,
        message: `A new version of ${appName} is available.`,
        detail: version
          ? `Version ${version} can download in the background while you keep working.`
          : 'The update can download in the background while you keep working.',
        buttons: ['Update Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (result && result.response === 0) {
        void downloadUpdate();
        return true;
      }
    } catch (_error) {
      // A failed native prompt must not interrupt the running app.
    } finally {
      availablePromptOpen = false;
    }
    return false;
  }

  async function showDownloadFailurePrompt(attempt) {
    if (
      !attempt ||
      handledDownloadFailures.has(attempt) ||
      downloadErrorPromptOpen ||
      downloadReady
    ) {
      return false;
    }

    handledDownloadFailures.add(attempt);
    downloadInFlight = false;
    if (activeDownloadAttempt === attempt) activeDownloadAttempt = 0;
    downloadErrorPromptOpen = true;
    publishPublicState({
      status: UPDATE_STATUS.ERROR,
      progress: null,
      error: {
        kind: 'download',
        message: "The update couldn't be downloaded. Check your internet connection and try again."
      }
    });

    try {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: `${getAppName()} Update`,
        message: "The update couldn't be downloaded.",
        detail:
          'Please check your internet connection and try again. You can keep using the app in the meantime.',
        buttons: ['Retry', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (result && result.response === 0) {
        void downloadUpdate();
        return true;
      }
    } catch (_error) {
      // Treat closing or failing to create this prompt as choosing Later.
    } finally {
      downloadErrorPromptOpen = false;
    }
    return false;
  }

  async function downloadUpdate() {
    if (!started || downloadInFlight || downloadReady) return false;

    downloadInFlight = true;
    readyDownloadAttempt = 0;
    const attempt = ++downloadAttemptSequence;
    activeDownloadAttempt = attempt;
    publishPublicState({
      status: UPDATE_STATUS.DOWNLOADING,
      progress: normalizeUpdateProgress({ percent: 0 }),
      error: null
    });

    try {
      const updater = resolveAutoUpdater();
      updater.autoInstallOnAppQuit = true;
      await updater.downloadUpdate();
      return true;
    } catch (_error) {
      await showDownloadFailurePrompt(attempt);
      return false;
    } finally {
      if (activeDownloadAttempt === attempt) {
        activeDownloadAttempt = 0;
        downloadInFlight = false;
      }
    }
  }

  async function quitAndInstall() {
    if (!started || !downloadReady || quitAndInstallRequested) return false;

    quitAndInstallRequested = true;
    try {
      await beforeQuitAndInstall();
      if (!quitAndInstallRequested || !downloadReady) return false;
      resolveAutoUpdater().quitAndInstall(false, true);
      return quitAndInstallRequested && downloadReady;
    } catch (_error) {
      await handlePostDownloadFailure();
      return false;
    }
  }

  async function showInstallFailurePrompt() {
    if (installErrorPromptOpen) return false;
    if (readyPromptOpen) {
      installErrorPromptPending = true;
      return false;
    }

    installErrorPromptPending = false;
    installErrorPromptOpen = true;
    try {
      await dialog.showMessageBox({
        type: 'warning',
        title: `${getAppName()} Update`,
        message: "The update couldn't be prepared for installation.",
        detail:
          'Your current version is still safe to use. Please restart the app and try the update again later.',
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return true;
    } catch (_error) {
      return false;
    } finally {
      installErrorPromptOpen = false;
    }
  }

  async function handlePostDownloadFailure() {
    if (postDownloadFailureHandling || (!downloadReady && !quitAndInstallRequested)) {
      return false;
    }

    postDownloadFailureHandling = true;
    const shouldRecoverServices = quitAndInstallRequested;
    const failedAttempt = readyDownloadAttempt || activeDownloadAttempt;
    if (failedAttempt) handledDownloadFailures.add(failedAttempt);
    downloadReady = false;
    downloadInFlight = false;
    activeDownloadAttempt = 0;
    readyDownloadAttempt = 0;
    quitAndInstallRequested = false;
    if (autoUpdater) autoUpdater.autoInstallOnAppQuit = false;
    publishPublicState({
      status: UPDATE_STATUS.ERROR,
      progress: null,
      error: {
        kind: 'install',
        message:
          "The update couldn't be prepared for installation. Restart Cavalry and try again later."
      }
    });

    try {
      if (shouldRecoverServices) {
        try {
          await afterQuitAndInstallFailure();
        } catch (_error) {
          // Recovery is best effort; the running app still receives a safe failure message.
        }
      }
      await showInstallFailurePrompt();
      return true;
    } finally {
      postDownloadFailureHandling = false;
    }
  }

  async function showUpdateReadyPrompt(updateInfo, options = {}) {
    const resolvedInfo = updateInfo || availableUpdateInfo || {};
    const updateKey = getUpdateKey(resolvedInfo);
    availableUpdateInfo = resolvedInfo;
    if (activeDownloadAttempt) readyDownloadAttempt = activeDownloadAttempt;
    downloadReady = true;
    downloadInFlight = false;
    publishPublicState({
      status: UPDATE_STATUS.READY,
      ...getSafeUpdateDetails(resolvedInfo),
      progress: normalizeUpdateProgress({ percent: 100 }),
      error: null
    });

    if (readyPromptOpen || (!options.force && promptedReadyUpdates.has(updateKey))) return false;

    promptedReadyUpdates.add(updateKey);
    readyPromptOpen = true;
    const version = getUpdateVersion(resolvedInfo);

    try {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: `${getAppName()} Update`,
        message: 'The update is ready to install.',
        detail: version
          ? `Version ${version} will be installed when the app restarts.`
          : 'The new version will be installed when the app restarts.',
        buttons: ['Restart and Install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (result && result.response === 0) {
        return await quitAndInstall();
      }
    } catch (_error) {
      // The downloaded update can still install on a later app quit.
    } finally {
      readyPromptOpen = false;
      if (installErrorPromptPending) void showInstallFailurePrompt();
    }
    return false;
  }

  function handleUpdaterError() {
    if (downloadReady || quitAndInstallRequested) {
      void handlePostDownloadFailure();
      return;
    }
    const attempt = activeDownloadAttempt;
    if (attempt && downloadInFlight && !downloadReady) {
      void showDownloadFailurePrompt(attempt);
      return;
    }
    if (checkInFlight) void handleCheckFailure();
  }

  const updaterListeners = {
    'checking-for-update': () => {
      if (!downloadInFlight && !downloadReady && publicState.status !== UPDATE_STATUS.CHECKING) {
        publishPublicState({ status: UPDATE_STATUS.CHECKING, progress: null, error: null });
      }
    },
    'update-available': (updateInfo) => {
      checkOutcomeHandled = checkInFlight || checkOutcomeHandled;
      availableUpdateInfo = updateInfo || {};
      publishPublicState({
        status: UPDATE_STATUS.AVAILABLE,
        ...getSafeUpdateDetails(availableUpdateInfo),
        checkedAt: getTimestamp(),
        progress: null,
        error: null
      });
      void showUpdateAvailablePrompt(updateInfo, { force: checkInteractiveRequested });
    },
    'update-not-available': () => {
      const userInitiated = checkInteractiveRequested;
      checkOutcomeHandled = checkInFlight || checkOutcomeHandled;
      availableUpdateInfo = null;
      publishPublicState({
        status: UPDATE_STATUS.UP_TO_DATE,
        availableVersion: '',
        releaseName: '',
        checkedAt: getTimestamp(),
        progress: null,
        error: null
      });
      if (userInitiated) void showUpToDatePrompt();
    },
    'download-progress': (progressInfo) => {
      if (!downloadInFlight || downloadReady) return;
      publishPublicState({
        status: UPDATE_STATUS.DOWNLOADING,
        progress: normalizeUpdateProgress(progressInfo),
        error: null
      });
    },
    'update-downloaded': (updateInfo) => {
      void showUpdateReadyPrompt(updateInfo);
    },
    'update-cancelled': () => {
      const attempt = activeDownloadAttempt;
      if (attempt && downloadInFlight && !downloadReady) void showDownloadFailurePrompt(attempt);
    },
    error: handleUpdaterError
  };

  function addUpdaterListeners() {
    const updater = resolveAutoUpdater();
    Object.entries(updaterListeners).forEach(([eventName, listener]) => {
      updater.on(eventName, listener);
    });
  }

  function removeUpdaterListeners() {
    if (!autoUpdater) return;
    const removeListener =
      typeof autoUpdater.removeListener === 'function'
        ? autoUpdater.removeListener.bind(autoUpdater)
        : typeof autoUpdater.off === 'function'
          ? autoUpdater.off.bind(autoUpdater)
          : null;
    if (!removeListener) return;
    Object.entries(updaterListeners).forEach(([eventName, listener]) => {
      removeListener(eventName, listener);
    });
  }

  function scheduleChecks() {
    initialCheckTimer = scheduleTimeout(
      () => {
        initialCheckTimer = null;
        void checkForUpdates();
      },
      Math.max(0, Number(initialCheckDelayMs) || 0)
    );
    unrefTimer(initialCheckTimer);

    periodicCheckTimer = scheduleInterval(
      () => {
        void checkForUpdates();
      },
      Math.max(1, Number(checkIntervalMs) || UPDATE_CHECK_INTERVAL_MS)
    );
    unrefTimer(periodicCheckTimer);
  }

  function start() {
    if (started) return true;
    if (!shouldStart()) return false;

    try {
      const updater = resolveAutoUpdater();
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = true;
      updater.autoRunAppAfterInstall = true;
      updater.disableWebInstaller = true;
      addUpdaterListeners();
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(
          'Cavalry automatic updates are unavailable:',
          error && error.message ? error.message : String(error)
        );
      }
      publishPublicState({
        enabled: false,
        status: UPDATE_STATUS.DISABLED,
        progress: null,
        error: null
      });
      return false;
    }

    started = true;
    publishPublicState({ enabled: true, status: UPDATE_STATUS.IDLE, error: null });
    scheduleChecks();
    return true;
  }

  function stop() {
    if (initialCheckTimer !== null) cancelTimeout(initialCheckTimer);
    if (periodicCheckTimer !== null) cancelInterval(periodicCheckTimer);
    initialCheckTimer = null;
    periodicCheckTimer = null;
    removeUpdaterListeners();
    started = false;
  }

  function getState() {
    return {
      activeDownloadAttempt,
      availablePromptOpen,
      checkInFlight,
      downloadErrorPromptOpen,
      downloadInFlight,
      downloadReady,
      installErrorPromptOpen,
      quitAndInstallRequested,
      started
    };
  }

  return {
    checkForUpdates,
    downloadUpdate,
    getPublicState,
    getState,
    quitAndInstall,
    shouldStart,
    start,
    stop,
    subscribe
  };
}

module.exports = {
  INITIAL_UPDATE_CHECK_DELAY_MS,
  SUPPORTED_UPDATE_PLATFORMS,
  UPDATE_STATUS,
  UPDATE_CHECK_INTERVAL_MS,
  createAutoUpdateController,
  envFlag,
  getCavalryAppTitle,
  isAutoUpdateDisabled,
  normalizeUpdateProgress,
  shouldEnableAutoUpdates
};
