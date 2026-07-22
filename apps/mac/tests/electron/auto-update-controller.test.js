import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  INITIAL_UPDATE_CHECK_DELAY_MS,
  UPDATE_STATUS,
  UPDATE_CHECK_INTERVAL_MS,
  createAutoUpdateController,
  getCavalryAppTitle,
  isAutoUpdateDisabled,
  normalizeUpdateProgress,
  shouldEnableAutoUpdates
} = require('../../src/main/auto-update-controller.cjs');

async function settleAsyncWork(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.15' } }));
  updater.downloadUpdate = vi.fn(async () => []);
  updater.quitAndInstall = vi.fn();
  return updater;
}

function createScheduler() {
  const timeouts = [];
  const intervals = [];
  const canceledTimeouts = [];
  const canceledIntervals = [];

  return {
    canceledIntervals,
    canceledTimeouts,
    intervals,
    timeouts,
    clearInterval(handle) {
      canceledIntervals.push(handle);
    },
    clearTimeout(handle) {
      canceledTimeouts.push(handle);
    },
    setInterval(callback, delay) {
      const handle = { callback, delay, unref: vi.fn() };
      intervals.push(handle);
      return handle;
    },
    setTimeout(callback, delay) {
      const handle = { callback, delay, unref: vi.fn() };
      timeouts.push(handle);
      return handle;
    }
  };
}

function createHarness({
  afterQuitAndInstallFailure = vi.fn(async () => {}),
  appName = 'Cavalry for Mac',
  appVersion = '1.0.18',
  beforeQuitAndInstall = vi.fn(async () => {}),
  environment = {},
  isPackaged = true,
  platform = 'darwin',
  responses = [],
  updater = createUpdater()
} = {}) {
  const scheduler = createScheduler();
  const responseQueue = [...responses];
  const dialog = {
    showMessageBox: vi.fn(async () => responseQueue.shift() || { response: 1 })
  };
  const controller = createAutoUpdateController({
    app: {
      getName: () => appName,
      getVersion: () => appVersion,
      isPackaged
    },
    afterQuitAndInstallFailure,
    autoUpdater: updater,
    beforeQuitAndInstall,
    dialog,
    environment,
    platform,
    clearInterval: scheduler.clearInterval,
    clearTimeout: scheduler.clearTimeout,
    setInterval: scheduler.setInterval,
    setTimeout: scheduler.setTimeout
  });

  return {
    afterQuitAndInstallFailure,
    beforeQuitAndInstall,
    controller,
    dialog,
    scheduler,
    updater
  };
}

