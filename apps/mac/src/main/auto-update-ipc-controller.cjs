// Exposes a narrow, trusted updater contract and broadcasts renderer-safe state snapshots.
'use strict';

const { createTrustedRendererIpcGuard } = require('./privileged-ipc-security.cjs');

const AUTO_UPDATE_IPC_CHANNELS = Object.freeze({
  getState: 'cavalry-updates:get-state',
  check: 'cavalry-updates:check',
  download: 'cavalry-updates:download',
  restartAndInstall: 'cavalry-updates:restart-and-install',
  stateChanged: 'cavalry-updates:state-changed'
});

function createTrustedUpdateIpcGuard(options = {}) {
  return createTrustedRendererIpcGuard({
    getMainWindow: options.getMainWindow,
    indexPath: options.indexPath,
    rendererUrl: options.rendererUrl,
    errorMessage: 'Update controls are available only to Cavalry.'
  });
}

function createAutoUpdateIpcController(dependencies = {}) {
  const BrowserWindow = dependencies.BrowserWindow;
  const ipcMain = dependencies.ipcMain;
  const updater = dependencies.updater;
  const assertTrustedSender =
    dependencies.assertTrustedSender || createTrustedUpdateIpcGuard(dependencies);
  let registered = false;
  let unsubscribe = null;

  function getState() {
    return updater.getPublicState();
  }

  function broadcastState(state) {
    const windows =
      BrowserWindow && typeof BrowserWindow.getAllWindows === 'function'
        ? BrowserWindow.getAllWindows()
        : [];
    windows.forEach((window) => {
      const windowAlive =
        window && (typeof window.isDestroyed !== 'function' || !window.isDestroyed());
      const contentsAlive =
        windowAlive &&
        window.webContents &&
        (typeof window.webContents.isDestroyed !== 'function' || !window.webContents.isDestroyed());
      if (contentsAlive && typeof window.webContents.send === 'function') {
        window.webContents.send(AUTO_UPDATE_IPC_CHANNELS.stateChanged, state);
      }
    });
  }

  function trusted(handler) {
    return async (event) => {
      assertTrustedSender(event);
      return handler();
    };
  }

  function actionResult(ok) {
    const state = getState();
    const failed = ok === false || (state.status === 'error' && !!state.error);
    return {
      ok: !failed,
      ...(failed && state.error ? { error: state.error.message } : {}),
      state
    };
  }

  function registerHandlers() {
    if (registered) return false;
    if (!(ipcMain && typeof ipcMain.handle === 'function')) {
      throw new Error('ipcMain with a handle function is required.');
    }
    if (
      !updater ||
      typeof updater.getPublicState !== 'function' ||
      typeof updater.subscribe !== 'function'
    ) {
      throw new Error('A public auto-update controller is required.');
    }

    ipcMain.handle(
      AUTO_UPDATE_IPC_CHANNELS.getState,
      trusted(async () => ({ ok: true, state: getState() }))
    );
    ipcMain.handle(
      AUTO_UPDATE_IPC_CHANNELS.check,
      trusted(async () => {
        return actionResult(await updater.checkForUpdates({ userInitiated: true }));
      })
    );
    ipcMain.handle(
      AUTO_UPDATE_IPC_CHANNELS.download,
      trusted(async () => actionResult(await updater.downloadUpdate()))
    );
    ipcMain.handle(
      AUTO_UPDATE_IPC_CHANNELS.restartAndInstall,
      trusted(async () => actionResult(await updater.quitAndInstall()))
    );
    unsubscribe = updater.subscribe(broadcastState);
    registered = true;
    return true;
  }

  function dispose() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    if (registered && ipcMain && typeof ipcMain.removeHandler === 'function') {
      [
        AUTO_UPDATE_IPC_CHANNELS.getState,
        AUTO_UPDATE_IPC_CHANNELS.check,
        AUTO_UPDATE_IPC_CHANNELS.download,
        AUTO_UPDATE_IPC_CHANNELS.restartAndInstall
      ].forEach((channel) => ipcMain.removeHandler(channel));
    }
    registered = false;
  }

  return { broadcastState, dispose, registerHandlers };
}

module.exports = {
  AUTO_UPDATE_IPC_CHANNELS,
  createAutoUpdateIpcController,
  createTrustedUpdateIpcGuard
};
