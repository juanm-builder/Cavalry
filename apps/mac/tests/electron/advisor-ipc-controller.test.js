import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAdvisorIpcController,
  normalizeAdvisorIpcError
} = require('../../src/main/advisor-ipc-controller.cjs');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: vi.fn((channel, handler) => handlers.set(channel, handler))
  };
}

function createRuntime(overrides = {}) {
  const saved = { provider: 'custom', localModelPath: '/models/old.gguf' };
  return {
    normalizeAdvisorSettings: vi.fn((payload, existing) => ({ ...existing, ...payload })),
    publicAdvisorSettings: vi.fn((settings) => settings),
    loadAdvisorRuntimeSettings: vi.fn(async () => saved),
    saveAdvisorSettings: vi.fn(async (settings) => settings),
    getLocalAdvisorServerStatus: vi.fn(async () => ({
      running: false,
      starting: false,
      manageable: true,
      message: 'Local model server is stopped.'
    })),
    ensureLocalAdvisorServer: vi.fn(async () => ({ ok: true, message: 'Local model started.' })),
    stopLocalAdvisorServer: vi.fn(async () => ({ ok: true })),
    findAdjacentMmprojPath: vi.fn(async () => ''),
    assertAdvisorLocalModelCompatibility: vi.fn(async () => ({
      status: 'compatible',
      reason: 'text-only'
    })),
    callAdvisorModel: vi.fn(async () => 'Model test passed.'),
    callAdvisorAgentTurn: vi.fn(async () => ({
      output_text: 'Model test passed.'
    })),
    callAdvisorTranscription: vi.fn(),
    cancelAdvisorRequest: vi.fn(),
    normalizeAdvisorRequestId: vi.fn((value) => String(value || '')),
    isAdvisorCancellationError: vi.fn(() => false),
    isAdvisorTimeoutError: vi.fn(() => false),
    getAdvisorMicrophoneAccessStatus: vi.fn(),
    requestAdvisorMicrophoneAccess: vi.fn(),
    openAdvisorMicrophoneSettings: vi.fn(),
    ...overrides
  };
}

function registerRuntime(
  runtime,
  dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }
) {
  const ipcMain = createIpcMain();
  createAdvisorIpcController({
    ipcMain,
    dialog,
    runtime,
    assertTrustedSender: vi.fn()
  }).registerHandlers();
  return ipcMain.handlers;
}

