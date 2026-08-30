// Owns privileged Advisor settings, local llama.cpp lifecycle, provider requests, transcription, cancellation, and IPC registration.

'use strict';

const childProcess = require('child_process');
const { promisify } = require('util');
const nodeFs = require('fs/promises');
const nodeFsSync = require('fs');
const nodePath = require('path');
const advisorSettingsDomain = require('@cavalry/advisor/domain/advisor/settings.cjs');
const {
  CAVALRY_LOCAL_ADVISOR_ENDPOINT,
  CAVALRY_LOCAL_ADVISOR_MODEL,
  OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT,
  OPENAI_ADVISOR_RESPONSES_ENDPOINT,
  getAdvisorChatCompletionsEndpoint,
  getAdvisorEndpoint,
  getAdvisorResponsesEndpoint,
  getAdvisorTranscriptionEndpoint
} = require('./advisor-endpoints.cjs');
const advisorMicrophoneHelpers = require('./advisor-microphone.cjs');
const { assertCompanionMultimodalInput } = require('./advisor-multimodal-input.cjs');
const { createAdvisorRequestLifecycle } = require('./advisor-request-lifecycle.cjs');
const {
  buildChatRequestBody,
  createAdvisorStreamRunners,
  createRequestFailureRethrower,
  createRetryingPost,
  finalizeChatResult: finalizeAdvisorChatResult,
  openAiUnreachableError,
  parseJsonSafe: parseAdvisorResponseText,
  responseErrorMessage: getAdvisorResponseErrorMessage
} = require('./advisor-stream-transport.cjs');
const {
  ADVISOR_TRANSCRIPTION_MODEL,
  ADVISOR_TRANSCRIPTION_PROMPT,
  buildAdvisorTranscriptionFormData,
  createAdvisorTranscriptionRuntime
} = require('./advisor-transcription-runtime.cjs');
const {
  ADVISOR_IPC_CHANNELS,
  createAdvisorIpcController
} = require('./advisor-ipc-controller.cjs');
const { sealAdvisorApiKey } = require('./advisor-key-encryption.cjs');
const {
  assertGgufCompatibility,
  inspectGgufCompatibility: inspectGgufCompatibilityDefault
} = require('./advisor-gguf-compatibility.cjs');
const {
  createAdvisorAdoptedProcessLifecycle,
  createAdvisorLocalProcessLifecycle,
  createAdvisorStopOperationCoordinator,
  createLocalAdvisorStartCancelledError,
  getInactiveLocalAdvisorStatus,
  getManagedAdvisorProcessStatus
} = require('./advisor-local-process-lifecycle.cjs');
const {
  createAdvisorLlamaServerLaunchSupport,
  getAdvisorLlamaLaunchFailure,
  getAdvisorLlamaProcessOutcome,
  waitForAdvisorLlamaStartupPoll
} = require('./advisor-llama-server-launch.cjs');
const {
  ADVISOR_LOG_MAX_BYTES,
  createAdvisorLogLineCollector,
  createAdvisorProcessLog,
  createBoundedAdvisorLogWriter,
  prepareAdvisorLogFile,
  redactAdvisorLogText
} = require('./advisor-process-log.cjs');
const { createAdvisorSettingsStorage } = require('./advisor-settings-storage.cjs');
const { createAdvisorMemoryRuntime } = require('./advisor-memory-runtime.cjs');

const {
  getAdvisorMediaPermissionTypes,
  installAdvisorMediaPermissionHandlers,
  isAdvisorAudioOnlyMediaPermission,
  shouldGrantAdvisorMediaPermission
} = advisorMicrophoneHelpers;

const LOCAL_ADVISOR_STARTUP_TIMEOUT_MS = 300000;
const ADVISOR_REQUEST_TIMEOUT_MS = 300000;
const ADVISOR_RETRY_DELAYS_MS = [1000, 3000];

