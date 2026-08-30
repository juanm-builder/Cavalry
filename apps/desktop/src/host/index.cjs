// Cavalry desktop host sidecar.
//
// The renderer runs inside Tauri's system WebView. Privileged finance-file,
// cloud, Companion API, and Advisor work remains in this isolated Node host and
// is exposed only through a versioned request/event protocol owned by Rust.
'use strict';

const readline = require('node:readline');
const { createAdvisorRuntimeController } = require('./advisor-runtime-controller.cjs');
const { createCloudController } = require('./cloud-controller.cjs');
const { createCompanionApiController } = require('./companion-api-controller.cjs');
const deepLink = require('./deep-link.cjs');
const { createDeepLinkController } = require('./deep-link-controller.cjs');
const { createSafeStorage } = require('./safe-storage.cjs');
const { createWorkbookFileController } = require('./workbook-file-controller.cjs');
const { createHostApp } = require('./runtime/host-app.cjs');
const { createHostIpcRouter } = require('./runtime/ipc-router.cjs');
const {
  createNativeBridge,
  createDialogAdapter,
  createShellAdapter
} = require('./runtime/native-bridge.cjs');
const {
  PROTOCOL_VERSION,
  decodeProtocolLine,
  encodeProtocolMessage,
  serializeError
} = require('./runtime/protocol.cjs');

// Stdout is reserved for machine-readable IPC. Route ordinary application logs
// to stderr so a dependency cannot corrupt the host protocol stream.
for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
  console[method] = (...values) => {
    const text = values
      .map((value) => {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch (_error) {
          return String(value);
        }
      })
      .join(' ');
    process.stderr.write(`[cavalry-host:${method}] ${text}\n`);
  };
}

function sendProtocol(message) {
  try {
    process.stdout.write(encodeProtocolMessage({ version: PROTOCOL_VERSION, ...message }));
  } catch (error) {
    process.stderr.write(`[cavalry-host:fatal] ${error && error.stack ? error.stack : error}\n`);
  }
}

function appTitleForPlatform() {
  if (process.env.CAVALRY_APP_NAME) return String(process.env.CAVALRY_APP_NAME);
  return 'Cavalry for Mac';
}

let shuttingDown = false;
let advisorController = null;
let companionApiController = null;
let cloudController = null;
let nativeBridge = null;

async function shutdown(reason = 'shutdown') {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (advisorController) {
      await Promise.race([
        advisorController.stopLocalAdvisorServerForSavedSettings({
          wait: true,
          forceAfterMs: 2_500
        }),
        new Promise((resolve) => setTimeout(resolve, 3_000))
      ]).catch(() => advisorController.stopLocalAdvisorProcess({ forceAfterMs: 1_000 }));
    }
  } catch (_error) {
    // Best-effort process cleanup continues below.
  }
  try {
    if (companionApiController) await companionApiController.stop();
  } catch (_error) {
    // Best effort.
  }
  try {
    if (cloudController) cloudController.dispose();
  } catch (_error) {
    // Best effort.
  }
  if (nativeBridge) nativeBridge.rejectAll(`Cavalry desktop host stopped (${reason}).`);
  sendProtocol({ type: 'stopped', reason: String(reason || 'shutdown') });
  setTimeout(() => process.exit(0), 20).unref();
}