describe('Advisor lifecycle IPC', () => {
  it('normalizes Electron wrapper errors into a concise result', () => {
    expect(
      normalizeAdvisorIpcError(
        new Error(
          "Error invoking remote method 'cavalry-advisor:test': Error: Projector is incompatible."
        )
      )
    ).toEqual({
      ok: false,
      error: 'Projector is incompatible.',
      code: 'ADVISOR_OPERATION_FAILED'
    });
  });

  it('does not persist a configuration when Start fails validation or launch', async () => {
    const error = Object.assign(new Error('The selected vision projector is incompatible.'), {
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      detail: 'model dimension 2560; projector dimension 4096',
      logPath: '/private/cavalry-llama-server.log'
    });
    const runtime = createRuntime({
      ensureLocalAdvisorServer: vi.fn(async () => {
        throw error;
      })
    });
    const handlers = registerRuntime(runtime);

    await expect(
      handlers.get('cavalry-advisor:start-server')(null, {
        localModelPath: '/models/qwen-4b.gguf',
        mmprojPath: '/models/qwen-9b-mmproj.gguf'
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      error: 'The selected vision projector is incompatible.',
      detail: 'model dimension 2560; projector dimension 4096',
      logPath: '/private/cavalry-llama-server.log',
      status: { running: false }
    });
    expect(runtime.saveAdvisorSettings).not.toHaveBeenCalled();
    expect(runtime.getLocalAdvisorServerStatus).toHaveBeenCalledTimes(1);
  });

  it('returns a structured compatibility error when Save rejects the projector', async () => {
    const runtime = createRuntime({
      saveAdvisorSettings: vi.fn(async () => {
        throw Object.assign(new Error('The projector is for a different model.'), {
          code: 'ADVISOR_PROJECTOR_MISMATCH'
        });
      })
    });
    const handlers = registerRuntime(runtime);

    await expect(
      handlers.get('cavalry-advisor:save-settings')(null, {
        provider: 'custom',
        localModelPath: '/models/qwen-4b.gguf',
        mmprojPath: '/models/qwen-9b-mmproj.gguf'
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      error: 'The projector is for a different model.',
      status: { running: false }
    });
  });

  it('persists Test settings only after a successful model response', async () => {
    const callOrder = [];
    const runtime = createRuntime({
      ensureLocalAdvisorServer: vi.fn(async () => {
        callOrder.push('start');
        return { ok: true };
      }),
      callAdvisorModel: vi.fn(async () => {
        callOrder.push('test');
        return 'Model test passed.';
      }),
      saveAdvisorSettings: vi.fn(async (settings, options) => {
        callOrder.push('save');
        expect(options).toEqual({ allowActiveLocalConfiguration: true });
        return settings;
      })
    });
    const handlers = registerRuntime(runtime);

    await expect(
      handlers.get('cavalry-advisor:test')(null, {
        provider: 'custom',
        localModelPath: '/models/qwen-4b.gguf',
        mmprojPath: ''
      })
    ).resolves.toMatchObject({
      ok: true,
      message: 'Model test passed.',
      settings: {
        provider: 'custom',
        localModelPath: '/models/qwen-4b.gguf',
        mmprojPath: ''
      },
      status: { running: false }
    });
    expect(callOrder).toEqual(['test', 'save']);
  });

  it('does not persist a failed Test configuration and returns refreshed status', async () => {
    const runtime = createRuntime({
      callAdvisorModel: vi.fn(async () => {
        throw new Error('The model test returned no text.');
      })
    });
    const handlers = registerRuntime(runtime);

    await expect(
      handlers.get('cavalry-advisor:test')(null, {
        provider: 'custom',
        localModelPath: '/models/qwen-4b.gguf'
      })
    ).resolves.toMatchObject({
      ok: false,
      error: 'The model test returned no text.',
      status: { running: false }
    });
    expect(runtime.saveAdvisorSettings).not.toHaveBeenCalled();
  });

  it('normalizes model-picker and status errors instead of leaking Electron wrappers', async () => {
    const runtime = createRuntime({
      findAdjacentMmprojPath: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'cavalry-advisor:choose-local-model': Error: The selected model is unreadable."
        );
      }),
      getLocalAdvisorServerStatus: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'cavalry-advisor:get-server-status': Error: Status unavailable."
        );
      })
    });
    const handlers = registerRuntime(runtime, {
      showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: ['/models/qwen.gguf']
      }))
    });

    await expect(
      handlers.get('cavalry-advisor:choose-local-model')(null, {})
    ).resolves.toMatchObject({
      ok: false,
      error: 'The selected model is unreadable.'
    });
    await expect(
      handlers.get('cavalry-advisor:get-server-status')(null, {})
    ).resolves.toMatchObject({
      ok: false,
      error: 'Status unavailable.'
    });
  });

  it('validates a selected projector against the current text model before returning it', async () => {
    const runtime = createRuntime({
      assertAdvisorLocalModelCompatibility: vi.fn(async () => {
        throw Object.assign(new Error('The projector is for a different model.'), {
          code: 'ADVISOR_PROJECTOR_MISMATCH'
        });
      })
    });
    const handlers = registerRuntime(runtime, {
      showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: ['/models/mmproj-qwen-9b.gguf']
      }))
    });

    await expect(
      handlers.get('cavalry-advisor:choose-mmproj')(null, {
        provider: 'custom',
        localModelPath: '/models/qwen-4b.gguf'
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      error: 'The projector is for a different model.'
    });
    expect(runtime.assertAdvisorLocalModelCompatibility).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'custom',
        localModelPath: '/models/qwen-4b.gguf',
        mmprojPath: '/models/mmproj-qwen-9b.gguf'
      })
    );
  });
});
