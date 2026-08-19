import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAdvisorRuntimeController } = require('../../src/host/advisor-runtime-controller.cjs');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    }
  };
}

function createMemoryFs() {
  const files = new Map();
  return {
    async readFile(filePath) {
      if (!files.has(String(filePath))) {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(String(filePath));
    },
    async writeFile(filePath, contents) {
      files.set(String(filePath), String(contents));
    },
    async mkdir() {},
    async rename(from, to) {
      files.set(String(to), files.get(String(from)));
      files.delete(String(from));
    },
    async chmod() {},
    async unlink(filePath) {
      files.delete(String(filePath));
    }
  };
}

function sseBody(frames) {
  const encoder = new TextEncoder();
  const chunks = frames.map((frame) => encoder.encode(frame));
  let index = 0;
  return {
    getReader: () => ({
      read: async () =>
        index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
      releaseLock: () => {}
    })
  };
}

function streamResponse(frames) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: sseBody(frames)
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(payload)
  };
}

function makeController(fetchImpl, extra = {}) {
  const ipcMain = createIpcMain();
  const controller = createAdvisorRuntimeController({
    app: { getPath: () => '/tmp/cavalry-advisor-streaming-test' },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ipcMain,
    shell: { openExternal: async () => {} },
    systemPreferences: {
      getMediaAccessStatus: () => 'granted',
      askForMediaAccess: async () => true
    },
    fs: createMemoryFs(),
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'keychain',
      encryptString: (value) => Buffer.from(`sealed:${value}`),
      decryptString: (buffer) => String(buffer).replace(/^sealed:/, '')
    },
    assertTrustedSender: () => true,
    fetch: fetchImpl,
    advisorRetryDelaysMs: [0, 0],
    ...extra
  });
  return { controller, ipcMain };
}

const OPENAI_SETTINGS = {
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-5-mini',
  apiKey: 'sk-streaming-test'
};

function captureStatusEvent() {
  const events = [];
  return {
    events,
    event: { sender: { isDestroyed: () => false, send: (_channel, status) => events.push(status) } }
  };
}

describe('advisor streaming runtime', () => {
  it('streams chat text to the renderer and returns the assembled message', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"role":"assistant","content":"Your net worth "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"is steady."}}]}\n\n',
        'data: {"usage":{"total_tokens":81},"choices":[]}\n\n',
        'data: [DONE]\n\n'
      ])
    );
    const { controller } = makeController(fetchImpl);
    const { events, event } = captureStatusEvent();

    const result = await controller.callAdvisorModel(
      OPENAI_SETTINGS,
      {
        requestId: 'stream_turn',
        messages: [{ role: 'user', content: 'How am I doing?' }],
        returnMessage: true,
        stream: true
      },
      event
    );

    expect(result).toMatchObject({
      text: 'Your net worth is steady.',
      message: { role: 'assistant', content: 'Your net worth is steady.', tool_calls: [] },
      usage: { total_tokens: 81 }
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });

    const streamEvents = events.filter((entry) => entry.phase === 'stream');
    expect(streamEvents.map((entry) => entry.delta)).toEqual(['Your net worth ', 'is steady.']);
    // Every delta must be attributable, or concurrent turns cross-talk in the renderer.
    expect(streamEvents.every((entry) => entry.requestId === 'stream_turn')).toBe(true);
  });

  it('falls back to a buffered request when an endpoint rejects streaming', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ error: { message: 'stream with tools unsupported' } })
      })
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Buffered answer.' } }] })
      );
    const { controller } = makeController(fetchImpl);

    const result = await controller.callAdvisorModel(
      OPENAI_SETTINGS,
      {
        requestId: 'stream_downgrade',
        messages: [{ role: 'user', content: 'Hello.' }],
        stream: true
      },
      null
    );

    expect(result).toBe('Buffered answer.');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).stream).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).stream).toBeUndefined();
  });

  it('retries a transient 503 and succeeds without user-visible failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => 'application/json' },
        text: async () => 'temporarily unavailable'
      })
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Recovered.' } }] })
      );
    const { controller } = makeController(fetchImpl);

    await expect(
      controller.callAdvisorModel(
        OPENAI_SETTINGS,
        { requestId: 'retry_turn', messages: [{ role: 'user', content: 'Hi.' }] },
        null
      )
    ).resolves.toBe('Recovered.');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a response that fails without a retryable status', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }));
    const { controller } = makeController(fetchImpl);

    await expect(
      controller.callAdvisorModel(
        OPENAI_SETTINGS,
        { requestId: 'no_retry_turn', messages: [{ role: 'user', content: 'Hi.' }] },
        null
      )
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a client error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: 'bad request' } }, { ok: false, status: 400 })
    );
    const { controller } = makeController(fetchImpl);

    await expect(
      controller.callAdvisorModel(
        OPENAI_SETTINGS,
        { requestId: 'client_error_turn', messages: [{ role: 'user', content: 'Hi.' }] },
        null
      )
    ).rejects.toThrow('bad request');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('streams a Responses agent turn and returns the completed response', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        'data: {"type":"response.output_text.delta","delta":"Checking"}\n\n',
        'data: {"type":"response.output_text.delta","delta":" your books"}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_9","output":[]}}\n\n'
      ])
    );
    const { controller } = makeController(fetchImpl);
    const { events, event } = captureStatusEvent();

    const result = await controller.callAdvisorAgentTurn(
      { ...OPENAI_SETTINGS, endpoint: 'https://api.openai.com/v1/responses' },
      {
        requestId: 'agent_stream',
        input: [{ role: 'user', content: 'Review my spending.' }],
        stream: true
      },
      event
    );

    expect(result).toMatchObject({ id: 'resp_9' });
    expect(events.filter((entry) => entry.phase === 'stream').map((entry) => entry.delta)).toEqual([
      'Checking',
      ' your books'
    ]);
  });

  it('reports a neutral timeout message that does not claim a workbook fallback', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    });
    const { controller } = makeController(fetchImpl);

    await expect(
      controller.callAdvisorModel(
        OPENAI_SETTINGS,
        { requestId: 'timeout_turn', messages: [{ role: 'user', content: 'Hi.' }] },
        null
      )
    ).rejects.toThrow(
      'The model did not answer within 5 minutes. Try again, or check the model connection in Settings.'
    );
  });
});
