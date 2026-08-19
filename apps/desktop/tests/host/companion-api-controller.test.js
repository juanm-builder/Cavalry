import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCompanionApiController } = require('../../src/host/companion-api-controller.cjs');

function makeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}

describe('Companion API main-process controller', () => {
  it('remains disabled when explicitly opted out', async () => {
    const ipcMain = makeIpcMain();
    const loadModules = vi.fn();
    const controller = createCompanionApiController({
      app: { isPackaged: false },
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain,
      environment: { CAVALRY_COMPANION_API_ENABLED: '0' },
      assertTrustedSender: () => true,
      loadModules
    });

    expect(controller.shouldStart()).toBe(false);
    await expect(controller.start()).resolves.toBeNull();
    controller.registerHandlers();
    await expect(
      ipcMain.handlers.get('cavalry-companion:publish-workbook')(
        { sender: {} },
        { workbook: { id: 'must-not-be-retained' } }
      )
    ).resolves.toMatchObject({ ok: false, disabled: true, status: { enabled: false } });
    expect(controller.getWorkbook()).toBeNull();
    expect(loadModules).not.toHaveBeenCalled();
  });

  it('owns Companion server startup, workbook publication, and shutdown', async () => {
    const ipcMain = makeIpcMain();
    const sent = [];
    let senderDestroyed;
    const rendererSender = {
      isDestroyed: () => false,
      send: (channel, payload) => sent.push([channel, payload]),
      once: (event, callback) => {
        if (event === 'destroyed') senderDestroyed = callback;
      },
      removeListener: vi.fn()
    };
    let workbookStore;
    let closed = false;
    const server = {
      close(callback) {
        closed = true;
        callback();
      }
    };
    const loadModules = vi.fn(async () => [
      {
        startCavalryApiServer: vi.fn(async ({ runtimeConfig, workbookStore: store }) => {
          workbookStore = store;
          return {
            server,
            runtime: runtimeConfig,
            status: { api_mode: runtimeConfig.mode },
            url: 'http://127.0.0.1:4317'
          };
        })
      },
      {
        getCompanionApiRuntimeConfig: ({ mode }) => ({ mode })
      },
      {
        createLiveCompanionWorkbookStore: (options) => options
      }
    ]);
    const controller = createCompanionApiController({
      app: { isPackaged: true },
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain,
      environment: {
        CAVALRY_COMPANION_API_ENABLED: '1',
        CAVALRY_COMPANION_API_MODE: 'local_dev'
      },
      assertTrustedSender: () => true,
      loadModules
    });

    controller.registerHandlers();
    expect(Array.from(ipcMain.handlers.keys()).sort()).toEqual([
      'cavalry-companion:get-status',
      'cavalry-companion:publish-workbook'
    ]);

    await ipcMain.handlers.get('cavalry-companion:publish-workbook')(
      { sender: rendererSender },
      { workbook: { id: 'wb-live', name: 'Live workbook' } }
    );
    await controller.start();

    expect(loadModules).toHaveBeenCalledTimes(1);
    expect(workbookStore.getWorkbook()).toEqual({ id: 'wb-live', name: 'Live workbook' });
    workbookStore.saveWorkbook({ id: 'wb-updated', name: 'Updated workbook' });
    expect(sent.at(-1)).toMatchObject([
      'cavalry-companion:workbook-updated',
      { reason: 'api_draft_update', workbook: { id: 'wb-updated' } }
    ]);
    senderDestroyed();
    expect(controller.getWorkbook()).toBeNull();

    workbookStore.saveWorkbook({ id: 'wb-api-after-destroy', name: 'API workbook' });
    expect(controller.getWorkbook()).toMatchObject({ id: 'wb-api-after-destroy' });

    await controller.stop();
    expect(closed).toBe(true);
    expect(controller.getWorkbook()).toBeNull();
    await expect(ipcMain.handlers.get('cavalry-companion:get-status')()).resolves.toMatchObject({
      ok: true,
      status: { enabled: true, running: false, live_workbook_id: '' }
    });
  });
});
