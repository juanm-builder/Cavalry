// Keeps BrowserWindow construction and preload security settings out of the main process composition root.

const { pathToFileURL } = require('node:url');

function isSafeExternalUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch (_error) {
    return false;
  }
}

function isAllowedRendererNavigation(rawUrl, options = {}) {
  try {
    const candidate = new URL(String(rawUrl || ''));
    if (options.rendererUrl) {
      const development = new URL(options.rendererUrl);
      return candidate.origin === development.origin && candidate.pathname === development.pathname;
    }
    const packaged = new URL(pathToFileURL(options.indexPath).href);
    return (
      candidate.protocol === 'file:' &&
      candidate.hostname === packaged.hostname &&
      candidate.pathname === packaged.pathname
    );
  } catch (_error) {
    return false;
  }
}

function openSafeExternalUrl(shell, rawUrl) {
  if (!(shell && typeof shell.openExternal === 'function' && isSafeExternalUrl(rawUrl))) return;
  Promise.resolve(shell.openExternal(rawUrl)).catch(() => undefined);
}

function createCavalryMainWindow(options = {}) {
  const BrowserWindow = options.BrowserWindow;
  if (!BrowserWindow) {
    throw new Error('BrowserWindow dependency is required.');
  }
  const win = new BrowserWindow({
    title: options.appTitle || 'Cavalry for Mac',
    width: 1440,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b0b0b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  if (typeof options.installAdvisorMediaPermissionHandlers === 'function') {
    options.installAdvisorMediaPermissionHandlers(win);
  }

  if (win.webContents && typeof win.webContents.on === 'function') {
    win.webContents.on('will-navigate', function (event, url) {
      if (isAllowedRendererNavigation(url, options)) return;
      event.preventDefault();
      openSafeExternalUrl(options.shell, url);
    });
  }
  if (win.webContents && typeof win.webContents.setWindowOpenHandler === 'function') {
    win.webContents.setWindowOpenHandler(function ({ url }) {
      openSafeExternalUrl(options.shell, url);
      return { action: 'deny' };
    });
  }

  win.once('ready-to-show', function () {
    if (options.startMaximized !== false && typeof win.maximize === 'function') {
      win.maximize();
    }
    win.show();
  });

  win.webContents.once('did-finish-load', function () {
    const pendingDeepLink =
      typeof options.consumePendingDeepLink === 'function' ? options.consumePendingDeepLink() : '';
    if (pendingDeepLink && typeof options.handlePendingDeepLink === 'function') {
      options.handlePendingDeepLink(pendingDeepLink);
    }
  });

  if (options.rendererUrl) {
    win.loadURL(options.rendererUrl);
  } else {
    win.loadFile(options.indexPath);
  }
  return win;
}

module.exports = {
  createCavalryMainWindow,
  isAllowedRendererNavigation,
  isSafeExternalUrl
};
