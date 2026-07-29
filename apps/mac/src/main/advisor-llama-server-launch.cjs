// Resolves llama-server installations, negotiates versioned CLI flags, and classifies launch outcomes.

'use strict';

const nodeFsSync = require('fs');

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function llamaServerSupportsFlag(helpText, flag) {
  const escaped = escapeRegExp(flag);
  return new RegExp('(^|\\s)' + escaped + '([,\\s]|$)').test(String(helpText || ''));
}

function getLlamaServerFlagHelp(helpText, flag) {
  const lines = String(helpText || '').split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(flag));
  return index < 0 ? '' : lines.slice(index, index + 4).join('\n');
}

function llamaServerFlagSupportsValue(helpText, flag, value) {
  const flagHelp = getLlamaServerFlagHelp(helpText, flag);
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegExp(value)}(?:[^A-Za-z0-9_-]|$)`, 'i').test(
    flagHelp
  );
}

function looksLikeLlamaServerHelp(helpText) {
  const value = String(helpText || '');
  return (
    /(^|\s)--host(?:[,\s]|$)/m.test(value) &&
    /(^|\s)--port(?:[,\s]|$)/m.test(value) &&
    /(^|\s)(?:-m,?\s+|--model(?:[,\s]|$))/m.test(value)
  );
}

function createAdvisorLlamaServerLaunchSupport({
  app,
  defaultModel,
  execFileAsync,
  fs,
  getVisionArgs,
  normalizeContextWindowTokens,
  path,
  process
} = {}) {
  const helpCache = Object.create(null);

  async function findCommandOnPath(commandName) {
    try {
      const locator = process.platform === 'win32' ? 'where.exe' : 'which';
      const result = await execFileAsync(locator, [commandName], { timeout: 10000 });
      const firstLine = String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      return firstLine || '';
    } catch (_error) {
      return '';
    }
  }

  function resolveExecutableCandidate(candidate) {
    const value = String(candidate || '').trim();
    if (!value) return '';
    if (value === '~' || value.startsWith(`~${path.sep}`)) {
      const homePath =
        app && typeof app.getPath === 'function' ? String(app.getPath('home') || '') : '';
      return homePath ? path.join(homePath, value.slice(2)) : '';
    }
    return path.isAbsolute(value) ? value : path.resolve(value);
  }

  function getCommonBinaryPaths() {
    const executableName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const homePath =
      app && typeof app.getPath === 'function' ? String(app.getPath('home') || '') : '';
    const userCandidates = homePath
      ? [
          path.join(homePath, '.local', 'bin', executableName),
          path.join(homePath, 'bin', executableName)
        ]
      : [];
    if (process.platform === 'win32') return userCandidates;
    if (process.platform === 'darwin') {
      return [
        ...userCandidates,
        '/opt/homebrew/bin/llama-server',
        '/usr/local/bin/llama-server',
        '/opt/local/bin/llama-server'
      ];
    }
    return [
      ...userCandidates,
      '/usr/local/bin/llama-server',
      '/usr/bin/llama-server',
      '/snap/bin/llama-server'
    ];
  }

  async function isExecutableFile(filePath) {
    try {
      await fs.access(filePath, nodeFsSync.constants.X_OK);
      if (typeof fs.stat === 'function') {
        const stats = await fs.stat(filePath);
        if (stats && typeof stats.isFile === 'function' && !stats.isFile()) return false;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function getHelp(binaryPath) {
    if (Object.prototype.hasOwnProperty.call(helpCache, binaryPath)) {
      return helpCache[binaryPath];
    }
    try {
      const result = await execFileAsync(binaryPath, ['--help'], {
        timeout: 15000,
        maxBuffer: 1024 * 1024
      });
      helpCache[binaryPath] = String(result.stdout || '') + '\n' + String(result.stderr || '');
    } catch (error) {
      const output =
        String((error && error.stdout) || '') + '\n' + String((error && error.stderr) || '');
      if (output.trim()) {
        helpCache[binaryPath] = output;
      } else {
        throw new Error(
          `llama-server could not be executed (${String(
            (error && (error.code || error.message)) || 'unknown launch error'
          )})`
        );
      }
    }
    return helpCache[binaryPath];
  }

  async function resolveBinary() {
    const candidates = [];
    if (process.env.LLAMA_SERVER_BIN) candidates.push(process.env.LLAMA_SERVER_BIN);
    const commandName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const fromPath = await findCommandOnPath(commandName);
    if (fromPath) candidates.push(fromPath);
    candidates.push(...getCommonBinaryPaths());

    let lastValidationError = null;
    const checked = new Set();
    for (const rawCandidate of candidates) {
      const candidate = resolveExecutableCandidate(rawCandidate);
      if (!candidate || checked.has(candidate)) continue;
      checked.add(candidate);
      if (!(await isExecutableFile(candidate))) continue;
      try {
        const helpText = await getHelp(candidate);
        if (!looksLikeLlamaServerHelp(helpText)) {
          throw new Error('the executable did not return llama-server help output');
        }
        return candidate;
      } catch (error) {
        lastValidationError = error;
      }
    }
    if (lastValidationError) {
      throw new Error(
        `Could not run a compatible llama-server executable: ${String(
          lastValidationError && lastValidationError.message
            ? lastValidationError.message
            : lastValidationError
        )}`
      );
    }
    throw new Error(
      'Could not find llama-server. Install llama.cpp, or set LLAMA_SERVER_BIN to the llama-server executable.'
    );
  }

  function buildArgs(settings, serverInfo, helpText) {
    const args = ['--host', serverInfo.host, '--port', serverInfo.port];
    if (llamaServerSupportsFlag(helpText, '--alias')) {
      args.push('--alias', settings.model || defaultModel);
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
      args.push(...getVisionArgs(settings, helpText));
    }
    if (llamaServerSupportsFlag(helpText, '--ctx-size')) {
      args.push('--ctx-size', String(normalizeContextWindowTokens(settings.contextWindowTokens)));
    }
    if (
      llamaServerSupportsFlag(helpText, '--n-gpu-layers') &&
      llamaServerFlagSupportsValue(helpText, '--n-gpu-layers', 'auto')
    ) {
      args.push('--n-gpu-layers', 'auto');
    }
    if (llamaServerSupportsFlag(helpText, '--flash-attn')) {
      args.push('--flash-attn');
      if (llamaServerFlagSupportsValue(helpText, '--flash-attn', 'auto')) args.push('auto');
    }
    if (llamaServerSupportsFlag(helpText, '--jinja')) args.push('--jinja');
    if (llamaServerSupportsFlag(helpText, '--reasoning-format')) {
      args.push('--reasoning-format', 'none');
    } else if (
      llamaServerSupportsFlag(helpText, '--reasoning') &&
      llamaServerFlagSupportsValue(helpText, '--reasoning', 'off')
    ) {
      args.push('--reasoning', 'off');
    }
    return args;
  }

  async function resolveLaunchCommand(settings, serverInfo) {
    const binaryPath = await resolveBinary();
    return {
      args: buildArgs(settings, serverInfo, await getHelp(binaryPath)),
      binaryPath
    };
  }

  return Object.freeze({ resolveLaunchCommand });
}

function tailText(text, maxLines) {
  const lines = String(text || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

function getAdvisorLlamaRootCause(text) {
  const value = String(text || '');
  const projectorMismatch = value.match(
    /mismatch between text model\s*\(n_embd\s*=\s*(\d+)\)\s*and mmproj\s*\(n_embd\s*=\s*(\d+)\)/i
  );
  if (projectorMismatch) {
    return {
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      message:
        `The selected vision projector is incompatible with this text model ` +
        `(model dimension ${projectorMismatch[1]}, projector dimension ${projectorMismatch[2]}). ` +
        'Choose the projector published for the same model, or clear the optional projector.'
    };
  }

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const highSignalLine = lines.find(
    (line) =>
      !/^(?:\d+\s+)?(?:lib\S+|0x[0-9a-f]+|_ZN|GGML_ASSERT|\[New LWP)/i.test(line) &&
      !/\b(?:backtrace|stack trace)\b/i.test(line) &&
      /\b(?:error|failed|invalid|incompatible|out of memory|not enough memory|unsupported)\b/i.test(
        line
      )
  );
  if (!highSignalLine) return null;

  return {
    code: 'ADVISOR_LOCAL_MODEL_LOAD_FAILED',
    message: highSignalLine.replace(/^(?:error|fatal)\s*:\s*/i, '').slice(0, 500)
  };
}

function createAdvisorLlamaError(message, options = {}) {
  const error = new Error(message);
  error.code = options.code || 'ADVISOR_LOCAL_MODEL_LAUNCH_FAILED';
  error.userMessage = options.userMessage || message;
  error.detail = options.detail || '';
  error.logPath = options.logPath || '';
  return error;
}

function getAdvisorLlamaProcessOutcome(child, observedOutcome) {
  if (observedOutcome) return observedOutcome;
  if (child && typeof child.exitCode !== 'undefined' && child.exitCode !== null) {
    return { code: child.exitCode, signal: child.signalCode || '' };
  }
  if (child && child.signalCode) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  if (child && child.killed) {
    return { code: child.exitCode, signal: child.signalCode || 'terminated' };
  }
  return null;
}

function getAdvisorLlamaLaunchFailure(outcome, processLog, logPath) {
  const collectedText = processLog.getCollectedText();
  const rootCause = getAdvisorLlamaRootCause(collectedText);
  if (outcome && outcome.error) {
    const reason = String(
      (outcome.error && (outcome.error.cause?.message || outcome.error.message)) ||
        outcome.error ||
        'unknown process error'
    );
    const message = rootCause ? rootCause.message : `Could not launch llama-server (${reason}).`;
    return createAdvisorLlamaError(message, {
      code: rootCause ? rootCause.code : 'ADVISOR_LOCAL_MODEL_LAUNCH_FAILED',
      detail: `llama-server could not be launched: ${reason}`,
      logPath
    });
  }
  const termination =
    outcome && outcome.signal
      ? ` after receiving ${outcome.signal}`
      : outcome && outcome.code != null
        ? ` with exit code ${outcome.code}`
        : '';
  const message = rootCause
    ? rootCause.message
    : `llama-server exited${termination} before it became ready.`;
  const fallbackDetail = tailText(collectedText, 12);
  return createAdvisorLlamaError(message, {
    code: rootCause ? rootCause.code : 'ADVISOR_LOCAL_MODEL_LAUNCH_FAILED',
    detail:
      `llama-server exited${termination} before it became ready.` +
      (rootCause || !fallbackDetail ? '' : ` ${fallbackDetail}`),
    logPath
  });
}

function waitForAdvisorLlamaStartupPoll(processOutcomePromise, delayMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, delayMs);
    processOutcomePromise.then(done, done);
  });
}

module.exports = {
  createAdvisorLlamaServerLaunchSupport,
  getAdvisorLlamaLaunchFailure,
  getAdvisorLlamaRootCause,
  getAdvisorLlamaProcessOutcome,
  waitForAdvisorLlamaStartupPoll
};
