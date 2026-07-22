// Defines the only renderer URL allowed in development and authorizes privileged renderer IPC.
'use strict';

const { pathToFileURL } = require('node:url');

const APPROVED_DEV_RENDERER_URL = 'http://127.0.0.1:5173/';

function normalizeApprovedDevRendererUrl(value) {
  try {
    const candidate = new URL(String(value || ''));
    const approved = new URL(APPROVED_DEV_RENDERER_URL);
    return candidate.href === approved.href ? approved.href : '';
  } catch (_error) {
    return '';
  }
}

function resolveCavalryRendererUrl({ isPackaged = false, rendererUrl = '' } = {}) {
  if (isPackaged) return '';
  return normalizeApprovedDevRendererUrl(rendererUrl);
}

function matchesRendererUrl(rawUrl, expectedUrl) {
  try {
    const candidate = new URL(String(rawUrl || ''));
    const expected = new URL(String(expectedUrl || ''));
    return (
      candidate.protocol === expected.protocol &&
      candidate.username === expected.username &&
      candidate.password === expected.password &&
      candidate.hostname === expected.hostname &&
      candidate.port === expected.port &&
      candidate.pathname === expected.pathname &&
      candidate.search === expected.search
    );
  } catch (_error) {
    return false;
  }
}

function createTrustedRendererIpcGuard(options = {}) {
  const getMainWindow =
    typeof options.getMainWindow === 'function' ? options.getMainWindow : () => null;
  const packagedUrl = options.indexPath ? pathToFileURL(options.indexPath).href : '';
  const developmentUrl = normalizeApprovedDevRendererUrl(options.rendererUrl);
  const expectedUrl = developmentUrl || packagedUrl;
  const errorMessage = options.errorMessage || 'Privileged IPC is available only to Cavalry.';

  return function assertTrustedRendererIpcSender(event) {
    const mainWindow = getMainWindow();
    const sender = event && event.sender;
    const senderFrame = event && event.senderFrame;
    const mainFrame = sender && sender.mainFrame;
    const windowAlive =
      mainWindow && (typeof mainWindow.isDestroyed !== 'function' || !mainWindow.isDestroyed());
    const senderAlive =
      sender && (typeof sender.isDestroyed !== 'function' || !sender.isDestroyed());
    const topFrame =
      senderFrame &&
      mainFrame &&
      senderFrame === mainFrame &&
      (!senderFrame.top || senderFrame.top === senderFrame);
    const frameUrl = senderFrame && senderFrame.url;
    const currentUrl = sender && typeof sender.getURL === 'function' ? sender.getURL() : frameUrl;
    const trusted =
      windowAlive &&
      senderAlive &&
      mainWindow.webContents === sender &&
      topFrame &&
      matchesRendererUrl(frameUrl, expectedUrl) &&
      matchesRendererUrl(currentUrl, expectedUrl);

    if (trusted) return true;
    throw new Error(errorMessage);
  };
}

module.exports = {
  APPROVED_DEV_RENDERER_URL,
  createTrustedRendererIpcGuard,
  matchesRendererUrl,
  normalizeApprovedDevRendererUrl,
  resolveCavalryRendererUrl
};
