'use strict';

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function envFlag(environment, name) {
  const raw = String(environment[name] || '').trim();
  return raw === '1' || /^true$/i.test(raw);
}

function createCompanionApiController({
  app,
  BrowserWindow,
  ipcMain,
  environment = process.env,
  assertTrustedSender,
  loadModules = () =>
    Promise.all([
      import('@cavalry/companion-api/server/cavalry-api/server.js'),
      import('@cavalry/companion-api/server/cavalry-api/runtime.js'),
      import('@cavalry/companion-api/server/cavalry-api/live-workbook-store.js')
    ])
} = {}) {
  let liveWorkbook = null;
  let liveWorkbookSender = null;
  let liveWorkbookSenderDestroyedListener = null;
  let server = null;
  let runtime = null;
  let status = null;
  let startPromise = null;
  let lastError = '';

  function shouldStart() {
    if (environment.CAVALRY_COMPANION_API_ENABLED === '0') return false;
    if (
      envFlag(environment, 'CAVALRY_COMPANION_API_ENABLED') ||
      envFlag(environment, 'CAVALRY_API_ENABLED')
    ) {
      return true;
    }
    if (
      environment.CAVALRY_COMPANION_API_MODE ||
      environment.CAVALRY_COMPANION_PUBLIC_BASE_URL ||
      environment.CAVALRY_COMPANION_BETA_API_KEY ||
      environment.CAVALRY_COMPANION_BETA_API_KEY_HASH
    ) {
      return true;
    }
    return !app.isPackaged;
  }

  function getWorkbook() {
    return liveWorkbook && typeof liveWorkbook === 'object' ? liveWorkbook : null;
  }

  function clearLiveWorkbookReferences() {
    if (
      liveWorkbookSender &&
      liveWorkbookSenderDestroyedListener &&
      typeof liveWorkbookSender.removeListener === 'function'
    ) {
      liveWorkbookSender.removeListener('destroyed', liveWorkbookSenderDestroyedListener);
    }
    liveWorkbook = null;
    liveWorkbookSender = null;
    liveWorkbookSenderDestroyedListener = null;
    status = Object.assign({}, status || {}, {
      live_workbook_id: '',
      live_workbook_name: ''
    });
  }

  function retainLiveWorkbookSender(sender) {
    if (liveWorkbookSender === sender) return;
    if (
      liveWorkbookSender &&
      liveWorkbookSenderDestroyedListener &&
      typeof liveWorkbookSender.removeListener === 'function'
    ) {
      liveWorkbookSender.removeListener('destroyed', liveWorkbookSenderDestroyedListener);
    }
    liveWorkbookSender = sender || null;
    liveWorkbookSenderDestroyedListener = null;
    if (!(sender && typeof sender.once === 'function')) return;

    const handleDestroyed = () => {
      if (liveWorkbookSender !== sender) return;
      liveWorkbook = null;
      liveWorkbookSender = null;
      liveWorkbookSenderDestroyedListener = null;
      status = Object.assign({}, status || {}, {
        live_workbook_id: '',
        live_workbook_name: ''
      });
      sendStatus(status);
    };
    liveWorkbookSenderDestroyedListener = handleDestroyed;
    sender.once('destroyed', handleDestroyed);
  }

  function sendStatus(nextStatus) {
    const payload = Object.assign(
      {
        enabled: shouldStart(),
        running: !!server,
        error: lastError
      },
      nextStatus || status || {}
    );
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('cavalry-companion:status', payload);
      }
    });
  }

  function sendWorkbookUpdate(workbook, reason) {
    const payload = {
      workbook: clonePlain(workbook),
      reason: String(reason || 'api_update'),
      updatedAt: new Date().toISOString()
    };
    if (liveWorkbookSender && !liveWorkbookSender.isDestroyed()) {
      liveWorkbookSender.send('cavalry-companion:workbook-updated', payload);
      return;
    }
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('cavalry-companion:workbook-updated', payload);
      }
    });
  }

  async function start() {
    if (!shouldStart()) return null;
    if (startPromise) return startPromise;

    startPromise = loadModules()
      .then(async ([serverModule, runtimeModule, liveStoreModule]) => {
        const runtimeConfig = runtimeModule.getCompanionApiRuntimeConfig({
          enabled: true,
          mode:
            environment.CAVALRY_COMPANION_API_MODE ||
            (envFlag(environment, 'CAVALRY_COMPANION_BETA_TUNNEL') ? 'beta_tunnel' : 'local_dev')
        });
        const workbookStore = liveStoreModule.createLiveCompanionWorkbookStore({
          getWorkbook,
          saveWorkbook(workbook) {
            liveWorkbook = workbook && typeof workbook === 'object' ? workbook : null;
            status = Object.assign({}, status || {}, {
              live_workbook_id: liveWorkbook && liveWorkbook.id ? String(liveWorkbook.id) : '',
              live_workbook_name: liveWorkbook && liveWorkbook.name ? String(liveWorkbook.name) : ''
            });
            if (liveWorkbook) sendWorkbookUpdate(liveWorkbook, 'api_draft_update');
            return liveWorkbook;
          }
        });
        const started = await serverModule.startCavalryApiServer({
          runtimeConfig,
          workbookStore,
          quiet: false
        });
        server = started.server;
        runtime = started.runtime;
        status = Object.assign({}, started.status, {
          running: true,
          url: started.url,
          live_workbook_id: liveWorkbook && liveWorkbook.id ? String(liveWorkbook.id) : ''
        });
        lastError = '';
        sendStatus(status);
        return started;
      })
      .catch((error) => {
        lastError = error && error.message ? error.message : String(error);
        console.warn('Cavalry Companion API did not start:', lastError);
        sendStatus({ running: false, error: lastError });
        return null;
      })
      .finally(() => {
        startPromise = null;
      });
    return startPromise;
  }

  function stop() {
    const activeServer = server;
    server = null;
    runtime = null;
    clearLiveWorkbookReferences();
    status = Object.assign({}, status || {}, { running: false });
    return new Promise((resolve) => {
      if (!activeServer) {
        sendStatus(status);
        resolve();
        return;
      }
      activeServer.close(() => {
        sendStatus(status);
        resolve();
      });
    });
  }

  function registerHandlers() {
    if (typeof assertTrustedSender !== 'function') {
      throw new Error('A trusted IPC sender guard is required.');
    }
    const handle = (channel, handler) => {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedSender(event);
        return handler(event, ...args);
      });
    };

    handle('cavalry-companion:publish-workbook', async (event, payload) => {
      if (!shouldStart()) {
        clearLiveWorkbookReferences();
        status = Object.assign({}, status || {}, { enabled: false, running: false });
        return { ok: false, disabled: true, status };
      }
      const workbook =
        payload && payload.workbook && typeof payload.workbook === 'object'
          ? payload.workbook
          : null;
      liveWorkbook = workbook;
      retainLiveWorkbookSender(event.sender);
      status = Object.assign({}, status || {}, {
        enabled: true,
        running: !!server,
        api_mode: (runtime && runtime.mode) || (status && status.api_mode) || '',
        live_workbook_id: workbook && workbook.id ? String(workbook.id) : '',
        live_workbook_name: workbook && workbook.name ? String(workbook.name) : ''
      });
      if (!server && shouldStart()) start();
      else sendStatus(status);
      return { ok: true, status };
    });

    handle('cavalry-companion:get-status', async () => ({
      ok: true,
      status: Object.assign(
        {
          enabled: shouldStart(),
          running: !!server,
          error: lastError,
          live_workbook_id: liveWorkbook && liveWorkbook.id ? String(liveWorkbook.id) : ''
        },
        status || {}
      )
    }));
  }

  return {
    getWorkbook,
    registerHandlers,
    shouldStart,
    start,
    stop
  };
}

module.exports = {
  clonePlain,
  createCompanionApiController,
  envFlag
};
