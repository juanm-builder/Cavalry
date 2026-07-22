// Coordinates one graceful background-service shutdown for normal quits and updater installs.

'use strict';

function createAppShutdownController({ app, advisorController, companionApiController } = {}) {
  let isQuitting = false;
  let shutdownPromise = null;

  function stopBackgroundServices() {
    if (!shutdownPromise) {
      shutdownPromise = Promise.allSettled([
        advisorController
          .stopLocalAdvisorServerForSavedSettings({ wait: true, forceAfterMs: 2500 })
          .catch(() => {
            return advisorController.stopLocalAdvisorProcess({ wait: true, forceAfterMs: 2500 });
          }),
        companionApiController.stop()
      ]);
    }
    return shutdownPromise;
  }

  function prepareToQuitAndInstallUpdate() {
    isQuitting = true;
    return stopBackgroundServices();
  }

  async function recoverAfterFailedUpdateInstall() {
    if (shutdownPromise) await shutdownPromise;
    isQuitting = false;
    shutdownPromise = null;
    if (typeof companionApiController.start === 'function') {
      await Promise.resolve(companionApiController.start()).catch(() => {});
    }
  }

  function handleBeforeQuit(event) {
    if (isQuitting) return false;

    event.preventDefault();
    isQuitting = true;
    stopBackgroundServices().finally(() => {
      app.quit();
    });
    return true;
  }

  return {
    handleBeforeQuit,
    isQuitting: () => isQuitting,
    prepareToQuitAndInstallUpdate,
    recoverAfterFailedUpdateInstall,
    stopBackgroundServices
  };
}

module.exports = {
  createAppShutdownController
};