describe('automatic update eligibility', () => {
  it('enables updates only in packaged macOS and Windows applications', () => {
    const packagedApp = { isPackaged: true };

    expect(shouldEnableAutoUpdates({ app: packagedApp, environment: {}, platform: 'darwin' })).toBe(
      true
    );
    expect(shouldEnableAutoUpdates({ app: packagedApp, environment: {}, platform: 'win32' })).toBe(
      true
    );
    expect(
      shouldEnableAutoUpdates({
        app: { isPackaged: false },
        environment: {},
        platform: 'darwin'
      })
    ).toBe(false);
    expect(shouldEnableAutoUpdates({ app: packagedApp, environment: {}, platform: 'linux' })).toBe(
      false
    );
  });

  it('supports the deployment escape hatch without loading electron-updater', () => {
    expect(isAutoUpdateDisabled({ CAVALRY_AUTO_UPDATE_DISABLED: '1' })).toBe(true);
    expect(isAutoUpdateDisabled({ CAVALRY_AUTO_UPDATE_DISABLED: 'true' })).toBe(true);
    expect(isAutoUpdateDisabled({ CAVALRY_DISABLE_AUTO_UPDATE: 'yes' })).toBe(true);
    expect(isAutoUpdateDisabled({ CAVALRY_AUTO_UPDATE_ENABLED: '0' })).toBe(true);
    expect(isAutoUpdateDisabled({ CAVALRY_AUTO_UPDATE_DISABLED: '0' })).toBe(false);

    const loadAutoUpdater = vi.fn();
    const controller = createAutoUpdateController({
      app: { isPackaged: true },
      dialog: { showMessageBox: vi.fn() },
      environment: { CAVALRY_AUTO_UPDATE_DISABLED: '1' },
      loadAutoUpdater,
      platform: 'darwin'
    });

    expect(controller.start()).toBe(false);
    expect(loadAutoUpdater).not.toHaveBeenCalled();
  });

  it('disables updater state when packaged startup cannot load the updater', async () => {
    const logger = { warn: vi.fn() };
    const controller = createAutoUpdateController({
      app: { getVersion: () => '1.0.19', isPackaged: true },
      dialog: { showMessageBox: vi.fn() },
      loadAutoUpdater: () => {
        throw new Error('updater module unavailable');
      },
      logger,
      platform: 'darwin'
    });

    expect(controller.getPublicState()).toMatchObject({ enabled: true, status: 'idle' });
    expect(controller.start()).toBe(false);
    expect(controller.getPublicState()).toMatchObject({ enabled: false, status: 'disabled' });
    await expect(controller.checkForUpdates({ userInitiated: true })).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('keeps the established macOS title and uses a platform-neutral Windows title', () => {
    expect(getCavalryAppTitle('darwin')).toBe('Cavalry for Mac');
    expect(getCavalryAppTitle('linux')).toBe('Cavalry for Mac');
    expect(getCavalryAppTitle('win32')).toBe('Cavalry');
  });
});

describe('automatic update scheduling', () => {
  it('configures manual background downloads and performs delayed and periodic checks', async () => {
    const { controller, scheduler, updater } = createHarness();

    expect(controller.start()).toBe(true);
    expect(controller.start()).toBe(true);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.autoRunAppAfterInstall).toBe(true);
    expect(updater.disableWebInstaller).toBe(true);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(scheduler.timeouts).toHaveLength(1);
    expect(scheduler.timeouts[0].delay).toBe(INITIAL_UPDATE_CHECK_DELAY_MS);
    expect(scheduler.timeouts[0].unref).toHaveBeenCalledOnce();
    expect(scheduler.intervals).toHaveLength(1);
    expect(scheduler.intervals[0].delay).toBe(UPDATE_CHECK_INTERVAL_MS);
    expect(scheduler.intervals[0].unref).toHaveBeenCalledOnce();

    scheduler.timeouts[0].callback();
    await settleAsyncWork();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    scheduler.intervals[0].callback();
    await settleAsyncWork();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not overlap slow checks and silently handles rejected checks', async () => {
    let finishFirstCheck;
    const updater = createUpdater();
    updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstCheck = resolve;
        })
    );
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    const { controller, dialog, scheduler } = createHarness({ updater });
    controller.start();

    scheduler.timeouts[0].callback();
    scheduler.intervals[0].callback();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    finishFirstCheck({ updateInfo: { version: '1.0.15' } });
    await settleAsyncWork();
    scheduler.intervals[0].callback();
    await settleAsyncWork();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('clears schedules and updater listeners when stopped', () => {
    const { controller, scheduler, updater } = createHarness();
    controller.start();

    expect(updater.listenerCount('update-available')).toBe(1);
    expect(updater.listenerCount('update-not-available')).toBe(1);
    expect(updater.listenerCount('download-progress')).toBe(1);
    expect(updater.listenerCount('update-downloaded')).toBe(1);
    expect(updater.listenerCount('update-cancelled')).toBe(1);
    expect(updater.listenerCount('error')).toBe(1);

    controller.stop();

    expect(scheduler.canceledTimeouts).toEqual([scheduler.timeouts[0]]);
    expect(scheduler.canceledIntervals).toEqual([scheduler.intervals[0]]);
    expect(updater.listenerCount('update-available')).toBe(0);
    expect(updater.listenerCount('update-not-available')).toBe(0);
    expect(updater.listenerCount('download-progress')).toBe(0);
    expect(updater.listenerCount('update-downloaded')).toBe(0);
    expect(updater.listenerCount('update-cancelled')).toBe(0);
    expect(updater.listenerCount('error')).toBe(0);
    expect(controller.getState().started).toBe(false);
  });
});

