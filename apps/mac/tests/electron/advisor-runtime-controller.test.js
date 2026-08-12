import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ADVISOR_IPC_CHANNELS,
  createAdvisorRuntimeController,
  createAdvisorLogLineCollector,
  createBoundedAdvisorLogWriter,
  prepareAdvisorLogFile,
  redactAdvisorLogText
} = require('../../src/main/advisor-runtime-controller.cjs');
const {
  createAdvisorLocalProcessLifecycle
} = require('../../src/main/advisor-local-process-lifecycle.cjs');

const EXPECTED_ADVISOR_CHANNELS = [
  'cavalry-advisor:get-settings',
  'cavalry-advisor:save-settings',
  'cavalry-advisor:get-server-status',
  'cavalry-advisor:start-server',
  'cavalry-advisor:stop-server',
  'cavalry-advisor:choose-local-model',
  'cavalry-advisor:choose-mmproj',
  'cavalry-advisor:test',
  'cavalry-advisor:chat',
  'cavalry-advisor:agent',
  'cavalry-advisor:get-microphone-status',
  'cavalry-advisor:request-microphone-access',
  'cavalry-advisor:open-microphone-settings',
  'cavalry-advisor:transcribe-audio',
  'cavalry-advisor:cancel'
];

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}

function createMemoryFs() {
  const files = new Map();
  const modes = new Map();
  return {
    files,
    modes,
    async access(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
    },
    async mkdir() {},
    async stat(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return { size: Buffer.byteLength(String(files.get(filePath)), 'utf8') };
    },
    async truncate(filePath, length) {
      if (!files.has(filePath)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      files.set(filePath, String(files.get(filePath)).slice(0, length));
    },
    async readFile(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(filePath);
    },
    async writeFile(filePath, contents, options) {
      files.set(filePath, String(contents));
      modes.set(filePath, options && options.mode);
    },
    async chmod(filePath, mode) {
      modes.set(filePath, mode);
    },
    async rename(from, to) {
      files.set(to, files.get(from));
      modes.set(to, modes.get(from));
      files.delete(from);
      modes.delete(from);
    },
    async readdir() {
      return [];
    }
  };
}

function createSecureStorage(overrides = {}) {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value) => Buffer.from('enc:' + value, 'utf8'),
    decryptString: (buffer) => {
      const raw = buffer.toString('utf8');
      if (!raw.startsWith('enc:')) throw new Error('unexpected payload');
      return raw.slice(4);
    },
    ...overrides
  };
}

function createMemoryFsSync() {
  const chunks = [];
  return {
    chunks,
    createWriteStream() {
      return {
        write(value) {
          chunks.push(Buffer.from(value));
        },
        end() {}
      };
    }
  };
}

function createFakeChild(pid = 4100) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.finish = (code = null, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
  };
  child.kill = vi.fn((signal = 'SIGTERM') => {
    child.killed = true;
    queueMicrotask(() => child.finish(null, signal));
    return true;
  });
  return child;
}

function createLocalLaunchHarness(overrides = {}) {
  const binaryPath = overrides.binaryPath || '/opt/homebrew/bin/llama-server';
  const modelPath = overrides.modelPath || '/Models/local-model.gguf';
  const fs = overrides.fs || createMemoryFs();
  fs.files.set(binaryPath, 'llama-server executable');
  fs.files.set(modelPath, 'GGUF model');
  const helpText =
    overrides.helpText ||
    [
      '--host HOST',
      '--port PORT',
      '-m, --model FNAME',
      '--alias STRING',
      '--no-webui',
      '--ctx-size N',
      '--n-gpu-layers N',
      '--flash-attn',
      '--jinja',
      '--reasoning-format FORMAT'
    ].join('\n');
  const execFileAsync =
    overrides.execFileAsync ||
    vi.fn(async (executable, args) => {
      if (executable === 'which') return { stdout: `${binaryPath}\n`, stderr: '' };
      if (executable === binaryPath && args[0] === '--help') {
        return { stdout: helpText, stderr: '' };
      }
      const error = new Error(`${executable} unavailable`);
      error.code = 'ENOENT';
      throw error;
    });
  const spawn = overrides.spawn || vi.fn(() => createFakeChild());
  const fetch = overrides.fetch || vi.fn(async () => ({ ok: false }));
  const process = overrides.process || {
    env: { LLAMA_SERVER_BIN: binaryPath },
    kill: vi.fn(),
    platform: 'darwin'
  };
  const fsSync = overrides.fsSync || createMemoryFsSync();
  const created = createController({
    execFileAsync,
    fetch,
    fs,
    fsSync,
    inspectGgufCompatibility:
      overrides.inspectGgufCompatibility ||
      vi.fn(async ({ mmprojPath }) => ({
        status: 'compatible',
        compatible: true,
        reason: mmprojPath ? 'metadata-match' : 'text-only'
      })),
    process,
    spawn
  });
  return {
    ...created,
    binaryPath,
    execFileAsync,
    fetch,
    fsSync,
    modelPath,
    process,
    settings: {
      provider: 'custom',
      providerKind: 'local_model',
      apiMode: 'chat_completions',
      endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
      model: 'cavalry-advisor',
      localModelPath: modelPath,
      mmprojPath: '',
      contextWindowTokens: 8192,
      apiKey: ''
    },
    spawn
  };
}