function createAdvisorRuntimeController(dependencies = {}) {
  const app = dependencies.app;
  const dialog = dependencies.dialog;
  const ipcMain = dependencies.ipcMain;
  const shell = dependencies.shell;
  const systemPreferences = dependencies.systemPreferences;
  const spawn = dependencies.spawn || childProcess.spawn;
  const execFileAsync = dependencies.execFileAsync || promisify(childProcess.execFile);
  const fs = dependencies.fs || nodeFs;
  const fsSync = dependencies.fsSync || nodeFsSync;
  const path = dependencies.path || nodePath;
  const safeStorage = dependencies.safeStorage || null;
  const assertTrustedSender = dependencies.assertTrustedSender;
  const fetch = dependencies.fetch || globalThis.fetch;
  const process = dependencies.process || global.process;
  const inspectGgufCompatibility =
    dependencies.inspectGgufCompatibility || inspectGgufCompatibilityDefault;

  const retryDelaysMs = Array.isArray(dependencies.advisorRetryDelaysMs)
    ? dependencies.advisorRetryDelaysMs
    : ADVISOR_RETRY_DELAYS_MS;
  const delay = dependencies.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const advisorRequestLifecycle = createAdvisorRequestLifecycle({ fetch });
  const {
    assertNotCancelled: assertAdvisorRequestNotCancelled,
    cancelRequest: cancelAdvisorRequest,
    createRequestState: createAdvisorRequestState,
    fetchStreamedWithTimeout,
    fetchWithTimeout,
    finishRequestState: finishAdvisorRequestState,
    getRequestSignal: getAdvisorRequestSignal,
    isCancellationError: isAdvisorCancellationError,
    isTimeoutError: isAdvisorTimeoutError,
    normalizeRequestId: normalizeAdvisorRequestId,
    sendStatus: sendAdvisorStatus
  } = advisorRequestLifecycle;
  const postAdvisorRequestWithRetry = createRetryingPost({ delay, retryDelaysMs });
  const { streamAgentTurn, streamChatCompletion } = createAdvisorStreamRunners({
    fetchStreamedWithTimeout,
    sendStatus: sendAdvisorStatus,
    timeoutMs: ADVISOR_REQUEST_TIMEOUT_MS
  });
  const { callAdvisorTranscription } = createAdvisorTranscriptionRuntime({
    getTranscriptionEndpoint: getAdvisorTranscriptionEndpoint,
    normalizeSettings: normalizeAdvisorSettings,
    requestLifecycle: advisorRequestLifecycle,
    requestTimeoutMs: ADVISOR_REQUEST_TIMEOUT_MS
  });

  let localAdvisorProcess = null;
  let localAdvisorProcessKey = '';
  let localAdvisorStartPromise = null;
  let localAdvisorStartOperation = null;
  let localAdvisorOperationSequence = 0;

  const localProcessLifecycle = createAdvisorLocalProcessLifecycle({ process });
  const {
    isChildRunning: isChildProcessRunning,
    isChildStopping: isLocalAdvisorChildStopping,
    isPidAlive,
    markChildExited: markLocalAdvisorChildExited,
    stopChild: stopLocalAdvisorChild,
    stopPid: stopLocalAdvisorPidProcess
  } = localProcessLifecycle;
  const localAdvisorStopOperations = createAdvisorStopOperationCoordinator();
  const adoptedProcessLifecycle = createAdvisorAdoptedProcessLifecycle({
    getBaseUrl: getLocalAdvisorBaseUrlFromKey,
    inspectProcess,
    isPidAlive,
    listListeningPidsOnPort
  });

  function getDefaultAdvisorSettings() {
    return advisorSettingsDomain.getDefaultAdvisorSettings();
  }

  function getAdvisorSettingsPath() {
    return path.join(app.getPath('userData'), 'cavalry-advisor-settings.json');
  }

  function normalizeCustomAdvisorEndpoint(endpoint) {
    return advisorSettingsDomain.normalizeCustomAdvisorEndpoint(endpoint);
  }

  function normalizeAdvisorSettings(raw, existing) {
    return advisorSettingsDomain.normalizeAdvisorSettings(raw, existing);
  }

  function normalizeAdvisorContextWindowTokens(value, fallback) {
    return advisorSettingsDomain.normalizeAdvisorContextWindowTokens(value, fallback);
  }

  function publicAdvisorSettings(settings) {
    return advisorSettingsDomain.publicAdvisorSettings(settings);
  }

  const llamaServerLaunchSupport = createAdvisorLlamaServerLaunchSupport({
    app,
    defaultModel: CAVALRY_LOCAL_ADVISOR_MODEL,
    execFileAsync,
    fs,
    getVisionArgs: advisorSettingsDomain.getAdvisorLlamaVisionArgs,
    normalizeContextWindowTokens: normalizeAdvisorContextWindowTokens,
    path,
    process
  });

  const advisorSettingsStorage = createAdvisorSettingsStorage({
    fs,
    path,
    safeStorage,
    getSettingsPath: getAdvisorSettingsPath,
    getDefaultSettings: getDefaultAdvisorSettings,
    normalizeSettings: normalizeAdvisorSettings,
    getPersistentSettings: getPersistentAdvisorSettings
  });
  const advisorMemoryRuntime = createAdvisorMemoryRuntime({ app, fs, path, shell });

  async function pathExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function assertAdvisorLocalModelCompatibility(settings) {
    if (!(settings && settings.provider === 'custom')) {
      return {
        status: 'compatible',
        compatible: true,
        reason: 'not-local-model',
        message: 'GGUF compatibility validation is not required for this provider.'
      };
    }
    return assertGgufCompatibility(
      {
        modelPath: settings && settings.localModelPath,
        mmprojPath: settings.mmprojPath
      },
      inspectGgufCompatibility
    );
  }

  function getLocalAdvisorServerInfo(settings) {
    let parsed = null;
    try {
      parsed = new URL(getAdvisorEndpoint(settings));
    } catch (_error) {
      parsed = new URL(CAVALRY_LOCAL_ADVISOR_ENDPOINT);
    }
    const parsedHostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const hostname = parsedHostname === 'localhost' ? '127.0.0.1' : parsedHostname;
    const port = parsed.port || '80';
    if (parsed.protocol !== 'http:') {
      throw new Error('Cavalry can only auto-start local llama.cpp servers over HTTP.');
    }
    if (!['127.0.0.1', '::1'].includes(hostname)) {
      throw new Error('Cavalry can only auto-start local llama.cpp servers bound to localhost.');
    }
    const urlHostname = hostname === '::1' ? '[::1]' : hostname;
    return {
      host: hostname,
      port,
      baseUrl: `${parsed.protocol}//${urlHostname}:${port}`,
      healthUrl: `${parsed.protocol}//${urlHostname}:${port}/health`
    };
  }

  async function isLocalAdvisorHealthy(serverInfo) {
    try {
      const response = await fetchWithTimeout(serverInfo.healthUrl, { method: 'GET' }, 2000);
      return response.ok;
    } catch (_error) {
      return false;
    }
  }

  function getLocalAdvisorServerKey(settings, serverInfo) {
    return [
      serverInfo.baseUrl,
      settings.localModelPath,
      settings.mmprojPath || '',
      settings.model || CAVALRY_LOCAL_ADVISOR_MODEL,
      String(normalizeAdvisorContextWindowTokens(settings.contextWindowTokens)),
      settings.apiKey ? 'keyed' : 'open'
    ].join('|');
  }

  function getLocalAdvisorBaseUrlFromKey(key) {
    return String(key || '').split('|')[0] || '';
  }

  function assertLocalAdvisorStartActive(operation) {
    if (!operation || operation.cancelled || localAdvisorStartOperation !== operation) {
      throw createLocalAdvisorStartCancelledError();
    }
  }

  async function getManagedLocalAdvisorStatusFromProcess() {
    let adopted = adoptedProcessLifecycle.snapshot();
    if (adopted.pid) {
      await adoptedProcessLifecycle.validate();
      adopted = adoptedProcessLifecycle.snapshot();
    }
    return getManagedAdvisorProcessStatus({
      startOperation: localAdvisorStartOperation,
      managedChild: localAdvisorProcess,
      managedProcessKey: localAdvisorProcessKey,
      adoptedPid: adopted.pid,
      adoptedProcessKey: adopted.processKey,
      getBaseUrl: getLocalAdvisorBaseUrlFromKey,
      isChildRunning: isChildProcessRunning,
      isPidAlive,
      isHealthy: isLocalAdvisorHealthy
    });
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function commandHasCliValue(command, flag, value) {
    const escapedFlag = escapeRegExp(flag);
    const escapedValue = escapeRegExp(value);
    return new RegExp('(^|\\s)' + escapedFlag + '(\\s+|=)' + escapedValue + '(\\s|$)').test(
      String(command || '')
    );
  }

  async function listListeningPidsOnPort(port) {
    try {
      const result = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
        timeout: 10000,
        maxBuffer: 1024 * 1024
      });
      const pids = String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^p\d+$/.test(line))
        .map((line) => Number(line.slice(1)))
        .filter((pid, index, all) => Number.isFinite(pid) && pid > 0 && all.indexOf(pid) === index);
      return pids;
    } catch (_error) {
      return [];
    }
  }

  async function inspectProcess(pid) {
    try {
      const result = await execFileAsync(
        'ps',
        ['-ww', '-p', String(pid), '-o', 'ppid=', '-o', 'command='],
        { timeout: 10000, maxBuffer: 1024 * 1024 }
      );
      const line = String(result.stdout || '')
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean);
      const match = line && line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(pid),
        ppid: Number(match[1]),
        command: match[2]
      };
    } catch (_error) {
      return null;
    }
  }

  function processMatchesLocalAdvisor(processInfo, settings, serverInfo) {
    const command = String((processInfo && processInfo.command) || '');
    if (!/(^|[\\/\s"'])llama-server(["'\s]|$)/i.test(command)) {
      return false;
    }
    if (!commandHasCliValue(command, '--host', serverInfo.host)) {
      return false;
    }
    if (!commandHasCliValue(command, '--port', serverInfo.port)) {
      return false;
    }
    if (!(settings.localModelPath && command.includes(settings.localModelPath))) {
      return false;
    }
    if (
      /(^|\s)--ctx-size(\s|=)/.test(command) &&
      !commandHasCliValue(
        command,
        '--ctx-size',
        String(normalizeAdvisorContextWindowTokens(settings.contextWindowTokens))
      )
    ) {
      return false;
    }
    return !settings.mmprojPath || command.includes(settings.mmprojPath);
  }

  async function findMatchingLocalAdvisorProcess(settings, serverInfo) {
    const pids = await listListeningPidsOnPort(serverInfo.port);
    for (const pid of pids) {
      const processInfo = await inspectProcess(pid);
      if (processMatchesLocalAdvisor(processInfo, settings, serverInfo)) {
        return processInfo;
      }
    }
    return null;
  }

  async function stopLocalAdvisorPid(pid, options) {
    const stopOptions = options || {};
    const validatesAdoptedIdentity = adoptedProcessLifecycle.hasPid(pid);
    const stopped = await stopLocalAdvisorPidProcess(pid, {
      ...stopOptions,
      ...(validatesAdoptedIdentity
        ? { validateIdentity: () => adoptedProcessLifecycle.validate() }
        : {})
    });
    if (stopped && stopOptions.wait && adoptedProcessLifecycle.hasPid(pid)) {
      adoptedProcessLifecycle.clear();
    }
    return stopped;
  }

  async function stopLocalAdvisorProcessOnce(options) {
    const stopOptions = options || {};
    const operation = localAdvisorStartOperation;
    if (operation && stopOptions.cancelStart !== false) {
      operation.cancelled = true;
      if (localAdvisorStartOperation === operation) {
        localAdvisorStartOperation = null;
      }
      if (localAdvisorStartPromise === operation.promise) {
        localAdvisorStartPromise = null;
      }
      if (operation.promise && typeof operation.promise.catch === 'function') {
        operation.promise.catch(() => {});
      }
    }
    const child = localAdvisorProcess || (operation && operation.child);
    const stopped = await stopLocalAdvisorChild(child, stopOptions);
    return { stopped: stopped || !!operation };
  }

  function stopLocalAdvisorProcess(options) {
    return localAdvisorStopOperations.run(() => stopLocalAdvisorProcessOnce(options));
  }

  async function getLocalAdvisorServerStatus(settings) {
    const normalized = normalizeAdvisorSettings(settings);
    const managedStatus = await getManagedLocalAdvisorStatusFromProcess();
    if (managedStatus) {
      if (localAdvisorStopOperations.isStopping()) {
        return {
          ...managedStatus,
          starting: false,
          stopping: true,
          message: 'Local model server is stopping.'
        };
      }
      return managedStatus;
    }
    if (normalized.provider !== 'custom') {
      return getInactiveLocalAdvisorStatus('Local llama.cpp is not selected.');
    }
    if (!normalized.localModelPath) {
      return getInactiveLocalAdvisorStatus(
        'Choose a local GGUF model file before starting the server.'
      );
    }
    let serverInfo = null;
    try {
      serverInfo = getLocalAdvisorServerInfo(normalized);
    } catch (error) {
      return Object.assign(
        getInactiveLocalAdvisorStatus(
          String(error && error.message ? error.message : 'Invalid local server endpoint.')
        ),
        {
          source: 'error'
        }
      );
    }
    const serverKey = getLocalAdvisorServerKey(normalized, serverInfo);
    if (localAdvisorStartPromise && localAdvisorProcessKey === serverKey) {
      return {
        running: false,
        healthy: false,
        starting: true,
        stopping: false,
        manageable: true,
        source: 'managed',
        pid: localAdvisorProcess && localAdvisorProcess.pid ? localAdvisorProcess.pid : 0,
        baseUrl: serverInfo.baseUrl,
        message: 'Local model server is starting.'
      };
    }
    if (isChildProcessRunning(localAdvisorProcess) && localAdvisorProcessKey === serverKey) {
      const healthy = await isLocalAdvisorHealthy(serverInfo);
      return {
        running: true,
        healthy,
        starting: !healthy,
        stopping: false,
        manageable: true,
        source: 'managed',
        pid: localAdvisorProcess.pid || 0,
        baseUrl: serverInfo.baseUrl,
        message: healthy
          ? `Local model server is running at ${serverInfo.baseUrl}.`
          : 'Local model server is running but not healthy yet.'
      };
    }
    const matchingProcess = await findMatchingLocalAdvisorProcess(normalized, serverInfo);
    if (matchingProcess) {
      adoptedProcessLifecycle.adopt(matchingProcess, serverKey);
      const healthy = await isLocalAdvisorHealthy(serverInfo);
      return {
        running: true,
        healthy,
        starting: !healthy,
        stopping: false,
        manageable: true,
        source: 'adopted',
        pid: matchingProcess.pid,
        baseUrl: serverInfo.baseUrl,
        message: healthy
          ? `Local model server is running at ${serverInfo.baseUrl}.`
          : 'A matching llama-server is listening but not healthy yet.'
      };
    }
    const healthy = await isLocalAdvisorHealthy(serverInfo);
    if (healthy) {
      return {
        running: true,
        healthy: true,
        starting: false,
        stopping: false,
        manageable: false,
        source: 'external',
        pid: 0,
        baseUrl: serverInfo.baseUrl,
        message: 'A local endpoint is responding, but it does not match this GGUF configuration.'
      };
    }
    return {
      running: false,
      healthy: false,
      starting: false,
      stopping: false,
      manageable: true,
      source: 'stopped',
      pid: 0,
      baseUrl: serverInfo.baseUrl,
      message: 'Local model server is stopped.'
    };
  }

  async function stopLocalAdvisorServerOnce(settings, event, options) {
    const normalized = normalizeAdvisorSettings(settings);
    const stopOptions = Object.assign({ wait: true, forceAfterMs: 2500 }, options || {});
    let serverInfo = null;
    let serverKey = '';
    let stopped = false;
    const trackedChild = localAdvisorProcess;
    await adoptedProcessLifecycle.validate();
    const trackedAdoptedPid = adoptedProcessLifecycle.snapshot().pid;
    const hadTrackedTarget =
      !!localAdvisorStartOperation ||
      isChildProcessRunning(trackedChild) ||
      (trackedAdoptedPid && isPidAlive(trackedAdoptedPid));
    try {
      if (normalized.provider === 'custom' && normalized.localModelPath) {
        serverInfo = getLocalAdvisorServerInfo(normalized);
        serverKey = getLocalAdvisorServerKey(normalized, serverInfo);
      }
    } catch (_error) {
      serverInfo = null;
    }

    if (hadTrackedTarget) {
      sendAdvisorStatus(event, {
        phase: 'stopping',
        message: 'Stopping local model server.',
        progressPercent: 0
      });
    }

    try {
      if (localAdvisorStartOperation || isChildProcessRunning(trackedChild)) {
        const processResult = await stopLocalAdvisorProcessOnce(stopOptions);
        stopped = !!(processResult && processResult.stopped);
      }
      if (trackedAdoptedPid && isPidAlive(trackedAdoptedPid)) {
        stopped = (await stopLocalAdvisorPid(trackedAdoptedPid, stopOptions)) || stopped;
      }
      if (!hadTrackedTarget && serverInfo && serverKey) {
        const matchingProcess = await findMatchingLocalAdvisorProcess(normalized, serverInfo);
        if (matchingProcess) {
          adoptedProcessLifecycle.adopt(matchingProcess, serverKey);
          stopped = (await stopLocalAdvisorPid(matchingProcess.pid, stopOptions)) || stopped;
        }
      }
    } catch (error) {
      sendAdvisorStatus(event, {
        phase: 'failed',
        message: String(
          (error && error.message) || 'Cavalry could not confirm that the local model stopped.'
        ),
        progressPercent: 0
      });
      throw error;
    }

    const status = await getLocalAdvisorServerStatus(normalized);
    if (status.running || status.healthy || status.starting || status.stopping) {
      const error = new Error(
        status.manageable === false
          ? 'The configured local endpoint is still responding, but Cavalry cannot safely stop its process.'
          : 'Cavalry could not confirm that the local model server stopped.'
      );
      error.code = 'ADVISOR_LOCAL_MODEL_STILL_RUNNING';
      error.userMessage = error.message;
      sendAdvisorStatus(event, {
        phase: 'failed',
        message: error.message,
        progressPercent: 0
      });
      throw error;
    }
    sendAdvisorStatus(event, {
      phase: 'stopped',
      message: stopped
        ? 'Local model server stopped.'
        : 'No matching local model server was running.',
      progressPercent: 0
    });
    return {
      ok: true,
      status,
      message: stopped
        ? 'Local model server stopped.'
        : 'No matching local model server was running.'
    };
  }

  function stopLocalAdvisorServer(settings, event, options) {
    return localAdvisorStopOperations.run(() =>
      stopLocalAdvisorServerOnce(settings, event, options)
    );
  }

  async function stopLocalAdvisorServerForSavedSettings(options) {
    const settings = await loadAdvisorSettings();
    return stopLocalAdvisorServer(settings, null, options || { wait: true, forceAfterMs: 2500 });
  }

  function clampAdvisorProgressPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  function advisorElapsedProgress(startedAt, timeoutMs, minPercent, maxPercent) {
    const elapsed = Math.max(0, Date.now() - startedAt);
    const span = Math.max(1, Number(maxPercent) - Number(minPercent));
    const ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, Number(timeoutMs) || 1)));
    return clampAdvisorProgressPercent(Number(minPercent) + span * ratio);
  }

  async function startLocalAdvisorServer(settings, serverInfo, serverKey, event, operation) {
    assertLocalAdvisorStartActive(operation);
    sendAdvisorStatus(event, {
      phase: 'resolve',
      message: 'Finding llama-server.',
      progressPercent: 5
    });
    const { binaryPath, args } = await llamaServerLaunchSupport.resolveLaunchCommand(
      settings,
      serverInfo
    );
    assertLocalAdvisorStartActive(operation);

    const logPath = path.join(app.getPath('userData'), 'cavalry-llama-server.log');
    const advisorProcessLog = await createAdvisorProcessLog({ fs, fsSync, path, logPath });
    try {
      assertLocalAdvisorStartActive(operation);
    } catch (error) {
      advisorProcessLog.close();
      throw error;
    }
    const workingDirectory = path.dirname(logPath);
    sendAdvisorStatus(event, {
      phase: 'launch',
      message: 'Starting llama-server for the selected GGUF.',
      detail: logPath,
      progressPercent: 10
    });

    let child = null;
    try {
      child = spawn(binaryPath, args, {
        cwd: workingDirectory,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      advisorProcessLog.close(error);
      throw getAdvisorLlamaLaunchFailure({ error }, advisorProcessLog, logPath);
    }
    operation.child = child;
    localAdvisorProcess = child;
    localAdvisorProcessKey = serverKey;
    adoptedProcessLifecycle.clear();

    let observedProcessOutcome = null;
    let resolveProcessOutcome = null;
    const processOutcomePromise = new Promise((resolve) => {
      resolveProcessOutcome = resolve;
    });
    advisorProcessLog.attach(child, (outcome, lifecycle = {}) => {
      observedProcessOutcome = outcome || {};
      if (lifecycle.exited === true) {
        markLocalAdvisorChildExited(child);
        if (localAdvisorProcess === child) {
          localAdvisorProcess = null;
          localAdvisorProcessKey = '';
        }
        if (operation.ready && !operation.cancelled && !isLocalAdvisorChildStopping(child)) {
          sendAdvisorStatus(event, {
            phase: 'failed',
            message: 'Local model server stopped unexpectedly.',
            detail: logPath,
            progressPercent: 0
          });
        }
      }
      resolveProcessOutcome(observedProcessOutcome);
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < LOCAL_ADVISOR_STARTUP_TIMEOUT_MS) {
      assertLocalAdvisorStartActive(operation);
      const healthy = await isLocalAdvisorHealthy(serverInfo);
      assertLocalAdvisorStartActive(operation);
      const processOutcome = getAdvisorLlamaProcessOutcome(child, observedProcessOutcome);
      if (processOutcome) {
        if (processOutcome.error && isChildProcessRunning(child)) {
          await stopLocalAdvisorChild(child, { wait: true, forceAfterMs: 2500 });
        }
        throw getAdvisorLlamaLaunchFailure(processOutcome, advisorProcessLog, logPath);
      }
      if (healthy) {
        operation.ready = true;
        sendAdvisorStatus(event, {
          phase: 'ready',
          message: `Local model server is ready at ${serverInfo.baseUrl}.`,
          detail: logPath,
          progressPercent: 65
        });
        return { ok: true, message: `Local model started at ${serverInfo.baseUrl}` };
      }
      sendAdvisorStatus(event, {
        phase: 'loading',
        message: `Loading local model... ${Math.round((Date.now() - startedAt) / 1000)}s`,
        detail: logPath,
        progressPercent: advisorElapsedProgress(startedAt, LOCAL_ADVISOR_STARTUP_TIMEOUT_MS, 10, 60)
      });
      await waitForAdvisorLlamaStartupPoll(processOutcomePromise, 1000);
    }

    await stopLocalAdvisorChild(child, { wait: true, forceAfterMs: 2500 });
    throw new Error(`Timed out waiting for llama-server to start. Review ${logPath}`);
  }

  async function runLocalAdvisorStartOperation(settings, serverInfo, serverKey, event, operation) {
    assertLocalAdvisorStartActive(operation);
    if (!(await pathExists(settings.localModelPath))) {
      throw new Error(`The selected local model file does not exist: ${settings.localModelPath}`);
    }
    assertLocalAdvisorStartActive(operation);
    if (settings.mmprojPath && !(await pathExists(settings.mmprojPath))) {
      throw new Error(
        `The selected multimodal projector file does not exist: ${settings.mmprojPath}`
      );
    }
    assertLocalAdvisorStartActive(operation);
    await assertAdvisorLocalModelCompatibility(settings);
    assertLocalAdvisorStartActive(operation);

    const trackedChild = localAdvisorProcess;
    if (isChildProcessRunning(trackedChild)) {
      const sameTrackedServer = localAdvisorProcessKey === serverKey;
      const trackedHealthy = sameTrackedServer ? await isLocalAdvisorHealthy(serverInfo) : false;
      assertLocalAdvisorStartActive(operation);
      if (sameTrackedServer && trackedHealthy) {
        sendAdvisorStatus(event, {
          phase: 'ready',
          message: `Local model server is already running at ${serverInfo.baseUrl}.`,
          progressPercent: 65
        });
        return {
          ok: true,
          message: `Local model server is already running at ${serverInfo.baseUrl}`
        };
      }
      await stopLocalAdvisorChild(trackedChild, {
        wait: true,
        forceAfterMs: 2500
      });
      assertLocalAdvisorStartActive(operation);
    }

    const matchingProcess = await findMatchingLocalAdvisorProcess(settings, serverInfo);
    assertLocalAdvisorStartActive(operation);
    const isHealthy = await isLocalAdvisorHealthy(serverInfo);
    assertLocalAdvisorStartActive(operation);
    if (matchingProcess && isHealthy) {
      adoptedProcessLifecycle.adopt(matchingProcess, serverKey);
      sendAdvisorStatus(event, {
        phase: 'ready',
        message: `Local model server is already running at ${serverInfo.baseUrl}.`,
        progressPercent: 65
      });
      return {
        ok: true,
        message: `Local model server is already running at ${serverInfo.baseUrl}`
      };
    }
    if (matchingProcess && !isHealthy) {
      adoptedProcessLifecycle.adopt(matchingProcess, serverKey);
      throw new Error(
        'A matching llama-server is already listening, but it is not healthy yet. Stop it or wait for it to finish loading, then try again.'
      );
    }
    if (isHealthy) {
      throw new Error(
        'A local endpoint is already responding on the configured port, but it does not match this GGUF model. Cavalry will not reuse or stop that process.'
      );
    }
    return startLocalAdvisorServer(settings, serverInfo, serverKey, event, operation);
  }

  function ensureLocalAdvisorServer(settings, event) {
    if (settings.provider !== 'custom') {
      return Promise.resolve({ ok: true, message: 'No local model server needed.' });
    }
    if (!settings.localModelPath) {
      return Promise.reject(
        new Error('Choose a local GGUF model file before starting the local advisor.')
      );
    }
    if (path.extname(settings.localModelPath).toLowerCase() !== '.gguf') {
      return Promise.reject(new Error('The local advisor requires a GGUF model file.'));
    }
    if (localAdvisorStopOperations.isStopping()) {
      return Promise.reject(
        new Error('The local model server is being stopped. Wait for it to stop before starting.')
      );
    }
    const serverInfo = getLocalAdvisorServerInfo(settings);
    const serverKey = getLocalAdvisorServerKey(settings, serverInfo);
    if (localAdvisorStartOperation) {
      if (
        !localAdvisorStartOperation.cancelled &&
        localAdvisorStartOperation.serverKey === serverKey
      ) {
        sendAdvisorStatus(event, {
          phase: 'loading',
          message: 'Local model is already starting.',
          progressPercent: 25
        });
        return localAdvisorStartOperation.promise;
      }
      return Promise.reject(
        new Error(
          localAdvisorStartOperation.cancelled
            ? 'The local model server is still stopping. Wait for it to stop before starting again.'
            : 'A different local model is already starting. Stop it before starting this model.'
        )
      );
    }

    const operation = {
      id: ++localAdvisorOperationSequence,
      serverKey,
      child: null,
      cancelled: false,
      ready: false,
      promise: null
    };
    localAdvisorStartOperation = operation;
    let trackedPromise = null;
    trackedPromise = Promise.resolve()
      .then(() => runLocalAdvisorStartOperation(settings, serverInfo, serverKey, event, operation))
      .catch((error) => {
        const cancelled =
          operation.cancelled ||
          !!(
            error &&
            (error.cavalryCancelled || error.code === 'ERR_CAVALRY_LOCAL_ADVISOR_START_CANCELLED')
          );
        sendAdvisorStatus(event, {
          phase: cancelled ? 'stopped' : 'failed',
          message: cancelled
            ? 'Local model startup stopped.'
            : String((error && error.message) || 'Local model server failed to start.'),
          progressPercent: 0
        });
        throw error;
      })
      .finally(() => {
        if (localAdvisorStartOperation === operation) {
          localAdvisorStartOperation = null;
        }
        if (localAdvisorStartPromise === trackedPromise) {
          localAdvisorStartPromise = null;
        }
      });
    operation.promise = trackedPromise;
    localAdvisorStartPromise = trackedPromise;
    return trackedPromise;
  }

  async function loadAdvisorSettings() {
    return advisorSettingsStorage.load();
  }

  async function loadAdvisorRuntimeSettings() {
    return loadAdvisorSettings();
  }

  function getPersistentAdvisorSettings(settings) {
    const normalized = normalizeAdvisorSettings(settings);
    const stored = {
      provider: normalized.provider,
      providerKind: normalized.providerKind,
      apiMode: normalized.apiMode,
      endpoint: normalized.endpoint,
      model: normalized.model,
      localModelPath: normalized.localModelPath,
      mmprojPath: normalized.mmprojPath,
      contextWindowTokens: normalized.contextWindowTokens
    };
    if (normalized.apiKey) {
      sealAdvisorApiKey(safeStorage, stored, normalized.apiKey);
    }
    return stored;
  }

  async function assertAdvisorContextChangeAllowed(nextSettings, existingSettings) {
    const previous = normalizeAdvisorSettings(existingSettings);
    const next = normalizeAdvisorSettings(nextSettings, previous);
    if (previous.contextWindowTokens === next.contextWindowTokens) {
      return;
    }
    if (previous.provider !== 'custom' || !previous.localModelPath) {
      return;
    }
    const status = await getLocalAdvisorServerStatus(previous);
    if (status && (status.running || status.starting || status.stopping)) {
      throw new Error('Stop the local model before changing context allocation.');
    }
  }

  async function saveAdvisorSettings(payload, options = {}) {
    const existing = await loadAdvisorRuntimeSettings();
    const settings = normalizeAdvisorSettings(payload, existing);
    await assertAdvisorLocalModelCompatibility(settings);
    if (!options.allowActiveLocalConfiguration) {
      await assertAdvisorContextChangeAllowed(settings, existing);
    }
    await advisorSettingsStorage.persist(getPersistentAdvisorSettings(settings));
    return settings;
  }

  function getAdvisorMicrophoneAccessStatus(mediaPreferences, platformName) {
    return advisorMicrophoneHelpers.getAdvisorMicrophoneAccessStatus(
      mediaPreferences || systemPreferences,
      platformName || process.platform
    );
  }

  async function requestAdvisorMicrophoneAccess(mediaPreferences, platformName) {
    return advisorMicrophoneHelpers.requestAdvisorMicrophoneAccess(
      mediaPreferences || systemPreferences,
      platformName || process.platform
    );
  }

  async function openAdvisorMicrophoneSettings(shellModule, platformName) {
    return advisorMicrophoneHelpers.openAdvisorMicrophoneSettings(
      shellModule || shell,
      platformName || process.platform
    );
  }

  async function callAdvisorModel(settings, payload, event) {
    const requestState = createAdvisorRequestState(payload && payload.requestId, event);
    try {
      const endpoint = getAdvisorChatCompletionsEndpoint(settings);
      if (!endpoint) {
        throw new Error('No advisor endpoint is configured.');
      }
      const model =
        settings.model || (settings.provider === 'custom' ? CAVALRY_LOCAL_ADVISOR_MODEL : '');
      if (!model) {
        throw new Error('Choose a model before testing the advisor connection.');
      }
      if (settings.provider === 'openai' && !settings.apiKey) {
        throw new Error('Add an API key before using the OpenAI provider.');
      }
      if (typeof fetch !== 'function') {
        throw new Error('This runtime does not expose fetch in the main process.');
      }
      if (settings.provider === 'custom') {
        await ensureLocalAdvisorServer(settings, event);
      }
      assertAdvisorRequestNotCancelled(requestState);
      sendAdvisorStatus(event, {
        phase: 'request',
        requestId: requestState ? requestState.requestId : '',
        message:
          settings.provider === 'custom'
            ? 'Local model is generating a response.'
            : 'Cavalry is thinking…',
        progressPercent: settings.provider === 'custom' ? 70 : 35
      });
      const headers = {
        'Content-Type': 'application/json'
      };
      if (settings.provider === 'openai' && settings.apiKey) {
        headers.Authorization = `Bearer ${settings.apiKey}`;
      }
      assertCompanionMultimodalInput(payload.messages || []);
      const wantsStream = payload.stream === true;
      const body = buildChatRequestBody({ endpoint, model, payload, settings, wantsStream });
      const requestInit = (requestBody) => ({
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });
      const postAdvisorRequest = (requestBody) =>
        postAdvisorRequestWithRetry(() =>
          fetchWithTimeout(
            endpoint,
            requestInit(requestBody),
            ADVISOR_REQUEST_TIMEOUT_MS,
            getAdvisorRequestSignal(requestState)
          )
        );
      const rethrowRequestFailure = createRequestFailureRethrower(requestState);

      if (wantsStream) {
        const streamed = await streamChatCompletion({
          body,
          endpoint,
          event,
          requestInit,
          requestSignal: getAdvisorRequestSignal(requestState),
          requestState,
          rethrowRequestFailure,
          segment: payload.streamSegment
        });
        if (streamed.handled) {
          sendAdvisorStatus(event, {
            phase: 'response',
            requestId: requestState ? requestState.requestId : '',
            message: 'Cavalry finished.',
            progressPercent: 100
          });
          return finalizeAdvisorChatResult(streamed.message, streamed.usage, payload);
        }
        // The endpoint ignored or rejected streaming; fall through to the buffered request.
        delete body.stream;
        delete body.stream_options;
      }

      let response = null;
      let generationStatusTimer = null;
      try {
        if (settings.provider === 'custom') {
          const startedAt = Date.now();
          generationStatusTimer = setInterval(() => {
            sendAdvisorStatus(event, {
              phase: 'request',
              requestId: requestState ? requestState.requestId : '',
              message: 'Local model is generating a response.',
              progressPercent: advisorElapsedProgress(startedAt, ADVISOR_REQUEST_TIMEOUT_MS, 70, 94)
            });
          }, 5000);
        }
        response = await postAdvisorRequest(body);
      } catch (error) {
        rethrowRequestFailure(error);
      } finally {
        if (generationStatusTimer) {
          clearInterval(generationStatusTimer);
        }
      }
      sendAdvisorStatus(event, {
        phase: 'response',
        requestId: requestState ? requestState.requestId : '',
        message: 'Cavalry finished.',
        progressPercent: 100
      });
      let text = await response.text();
      let parsed = parseAdvisorResponseText(text);
      if (!response.ok) {
        const message = getAdvisorResponseErrorMessage(text, parsed, response.status);
        if (
          settings.provider === 'custom' &&
          body.response_format &&
          /response_format|json_schema|schema|grammar|unsupported|not supported|invalid format|failed to parse input|parse input at pos/i.test(
            message
          )
        ) {
          const retryBody = Object.assign({}, body);
          delete retryBody.response_format;
          sendAdvisorStatus(event, {
            phase: 'request',
            requestId: requestState ? requestState.requestId : '',
            message: 'Adjusting the local model request…',
            progressPercent: 72
          });
          response = await postAdvisorRequest(retryBody);
          sendAdvisorStatus(event, {
            phase: 'response',
            requestId: requestState ? requestState.requestId : '',
            message: 'Cavalry finished.',
            progressPercent: 100
          });
          text = await response.text();
          parsed = parseAdvisorResponseText(text);
        }
      }
      if (!response.ok) {
        const message = getAdvisorResponseErrorMessage(text, parsed, response.status);
        throw new Error(message);
      }
      const responseMessage =
        parsed &&
        parsed.choices &&
        parsed.choices[0] &&
        parsed.choices[0].message &&
        typeof parsed.choices[0].message === 'object'
          ? parsed.choices[0].message
          : parsed && parsed.message && typeof parsed.message === 'object'
            ? parsed.message
            : null;
      const responseContent =
        responseMessage && Object.prototype.hasOwnProperty.call(responseMessage, 'content')
          ? responseMessage.content
          : parsed && Object.prototype.hasOwnProperty.call(parsed, 'response')
            ? parsed.response
            : '';
      return finalizeAdvisorChatResult(
        {
          role: String((responseMessage && responseMessage.role) || 'assistant'),
          content: responseContent,
          tool_calls:
            responseMessage && Array.isArray(responseMessage.tool_calls)
              ? responseMessage.tool_calls
              : []
        },
        (parsed && parsed.usage) || null,
        payload
      );
    } finally {
      finishAdvisorRequestState(requestState);
    }
  }

  async function callAdvisorAgentTurn(settings, payload, event, dependencies) {
    const requestState = createAdvisorRequestState(payload && payload.requestId, event);
    const transport =
      dependencies && dependencies.fetchWithTimeout
        ? dependencies.fetchWithTimeout
        : fetchWithTimeout;
    try {
      if (!settings || settings.provider !== 'openai') {
        throw new Error('Responses mode requires an OpenAI/API connection.');
      }
      const endpoint = getAdvisorResponsesEndpoint(settings);
      if (!endpoint) {
        throw new Error('No advisor endpoint is configured.');
      }
      const model = settings.model || '';
      if (!model) {
        throw new Error('Choose a model before using OpenAI agent mode.');
      }
      if (!settings.apiKey) {
        throw new Error('Add an API key before using the OpenAI provider.');
      }
      assertAdvisorRequestNotCancelled(requestState);
      sendAdvisorStatus(event, {
        phase: 'request',
        requestId: requestState ? requestState.requestId : '',
        message: 'Cavalry is thinking…',
        progressPercent: 35
      });
      const input =
        payload && typeof payload.input !== 'undefined'
          ? payload.input
          : payload && payload.messages
            ? payload.messages
            : [];
      assertCompanionMultimodalInput(input);
      const body = {
        model,
        input,
        tools: Array.isArray(payload && payload.tools) ? payload.tools : []
      };
      [
        'instructions',
        'previous_response_id',
        'tool_choice',
        'parallel_tool_calls',
        'reasoning',
        'text',
        'metadata',
        'temperature',
        'top_p',
        'max_output_tokens'
      ].forEach((key) => {
        if (payload && typeof payload[key] !== 'undefined') {
          body[key] = payload[key];
        }
      });
      const agentRequestInit = () => ({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(body)
      });
      const unreachable = openAiUnreachableError;

      if (payload && payload.stream === true && !(dependencies && dependencies.fetchWithTimeout)) {
        body.stream = true;
        const streamedTurn = await streamAgentTurn({
          endpoint,
          event,
          requestInit: agentRequestInit,
          requestSignal: getAdvisorRequestSignal(requestState),
          requestState,
          unreachable,
          segment: payload.streamSegment
        });
        if (streamedTurn.handled) {
          sendAdvisorStatus(event, {
            phase: 'response',
            requestId: requestState ? requestState.requestId : '',
            message: 'Cavalry finished.',
            progressPercent: 100
          });
          return streamedTurn.response;
        }
        delete body.stream;
      }

      let response;
      try {
        response = await transport(
          endpoint,
          agentRequestInit(),
          ADVISOR_REQUEST_TIMEOUT_MS,
          getAdvisorRequestSignal(requestState)
        );
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw unreachable(error);
      }
      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_error) {
        parsed = null;
      }
      if (!response.ok) {
        const message = getAdvisorResponseErrorMessage(text, parsed, response.status);
        throw new Error(message);
      }
      sendAdvisorStatus(event, {
        phase: 'response',
        requestId: requestState ? requestState.requestId : '',
        message: 'Cavalry finished.',
        progressPercent: 100
      });
      return parsed || {};
    } finally {
      finishAdvisorRequestState(requestState);
    }
  }

  async function findAdjacentMmprojPath(modelPath) {
    try {
      const dir = path.dirname(modelPath);
      const entries = await fs.readdir(dir);
      const candidates = entries
        .filter(
          (entry) =>
            /^mmproj.*\.gguf$/i.test(entry) || /(^|[-_.])mmproj([-_.]|$).*\.gguf$/i.test(entry)
        )
        .sort((left, right) => left.localeCompare(right));
      const outcomes = await Promise.all(
        candidates.map(async (entry) => {
          const mmprojPath = path.join(dir, entry);
          const compatibility = await inspectGgufCompatibility({ modelPath, mmprojPath });
          return compatibility.status === 'compatible' && compatibility.reason === 'metadata-match'
            ? mmprojPath
            : '';
        })
      );
      const compatibleCandidates = outcomes.filter(Boolean);
      if (compatibleCandidates.length === 1) return compatibleCandidates[0];
    } catch (_error) {
      // Projector selection is optional.
    }
    return '';
  }

  const advisorIpcController = createAdvisorIpcController({
    ipcMain,
    dialog,
    path,
    assertTrustedSender,
    runtime: {
      normalizeAdvisorSettings,
      publicAdvisorSettings,
      loadAdvisorRuntimeSettings,
      saveAdvisorSettings,
      getLocalAdvisorServerStatus,
      ensureLocalAdvisorServer,
      stopLocalAdvisorServer,
      findAdjacentMmprojPath,
      assertAdvisorLocalModelCompatibility,
      callAdvisorModel,
      callAdvisorAgentTurn,
      callAdvisorTranscription,
      ...advisorMemoryRuntime,
      cancelAdvisorRequest,
      normalizeAdvisorRequestId,
      isAdvisorCancellationError,
      isAdvisorTimeoutError,
      getAdvisorMicrophoneAccessStatus,
      requestAdvisorMicrophoneAccess,
      openAdvisorMicrophoneSettings
    }
  });

  return {
    ADVISOR_TRANSCRIPTION_MODEL,
    ADVISOR_TRANSCRIPTION_PROMPT,
    registerHandlers: advisorIpcController.registerHandlers,
    stopLocalAdvisorServerForSavedSettings,
    stopLocalAdvisorProcess,
    buildAdvisorTranscriptionFormData,
    callAdvisorModel,
    callAdvisorAgentTurn,
    callAdvisorTranscription,
    ...advisorMemoryRuntime,
    cancelAdvisorRequest,
    ensureLocalAdvisorServer,
    findAdjacentMmprojPath,
    assertAdvisorLocalModelCompatibility,
    getAdvisorMicrophoneAccessStatus,
    getAdvisorMediaPermissionTypes,
    getAdvisorTranscriptionEndpoint,
    getLocalAdvisorServerStatus,
    installAdvisorMediaPermissionHandlers,
    isAdvisorAudioOnlyMediaPermission,
    isAdvisorCancellationError,
    isAdvisorTimeoutError,
    loadAdvisorRuntimeSettings,
    openAdvisorMicrophoneSettings,
    normalizeAdvisorRequestId,
    requestAdvisorMicrophoneAccess,
    saveAdvisorSettings,
    shouldGrantAdvisorMediaPermission
  };
}

module.exports = {
  ADVISOR_IPC_CHANNELS,
  ADVISOR_LOG_MAX_BYTES,
  ADVISOR_TRANSCRIPTION_MODEL,
  ADVISOR_TRANSCRIPTION_PROMPT,
  createAdvisorLogLineCollector,
  createBoundedAdvisorLogWriter,
  prepareAdvisorLogFile,
  redactAdvisorLogText,
  createAdvisorRuntimeController
};
