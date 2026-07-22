// Keeps the cloud-specific error contract while sharing the privileged renderer IPC guard.
'use strict';

const {
  createTrustedRendererIpcGuard,
  normalizeApprovedDevRendererUrl
} = require('./privileged-ipc-security.cjs');

function normalizeDevRendererUrl(value) {
  const approved = normalizeApprovedDevRendererUrl(value);
  if (!approved) return null;
  const url = new URL(approved);
  return { origin: url.origin, pathname: url.pathname };
}

function createTrustedCloudIpcGuard(options = {}) {
  return createTrustedRendererIpcGuard({
    getMainWindow: options.getMainWindow,
    indexPath: options.indexPath,
    rendererUrl: options.rendererUrl,
    errorMessage: 'Cloud IPC is available only to Cavalry.'
  });
}

module.exports = { createTrustedCloudIpcGuard, normalizeDevRendererUrl };
