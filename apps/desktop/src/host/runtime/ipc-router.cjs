'use strict';

const { EventEmitter } = require('node:events');

function createHostIpcRouter({ emitEvent } = {}) {
  const handlers = new Map();
  const sender = new EventEmitter();
  const send = typeof emitEvent === 'function' ? emitEvent : () => undefined;

  sender.send = (channel, payload) => send(String(channel || ''), payload);
  sender.isDestroyed = () => false;
  sender.getURL = () => 'tauri://localhost/';
  sender.mainFrame = sender;
  sender.top = sender;
  sender.url = 'tauri://localhost/';

  const webContents = sender;
  webContents.isDestroyed = () => false;

  const mainWindow = new EventEmitter();
  mainWindow.webContents = webContents;
  mainWindow.isDestroyed = () => false;
  mainWindow.isMinimized = () => false;
  mainWindow.restore = () => undefined;
  mainWindow.focus = () => undefined;
  mainWindow.show = () => undefined;
  mainWindow.hide = () => undefined;

  const BrowserWindow = {
    getAllWindows: () => [mainWindow],
    getFocusedWindow: () => mainWindow
  };

  const ipcMain = {
    handle(channel, handler) {
      const name = String(channel || '');
      if (!name || typeof handler !== 'function') {
        throw new TypeError('IPC handlers require a channel and function.');
      }
      if (handlers.has(name)) {
        throw new Error(`IPC handler already registered for ${name}.`);
      }
      handlers.set(name, handler);
    },
    removeHandler(channel) {
      handlers.delete(String(channel || ''));
    }
  };

  async function invoke(channel, payload) {
    const name = String(channel || '');
    const handler = handlers.get(name);
    if (!handler) {
      const error = new Error(`Unknown Cavalry desktop host channel: ${name}`);
      error.code = 'unknown_host_channel';
      throw error;
    }
    const event = {
      sender,
      senderFrame: sender
    };
    return handler(event, payload == null ? {} : payload);
  }

  return Object.freeze({
    BrowserWindow,
    ipcMain,
    invoke,
    mainWindow,
    sender,
    getRegisteredChannels: () => [...handlers.keys()].sort()
  });
}

module.exports = { createHostIpcRouter };
