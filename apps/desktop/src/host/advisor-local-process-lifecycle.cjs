'use strict';

function createLocalAdvisorStartCancelledError() {
  const error = new Error('Local model startup was stopped.');
  error.name = 'AbortError';
  error.code = 'ERR_CAVALRY_LOCAL_ADVISOR_START_CANCELLED';
  error.cavalryCancelled = true;
  return error;
}

function getInactiveLocalAdvisorStatus(message) {
  return {
    running: false,
    healthy: false,
    starting: false,
    stopping: false,
    manageable: false,
    source: 'inactive',
    pid: 0,
    baseUrl: '',
    message
  };
}

function createAdvisorLocalProcessLifecycle({
  process,
  setTimeout: scheduleTimeout = setTimeout,
  clearTimeout: cancelTimeout = clearTimeout
} = {}) {
  const exitedChildren = new WeakSet();
  const stoppingChildren = new WeakSet();
  let forceKillTimer = null;

  function normalizeStopTimeout(timeoutMs) {
    return Math.max(25, Number(timeoutMs) || 2500);
  }

  function isPidAlive(pid) {
    const numericPid = Number(pid);
    if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
    try {
      process.kill(numericPid, 0);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function isChildRunning(child) {
    return !!(
      child &&
      !exitedChildren.has(child) &&
      child.exitCode === null &&
      child.signalCode === null
    );
  }

  function markChildExited(child) {
    if (child) exitedChildren.add(child);
    if (forceKillTimer) {
      cancelTimeout(forceKillTimer);
      forceKillTimer = null;
    }
  }

  function isChildStopping(child) {
    return !!(child && stoppingChildren.has(child));
  }

  async function waitForPidExit(pid, timeoutMs) {
    const deadline = Date.now() + normalizeStopTimeout(timeoutMs);
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) return true;
      await new Promise((resolve) => scheduleTimeout(resolve, 100));
    }
    return !isPidAlive(pid);
  }

  async function stopPid(pid, options = {}) {
    if (!isPidAlive(pid)) return false;
    const matchesExpectedProcess = async () =>
      typeof options.validateIdentity !== 'function' || Boolean(await options.validateIdentity());
    if (!(await matchesExpectedProcess())) return false;
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (!isPidAlive(pid)) return true;
      throw new Error(
        `Could not signal local model server process ${pid} to stop: ${
          error && error.message ? error.message : String(error)
        }`
      );
    }
    if (!options.wait) {
      const timer = scheduleTimeout(async () => {
        try {
          if (isPidAlive(pid) && (await matchesExpectedProcess())) {
            process.kill(pid, 'SIGKILL');
          }
        } catch (_error) {
          // The process may already be gone.
        }
      }, normalizeStopTimeout(options.forceAfterMs));
      if (typeof timer.unref === 'function') timer.unref();
      return true;
    }

    let exited = await waitForPidExit(pid, options.forceAfterMs);
    if (!exited) {
      if (!(await matchesExpectedProcess())) return true;
      try {
        process.kill(pid, 'SIGKILL');
      } catch (_error) {
        // The process may already be gone.
      }
      exited = await waitForPidExit(pid, options.forceAfterMs);
    }
    if (!exited) {
      throw new Error(`Could not confirm that local model server process ${pid} stopped.`);
    }
    return true;
  }

  function waitForChildExit(child, timeoutMs) {
    return new Promise((resolve) => {
      if (!isChildRunning(child)) {
        resolve(true);
        return;
      }
      let settled = false;
      let timer = null;
      const finish = (exited) => {
        if (settled) return;
        settled = true;
        if (timer) cancelTimeout(timer);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        resolve(exited);
      };
      const onExit = () => finish(true);
      const onError = () =>
        finish(!isChildRunning(child) || (child.pid ? !isPidAlive(child.pid) : true));
      child.once('exit', onExit);
      child.once('error', onError);
      timer = scheduleTimeout(
        () => finish(!isChildRunning(child) || (child.pid ? !isPidAlive(child.pid) : true)),
        normalizeStopTimeout(timeoutMs)
      );
    });
  }

  function signalChild(child, signal) {
    if (!child) return false;
    try {
      if (typeof child.kill === 'function' && child.kill(signal)) return true;
    } catch (_error) {
      // Fall through to the PID signal when the ChildProcess wrapper cannot signal it.
    }
    try {
      if (child.pid) {
        process.kill(child.pid, signal);
        return true;
      }
    } catch (_error) {
      // The process may already be gone.
    }
    return false;
  }

  async function stopChild(child, options = {}) {
    if (!isChildRunning(child)) return false;
    stoppingChildren.add(child);
    signalChild(child, 'SIGTERM');
    if (!options.wait) {
      if (forceKillTimer) cancelTimeout(forceKillTimer);
      forceKillTimer = scheduleTimeout(() => {
        forceKillTimer = null;
        if (isChildRunning(child)) signalChild(child, 'SIGKILL');
      }, normalizeStopTimeout(options.forceAfterMs));
      if (typeof forceKillTimer.unref === 'function') forceKillTimer.unref();
      return true;
    }

    let exited = await waitForChildExit(child, options.forceAfterMs);
    if (!exited) {
      signalChild(child, 'SIGKILL');
      exited = await waitForChildExit(child, options.forceAfterMs);
    }
    if (!exited) {
      throw new Error(
        `Could not confirm that local model server process ${child.pid || 'unknown'} stopped.`
      );
    }
    return true;
  }

  return Object.freeze({
    isChildRunning,
    isChildStopping,
    isPidAlive,
    markChildExited,
    stopChild,
    stopPid
  });
}

