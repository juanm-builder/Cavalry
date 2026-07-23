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

  it('keeps model-selection dialogs inside the controller IPC adapter', async () => {
    const ipcMain = createIpcMain();
    const { controller } = createController({ ipcMain });
    controller.registerHandlers();

    await expect(ipcMain.handlers.get('cavalry-advisor:choose-local-model')()).resolves.toEqual({
      ok: false,
      canceled: true
    });
    await expect(ipcMain.handlers.get('cavalry-advisor:choose-mmproj')()).resolves.toEqual({
      ok: false,
      canceled: true
    });
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
