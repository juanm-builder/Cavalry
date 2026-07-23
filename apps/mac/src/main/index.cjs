// Electron composition root: wires application lifecycle to focused main-process controllers.
'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  systemPreferences
} = require('electron');
const path = require('path');
const { installCavalryAppMenu } = require('./app-menu-controller.cjs');
const { createAutoUpdateIpcController } = require('./auto-update-ipc-controller.cjs');
const { createAutoUpdateController, getCavalryAppTitle } = require('./auto-update-controller.cjs');
const { createAppShutdownController } = require('./app-shutdown-controller.cjs');
const { createAdvisorRuntimeController } = require('./advisor-runtime-controller.cjs');
const { createCloudController } = require('./cloud-controller.cjs');
const { createCloudDeepLinkController } = require('./cloud-deep-link-controller.cjs');
const { createCompanionApiController } = require('./companion-api-controller.cjs');
const deepLink = require('./deep-link.cjs');
const { createCavalryMainWindow } = require('./main-window-controller.cjs');
const {
  createTrustedRendererIpcGuard,
  resolveCavalryRendererUrl
} = require('./privileged-ipc-security.cjs');
const { createWorkbookFileController } = require('./workbook-file-controller.cjs');

const APP_TITLE = getCavalryAppTitle(process.platform);
const RENDERER_INDEX_PATH = path.join(__dirname, '..', 'renderer', 'index.html');
const rendererUrl = resolveCavalryRendererUrl({
  isPackaged: !!(app && app.isPackaged),
  rendererUrl: process.env.CAVALRY_RENDERER_URL || ''
});
let mainWindow = null;
const assertTrustedRendererIpcSender = createTrustedRendererIpcGuard({
  getMainWindow: () => mainWindow,
  indexPath: RENDERER_INDEX_PATH,
  rendererUrl
});

const workbookFileController = createWorkbookFileController({
  app,
  ipcMain,
  dialog,
  shell,
  appTitle: APP_TITLE,
  assertTrustedSender: assertTrustedRendererIpcSender
});
const companionApiController = createCompanionApiController({
  app,
  BrowserWindow,
  ipcMain,
  assertTrustedSender: assertTrustedRendererIpcSender
});
const advisorController = createAdvisorRuntimeController({
  app,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  systemPreferences,
  assertTrustedSender: assertTrustedRendererIpcSender
});
const cloudController = createCloudController({
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  indexPath: RENDERER_INDEX_PATH,
  rendererUrl,
  supabaseUrl: process.env.CAVALRY_SUPABASE_URL,
  publishableKey: process.env.CAVALRY_SUPABASE_PUBLISHABLE_KEY,
  assertTrustedSender: assertTrustedRendererIpcSender
});

const shutdownController = createAppShutdownController({
  app,
  advisorController,
  companionApiController
});
const autoUpdateController = createAutoUpdateController({
  app,
  dialog,
  afterQuitAndInstallFailure: shutdownController.recoverAfterFailedUpdateInstall,
  beforeQuitAndInstall: shutdownController.prepareToQuitAndInstallUpdate
});
const autoUpdateIpcController = createAutoUpdateIpcController({
  BrowserWindow,
  ipcMain,
  updater: autoUpdateController,
  assertTrustedSender: assertTrustedRendererIpcSender
});
if (app && typeof app.setName === 'function') {
  app.setName(APP_TITLE);
}

function sendCommand(command) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('cavalry-command', command);
  }
}

function createAppMenu() {
  return installCavalryAppMenu({
    Menu,
    appName: app.name,
    sendCommand,
    updatesEnabled: autoUpdateController.getPublicState().enabled,
    onCheckForUpdates: () => {
      void autoUpdateController.checkForUpdates({ userInitiated: true });
    }
  });
}

function createMainWindow() {
  const win = createCavalryMainWindow({
    BrowserWindow,
    appTitle: APP_TITLE,
    preloadPath: path.join(__dirname, '..', 'preload', 'index.cjs'),
    indexPath: RENDERER_INDEX_PATH,
    rendererUrl,
    shell,
    installAdvisorMediaPermissionHandlers: advisorController.installAdvisorMediaPermissionHandlers,
    consumePendingDeepLink: deepLinkController.consumePendingReviewUrl,
    handlePendingDeepLink: deepLinkController.handle
  });
  mainWindow = win;
  if (win && typeof win.once === 'function') {
    win.once('closed', function () {
      if (mainWindow === win) mainWindow = null;
    });
  }
  return win;
}

const deepLinkController = createCloudDeepLinkController({
  app,
  BrowserWindow,
  cloudController,
  deepLink,
  createWindow: createMainWindow,
  sendCommand
});
const hasSingleInstanceLock = deepLinkController.register();

if (
  hasSingleInstanceLock &&
  app &&
  typeof app.whenReady === 'function' &&
  typeof app.on === 'function'
) {
  app.whenReady().then(async function () {
    await workbookFileController.loadFileState();
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('cavalry', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('cavalry');
    }
    workbookFileController.registerFileHandlers();
    companionApiController.registerHandlers();
    advisorController.registerHandlers();
    cloudController.registerHandlers();
    autoUpdateIpcController.registerHandlers();
    autoUpdateController.start();
    createAppMenu();
    const launchDeepLink = deepLinkController.findLaunchUrl(process.argv);
    if (launchDeepLink) deepLinkController.handle(launchDeepLink);
    if (!BrowserWindow.getAllWindows().length) createMainWindow();
    void cloudController.restoreExistingSession().catch(() => undefined);
    companionApiController.start();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', function () {
    advisorController.stopLocalAdvisorServerForSavedSettings({ forceAfterMs: 2500 }).catch(() => {
      advisorController.stopLocalAdvisorProcess({ forceAfterMs: 2500 });
    });
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => shutdownController.handleBeforeQuit(event));

  app.on('will-quit', function () {
    autoUpdateController.stop();
    autoUpdateIpcController.dispose();
    companionApiController.stop();
    advisorController.stopLocalAdvisorProcess({ forceAfterMs: 1000 });
    cloudController.dispose();
  });
}

module.exports = Object.assign({ APP_TITLE, getCavalryAppTitle }, advisorController);
