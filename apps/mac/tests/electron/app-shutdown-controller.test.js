import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAppShutdownController } = require('../../src/main/app-shutdown-controller.cjs');

function createHarness({ advisorStopError } = {}) {
  const app = { quit: vi.fn() };
  const advisorController = {
    stopLocalAdvisorProcess: vi.fn(async () => {}),
    stopLocalAdvisorServerForSavedSettings: advisorStopError
      ? vi.fn(async () => {
          throw advisorStopError;
        })
      : vi.fn(async () => {})
  };
  const companionApiController = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {})
  };
  const controller = createAppShutdownController({
    app,
    advisorController,
    companionApiController
  });

  return { advisorController, app, companionApiController, controller };
}

describe('Electron app shutdown controller', () => {
  it('delays a normal quit until background services stop', async () => {
    const { advisorController, app, companionApiController, controller } = createHarness();
    const event = { preventDefault: vi.fn() };

    expect(controller.handleBeforeQuit(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();

    await controller.stopBackgroundServices();

    expect(advisorController.stopLocalAdvisorServerForSavedSettings).toHaveBeenCalledWith({
      wait: true,
      forceAfterMs: 2500
    });
    expect(companionApiController.stop).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it('falls back to stopping the Advisor process and reuses one shutdown', async () => {
    const { advisorController, companionApiController, controller } = createHarness({
      advisorStopError: new Error('server did not stop')
    });

    const firstShutdown = controller.stopBackgroundServices();
    const secondShutdown = controller.stopBackgroundServices();
    await firstShutdown;

    expect(secondShutdown).toBe(firstShutdown);
    expect(advisorController.stopLocalAdvisorProcess).toHaveBeenCalledWith({
      wait: true,
      forceAfterMs: 2500
    });
    expect(companionApiController.stop).toHaveBeenCalledOnce();
  });

  it('lets quitAndInstall own the final quit after services are ready', async () => {
    const { app, controller } = createHarness();
    const event = { preventDefault: vi.fn() };

    await controller.prepareToQuitAndInstallUpdate();

    expect(controller.isQuitting()).toBe(true);
    expect(controller.handleBeforeQuit(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('restores normal quitting and optional services after an installer handoff fails', async () => {
    const { companionApiController, controller } = createHarness();
    const event = { preventDefault: vi.fn() };

    await controller.prepareToQuitAndInstallUpdate();
    await controller.recoverAfterFailedUpdateInstall();

    expect(controller.isQuitting()).toBe(false);
    expect(companionApiController.start).toHaveBeenCalledOnce();
    expect(controller.handleBeforeQuit(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