describe('automatic update prompts and downloads', () => {
  it('offers Update Now or Later and de-duplicates each available version', async () => {
    const { controller, dialog, updater } = createHarness({
      responses: [{ response: 1 }, { response: 1 }]
    });
    controller.start();

    updater.emit('update-available', { version: '1.0.16' });
    updater.emit('update-available', { version: '1.0.16' });
    await settleAsyncWork();
    updater.emit('update-available', { version: '1.0.16' });
    updater.emit('update-available', { version: '1.0.17' });
    await settleAsyncWork();

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(dialog.showMessageBox.mock.calls[0][0]).toMatchObject({
      buttons: ['Update Now', 'Later'],
      cancelId: 1,
      defaultId: 0,
      message: 'A new version of Cavalry for Mac is available.'
    });
    expect(dialog.showMessageBox.mock.calls[0][0].detail).toContain('1.0.16');
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.AVAILABLE,
      currentVersion: '1.0.18',
      availableVersion: '1.0.17',
      progress: null,
      error: null
    });
  });

  it('downloads in the background after Update Now and allows restart to be postponed', async () => {
    const { controller, dialog, updater } = createHarness({
      responses: [{ response: 0 }, { response: 1 }]
    });
    controller.start();

    updater.emit('update-available', { version: '1.0.16' });
    await settleAsyncWork();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();

    updater.emit('update-downloaded', { version: '1.0.16' });
    updater.emit('update-downloaded', { version: '1.0.16' });
    await settleAsyncWork();

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(dialog.showMessageBox.mock.calls[1][0]).toMatchObject({
      buttons: ['Restart and Install', 'Later'],
      cancelId: 1,
      defaultId: 0,
      message: 'The update is ready to install.'
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getState().downloadReady).toBe(true);
  });

  it('finishes service shutdown before handing off to the installer', async () => {
    const order = [];
    const updater = createUpdater();
    updater.quitAndInstall.mockImplementation(() => order.push('install'));
    const beforeQuitAndInstall = vi.fn(async () => {
      order.push('shutdown');
    });
    const { controller } = createHarness({
      beforeQuitAndInstall,
      responses: [{ response: 0 }],
      updater
    });
    controller.start();

    updater.emit('update-downloaded', { version: '1.0.16' });
    await settleAsyncWork();

    expect(beforeQuitAndInstall).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(order).toEqual(['shutdown', 'install']);
  });

  it('recovers the running app and reports an installer handoff failure once', async () => {
    const updater = createUpdater();
    updater.quitAndInstall.mockImplementation(() => {
      updater.emit('error', new Error('Squirrel could not stage the signed update'));
    });
    const { afterQuitAndInstallFailure, controller, dialog } = createHarness({
      responses: [{ response: 0 }, { response: 0 }],
      updater
    });
    controller.start();

    updater.emit('update-downloaded', { version: '1.0.16' });
    await settleAsyncWork(8);

    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    expect(afterQuitAndInstallFailure).toHaveBeenCalledOnce();
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(dialog.showMessageBox.mock.calls[1][0]).toMatchObject({
      buttons: ['OK'],
      message: "The update couldn't be prepared for installation."
    });
    expect(dialog.showMessageBox.mock.calls[1][0].detail).not.toContain('Squirrel');
    expect(controller.getState()).toMatchObject({
      downloadReady: false,
      quitAndInstallRequested: false
    });
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('keeps check errors, up-to-date events, and unrelated updater errors silent', async () => {
    const updater = createUpdater();
    updater.checkForUpdates.mockRejectedValue(new Error('no internet'));
    const { controller, dialog, scheduler } = createHarness({ updater });
    controller.start();

    scheduler.timeouts[0].callback();
    updater.emit('update-not-available', { version: '1.0.15' });
    updater.emit('error', new Error('check failed'));
    await settleAsyncWork();

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('shows one friendly Retry or Later prompt for each failed requested download', async () => {
    const updater = createUpdater();
    updater.downloadUpdate.mockImplementation(() => {
      const error = new Error('socket reset while downloading update');
      updater.emit('error', error);
      return Promise.reject(error);
    });
    const { controller, dialog } = createHarness({
      responses: [{ response: 0 }, { response: 0 }, { response: 1 }],
      updater
    });
    controller.start();

    updater.emit('update-available', { version: '1.0.16' });
    await settleAsyncWork(8);

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(3);
    expect(dialog.showMessageBox.mock.calls[1][0]).toMatchObject({
      buttons: ['Retry', 'Later'],
      message: "The update couldn't be downloaded."
    });
    expect(dialog.showMessageBox.mock.calls[2][0]).toMatchObject({
      buttons: ['Retry', 'Later'],
      message: "The update couldn't be downloaded."
    });
    expect(dialog.showMessageBox.mock.calls[1][0].detail).not.toContain('socket reset');
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.ERROR,
      availableVersion: '1.0.16',
      error: { kind: 'download' }
    });
  });
});

describe('public automatic update state', () => {
  it('normalizes progress without exposing invalid byte counts', () => {
    expect(
      normalizeUpdateProgress({
        percent: 140.5,
        transferred: -1,
        total: Number.NaN,
        bytesPerSecond: 1024.4
      })
    ).toEqual({ percent: 100, transferred: 0, total: 0, bytesPerSecond: 1024 });
  });

  it('publishes sequenced available, downloading, progress, and ready snapshots', async () => {
    let finishDownload;
    const updater = createUpdater();
    updater.downloadUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDownload = resolve;
        })
    );
    const { controller } = createHarness({
      responses: [{ response: 0 }, { response: 1 }],
      updater
    });
    const snapshots = [];
    controller.subscribe((state) => snapshots.push(state));
    controller.start();

    updater.emit('update-available', {
      version: '1.0.19',
      releaseName: 'Cavalry 1.0.19',
      files: [{ url: 'https://secret.example/update.zip' }]
    });
    await settleAsyncWork();
    expect(controller.getPublicState()).toMatchObject({
      enabled: true,
      status: UPDATE_STATUS.DOWNLOADING,
      currentVersion: '1.0.18',
      availableVersion: '1.0.19',
      releaseName: 'Cavalry 1.0.19',
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
    });
    expect(JSON.stringify(controller.getPublicState())).not.toContain('secret.example');

    updater.emit('download-progress', {
      percent: 46.25,
      transferred: 48_496_640,
      total: 104_857_600,
      bytesPerSecond: 2_097_152
    });
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.DOWNLOADING,
      progress: {
        percent: 46.25,
        transferred: 48_496_640,
        total: 104_857_600,
        bytesPerSecond: 2_097_152
      }
    });

    updater.emit('update-downloaded', { version: '1.0.19', releaseName: 'Cavalry 1.0.19' });
    finishDownload([]);
    await settleAsyncWork();
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.READY,
      availableVersion: '1.0.19',
      progress: { percent: 100 },
      error: null
    });
    expect(snapshots.map((state) => state.sequence)).toEqual(
      [...snapshots.map((state) => state.sequence)].sort((left, right) => left - right)
    );
    expect(new Set(snapshots.map((state) => state.sequence)).size).toBe(snapshots.length);
  });

  it('reports manual up-to-date checks and keeps scheduled checks quiet', async () => {
    const updater = createUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-not-available', { version: '1.0.18' });
      return { updateInfo: { version: '1.0.18' } };
    });
    const { controller, dialog, scheduler } = createHarness({ updater });
    controller.start();

    scheduler.timeouts[0].callback();
    await settleAsyncWork();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.UP_TO_DATE,
      availableVersion: '',
      error: null
    });

    await controller.checkForUpdates({ userInitiated: true });
    await settleAsyncWork();
    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(dialog.showMessageBox.mock.calls[0][0]).toMatchObject({
      buttons: ['OK'],
      message: 'Cavalry for Mac is up to date.',
      detail: "You're using version 1.0.18."
    });
  });

  it('shows a sanitized offline result only for user-initiated checks', async () => {
    const updater = createUpdater();
    updater.checkForUpdates.mockRejectedValue(
      new Error('GET https://updates.example/private?token=raw-secret failed')
    );
    const { controller, dialog, scheduler } = createHarness({ updater });
    controller.start();

    scheduler.timeouts[0].callback();
    await settleAsyncWork();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(controller.getPublicState().status).toBe(UPDATE_STATUS.IDLE);

    await controller.checkForUpdates({ userInitiated: true });
    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(dialog.showMessageBox.mock.calls[0][0]).toMatchObject({
      buttons: ['OK'],
      message: "Cavalry couldn't check for updates."
    });
    const serialized = JSON.stringify(controller.getPublicState());
    expect(serialized).not.toContain('updates.example');
    expect(serialized).not.toContain('raw-secret');
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.ERROR,
      error: { kind: 'check' }
    });
  });

  it('upgrades an in-flight scheduled check to a user-visible manual result', async () => {
    let finishCheck;
    const updater = createUpdater();
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = () => {
            updater.emit('update-not-available', { version: '1.0.18' });
            resolve({ updateInfo: { version: '1.0.18' } });
          };
        })
    );
    const { controller, dialog, scheduler } = createHarness({ updater });
    controller.start();

    scheduler.timeouts[0].callback();
    const manualCheck = controller.checkForUpdates({ userInitiated: true });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    finishCheck();
    await manualCheck;
    await settleAsyncWork();

    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(dialog.showMessageBox.mock.calls[0][0].message).toBe('Cavalry for Mac is up to date.');
  });

  it('keeps an available update after Later and lets a manual check reopen its prompt', async () => {
    const updater = createUpdater();
    const { controller, dialog } = createHarness({
      responses: [{ response: 1 }, { response: 1 }],
      updater
    });
    controller.start();

    updater.emit('update-available', { version: '1.0.19' });
    await settleAsyncWork();
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.AVAILABLE,
      availableVersion: '1.0.19'
    });

    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '1.0.19' });
      return { updateInfo: { version: '1.0.19' } };
    });
    await controller.checkForUpdates({ userInitiated: true });
    await settleAsyncWork();

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.AVAILABLE,
      availableVersion: '1.0.19'
    });

    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline with a private feed URL'));
    await controller.checkForUpdates({ userInitiated: true });
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(3);
    expect(dialog.showMessageBox.mock.calls[2][0].message).toBe(
      "Cavalry couldn't check for updates."
    );
    expect(controller.getPublicState()).toMatchObject({
      status: UPDATE_STATUS.AVAILABLE,
      availableVersion: '1.0.19',
      error: null
    });
  });

  it('reports an in-progress or ready update when Check for Updates is chosen again', async () => {
    let finishDownload;
    const updater = createUpdater();
    updater.downloadUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDownload = resolve;
        })
    );
    const { controller, dialog } = createHarness({
      responses: [{ response: 0 }, { response: 0 }, { response: 1 }, { response: 1 }],
      updater
    });
    controller.start();

    updater.emit('update-available', { version: '1.0.19' });
    await settleAsyncWork();
    updater.emit('download-progress', { percent: 36.4, transferred: 36, total: 100 });
    await controller.checkForUpdates({ userInitiated: true });
    expect(dialog.showMessageBox.mock.calls[1][0]).toMatchObject({
      buttons: ['OK'],
      message: 'The update is already downloading.'
    });
    expect(dialog.showMessageBox.mock.calls[1][0].detail).toContain('36% downloaded');

    updater.emit('update-downloaded', { version: '1.0.19' });
    finishDownload([]);
    await settleAsyncWork();
    await controller.checkForUpdates({ userInitiated: true });
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(4);
    expect(dialog.showMessageBox.mock.calls[3][0]).toMatchObject({
      buttons: ['Restart and Install', 'Later'],
      message: 'The update is ready to install.'
    });
  });
});