function createAdvisorAdoptedProcessLifecycle({
  getBaseUrl,
  inspectProcess,
  isPidAlive,
  listListeningPidsOnPort
} = {}) {
  let adopted = null;

  function clear() {
    adopted = null;
  }

  function adopt(processInfo, processKey) {
    if (!(processInfo && processInfo.pid && processKey)) return;
    adopted = {
      pid: processInfo.pid,
      ppid: processInfo.ppid,
      command: processInfo.command,
      processKey
    };
  }

  function snapshot() {
    return adopted
      ? {
          pid: adopted.pid,
          processKey: adopted.processKey
        }
      : { pid: 0, processKey: '' };
  }

  function hasPid(pid) {
    return !!(adopted && adopted.pid === pid);
  }

  async function validate() {
    const identity = adopted;
    if (!identity || !isPidAlive(identity.pid)) {
      clear();
      return null;
    }
    const current = await inspectProcess(identity.pid);
    if (
      !current ||
      current.pid !== identity.pid ||
      current.ppid !== identity.ppid ||
      current.command !== identity.command
    ) {
      clear();
      return null;
    }
    let port = '';
    try {
      port = new URL(getBaseUrl(identity.processKey)).port || '80';
    } catch (_error) {
      clear();
      return null;
    }
    if (!(await listListeningPidsOnPort(port)).includes(identity.pid)) {
      clear();
      return null;
    }
    return current;
  }

  return Object.freeze({ adopt, clear, hasPid, snapshot, validate });
}

function createAdvisorStopOperationCoordinator() {
  let activeOperationCount = 0;
  return Object.freeze({
    isStopping() {
      return activeOperationCount > 0;
    },
    async run(operation) {
      activeOperationCount += 1;
      try {
        return await operation();
      } finally {
        activeOperationCount = Math.max(0, activeOperationCount - 1);
      }
    }
  });
}

async function getManagedAdvisorProcessStatus({
  startOperation,
  managedChild,
  managedProcessKey,
  adoptedPid,
  adoptedProcessKey,
  getBaseUrl,
  isChildRunning,
  isPidAlive,
  isHealthy
}) {
  const statusFor = async ({ child, pid, processKey, source }) => {
    const baseUrl = getBaseUrl(processKey);
    const healthUrl = baseUrl ? baseUrl.replace(/\/+$/g, '') + '/health' : '';
    const healthy =
      (child ? isChildRunning(child) : isPidAlive(pid)) && healthUrl
        ? await isHealthy({ baseUrl, healthUrl })
        : false;
    return {
      running: child || pid ? true : healthy,
      healthy,
      starting: !healthy,
      stopping: false,
      manageable: true,
      source,
      pid: Number((child && child.pid) || pid) || 0,
      baseUrl,
      message:
        healthy && baseUrl
          ? `Local model server is running at ${baseUrl}.`
          : 'Local model server is running.'
    };
  };

  if (startOperation) {
    const baseUrl = getBaseUrl(startOperation.serverKey);
    if (startOperation.cancelled) {
      return {
        running: isChildRunning(startOperation.child),
        healthy: false,
        starting: false,
        stopping: true,
        manageable: true,
        source: 'managed',
        pid: Number(startOperation.child && startOperation.child.pid) || 0,
        baseUrl,
        message: 'Local model server is stopping.'
      };
    }
    const status = await statusFor({
      child: startOperation.child,
      pid: 0,
      processKey: startOperation.serverKey,
      source: 'managed'
    });
    status.running = status.healthy;
    status.message = status.healthy
      ? `Local model server is running at ${baseUrl}.`
      : 'Local model server is starting.';
    return status;
  }
  if (isChildRunning(managedChild)) {
    return statusFor({
      child: managedChild,
      pid: 0,
      processKey: managedProcessKey,
      source: 'managed'
    });
  }
  if (adoptedPid && isPidAlive(adoptedPid)) {
    return statusFor({
      child: null,
      pid: adoptedPid,
      processKey: adoptedProcessKey,
      source: 'adopted'
    });
  }
  return null;
}

module.exports = {
  createAdvisorAdoptedProcessLifecycle,
  createAdvisorLocalProcessLifecycle,
  createAdvisorStopOperationCoordinator,
  createLocalAdvisorStartCancelledError,
  getInactiveLocalAdvisorStatus,
  getManagedAdvisorProcessStatus
};