function createController(overrides = {}) {
  const ipcMain = overrides.ipcMain || createIpcMain();
  const fs = overrides.fs || createMemoryFs();
  return {
    ipcMain,
    fs,
    controller: createAdvisorRuntimeController({
      app: { getPath: () => '/tmp/cavalry-advisor-controller-test' },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      ipcMain,
      shell: { openExternal: async () => {} },
      systemPreferences: {
        getMediaAccessStatus: () => 'granted',
        askForMediaAccess: async () => true
      },
      fs,
      safeStorage: createSecureStorage(),
      assertTrustedSender: () => true,
      ...overrides
    })
  };
}

describe('Advisor runtime controller', () => {
  it('redacts credentials, request content, and local user paths from llama-server logs', () => {
    const redacted = redactAdvisorLogText(
      [
        'Authorization: Bearer synthetic-bearer-token-123456',
        'api_key=synthetic-api-key-123456',
        '--password synthetic-password-123456',
        '"messages":[{"role":"user","content":"private workbook question"}]',
        'model=/Users/alex/Models/demo.gguf',
        'cache=/home/alex/.cache/demo',
        'windows=C:\\Users\\alex\\Models\\demo.gguf'
      ].join('\n')
    );

    expect(redacted).not.toContain('synthetic-bearer-token-123456');
    expect(redacted).not.toContain('synthetic-api-key-123456');
    expect(redacted).not.toContain('synthetic-password-123456');
    expect(redacted).not.toContain('private workbook question');
    expect(redacted).not.toMatch(/Users[\\/]alex|home[\\/]alex/);
    expect(redacted).toContain('[redacted');
  });

  it('stores bounded advisor logs and marks truncated output', () => {
    const chunks = [];
    const writer = createBoundedAdvisorLogWriter(
      {
        write(chunk) {
          chunks.push(Buffer.from(chunk));
        }
      },
      { maxBytes: 96 }
    );

    writer.write('server ready\n');
    writer.write('x'.repeat(200));
    writer.write('this must not be stored');

    const stored = Buffer.concat(chunks);
    expect(stored.length).toBe(96);
    expect(stored.toString('utf8')).toContain('Advisor log limit reached');
    expect(stored.toString('utf8')).not.toContain('this must not be stored');
    expect(writer.capped).toBe(true);
    expect(writer.bytesWritten).toBe(96);
  });

  it('redacts secrets that arrive across separate process-output chunks', () => {
    const chunks = [];
    const writer = createBoundedAdvisorLogWriter({
      write(chunk) {
        chunks.push(Buffer.from(chunk));
      }
    });
    const collector = createAdvisorLogLineCollector((text) => writer.write(text));

    collector.push('Authorization: Bearer synthetic-split-');
    collector.push('secret-123456\nserver ready');
    collector.flush();

    const stored = Buffer.concat(chunks).toString('utf8');
    expect(stored).not.toContain('synthetic-split-secret-123456');
    expect(stored).toContain('Authorization: Bearer [redacted]');
    expect(stored).toContain('server ready');
  });

  it('truncates oversized advisor logs and reapplies owner-only permissions', async () => {
    const fs = createMemoryFs();
    const logPath = '/tmp/cavalry-advisor-controller-test/cavalry-llama-server.log';
    fs.files.set(logPath, 'x'.repeat(128));

    await expect(prepareAdvisorLogFile(fs, path, logPath, 64)).resolves.toBe(0);
    expect(fs.files.get(logPath)).toBe('');
    expect(fs.modes.get(logPath)).toBe(0o600);
  });

  it('launches older llama-server builds with backward-compatible optional flags', async () => {
    let spawned = false;
    const spawn = vi.fn(() => {
      spawned = true;
      return createFakeChild();
    });
    const harness = createLocalLaunchHarness({
      spawn,
      fetch: vi.fn(async () => ({ ok: spawned }))
    });

    await expect(
      harness.controller.ensureLocalAdvisorServer(harness.settings)
    ).resolves.toMatchObject({
      ok: true,
      message: 'Local model started at http://127.0.0.1:8080'
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [binaryPath, args, options] = spawn.mock.calls[0];
    expect(binaryPath).toBe(harness.binaryPath);
    expect(args).toEqual(
      expect.arrayContaining([
        '--host',
        '127.0.0.1',
        '--port',
        '8080',
        '-m',
        harness.modelPath,
        '--ctx-size',
        '8192',
        '--flash-attn',
        '--reasoning-format',
        'none'
      ])
    );
    expect(args).not.toContain('--n-gpu-layers');
    expect(args[args.indexOf('--flash-attn') + 1]).not.toBe('auto');
    expect(options).toMatchObject({
      cwd: '/tmp/cavalry-advisor-controller-test',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  });

  it('uses automatic GPU layers only when the installed build documents support', async () => {
    let spawned = false;
    const helpText = [
      '--host HOST',
      '--port PORT',
      '-m, --model FNAME',
      '--n-gpu-layers N    exact number, auto, or all (default: auto)',
      '--flash-attn [on|off|auto]    set Flash Attention use (default: auto)'
    ].join('\n');
    const spawn = vi.fn(() => {
      spawned = true;
      return createFakeChild();
    });
    const harness = createLocalLaunchHarness({
      helpText,
      spawn,
      fetch: vi.fn(async () => ({ ok: spawned }))
    });

    await expect(
      harness.controller.ensureLocalAdvisorServer(harness.settings)
    ).resolves.toMatchObject({ ok: true });

    expect(spawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['--n-gpu-layers', 'auto', '--flash-attn', 'auto'])
    );
  });

  it('skips a broken configured executable when a compatible llama-server is discoverable', async () => {
    const brokenBinaryPath = '/Applications/Broken llama-server';
    const workingBinaryPath = '/opt/homebrew/bin/llama-server';
    const fs = createMemoryFs();
    fs.files.set(brokenBinaryPath, 'not executable');
    let spawned = false;
    const execFileAsync = vi.fn(async (executable, args) => {
      if (executable === 'which') {
        return { stdout: `${workingBinaryPath}\n`, stderr: '' };
      }
      if (executable === brokenBinaryPath && args[0] === '--help') {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      }
      if (executable === workingBinaryPath && args[0] === '--help') {
        return {
          stdout: ['--host HOST', '--port PORT', '-m, --model FNAME'].join('\n'),
          stderr: ''
        };
      }
      throw new Error(`Unexpected command: ${executable}`);
    });
    const spawn = vi.fn(() => {
      spawned = true;
      return createFakeChild();
    });
    const harness = createLocalLaunchHarness({
      binaryPath: workingBinaryPath,
      execFileAsync,
      fetch: vi.fn(async () => ({ ok: spawned })),
      fs,
      process: {
        env: { LLAMA_SERVER_BIN: brokenBinaryPath },
        kill: vi.fn(),
        platform: 'darwin'
      },
      spawn
    });

    await expect(
      harness.controller.ensureLocalAdvisorServer(harness.settings)
    ).resolves.toMatchObject({ ok: true });

    expect(spawn.mock.calls[0][0]).toBe(workingBinaryPath);
    expect(execFileAsync).toHaveBeenCalledWith(
      brokenBinaryPath,
      ['--help'],
      expect.objectContaining({ timeout: 15000 })
    );
  });

  it('reports asynchronous spawn errors promptly and can retry the launch', async () => {
    let spawnCount = 0;
    const spawn = vi.fn(() => {
      spawnCount += 1;
      const child = createFakeChild(4100 + spawnCount);
      if (spawnCount === 1) {
        queueMicrotask(() => {
          const error = new Error('spawn EACCES');
          error.code = 'EACCES';
          child.emit('error', error);
        });
      }
      return child;
    });
    const harness = createLocalLaunchHarness({
      spawn,
      fetch: vi.fn(async () => ({ ok: spawnCount >= 2 }))
    });

    await expect(harness.controller.ensureLocalAdvisorServer(harness.settings)).rejects.toThrow(
      /Could not launch llama-server \(spawn EACCES\)/
    );
    await expect(
      harness.controller.ensureLocalAdvisorServer(harness.settings)
    ).resolves.toMatchObject({ ok: true });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(Buffer.concat(harness.fsSync.chunks).toString('utf8')).toContain(
      'llama-server process error: spawn EACCES'
    );
  });

  it('does not wait for the startup timeout after llama-server terminates by signal', async () => {
    const spawn = vi.fn(() => {
      const child = createFakeChild();
      queueMicrotask(() => {
        child.signalCode = 'SIGABRT';
        child.emit('exit', null, 'SIGABRT');
      });
      return child;
    });
    const harness = createLocalLaunchHarness({ spawn });
    let timeout = null;
    const launchResult = harness.controller.ensureLocalAdvisorServer(harness.settings).then(
      () => ({ resolved: true, error: null }),
      (error) => ({ resolved: false, error })
    );
    const raceResult = await Promise.race([
      launchResult,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), 100);
      })
    ]);
    clearTimeout(timeout);

    expect(raceResult).not.toMatchObject({ timedOut: true });
    expect(raceResult).toMatchObject({ resolved: false });
    expect(raceResult.error).toMatchObject({
      message: expect.stringContaining('SIGABRT')
    });
  });

  it('shares one startup operation when Start and Test race before preflight finishes', async () => {
    let releaseModelAccess = null;
    const modelAccessGate = new Promise((resolve) => {
      releaseModelAccess = resolve;
    });
    let spawned = false;
    const spawn = vi.fn(() => {
      spawned = true;
      return createFakeChild();
    });
    const harness = createLocalLaunchHarness({
      spawn,
      fetch: vi.fn(async () => ({ ok: spawned }))
    });
    const originalAccess = harness.fs.access.bind(harness.fs);
    harness.fs.access = vi.fn(async (filePath) => {
      if (filePath === harness.modelPath) {
        await modelAccessGate;
      }
      return originalAccess(filePath);
    });

    const firstStart = harness.controller.ensureLocalAdvisorServer(harness.settings);
    const concurrentTestStart = harness.controller.ensureLocalAdvisorServer(harness.settings);

    expect(concurrentTestStart).toBe(firstStart);
    expect(spawn).not.toHaveBeenCalled();
    releaseModelAccess();
    await expect(Promise.all([firstStart, concurrentTestStart])).resolves.toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight startup before it can spawn when Stop is pressed', async () => {
    let releaseModelAccess = null;
    const modelAccessGate = new Promise((resolve) => {
      releaseModelAccess = resolve;
    });
    const harness = createLocalLaunchHarness();
    const originalAccess = harness.fs.access.bind(harness.fs);
    harness.fs.access = vi.fn(async (filePath) => {
      if (filePath === harness.modelPath) {
        await modelAccessGate;
      }
      return originalAccess(filePath);
    });

    const startResult = harness.controller.ensureLocalAdvisorServer(harness.settings).then(
      () => ({ resolved: true, error: null }),
      (error) => ({ resolved: false, error })
    );
    await Promise.resolve();
    const stopPromise = harness.controller.stopLocalAdvisorProcess({
      wait: true,
      forceAfterMs: 25
    });

    await expect(
      Promise.race([
        stopPromise,
        new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 100))
      ])
    ).resolves.toEqual({ stopped: true });
    expect(harness.spawn).not.toHaveBeenCalled();

    releaseModelAccess();
    await expect(startResult).resolves.toMatchObject({
      resolved: false,
      error: {
        cavalryCancelled: true,
        code: 'ERR_CAVALRY_LOCAL_ADVISOR_START_CANCELLED'
      }
    });
  });

  it('rejects a concurrent Start until an in-flight Stop has confirmed exit', async () => {
    let spawned = false;
    let releaseExit = null;
    const child = createFakeChild();
    child.kill = vi.fn((signal = 'SIGTERM') => {
      child.killed = true;
      if (signal === 'SIGTERM') {
        releaseExit = () => child.finish(null, signal);
      }
      return true;
    });
    const harness = createLocalLaunchHarness({
      spawn: vi.fn(() => {
        spawned = true;
        return child;
      }),
      fetch: vi.fn(async () => ({ ok: spawned && child.exitCode === null }))
    });
    await harness.controller.ensureLocalAdvisorServer(harness.settings);

    const stopPromise = harness.controller.stopLocalAdvisorProcess({
      wait: true,
      forceAfterMs: 1000
    });
    await expect(harness.controller.ensureLocalAdvisorServer(harness.settings)).rejects.toThrow(
      'The local model server is being stopped.'
    );
    expect(harness.spawn).toHaveBeenCalledTimes(1);

    releaseExit();
    await expect(stopPromise).resolves.toEqual({ stopped: true });
  });

  it('escalates from SIGTERM to SIGKILL and waits for the confirmed child exit', async () => {
    let spawned = false;
    let exited = false;
    const child = createFakeChild();
    child.on('exit', () => {
      exited = true;
    });
    child.kill = vi.fn((signal = 'SIGTERM') => {
      child.killed = true;
      if (signal === 'SIGKILL') {
        queueMicrotask(() => child.finish(null, signal));
      }
      return true;
    });
    const harness = createLocalLaunchHarness({
      spawn: vi.fn(() => {
        spawned = true;
        return child;
      }),
      fetch: vi.fn(async () => ({ ok: spawned && !exited }))
    });
    await harness.controller.ensureLocalAdvisorServer(harness.settings);

    const result = await harness.controller.stopLocalAdvisorProcess({
      wait: true,
      forceAfterMs: 25
    });

    expect(result).toEqual({ stopped: true });
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(exited).toBe(true);
  });

  it('does not report a successful stop when the child remains alive after SIGKILL', async () => {
    let spawned = false;
    const child = createFakeChild();
    child.kill = vi.fn(() => {
      child.killed = true;
      return true;
    });
    const harness = createLocalLaunchHarness({
      spawn: vi.fn(() => {
        spawned = true;
        return child;
      }),
      fetch: vi.fn(async () => ({ ok: spawned }))
    });
    await harness.controller.ensureLocalAdvisorServer(harness.settings);

    await expect(
      harness.controller.stopLocalAdvisorProcess({
        wait: true,
        forceAfterMs: 25
      })
    ).rejects.toThrow('Could not confirm that local model server process 4100 stopped.');
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('does not treat a ChildProcess signal error as a confirmed exit', async () => {
    let spawned = false;
    const child = createFakeChild();
    child.kill = vi.fn((signal = 'SIGTERM') => {
      child.killed = true;
      queueMicrotask(() => child.emit('error', new Error(`could not deliver ${signal}`)));
      return true;
    });
    const process = {
      env: { LLAMA_SERVER_BIN: '/opt/homebrew/bin/llama-server' },
      kill: vi.fn((_pid, signal) => {
        if (signal === 0) return true;
        throw new Error('process is still alive');
      }),
      platform: 'darwin'
    };
    const harness = createLocalLaunchHarness({
      process,
      spawn: vi.fn(() => {
        spawned = true;
        return child;
      }),
      fetch: vi.fn(async () => ({ ok: spawned }))
    });
    await harness.controller.ensureLocalAdvisorServer(harness.settings);

    await expect(
      harness.controller.stopLocalAdvisorProcess({
        wait: true,
        forceAfterMs: 25
      })
    ).rejects.toThrow('Could not confirm that local model server process 4100 stopped.');
    expect(child.exitCode).toBeNull();
    expect(process.kill).toHaveBeenCalledWith(4100, 0);
  });

  it('does not SIGKILL a replacement process that reuses an adopted PID', async () => {
    let matchesOriginalProcess = true;
    const process = {
      kill: vi.fn((_pid, signal) => {
        if (signal === 'SIGTERM') matchesOriginalProcess = false;
        return true;
      })
    };
    const lifecycle = createAdvisorLocalProcessLifecycle({ process });

    await expect(
      lifecycle.stopPid(7331, {
        wait: true,
        forceAfterMs: 25,
        validateIdentity: async () => matchesOriginalProcess
      })
    ).resolves.toBe(true);

    expect(process.kill).toHaveBeenCalledWith(7331, 'SIGTERM');
    expect(process.kill).not.toHaveBeenCalledWith(7331, 'SIGKILL');
  });

  it('stops the tracked server even after the saved model changes its server key', async () => {
    const child = createFakeChild();
    let spawned = false;
    let exited = false;
    child.on('exit', () => {
      exited = true;
    });
    const harness = createLocalLaunchHarness({
      spawn: vi.fn(() => {
        spawned = true;
        return child;
      }),
      fetch: vi.fn(async () => ({ ok: spawned && !exited }))
    });
    await harness.controller.saveAdvisorSettings(harness.settings);
    await harness.controller.ensureLocalAdvisorServer(harness.settings);

    const replacementModelPath = '/Models/replacement-model.gguf';
    harness.fs.files.set(replacementModelPath, 'replacement GGUF model');
    await harness.controller.saveAdvisorSettings({
      ...harness.settings,
      localModelPath: replacementModelPath
    });

    const result = await harness.controller.stopLocalAdvisorServerForSavedSettings({
      wait: true,
      forceAfterMs: 25
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exited).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      status: {
        running: false,
        starting: false
      },
      message: 'Local model server stopped.'
    });
  });

  it('revalidates an adopted PID identity before signaling it', async () => {
    const adoptedPid = 7331;
    const binaryPath = '/opt/homebrew/bin/llama-server';
    const modelPath = '/Models/local-model.gguf';
    let command = `${binaryPath} --host 127.0.0.1 --port 8080 -m ${modelPath} --ctx-size 8192`;
    let healthy = true;
    const execFileAsync = vi.fn(async (executable, args) => {
      if (executable === 'lsof') return { stdout: `p${adoptedPid}\n`, stderr: '' };
      if (executable === 'ps') return { stdout: `1 ${command}\n`, stderr: '' };
      if (executable === 'which') return { stdout: `${binaryPath}\n`, stderr: '' };
      if (executable === binaryPath && args[0] === '--help') {
        return { stdout: '--host HOST\n--port PORT\n-m, --model FNAME\n', stderr: '' };
      }
      throw new Error(`Unexpected command: ${executable}`);
    });
    const process = {
      env: { LLAMA_SERVER_BIN: binaryPath },
      kill: vi.fn(() => true),
      platform: 'darwin'
    };
    const harness = createLocalLaunchHarness({
      binaryPath,
      execFileAsync,
      fetch: vi.fn(async () => ({ ok: healthy })),
      modelPath,
      process
    });
    await harness.controller.saveAdvisorSettings(harness.settings);
    await expect(
      harness.controller.getLocalAdvisorServerStatus(harness.settings)
    ).resolves.toMatchObject({
      running: true,
      source: 'adopted',
      pid: adoptedPid
    });

    command = '/usr/bin/sleep 999';
    healthy = false;
    await expect(
      harness.controller.stopLocalAdvisorServerForSavedSettings({
        wait: true,
        forceAfterMs: 25
      })
    ).resolves.toMatchObject({
      ok: true,
      status: { running: false }
    });

    expect(
      process.kill.mock.calls.filter(([, signal]) => signal === 'SIGTERM' || signal === 'SIGKILL')
    ).toHaveLength(0);
  });

  it('fails Stop when the configured endpoint remains live after the tracked PID exits', async () => {
    let spawned = false;
    const child = createFakeChild();
    const harness = createLocalLaunchHarness({
      spawn: vi.fn(() => {
        spawned = true;
        return child;
      }),
      fetch: vi.fn(async () => ({ ok: spawned }))
    });
    await harness.controller.saveAdvisorSettings(harness.settings);
    await harness.controller.ensureLocalAdvisorServer(harness.settings);

    await expect(
      harness.controller.stopLocalAdvisorServerForSavedSettings({
        wait: true,
        forceAfterMs: 25
      })
    ).rejects.toMatchObject({
      code: 'ADVISOR_LOCAL_MODEL_STILL_RUNNING',
      message: expect.stringContaining('still responding')
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects file formats that llama-server cannot load before spawning', async () => {
    const harness = createLocalLaunchHarness({ modelPath: '/Models/local-model.safetensors' });

    await expect(harness.controller.ensureLocalAdvisorServer(harness.settings)).rejects.toThrow(
      'The local advisor requires a GGUF model file.'
    );
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it('blocks a proven model/projector mismatch before spawning or saving it', async () => {
    const mmprojPath = '/Models/qwen-9b-mmproj.gguf';
    const inspectGgufCompatibility = vi.fn(async () => ({
      status: 'incompatible',
      compatible: false,
      reason: 'dimension-mismatch',
      message:
        'Qwen3.5-9B expects a 4096-dimension text model, but Qwen3.5-4B uses 2560. Choose a matching vision projector or leave the projector empty.',
      model: { embeddingDimension: 2560 },
      projector: { projectionDimension: 4096 }
    }));
    const harness = createLocalLaunchHarness({ inspectGgufCompatibility });
    harness.fs.files.set(mmprojPath, 'GGUF projector');
    const settings = { ...harness.settings, mmprojPath };

    await expect(harness.controller.ensureLocalAdvisorServer(settings)).rejects.toMatchObject({
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      message: expect.stringContaining('Qwen3.5-9B expects a 4096-dimension text model'),
      detail: expect.stringContaining('Model dimension: 2560')
    });
    await expect(harness.controller.saveAdvisorSettings(settings)).rejects.toMatchObject({
      code: 'ADVISOR_PROJECTOR_MISMATCH'
    });

    expect(inspectGgufCompatibility).toHaveBeenCalledWith({
      modelPath: harness.modelPath,
      mmprojPath
    });
    expect(harness.spawn).not.toHaveBeenCalled();
    expect(
      harness.fs.files.has('/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json')
    ).toBe(false);
  });

  it('auto-selects only the single metadata-compatible adjacent projector', async () => {
    const fs = createMemoryFs();
    fs.readdir = vi.fn(async () => ['mmproj-F16.gguf', 'mmproj-qwen-4b.gguf', 'notes.txt']);
    const inspectGgufCompatibility = vi.fn(async ({ mmprojPath }) => ({
      status: mmprojPath.endsWith('mmproj-qwen-4b.gguf') ? 'compatible' : 'incompatible',
      reason: mmprojPath.endsWith('mmproj-qwen-4b.gguf') ? 'metadata-match' : 'dimension-mismatch'
    }));
    const { controller } = createController({ fs, inspectGgufCompatibility });

    await expect(controller.findAdjacentMmprojPath('/Models/qwen-4b.gguf')).resolves.toBe(
      '/Models/mmproj-qwen-4b.gguf'
    );
    expect(inspectGgufCompatibility).toHaveBeenCalledTimes(2);
  });

  it('leaves the projector empty when adjacent metadata is incompatible or inconclusive', async () => {
    const fs = createMemoryFs();
    fs.readdir = vi.fn(async () => ['mmproj-F16.gguf', 'mmproj-unknown.gguf']);
    const inspectGgufCompatibility = vi.fn(async ({ mmprojPath }) => ({
      status: mmprojPath.endsWith('mmproj-F16.gguf') ? 'incompatible' : 'unknown'
    }));
    const { controller } = createController({ fs, inspectGgufCompatibility });

    await expect(controller.findAdjacentMmprojPath('/Models/qwen-4b.gguf')).resolves.toBe('');
  });

  it('does not auto-select a projector from identity alone without a verified dimension match', async () => {
    const fs = createMemoryFs();
    fs.readdir = vi.fn(async () => ['mmproj-qwen-4b.gguf']);
    const inspectGgufCompatibility = vi.fn(async () => ({
      status: 'compatible',
      reason: 'identity-match'
    }));
    const { controller } = createController({ fs, inspectGgufCompatibility });

    await expect(controller.findAdjacentMmprojPath('/Models/qwen-4b.gguf')).resolves.toBe('');
  });

  it('registers the complete narrow IPC contract exactly once', () => {
    const { controller, ipcMain } = createController();

    expect([...ADVISOR_IPC_CHANNELS]).toEqual(EXPECTED_ADVISOR_CHANNELS);
    expect(controller.registerHandlers()).toEqual({ channels: EXPECTED_ADVISOR_CHANNELS });
    expect([...ipcMain.handlers.keys()]).toEqual(EXPECTED_ADVISOR_CHANNELS);
    expect(new Set(ipcMain.handlers.keys()).size).toBe(ADVISOR_IPC_CHANNELS.length);
  });

  it('checks the trusted renderer before every Advisor command', () => {
    const { controller, ipcMain } = createController({
      assertTrustedSender: () => {
        throw new Error('untrusted renderer');
      }
    });
    controller.registerHandlers();

    ipcMain.handlers.forEach((handler) => {
      expect(() => handler({ sender: {} }, {})).toThrow('untrusted renderer');
    });
  });

  it('uses injected filesystem dependencies for settings persistence', async () => {
    const { controller, fs } = createController();
    const saved = await controller.saveAdvisorSettings({
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-controller-test'
    });
    const loaded = await controller.loadAdvisorRuntimeSettings();

    expect(saved).toMatchObject({
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-controller-test'
    });
    expect(loaded).toMatchObject(saved);
    expect([...fs.files.keys()]).toEqual([
      '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json'
    ]);
  });

  it('does not apply GGUF validation to OpenAI settings', async () => {
    const inspectGgufCompatibility = vi.fn(async () => {
      throw new Error('GGUF inspection must not run for OpenAI.');
    });
    const { controller } = createController({ inspectGgufCompatibility });

    await expect(
      controller.saveAdvisorSettings({
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: 'sk-controller-test'
      })
    ).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-5-mini'
    });
    expect(inspectGgufCompatibility).not.toHaveBeenCalled();
  });

  it('loads local-model-only settings without touching secure storage', async () => {
    const settingsPath = '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json';
    const localSettings = {
      provider: 'custom',
      providerKind: 'local_model',
      apiMode: 'chat_completions',
      endpoint: 'http://127.0.0.1:8080/v1',
      model: 'local-model',
      localModelPath: '/Models/local-model.gguf',
      contextWindowTokens: 8192
    };
    const fs = createMemoryFs();
    fs.files.set(settingsPath, JSON.stringify(localSettings));
    const safeStorage = createSecureStorage({
      isEncryptionAvailable: vi.fn(() => true),
      getSelectedStorageBackend: vi.fn(() => 'keychain'),
      encryptString: vi.fn((value) => Buffer.from('enc:' + value, 'utf8')),
      decryptString: vi.fn()
    });
    const { controller } = createController({ fs, safeStorage });

    await expect(controller.loadAdvisorRuntimeSettings()).resolves.toMatchObject(localSettings);

    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(safeStorage.getSelectedStorageBackend).not.toHaveBeenCalled();
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
    expect(fs.files.get(settingsPath)).toBe(JSON.stringify(localSettings));
  });

  it('encrypts the API key at rest when safeStorage is available', async () => {
    const safeStorage = createSecureStorage();
    const { controller, fs } = createController({ safeStorage });

    await controller.saveAdvisorSettings({
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-at-rest-secret'
    });

    const raw = fs.files.get('/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json');
    expect(raw).not.toContain('sk-at-rest-secret');
    expect(JSON.parse(raw)).toMatchObject({
      apiKeyEncrypted: Buffer.from('enc:sk-at-rest-secret', 'utf8').toString('base64')
    });
    expect(JSON.parse(raw)).not.toHaveProperty('apiKey');
    expect(fs.modes.get('/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json')).toBe(
      0o600
    );
    expect([...fs.files.keys()]).not.toContain(
      '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json.tmp'
    );

    const loaded = await controller.loadAdvisorRuntimeSettings();
    expect(loaded.apiKey).toBe('sk-at-rest-secret');
  });

  it('migrates legacy plaintext keys and drops undecryptable ciphertext without failing', async () => {
    const safeStorage = createSecureStorage({
      decryptString: () => {
        throw new Error('keychain unavailable');
      }
    });
    const fs = createMemoryFs();
    fs.files.set(
      '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json',
      JSON.stringify({ provider: 'openai', model: 'gpt-5-mini', apiKey: 'sk-legacy-plaintext' })
    );
    const { controller } = createController({ fs, safeStorage });

    const legacy = await controller.loadAdvisorRuntimeSettings();
    expect(legacy.apiKey).toBe('sk-legacy-plaintext');
    const migrated = fs.files.get(
      '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json'
    );
    expect(migrated).not.toContain('sk-legacy-plaintext');
    expect(JSON.parse(migrated)).toHaveProperty('apiKeyEncrypted');
    expect(JSON.parse(migrated)).not.toHaveProperty('apiKey');

    fs.files.set(
      '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json',
      JSON.stringify({ provider: 'openai', model: 'gpt-5-mini', apiKeyEncrypted: 'Y29ycnVwdA==' })
    );
    const recovered = await controller.loadAdvisorRuntimeSettings();
    expect(recovered.apiKey).toBeFalsy();
    expect(recovered.provider).toBe('openai');
  });

  it('rejects insecure API-key persistence and removes legacy plaintext without using it', async () => {
    for (const safeStorage of [
      null,
      createSecureStorage({ getSelectedStorageBackend: () => 'basic_text' })
    ]) {
      const fs = createMemoryFs();
      const settingsPath = '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json';
      fs.files.set(
        settingsPath,
        JSON.stringify({ provider: 'openai', model: 'gpt-5-mini', apiKey: 'sk-legacy-unsafe' })
      );
      const { controller } = createController({ fs, safeStorage });

      const loaded = await controller.loadAdvisorRuntimeSettings();
      expect(loaded.apiKey).toBeFalsy();
      expect(fs.files.get(settingsPath)).not.toContain('sk-legacy-unsafe');
      expect(JSON.parse(fs.files.get(settingsPath))).not.toHaveProperty('apiKey');
      await expect(
        controller.saveAdvisorSettings({
          provider: 'openai',
          model: 'gpt-5-mini',
          apiKey: 'sk-must-not-persist'
        })
      ).rejects.toThrow(/secure operating-system credential storage/i);
      expect(fs.files.get(settingsPath)).not.toContain('sk-must-not-persist');
    }
  });

  it('removes encrypted key material when only a weak storage backend is available', async () => {
    const fs = createMemoryFs();
    const settingsPath = '/tmp/cavalry-advisor-controller-test/cavalry-advisor-settings.json';
    fs.files.set(
      settingsPath,
      JSON.stringify({
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKeyEncrypted: Buffer.from('basic-text:key-material', 'utf8').toString('base64')
      })
    );
    const { controller } = createController({
      fs,
      safeStorage: createSecureStorage({ getSelectedStorageBackend: () => 'basic_text' })
    });

    const loaded = await controller.loadAdvisorRuntimeSettings();
    const persisted = fs.files.get(settingsPath);
    expect(loaded.apiKey).toBeFalsy();
    expect(persisted).not.toContain('basic-text:key-material');
    expect(JSON.parse(persisted)).not.toHaveProperty('apiKey');
    expect(JSON.parse(persisted)).not.toHaveProperty('apiKeyEncrypted');
    expect(fs.modes.get(settingsPath)).toBe(0o600);
  });

  it('forwards Chat Completions tools and returns scrubbed structured tool-call messages', async () => {
    const requests = [];
    const { controller, ipcMain } = createController({
      fetch: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_accounts',
                        type: 'function',
                        token: 'provider-tool-token',
                        function: {
                          name: 'lookup_accounts',
                          arguments: '{"query":"Cash"}',
                          apiKey: 'sk-provider-tool-leak'
                        }
                      }
                    ]
                  }
                }
              ]
            })
        };
      }
    });
    await controller.saveAdvisorSettings({
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-controller-secret'
    });
    controller.registerHandlers();

    const tools = [
      {
        type: 'function',
        function: {
          name: 'lookup_accounts',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false
          }
        }
      }
    ];
    const result = await ipcMain.handlers.get('cavalry-advisor:chat')(null, {
      requestId: 'chat_tools',
      messages: [{ role: 'user', content: 'Find my cash account.' }],
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      returnMessage: true
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(requests[0].options.body)).toMatchObject({
      model: 'gpt-5-mini',
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true
    });
    expect(result).toEqual({
      ok: true,
      text: '',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_accounts',
            type: 'function',
            function: {
              name: 'lookup_accounts',
              arguments: '{"query":"Cash"}'
            }
          }
        ]
      }
    });
    expect(JSON.stringify(result)).not.toContain('provider-tool-token');
    expect(JSON.stringify(result)).not.toContain('sk-provider-tool-leak');
    expect(JSON.stringify(result)).not.toContain('sk-controller-secret');
  });

  it('preserves plain chat responses and rejects empty non-tool responses', async () => {
    const providerResponses = [
      {
        choices: [{ message: { role: 'assistant', content: 'Legacy plain response.' } }]
      },
      {
        choices: [{ message: { role: 'assistant', content: '' } }]
      }
    ];
    const { controller } = createController({
      fetch: async () => ({
        ok: true,
        text: async () => JSON.stringify(providerResponses.shift())
      })
    });
    const settings = {
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-5-mini',
      apiKey: 'sk-controller-secret'
    };

    await expect(
      controller.callAdvisorModel(settings, {
        requestId: 'chat_plain',
        messages: [{ role: 'user', content: 'Hello.' }]
      })
    ).resolves.toBe('Legacy plain response.');
    await expect(
      controller.callAdvisorModel(settings, {
        requestId: 'chat_empty',
        messages: [{ role: 'user', content: 'Hello?' }],
        returnMessage: true
      })
    ).rejects.toThrow('The model response did not include a message.');
  });

  it('preserves legacy top-level response payloads in plain and structured results', async () => {
    const providerResponses = [
      { response: 'Legacy top-level response.' },
      { response: 'Structured legacy response.' }
    ];
    const { controller } = createController({
      fetch: async () => ({
        ok: true,
        text: async () => JSON.stringify(providerResponses.shift())
      })
    });
    const settings = {
      provider: 'openai',
      endpoint: 'https://example.invalid/v1/chat/completions',
      model: 'local-model',
      apiKey: 'sk-controller-secret'
    };

    await expect(
      controller.callAdvisorModel(settings, {
        requestId: 'chat_legacy_top_level',
        messages: [{ role: 'user', content: 'Hello.' }]
      })
    ).resolves.toBe('Legacy top-level response.');
    await expect(
      controller.callAdvisorModel(settings, {
        requestId: 'chat_legacy_top_level_structured',
        messages: [{ role: 'user', content: 'Hello again.' }],
        returnMessage: true
      })
    ).resolves.toEqual({
      text: 'Structured legacy response.',
      message: {
        role: 'assistant',
        content: 'Structured legacy response.',
        tool_calls: []
      },
      usage: null
    });
  });

  it('keeps model-selection dialogs inside the controller IPC adapter', async () => {
    const ipcMain = createIpcMain();
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    const { controller } = createController({
      ipcMain,
      dialog: { showOpenDialog }
    });
    controller.registerHandlers();

    await expect(ipcMain.handlers.get('cavalry-advisor:choose-local-model')()).resolves.toEqual({
      ok: false,
      canceled: true
    });
    await expect(ipcMain.handlers.get('cavalry-advisor:choose-mmproj')()).resolves.toEqual({
      ok: false,
      canceled: true
    });
    expect(showOpenDialog.mock.calls[0][0].filters).toEqual([
      { name: 'GGUF Model Files', extensions: ['gguf'] },
      { name: 'All Files', extensions: ['*'] }
    ]);
  });

  it('keeps saved credentials in the main process and scrubs structured provider responses', async () => {
    const { controller, ipcMain } = createController({
      fetch: async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 'resp_safe',
            apiKey: 'sk-provider-leak',
            nested: {
              token: 'provider-token',
              label: 'safe'
            }
          })
      })
    });
    await controller.saveAdvisorSettings({
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-controller-secret'
    });
    controller.registerHandlers();

    const settingsResponse = await ipcMain.handlers.get('cavalry-advisor:get-settings')();
    const agentResponse = await ipcMain.handlers.get('cavalry-advisor:agent')(null, {
      requestId: 'request_safe',
      input: 'Summarize the workbook.'
    });

    expect(settingsResponse).toMatchObject({
      ok: true,
      settings: {
        provider: 'openai',
        hasApiKey: true
      }
    });
    expect(agentResponse).toEqual({
      ok: true,
      response: {
        id: 'resp_safe',
        nested: { label: 'safe' }
      }
    });
    expect(JSON.stringify({ settingsResponse, agentResponse })).not.toContain(
      'sk-controller-secret'
    );
    expect(JSON.stringify(agentResponse)).not.toContain('sk-provider-leak');
    expect(JSON.stringify(agentResponse)).not.toContain('provider-token');
  });

  it('uses the current message connection when saved provider state is stale', async () => {
    const { controller, ipcMain } = createController({
      inspectGgufCompatibility: vi.fn(async () => ({
        status: 'compatible',
        compatible: true,
        reason: 'text-only'
      })),
      fetch: async () => ({
        ok: true,
        text: async () => JSON.stringify({ id: 'resp_current', output: [] })
      })
    });
    await controller.saveAdvisorSettings({
      provider: 'custom',
      localModelPath: '/models/stale.gguf',
      apiKey: 'sk-saved-for-openai'
    });
    controller.registerHandlers();

    const result = await ipcMain.handlers.get('cavalry-advisor:agent')(null, {
      requestId: 'request_current',
      connection: {
        provider: 'openai',
        apiMode: 'responses',
        model: 'gpt-5.4-mini'
      },
      input: 'Hello.'
    });

    expect(result).toMatchObject({ ok: true, response: { id: 'resp_current' } });
  });

  it('persists the configuration that successfully reaches Test Model', async () => {
    const { controller, ipcMain } = createController({
      fetch: async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 'resp_test',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'Model test passed.' }]
              }
            ]
          })
      })
    });
    controller.registerHandlers();

    await expect(
      ipcMain.handlers.get('cavalry-advisor:test')(null, {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        apiKey: 'sk-test-save'
      })
    ).resolves.toMatchObject({ ok: true, message: 'Model test passed.' });

    await expect(controller.loadAdvisorRuntimeSettings()).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      apiKey: 'sk-test-save'
    });
  });
});