async function start() {
  nativeBridge = createNativeBridge({
    emitRequest(request) {
      sendProtocol({ type: 'native-request', request });
    }
  });
  const dialog = createDialogAdapter(nativeBridge);
  const shell = createShellAdapter(nativeBridge);
  const router = createHostIpcRouter({
    emitEvent(channel, payload) {
      sendProtocol({ type: 'event', channel, payload });
    }
  });
  const { app, userDataDir } = createHostApp({
    environment: { ...process.env, CAVALRY_APP_NAME: appTitleForPlatform() },
    onQuit: () => void shutdown('app_quit')
  });
  const safeStorage = createSafeStorage({
    userDataDir,
    isPackaged: app.isPackaged,
    platform: process.platform
  });
  const assertTrustedSender = () => true;
  const systemPreferences = {
    getMediaAccessStatus: () => 'unknown',
    askForMediaAccess: async () => false
  };

  const workbookFileController = createWorkbookFileController({
    app,
    ipcMain: router.ipcMain,
    dialog,
    shell,
    appTitle: appTitleForPlatform(),
    assertTrustedSender
  });
  companionApiController = createCompanionApiController({
    app,
    BrowserWindow: router.BrowserWindow,
    ipcMain: router.ipcMain,
    assertTrustedSender
  });
  advisorController = createAdvisorRuntimeController({
    app,
    dialog,
    ipcMain: router.ipcMain,
    safeStorage,
    shell,
    systemPreferences,
    assertTrustedSender
  });
  cloudController = createCloudController({
    BrowserWindow: router.BrowserWindow,
    ipcMain: router.ipcMain,
    cloudKit: {
      request: (payload) => nativeBridge.request('cloudkit.request', payload)
    },
    assertTrustedSender
  });

  const sendCommand = (command) =>
    sendProtocol({
      type: 'event',
      channel: 'cavalry-command',
      payload: command
    });
  const deepLinkController = createDeepLinkController({
    app,
    BrowserWindow: router.BrowserWindow,
    deepLink,
    createWindow: () => router.mainWindow,
    sendCommand
  });

  await workbookFileController.loadFileState();
  workbookFileController.registerFileHandlers();
  companionApiController.registerHandlers();
  advisorController.registerHandlers();
  cloudController.registerHandlers();
  deepLinkController.register();

  router.ipcMain.handle('cavalry-host:deep-link', async (_event, payload) => ({
    ok: deepLinkController.handle(String((payload && payload.url) || ''))
  }));
  router.ipcMain.handle('cavalry-host:get-info', async () => ({
    ok: true,
    appName: appTitleForPlatform(),
    version: app.getVersion(),
    protocolVersion: PROTOCOL_VERSION,
    userDataDir,
    secureStorageBackend: safeStorage.getSelectedStorageBackend(),
    channels: router.getRegisteredChannels()
  }));

  void companionApiController.start();

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    const message = decodeProtocolLine(line);
    if (!message || message.version !== PROTOCOL_VERSION) return;
    if (message.type === 'native-response') {
      nativeBridge.respond(message.response || message);
      return;
    }
    if (message.type === 'native-event') {
      cloudController?.handleNativeEvent(String(message.source || ''), message.payload || {});
      return;
    }
    if (message.type === 'lifecycle' && message.action === 'shutdown') {
      void shutdown('tauri_exit');
      return;
    }
    if (message.type !== 'request') return;
    const id = String(message.id || '');
    if (!id) return;
    void router
      .invoke(message.channel, message.payload)
      .then((result) => sendProtocol({ type: 'response', id, ok: true, result }))
      .catch((error) =>
        sendProtocol({ type: 'response', id, ok: false, error: serializeError(error) })
      );
  });
  input.once('close', () => void shutdown('stdin_closed'));

  process.once('SIGINT', () => void shutdown('sigint'));
  process.once('SIGTERM', () => void shutdown('sigterm'));
  process.once('uncaughtException', (error) => {
    sendProtocol({ type: 'fatal', error: serializeError(error) });
    console.error(error);
    void shutdown('uncaught_exception');
  });
  process.once('unhandledRejection', (error) => {
    sendProtocol({ type: 'fatal', error: serializeError(error) });
    console.error(error);
    void shutdown('unhandled_rejection');
  });

  sendProtocol({
    type: 'ready',
    protocolVersion: PROTOCOL_VERSION,
    appName: appTitleForPlatform(),
    appVersion: app.getVersion(),
    channels: router.getRegisteredChannels()
  });
}

start().catch((error) => {
  sendProtocol({ type: 'fatal', error: serializeError(error) });
  console.error(error);
  process.exitCode = 1;
});

module.exports = { appTitleForPlatform, shutdown, start };
