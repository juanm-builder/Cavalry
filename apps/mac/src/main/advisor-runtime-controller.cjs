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
  ADVISOR_LOG_MAX_BYTES,
  createAdvisorLogLineCollector,
  createAdvisorProcessLog,
  createBoundedAdvisorLogWriter,
  prepareAdvisorLogFile,
  redactAdvisorLogText
} = require('./advisor-process-log.cjs');
const { createAdvisorSettingsStorage } = require('./advisor-settings-storage.cjs');

const {
  getAdvisorMediaPermissionTypes,
  installAdvisorMediaPermissionHandlers,
  isAdvisorAudioOnlyMediaPermission,
  shouldGrantAdvisorMediaPermission
} = advisorMicrophoneHelpers;

const LOCAL_ADVISOR_STARTUP_TIMEOUT_MS = 300000;
const ADVISOR_REQUEST_TIMEOUT_MS = 300000;

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

  const advisorRequestLifecycle = createAdvisorRequestLifecycle({ fetch });
  const {
    assertNotCancelled: assertAdvisorRequestNotCancelled,
    cancelRequest: cancelAdvisorRequest,
    createRequestState: createAdvisorRequestState,
    fetchWithTimeout,
    finishRequestState: finishAdvisorRequestState,
    getRequestSignal: getAdvisorRequestSignal,
    isCancellationError: isAdvisorCancellationError,
    isTimeoutError: isAdvisorTimeoutError,
    normalizeRequestId: normalizeAdvisorRequestId,
    sendStatus: sendAdvisorStatus
  } = advisorRequestLifecycle;
  const { callAdvisorTranscription } = createAdvisorTranscriptionRuntime({
    getTranscriptionEndpoint: getAdvisorTranscriptionEndpoint,
    normalizeSettings: normalizeAdvisorSettings,
    requestLifecycle: advisorRequestLifecycle,
    requestTimeoutMs: ADVISOR_REQUEST_TIMEOUT_MS
  });

  let localAdvisorProcess = null;
  let localAdvisorProcessKey = '';
  let localAdvisorStartPromise = null;
  let localAdvisorForceKillTimer = null;
  let localAdvisorAdoptedPid = 0;
  let localAdvisorAdoptedProcessKey = '';
  const llamaServerHelpCache = {};

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

  const advisorSettingsStorage = createAdvisorSettingsStorage({
    fs,
    path,
    safeStorage,
    getSettingsPath: getAdvisorSettingsPath,
    getDefaultSettings: getDefaultAdvisorSettings,
    normalizeSettings: normalizeAdvisorSettings,
    getPersistentSettings: getPersistentAdvisorSettings
  });

  async function pathExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function findCommandOnPath(commandName) {
    try {
      const result = await execFileAsync('which', [commandName], { timeout: 10000 });
      const firstLine = String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      return firstLine || '';
    } catch (_error) {
      return '';
    }
  }

  async function resolveLlamaServerBinary() {
    const candidates = [];
    if (process.env.LLAMA_SERVER_BIN) {
      candidates.push(process.env.LLAMA_SERVER_BIN);
    }
    const fromPath = await findCommandOnPath('llama-server');
    if (fromPath) {
      candidates.push(fromPath);
    }
    candidates.push('/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server');
    for (const candidate of candidates) {
      if (candidate && (await pathExists(candidate))) {
        return candidate;
      }
    }
    throw new Error(
      'Could not find llama-server. Install llama.cpp, or set LLAMA_SERVER_BIN to the llama-server executable.'
    );
  }

  async function getLlamaServerHelp(binaryPath) {
    if (llamaServerHelpCache[binaryPath]) {
      return llamaServerHelpCache[binaryPath];
    }
    try {
      const result = await execFileAsync(binaryPath, ['--help'], {
        timeout: 15000,
        maxBuffer: 1024 * 1024
      });
      llamaServerHelpCache[binaryPath] =
        String(result.stdout || '') + '\n' + String(result.stderr || '');
    } catch (error) {
      llamaServerHelpCache[binaryPath] =
        String((error && error.stdout) || '') +
        '\n' +
        String((error && error.stderr) || '') +
        '\n' +
        String((error && error.message) || '');
    }
    return llamaServerHelpCache[binaryPath];
  }

  function llamaServerSupportsFlag(helpText, flag) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|\\s)' + escaped + '([,\\s]|$)').test(String(helpText || ''));
  }

  function getLocalAdvisorServerInfo(settings) {
    let parsed = null;
    try {
      parsed = new URL(getAdvisorEndpoint(settings));
    } catch (_error) {
      parsed = new URL(CAVALRY_LOCAL_ADVISOR_ENDPOINT);
    }
    const hostname = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (!['127.0.0.1', '::1'].includes(hostname)) {
      throw new Error('Cavalry can only auto-start local llama.cpp servers bound to localhost.');
    }
    return {
      host: hostname,
      port,
      baseUrl: `${parsed.protocol}//${hostname}:${port}`,
      healthUrl: `${parsed.protocol}//${hostname}:${port}/health`
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

  async function getManagedLocalAdvisorStatusFromProcess() {
    if (isChildProcessRunning(localAdvisorProcess)) {
      const baseUrl = getLocalAdvisorBaseUrlFromKey(localAdvisorProcessKey);
      const healthUrl = baseUrl ? baseUrl.replace(/\/+$/g, '') + '/health' : '';
      const healthy = healthUrl ? await isLocalAdvisorHealthy({ baseUrl, healthUrl }) : false;
      return {
        running: true,
        healthy,
        starting: !healthy,
        manageable: true,
        source: 'managed',
        pid: localAdvisorProcess.pid || 0,
        baseUrl,
        message:
          healthy && baseUrl
            ? `Local model server is running at ${baseUrl}.`
            : 'Local model server is running.'
      };
    }
    if (localAdvisorAdoptedPid && isPidAlive(localAdvisorAdoptedPid)) {
      const baseUrl = getLocalAdvisorBaseUrlFromKey(localAdvisorAdoptedProcessKey);
      const healthUrl = baseUrl ? baseUrl.replace(/\/+$/g, '') + '/health' : '';
      const healthy = healthUrl ? await isLocalAdvisorHealthy({ baseUrl, healthUrl }) : false;
      return {
        running: true,
        healthy,
        starting: !healthy,
        manageable: true,
        source: 'adopted',
        pid: localAdvisorAdoptedPid,
        baseUrl,
        message:
          healthy && baseUrl
            ? `Local model server is running at ${baseUrl}.`
            : 'Local model server is running.'
      };
    }
    return null;
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

  function isPidAlive(pid) {
    const numericPid = Number(pid);
    if (!Number.isFinite(numericPid) || numericPid <= 0) {
      return false;
    }
    try {
      process.kill(numericPid, 0);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function isChildProcessRunning(child) {
    return !!(child && child.exitCode === null && !child.killed);
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
    if (!/(^|[\/\s])llama-server(\s|$)/.test(command)) {
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

  function adoptLocalAdvisorProcess(processInfo, serverKey) {
    if (!(processInfo && processInfo.pid)) {
      return;
    }
    if (localAdvisorProcess && localAdvisorProcess.pid === processInfo.pid) {
      return;
    }
    localAdvisorAdoptedPid = processInfo.pid;
    localAdvisorAdoptedProcessKey = serverKey;
  }

  async function waitForPidExit(pid, timeoutMs) {
    const deadline = Date.now() + Math.max(250, Number(timeoutMs) || 2500);
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch (_error) {
      // The process may already be gone.
    }
  }

  async function stopLocalAdvisorPid(pid, options) {
    const stopOptions = options || {};
    if (!isPidAlive(pid)) {
      return false;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (_error) {
      return false;
    }
    if (stopOptions.wait) {
      await waitForPidExit(pid, stopOptions.forceAfterMs || 2500);
    } else {
      const timer = setTimeout(() => {
        try {
          if (isPidAlive(pid)) {
            process.kill(pid, 'SIGKILL');
          }
        } catch (_error) {
          // The process may already be gone.
        }
      }, stopOptions.forceAfterMs || 2500);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }
    if (localAdvisorAdoptedPid === pid) {
      localAdvisorAdoptedPid = 0;
      localAdvisorAdoptedProcessKey = '';
    }
    return true;
  }

  function waitForProcessExit(child, timeoutMs) {
    return new Promise((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        child.removeListener('exit', done);
        resolve();
      };
      const timer = setTimeout(
        () => {
          try {
            if (child.pid) {
              process.kill(child.pid, 'SIGKILL');
            }
          } catch (_error) {
            // The process may already be gone.
          }
          done();
        },
        Math.max(250, Number(timeoutMs) || 2500)
      );
      child.once('exit', done);
    });
  }

  function stopLocalAdvisorProcess(options) {
    const stopOptions = options || {};
    const child = localAdvisorProcess;
    if (localAdvisorForceKillTimer) {
      clearTimeout(localAdvisorForceKillTimer);
      localAdvisorForceKillTimer = null;
    }
    if (localAdvisorStartPromise && typeof localAdvisorStartPromise.catch === 'function') {
      localAdvisorStartPromise.catch(() => {});
    }
    localAdvisorProcess = null;
    localAdvisorProcessKey = '';
    localAdvisorStartPromise = null;
    if (!isChildProcessRunning(child)) {
      return Promise.resolve();
    }
    try {
      child.kill('SIGTERM');
    } catch (_error) {
      return Promise.resolve();
    }
    if (stopOptions.wait) {
      return waitForProcessExit(child, stopOptions.forceAfterMs || 2500);
    }
    localAdvisorForceKillTimer = setTimeout(() => {
      localAdvisorForceKillTimer = null;
      try {
        if (child.pid) {
          process.kill(child.pid, 'SIGKILL');
        }
      } catch (_error) {
        // The process may already be gone.
      }
    }, stopOptions.forceAfterMs || 2500);
    if (typeof localAdvisorForceKillTimer.unref === 'function') {
      localAdvisorForceKillTimer.unref();
    }
    return Promise.resolve();
  }

  function getInactiveLocalAdvisorStatus(message) {
    return {
      running: false,
      healthy: false,
      starting: false,
      manageable: false,
      source: 'inactive',
      pid: 0,
      baseUrl: '',
      message
    };
  }

  async function getLocalAdvisorServerStatus(settings) {
    const normalized = normalizeAdvisorSettings(settings);
    const managedStatus = await getManagedLocalAdvisorStatusFromProcess();
    if (managedStatus) {
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
      adoptLocalAdvisorProcess(matchingProcess, serverKey);
      const healthy = await isLocalAdvisorHealthy(serverInfo);
      return {
        running: true,
        healthy,
        starting: !healthy,
        manageable: true,
        source: 'adopted',
        pid: matchingProcess.pid,
        baseUrl: serverInfo.baseUrl,
        message: healthy
          ? `Local model server is running at ${serverInfo.baseUrl}.`
          : 'A matching llama-server is listening but not healthy yet.'
      };
    }
    if (
      localAdvisorAdoptedPid &&
      localAdvisorAdoptedProcessKey === serverKey &&
      !isPidAlive(localAdvisorAdoptedPid)
    ) {
      localAdvisorAdoptedPid = 0;
      localAdvisorAdoptedProcessKey = '';
    }
    const healthy = await isLocalAdvisorHealthy(serverInfo);
    if (healthy) {
      return {
        running: true,
        healthy: true,
        starting: false,
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
      manageable: true,
      source: 'stopped',
      pid: 0,
      baseUrl: serverInfo.baseUrl,
      message: 'Local model server is stopped.'
    };
  }

  async function stopLocalAdvisorServer(settings, event, options) {
    const normalized = normalizeAdvisorSettings(settings);
    const stopOptions = Object.assign({ wait: true, forceAfterMs: 2500 }, options || {});
    let serverInfo = null;
    let serverKey = '';
    let stopped = false;
    try {
      if (normalized.provider === 'custom' && normalized.localModelPath) {
        serverInfo = getLocalAdvisorServerInfo(normalized);
        serverKey = getLocalAdvisorServerKey(normalized, serverInfo);
      }
    } catch (_error) {
      serverInfo = null;
    }
    if (
      isChildProcessRunning(localAdvisorProcess) &&
      (!serverKey || localAdvisorProcessKey === serverKey)
    ) {
      const childPid = localAdvisorProcess.pid || 0;
      await stopLocalAdvisorProcess(stopOptions);
      stopped = !!childPid;
    } else if (localAdvisorProcess && localAdvisorProcessKey === serverKey) {
      await stopLocalAdvisorProcess(stopOptions);
    }
    if (serverInfo && serverKey) {
      const matchingProcess = await findMatchingLocalAdvisorProcess(normalized, serverInfo);
      if (
        matchingProcess &&
        !(localAdvisorProcess && localAdvisorProcess.pid === matchingProcess.pid)
      ) {
        stopped = (await stopLocalAdvisorPid(matchingProcess.pid, stopOptions)) || stopped;
      }
    }
    sendAdvisorStatus(event, {
      phase: 'stopped',
      message: stopped
        ? 'Local model server stopped.'
        : 'No matching local model server was running.',
      progressPercent: 0
    });
    const status = await getLocalAdvisorServerStatus(normalized);
    return {
      ok: true,
      status,
      message: stopped
        ? 'Local model server stopped.'
        : 'No matching local model server was running.'
    };
  }

  async function stopLocalAdvisorServerForSavedSettings(options) {
    const settings = await loadAdvisorSettings();
    return stopLocalAdvisorServer(settings, null, options || { wait: true, forceAfterMs: 2500 });
  }

  function tailText(text, maxLines) {
    const lines = String(text || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
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

  async function startLocalAdvisorServer(settings, serverInfo, serverKey, event) {
    sendAdvisorStatus(event, {
      phase: 'resolve',
      message: 'Finding llama-server.',
      progressPercent: 5
    });
    const binaryPath = await resolveLlamaServerBinary();
    const helpText = await getLlamaServerHelp(binaryPath);
    const args = ['--host', serverInfo.host, '--port', serverInfo.port];
    const modelName = settings.model || CAVALRY_LOCAL_ADVISOR_MODEL;

    if (llamaServerSupportsFlag(helpText, '--alias')) {
      args.push('--alias', modelName);
    }
    if (llamaServerSupportsFlag(helpText, '--no-ui')) {
      args.push('--no-ui');
    } else if (llamaServerSupportsFlag(helpText, '--no-webui')) {
      args.push('--no-webui');
    }
    args.push('-m', settings.localModelPath);
    if (settings.mmprojPath) {
      if (!llamaServerSupportsFlag(helpText, '--mmproj')) {
        throw new Error(
          'The installed llama-server does not support --mmproj. Upgrade llama.cpp to use image inputs.'
        );
      }
      args.push('--mmproj', settings.mmprojPath);
      args.push(...advisorSettingsDomain.getAdvisorLlamaVisionArgs(settings, helpText));
    }
    if (llamaServerSupportsFlag(helpText, '--ctx-size')) {
      args.push(
        '--ctx-size',
        String(normalizeAdvisorContextWindowTokens(settings.contextWindowTokens))
      );
    }
    if (llamaServerSupportsFlag(helpText, '--n-gpu-layers')) {
      args.push('--n-gpu-layers', 'auto');
    }
    if (llamaServerSupportsFlag(helpText, '--flash-attn')) {
      args.push('--flash-attn', 'auto');
    }
    if (llamaServerSupportsFlag(helpText, '--jinja')) {
      args.push('--jinja');
    }
    if (llamaServerSupportsFlag(helpText, '--reasoning')) {
      args.push('--reasoning', 'off');
    } else if (llamaServerSupportsFlag(helpText, '--reasoning-format')) {
      args.push('--reasoning-format', 'none');
    }

    const logPath = path.join(app.getPath('userData'), 'cavalry-llama-server.log');
    const advisorProcessLog = await createAdvisorProcessLog({ fs, fsSync, path, logPath });
    const workingDirectory = path.dirname(logPath);
    sendAdvisorStatus(event, {
      phase: 'launch',
      message: 'Starting llama-server for the selected GGUF.',
      detail: logPath,
      progressPercent: 10
    });

    const child = spawn(binaryPath, args, {
      cwd: workingDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    localAdvisorProcess = child;
    localAdvisorProcessKey = serverKey;
    localAdvisorAdoptedPid = 0;
    localAdvisorAdoptedProcessKey = '';

    advisorProcessLog.attach(child, () => {
      if (localAdvisorProcess === child) {
        localAdvisorProcess = null;
        localAdvisorProcessKey = '';
        localAdvisorStartPromise = null;
      }
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < LOCAL_ADVISOR_STARTUP_TIMEOUT_MS) {
      if (await isLocalAdvisorHealthy(serverInfo)) {
        sendAdvisorStatus(event, {
          phase: 'ready',
          message: `Local model server is ready at ${serverInfo.baseUrl}.`,
          detail: logPath,
          progressPercent: 65
        });
        return { ok: true, message: `Local model started at ${serverInfo.baseUrl}` };
      }
      if (child.exitCode !== null) {
        throw new Error(
          `llama-server exited before it became ready. Log: ${
            tailText(advisorProcessLog.getCollectedText(), 12) || logPath
          }`
        );
      }
      sendAdvisorStatus(event, {
        phase: 'loading',
        message: `Loading local model... ${Math.round((Date.now() - startedAt) / 1000)}s`,
        detail: logPath,
        progressPercent: advisorElapsedProgress(startedAt, LOCAL_ADVISOR_STARTUP_TIMEOUT_MS, 10, 60)
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    child.kill();
    throw new Error(`Timed out waiting for llama-server to start. Review ${logPath}`);
  }

  async function ensureLocalAdvisorServer(settings, event) {
    if (settings.provider !== 'custom') {
      return { ok: true, message: 'No local model server needed.' };
    }
    if (!settings.localModelPath) {
      throw new Error('Choose a local GGUF model file before starting the local advisor.');
    }
    if (!(await pathExists(settings.localModelPath))) {
      throw new Error(`The selected local model file does not exist: ${settings.localModelPath}`);
    }
    if (settings.mmprojPath && !(await pathExists(settings.mmprojPath))) {
      throw new Error(
        `The selected multimodal projector file does not exist: ${settings.mmprojPath}`
      );
    }
    const serverInfo = getLocalAdvisorServerInfo(settings);
    const serverKey = getLocalAdvisorServerKey(settings, serverInfo);
    if (localAdvisorStartPromise && localAdvisorProcessKey === serverKey) {
      sendAdvisorStatus(event, {
        phase: 'loading',
        message: 'Local model is already starting.',
        progressPercent: 25
      });
      return localAdvisorStartPromise;
    }
    const matchingProcess = await findMatchingLocalAdvisorProcess(settings, serverInfo);
    const isHealthy = await isLocalAdvisorHealthy(serverInfo);
    if (matchingProcess && isHealthy) {
      adoptLocalAdvisorProcess(matchingProcess, serverKey);
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
      adoptLocalAdvisorProcess(matchingProcess, serverKey);
      throw new Error(
        'A matching llama-server is already listening, but it is not healthy yet. Stop it or wait for it to finish loading, then try again.'
      );
    }
    if (isHealthy) {
      throw new Error(
        'A local endpoint is already responding on the configured port, but it does not match this GGUF model. Cavalry will not reuse or stop that process.'
      );
    }
    if (localAdvisorProcess && localAdvisorProcessKey !== serverKey) {
      await stopLocalAdvisorProcess({ wait: true, forceAfterMs: 2500 });
    }
    localAdvisorStartPromise = startLocalAdvisorServer(
      settings,
      serverInfo,
      serverKey,
      event
    ).finally(() => {
      localAdvisorStartPromise = null;
    });
    return localAdvisorStartPromise;
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
    if (status && (status.running || status.starting)) {
      throw new Error('Stop the local model before changing context allocation.');
    }
  }

  async function saveAdvisorSettings(payload) {
    const existing = await loadAdvisorRuntimeSettings();
    const settings = normalizeAdvisorSettings(payload, existing);
    await assertAdvisorContextChangeAllowed(settings, existing);
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

  function isOpenAIChatCompletionsEndpoint(endpoint) {
    try {
      const parsed = new URL(String(endpoint || ''));
      return (
        /(^|\.)openai\.com$/i.test(parsed.hostname) &&
        /\/v1\/chat\/completions\/?$/i.test(parsed.pathname)
      );
    } catch (_error) {
      return false;
    }
  }

  function applyAdvisorOutputTokenLimit(body, settings, payload, endpoint) {
    const explicitCompletionLimit = Number(payload && payload.max_completion_tokens);
    const legacyCompletionLimit = Number(payload && payload.max_tokens);
    const limit =
      Number.isFinite(explicitCompletionLimit) && explicitCompletionLimit > 0
        ? Math.round(explicitCompletionLimit)
        : Number.isFinite(legacyCompletionLimit) && legacyCompletionLimit > 0
          ? Math.round(legacyCompletionLimit)
          : 0;
    if (!limit) {
      return body;
    }
    if (settings.provider === 'openai' && isOpenAIChatCompletionsEndpoint(endpoint)) {
      body.max_completion_tokens = limit;
    } else {
      body.max_tokens = limit;
    }
    return body;
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
      const messages = payload.messages || [];
      assertCompanionMultimodalInput(messages);
      const body = {
        model,
        messages,
        temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.1
      };
      if (typeof payload.top_p === 'number') {
        body.top_p = payload.top_p;
      }
      applyAdvisorOutputTokenLimit(body, settings, payload, endpoint);
      if (payload.response_format) {
        body.response_format = payload.response_format;
      }
      if (Array.isArray(payload.tools)) {
        body.tools = payload.tools;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'tool_choice')) {
        body.tool_choice = payload.tool_choice;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'parallel_tool_calls')) {
        body.parallel_tool_calls = payload.parallel_tool_calls;
      }
      const postAdvisorRequest = (requestBody) =>
        fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
          },
          ADVISOR_REQUEST_TIMEOUT_MS,
          getAdvisorRequestSignal(requestState)
        );
      const parseAdvisorResponseText = (value) => {
        try {
          return value ? JSON.parse(value) : null;
        } catch (_error) {
          return null;
        }
      };
      const getAdvisorResponseErrorMessage = (responseText, parsedBody, status) =>
        parsedBody && parsedBody.error && parsedBody.error.message
          ? parsedBody.error.message
          : responseText || `Model request failed with HTTP ${status}.`;
      let response = null;
      let generationStatusTimer = null;
      try {
        if (settings.provider === 'custom') {
          const startedAt = Date.now();
          generationStatusTimer = setInterval(() => {
            sendAdvisorStatus(event, {
              phase: 'request',
              message: 'Local model is generating a response.',
              progressPercent: advisorElapsedProgress(startedAt, ADVISOR_REQUEST_TIMEOUT_MS, 70, 94)
            });
          }, 5000);
        }
        response = await postAdvisorRequest(body);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (
            error.cavalryCancelled ||
            (requestState && requestState.controller && requestState.controller.signal.aborted)
          ) {
            throw error;
          }
          throw new Error(
            'The local model did not answer within 5 minutes. Cavalry used the verified workbook calculation instead.'
          );
        }
        throw error;
      } finally {
        if (generationStatusTimer) {
          clearInterval(generationStatusTimer);
        }
      }
      sendAdvisorStatus(event, {
        phase: 'response',
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
            message:
              'Local endpoint rejected structured JSON mode; retrying with prompt-only JSON instructions.',
            progressPercent: 72
          });
          response = await postAdvisorRequest(retryBody);
          sendAdvisorStatus(event, {
            phase: 'response',
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
      const answer = responseContent == null ? '' : String(responseContent);
      const toolCalls =
        responseMessage && Array.isArray(responseMessage.tool_calls)
          ? responseMessage.tool_calls
          : [];
      const returnMessage = payload && payload.returnMessage === true;
      if (!answer && !(returnMessage && toolCalls.length)) {
        throw new Error('The model response did not include a message.');
      }
      if (returnMessage) {
        return {
          text: answer,
          message: {
            role: String((responseMessage && responseMessage.role) || 'assistant'),
            content: responseMessage ? responseContent : answer,
            tool_calls: toolCalls
          }
        };
      }
      return answer;
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
      let response;
      try {
        response = await transport(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify(body)
          },
          ADVISOR_REQUEST_TIMEOUT_MS,
          getAdvisorRequestSignal(requestState)
        );
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        const reason = String((error && (error.cause?.message || error.message)) || '').trim();
        throw new Error(
          `Could not reach the OpenAI API. Check your internet connection and try again${reason ? ` (${reason}).` : '.'}`
        );
      }
      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_error) {
        parsed = null;
      }
      if (!response.ok) {
        const message =
          parsed && parsed.error && parsed.error.message
            ? parsed.error.message
            : text || `Model request failed with HTTP ${response.status}.`;
        throw new Error(message);
      }
      sendAdvisorStatus(event, {
        phase: 'response',
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
      const candidates = entries.filter(
        (entry) =>
          /^mmproj.*\.gguf$/i.test(entry) || /(^|[-_.])mmproj([-_.]|$).*\.gguf$/i.test(entry)
      );
      if (candidates.length === 1) {
        return path.join(dir, candidates[0]);
      }
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
      callAdvisorModel,
      callAdvisorAgentTurn,
      callAdvisorTranscription,
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
    cancelAdvisorRequest,
    ensureLocalAdvisorServer,
    findAdjacentMmprojPath,
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
