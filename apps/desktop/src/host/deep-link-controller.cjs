// Routes validated Cavalry review links to the renderer.
'use strict';

const defaultDeepLink = require('./deep-link.cjs');

function createDeepLinkController(options = {}) {
  const app = options.app;
  const BrowserWindow = options.BrowserWindow;
  const parser = options.deepLink || defaultDeepLink;
  let pendingReviewUrl = '';

  function focusWindow() {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win && win.isMinimized()) win.restore();
    if (win) win.focus();
    return win;
  }

  function handle(rawUrl) {
    const command = parser.getCavalryDeepLinkCommand(rawUrl);
    if (!command) return false;
    if (!BrowserWindow.getAllWindows().length) {
      pendingReviewUrl = String(rawUrl || '');
      if (app.isReady()) options.createWindow();
      return true;
    }
    options.sendCommand(command);
    focusWindow();
    return true;
  }

  function consumePendingReviewUrl() {
    const next = pendingReviewUrl;
    pendingReviewUrl = '';
    return next;
  }

  function register() {
    if (!(app && typeof app.on === 'function')) return true;
    const hasLock =
      typeof app.requestSingleInstanceLock !== 'function' ||
      app.requestSingleInstanceLock({ source: 'cavalry' });
    if (!hasLock) {
      app.quit();
      return false;
    }
    app.on('open-url', (event, rawUrl) => {
      event.preventDefault();
      handle(rawUrl);
    });
    app.on('second-instance', (_event, commandLine) => {
      const rawUrl = parser.findCavalryDeepLinkArgument(commandLine);
      if (rawUrl) handle(rawUrl);
      focusWindow();
    });
    return true;
  }

  return {
    consumePendingReviewUrl,
    findLaunchUrl: (args) => parser.findCavalryDeepLinkArgument(args),
    handle,
    register
  };
}

module.exports = { createDeepLinkController };
