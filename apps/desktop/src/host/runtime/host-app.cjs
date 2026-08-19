'use strict';

const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');

function defaultUserDataDir(platform = process.platform, environment = process.env) {
  if (environment.CAVALRY_USER_DATA_DIR) {
    return path.resolve(String(environment.CAVALRY_USER_DATA_DIR));
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cavalry for Mac');
  }
  if (platform === 'win32') {
    return path.join(String(environment.APPDATA || os.homedir()), 'Cavalry');
  }
  return path.join(
    String(environment.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')),
    'Cavalry'
  );
}

function createHostApp({ environment = process.env, onQuit } = {}) {
  const emitter = new EventEmitter();
  let appName = String(environment.CAVALRY_APP_NAME || 'Cavalry');
  const userDataDir = defaultUserDataDir(process.platform, environment);
  const version = String(environment.CAVALRY_APP_VERSION || '0.0.0');
  const isPackaged = String(environment.CAVALRY_IS_PACKAGED || '') === '1';

  const app = Object.assign(emitter, {
    isPackaged,
    getName: () => appName,
    getVersion: () => version,
    getPath(name) {
      if (name === 'userData') return userDataDir;
      if (name === 'home') return os.homedir();
      if (name === 'temp') return os.tmpdir();
      return userDataDir;
    },
    setName(value) {
      appName = String(value || appName);
    },
    addRecentDocument() {
      // Cavalry persists its own cross-platform MRU list. The host intentionally
      // does not depend on a platform-specific recent-document API.
    },
    isReady: () => true,
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: () => true,
    quit() {
      if (typeof onQuit === 'function') onQuit();
    }
  });

  return Object.freeze({ app, userDataDir });
}

module.exports = { createHostApp, defaultUserDataDir };
