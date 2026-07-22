// Pins the trusted updater IPC surface and renderer-safe state broadcasting.

import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  AUTO_UPDATE_IPC_CHANNELS,
  createAutoUpdateIpcController,
  createTrustedUpdateIpcGuard
} = require('../../src/main/auto-update-ipc-controller.cjs');

function createHarness() {
  const handlers = new Map();
  const removedHandlers = [];
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => {
      removedHandlers.push(channel);
      handlers.delete(channel);
    }
  };
  const sent = [];
  const mainFrame = {
    url: 'file:///Applications/Cavalry/index.html',
    top: null
  };
  const webContents = {
    mainFrame,
    getURL: () => mainFrame.url,
    isDestroyed: () => false,
    send: (channel, state) => sent.push({ channel, state })
  };
  const window = {
    isDestroyed: () => false,
    webContents
  };
  const BrowserWindow = { getAllWindows: () => [window] };
  let listener = null;
  let state = {
    sequence: 1,
    enabled: true,
    status: 'available',
    currentVersion: '1.0.18',
    availableVersion: '1.0.19',
    releaseName: 'Cavalry 1.0.19',
    checkedAt: '2026-07-21T03:00:00.000Z',
    progress: null,
    error: null
  };
  const updater = {
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => true),
    quitAndInstall: vi.fn(async () => true),
    getPublicState: () => ({ ...state }),
    subscribe: vi.fn((callback) => {
      listener = callback;
      return vi.fn(() => {
        listener = null;
      });
    })
  };
  const controller = createAutoUpdateIpcController({
    BrowserWindow,
    ipcMain,
    updater,
    getMainWindow: () => window,
    indexPath: '/Applications/Cavalry/index.html'
  });
  const event = { sender: webContents, senderFrame: mainFrame };

  return {
    BrowserWindow,
    controller,
    event,
    handlers,
    ipcMain,
    removedHandlers,
    sent,
    setState: (next) => {
      state = { ...state, ...next };
    },
    updater,
    webContents,
    emitState: (next) => listener && listener(next)
  };
}

describe('auto-update IPC controller', () => {
  it('registers only the narrow updater commands and dispatches their actions', async () => {
    const { controller, event, handlers, updater } = createHarness();
    expect(controller.registerHandlers()).toBe(true);
    expect(controller.registerHandlers()).toBe(false);
    expect([...handlers.keys()].sort()).toEqual(
      [
        AUTO_UPDATE_IPC_CHANNELS.getState,
        AUTO_UPDATE_IPC_CHANNELS.check,
        AUTO_UPDATE_IPC_CHANNELS.download,
        AUTO_UPDATE_IPC_CHANNELS.restartAndInstall
      ].sort()
    );

    await expect(handlers.get(AUTO_UPDATE_IPC_CHANNELS.getState)(event)).resolves.toMatchObject({
      ok: true,
      state: { status: 'available', availableVersion: '1.0.19' }
    });
    await handlers.get(AUTO_UPDATE_IPC_CHANNELS.check)(event);
    await handlers.get(AUTO_UPDATE_IPC_CHANNELS.download)(event);
    await handlers.get(AUTO_UPDATE_IPC_CHANNELS.restartAndInstall)(event);

    expect(updater.checkForUpdates).toHaveBeenCalledWith({ userInitiated: true });
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('broadcasts sequenced state only to live windows and cleans up handlers', () => {
    const { controller, emitState, handlers, removedHandlers, sent } = createHarness();
    controller.registerHandlers();
    const state = {
      sequence: 8,
      enabled: true,
      status: 'downloading',
      currentVersion: '1.0.18',
      availableVersion: '1.0.19',
      releaseName: '',
      checkedAt: null,
      progress: { percent: 42, transferred: 42, total: 100, bytesPerSecond: 5 },
      error: null
    };
    emitState(state);

    expect(sent).toEqual([{ channel: AUTO_UPDATE_IPC_CHANNELS.stateChanged, state }]);
    controller.dispose();
    expect(handlers.size).toBe(0);
    expect(removedHandlers.sort()).toEqual(
      [
        AUTO_UPDATE_IPC_CHANNELS.getState,
        AUTO_UPDATE_IPC_CHANNELS.check,
        AUTO_UPDATE_IPC_CHANNELS.download,
        AUTO_UPDATE_IPC_CHANNELS.restartAndInstall
      ].sort()
    );
  });

  it('rejects subframes, remote documents, and senders that are not the Cavalry window', () => {
    const { event, webContents } = createHarness();
    const window = { isDestroyed: () => false, webContents };
    const guard = createTrustedUpdateIpcGuard({
      getMainWindow: () => window,
      indexPath: '/Applications/Cavalry/index.html'
    });
    const top = webContents.mainFrame;

    expect(() => guard(event)).not.toThrow();
    expect(() => guard({ sender: {}, senderFrame: top })).toThrow(
      'Update controls are available only to Cavalry.'
    );
    expect(() =>
      guard({
        sender: webContents,
        senderFrame: { url: top.url, top }
      })
    ).toThrow('Update controls are available only to Cavalry.');
    top.url = 'https://attacker.example/app';
    expect(() => guard(event)).toThrow('Update controls are available only to Cavalry.');
  });

  it('returns only the controller sanitized message when an action fails', async () => {
    const { controller, event, handlers, setState, updater } = createHarness();
    updater.downloadUpdate.mockResolvedValue(false);
    setState({
      status: 'error',
      error: { kind: 'download', message: "The update couldn't be downloaded." }
    });
    controller.registerHandlers();

    const result = await handlers.get(AUTO_UPDATE_IPC_CHANNELS.download)(event);
    expect(result).toEqual({
      ok: false,
      error: "The update couldn't be downloaded.",
      state: expect.objectContaining({
        status: 'error',
        error: { kind: 'download', message: "The update couldn't be downloaded." }
      })
    });
    expect(JSON.stringify(result)).not.toMatch(/https?:|token=/);
  });

  it('reports an unavailable manual check as a failed action', async () => {
    const { controller, event, handlers, setState, updater } = createHarness();
    updater.checkForUpdates.mockResolvedValue(false);
    setState({ enabled: false, status: 'disabled', error: null });
    controller.registerHandlers();

    await expect(handlers.get(AUTO_UPDATE_IPC_CHANNELS.check)(event)).resolves.toMatchObject({
      ok: false,
      state: { enabled: false, status: 'disabled' }
    });
  });
});
