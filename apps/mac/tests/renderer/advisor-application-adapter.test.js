import { describe, expect, it, vi } from 'vitest';

import {
  createAdvisorOperationCoordinator,
  executeAdvisorApplicationIntent,
  loadAdvisorRuntimeState
} from '../../src/renderer/app/advisor-application-adapter.js';

function stateHarness(initial = {}) {
  let state = initial;
  return {
    get state() {
      return state;
    },
    setSettingsViewState(update) {
      state = typeof update === 'function' ? update(state) : update;
    }
  };
}

function adapterContext(advisor, harness, advisorOperations = createAdvisorOperationCoordinator()) {
  return {
    advisor,
    advisorOperations,
    navigate: vi.fn(),
    reportError: vi.fn(),
    setBillsViewState: vi.fn(),
    setSettingsViewState: harness.setSettingsViewState.bind(harness)
  };
}

describe('advisor application adapter', () => {
  it('hides inactive llama.cpp status for OpenAI runtime settings', async () => {
    const advisor = {
      invoke: vi.fn(async (method) => {
        if (method === 'getSettings') {
          return { settings: { provider: 'openai', model: 'gpt-5.4-mini' } };
        }
        if (method === 'getServerStatus') {
          return { status: { running: false, message: 'Local llama.cpp is not selected.' } };
        }
        return {};
      })
    };

    const state = await loadAdvisorRuntimeState(advisor);

    expect(state.advisorServerDetail).toBe('');
  });

  it('applies isolated defaults when switching assistant providers', async () => {
    const harness = stateHarness({
      advisorSettings: {
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        model: 'gpt-5.4-mini'
      },
      advisorServerDetail: 'Local llama.cpp is not selected.'
    });
    const context = {
      advisor: { invoke: vi.fn() },
      navigate: vi.fn(),
      reportError: vi.fn(),
      setBillsViewState: vi.fn(),
      setSettingsViewState: harness.setSettingsViewState.bind(harness)
    };

    await executeAdvisorApplicationIntent(
      { operation: 'provider-change', provider: 'custom' },
      context
    );

    expect(harness.state.advisorSettings).toMatchObject({
      provider: 'custom',
      endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
      model: 'cavalry-advisor'
    });
    expect(harness.state.advisorConnection).toBe('');
  });

  it('shows live test progress and suppresses local status after an OpenAI test', async () => {
    const harness = stateHarness({ advisorSettings: { provider: 'openai' } });
    let resolveTest;
    const testResult = new Promise((resolve) => {
      resolveTest = resolve;
    });
    const context = {
      advisor: { invoke: vi.fn(() => testResult) },
      navigate: vi.fn(),
      reportError: vi.fn(),
      setBillsViewState: vi.fn(),
      setSettingsViewState: harness.setSettingsViewState.bind(harness)
    };

    const pending = executeAdvisorApplicationIntent(
      { operation: 'connection-test', provider: 'openai', model: 'gpt-5.4-mini' },
      context
    );
    expect(harness.state.advisorConnection).toBe('Testing OpenAI…');

    resolveTest({
      ok: true,
      message: 'Model test passed.',
      settings: { provider: 'openai', model: 'gpt-5.4-mini' },
      status: { running: false, message: 'Local llama.cpp is not selected.' }
    });
    await pending;

    expect(harness.state.advisorConnection).toBe('Model test passed.');
    expect(harness.state.feedbackSection).toBe('settings-advisor');
    expect(harness.state.advisorServerDetail).toBe('');
  });

  it('clears stale testing state and reconciles the server after a failed local test', async () => {
    const harness = stateHarness({
      advisorSettings: { provider: 'custom', localModelPath: '/models/qwen.gguf' },
      advisorConnection: 'An older model test passed.',
      advisorServerStatus: { running: true, starting: true },
      advisorServerDetail: 'Local model server is running.'
    });
    const advisor = {
      invoke: vi.fn(async (method) => {
        if (method === 'testConnection') {
          throw new Error('The selected vision projector does not match this model.');
        }
        if (method === 'getServerStatus') {
          return {
            ok: true,
            status: {
              running: false,
              starting: false,
              manageable: false,
              message: 'Local model server is stopped.'
            }
          };
        }
        return {};
      })
    };
    const context = adapterContext(advisor, harness);

    const result = await executeAdvisorApplicationIntent(
      {
        operation: 'connection-test',
        provider: 'custom',
        localModelPath: '/models/qwen.gguf'
      },
      context
    );

    expect(result).toMatchObject({ ok: false });
    expect(harness.state.advisorConnection).toBe('');
    expect(harness.state.advisorOperation).toBeNull();
    expect(harness.state.advisorServerStatus).toMatchObject({
      running: false,
      starting: false
    });
    expect(harness.state.advisorServerToggleState).toMatchObject({
      disabled: false,
      label: 'Start Model',
      testDisabled: false
    });
    expect(harness.state.advisorServerDetail).toBe('Local model server is stopped.');
    expect(harness.state.error).toContain('does not match');
    expect(context.reportError).toHaveBeenCalledOnce();
  });

  it('keeps a local Test single-flight when it is pressed repeatedly', async () => {
    const harness = stateHarness({
      advisorSettings: { provider: 'custom', localModelPath: '/models/qwen.gguf' },
      advisorServerStatus: { running: false, starting: false }
    });
    let resolveTest;
    const testResult = new Promise((resolve) => {
      resolveTest = resolve;
    });
    const advisor = {
      invoke: vi.fn((method) => {
        if (method === 'testConnection') return testResult;
        if (method === 'getServerStatus') {
          return Promise.resolve({
            ok: true,
            status: {
              running: true,
              starting: false,
              manageable: true,
              message: 'Local model server is running.'
            }
          });
        }
        return Promise.resolve({});
      })
    };
    const context = adapterContext(advisor, harness);
    const payload = {
      operation: 'connection-test',
      provider: 'custom',
      localModelPath: '/models/qwen.gguf'
    };

    const firstTest = executeAdvisorApplicationIntent(payload, context);
    const repeatedTest = await executeAdvisorApplicationIntent(payload, context);

    expect(repeatedTest).toMatchObject({ ok: false, busy: true });
    expect(harness.state.advisorConnection).toBe('Testing local model…');
    expect(harness.state.advisorServerToggleState).toMatchObject({
      disabled: false,
      label: 'Stop Model',
      testDisabled: true
    });
    expect(
      advisor.invoke.mock.calls.filter(([method]) => method === 'testConnection')
    ).toHaveLength(1);

    resolveTest({ ok: true, message: 'Model test passed.' });
    await firstTest;

    expect(harness.state.advisorConnection).toBe('Model test passed.');
    expect(harness.state.advisorOperation).toBeNull();
    expect(harness.state.advisorServerToggleState.testDisabled).toBe(false);
  });

  it('blocks provider changes during Start without stranding the lifecycle state', async () => {
    const harness = stateHarness({
      advisorSettings: { provider: 'custom', localModelPath: '/models/qwen.gguf' },
      advisorServerStatus: { running: false, starting: false }
    });
    let resolveStart;
    const startResult = new Promise((resolve) => {
      resolveStart = resolve;
    });
    const advisor = {
      invoke: vi.fn((method) => {
        if (method === 'startServer') return startResult;
        if (method === 'getServerStatus') {
          return Promise.resolve({
            ok: true,
            status: {
              running: true,
              starting: false,
              manageable: true,
              message: 'Local model server is running.'
            }
          });
        }
        return Promise.resolve({});
      })
    };
    const context = adapterContext(advisor, harness);
    const pendingStart = executeAdvisorApplicationIntent(
      {
        operation: 'server-start',
        provider: 'custom',
        localModelPath: '/models/qwen.gguf'
      },
      context
    );

    await expect(
      executeAdvisorApplicationIntent({ operation: 'provider-change', provider: 'openai' }, context)
    ).resolves.toMatchObject({ ok: false, busy: true });
    expect(harness.state.advisorSettings.provider).toBe('custom');

    resolveStart({
      ok: true,
      message: 'Local model started.',
      status: {
        running: true,
        starting: false,
        manageable: true,
        message: 'Local model server is running.'
      }
    });
    await pendingStart;

    expect(harness.state.advisorOperation).toBeNull();
    expect(harness.state.advisorServerToggleState).toMatchObject({
      pending: false,
      label: 'Stop Model'
    });
  });

  it('keeps the last confirmed running state when final status reconciliation fails', async () => {
    const harness = stateHarness({
      advisorSettings: { provider: 'custom', localModelPath: '/models/qwen.gguf' },
      advisorServerStatus: { running: false, starting: false }
    });
    const advisor = {
      invoke: vi.fn(async (method) => {
        if (method === 'startServer') {
          return {
            ok: true,
            message: 'Local model started.',
            status: {
              running: true,
              healthy: true,
              starting: false,
              manageable: true,
              message: 'Local model server is running.'
            }
          };
        }
        if (method === 'getServerStatus') {
          return { ok: false, error: 'Unable to read server status.' };
        }
        return {};
      })
    };
    const context = adapterContext(advisor, harness);

    await executeAdvisorApplicationIntent(
      {
        operation: 'server-start',
        provider: 'custom',
        localModelPath: '/models/qwen.gguf'
      },
      context
    );

    expect(harness.state.advisorOperation).toBeNull();
    expect(harness.state.advisorServerStatus).toMatchObject({ running: true, healthy: true });
    expect(harness.state.advisorServerToggleState).toMatchObject({
      pending: false,
      label: 'Stop Model'
    });
    expect(harness.state.error).toBe('Unable to read server status.');
  });

  it('allows Stop during startup and ignores the late Start completion', async () => {
    const harness = stateHarness({
      advisorSettings: { provider: 'custom', localModelPath: '/models/qwen.gguf' },
      advisorServerStatus: { running: false, starting: false }
    });
    let resolveStart;
    const startResult = new Promise((resolve) => {
      resolveStart = resolve;
    });
    const advisor = {
      invoke: vi.fn((method) => {
        if (method === 'startServer') return startResult;
        if (method === 'stopServer') {
          return Promise.resolve({
            ok: true,
            message: 'Local model server stopped.',
            status: {
              running: false,
              starting: false,
              manageable: false,
              message: 'Local model server is stopped.'
            }
          });
        }
        if (method === 'getServerStatus') {
          return Promise.resolve({
            ok: true,
            status: {
              running: false,
              starting: false,
              manageable: false,
              message: 'Local model server is stopped.'
            }
          });
        }
        return Promise.resolve({});
      })
    };
    const context = adapterContext(advisor, harness);
    const connection = {
      provider: 'custom',
      localModelPath: '/models/qwen.gguf'
    };

    const pendingStart = executeAdvisorApplicationIntent(
      { ...connection, operation: 'server-start' },
      context
    );

    expect(harness.state.advisorServerToggleState).toMatchObject({
      disabled: false,
      label: 'Stop Model',
      shouldStop: true
    });

    const stopResult = await executeAdvisorApplicationIntent(
      { ...connection, operation: 'server-stop' },
      context
    );

    expect(stopResult).toMatchObject({ ok: true });
    expect(harness.state.advisorServerStatus).toMatchObject({
      running: false,
      starting: false
    });
    expect(harness.state.advisorServerToggleState).toMatchObject({
      disabled: false,
      label: 'Start Model',
      shouldStop: false
    });

    resolveStart({
      ok: true,
      message: 'Local model started.',
      status: {
        running: true,
        starting: false,
        manageable: true,
        message: 'Local model server is running.'
      }
    });
    await pendingStart;

    expect(harness.state.advisorServerStatus.running).toBe(false);
    expect(harness.state.advisorServerToggleState.label).toBe('Start Model');
  });

  it('treats a canceled model picker as a quiet no-op', async () => {
    const initial = {
      advisorSettings: {
        provider: 'custom',
        localModelPath: '/models/current.gguf',
        mmprojPath: ''
      },
      advisorConnection: '',
      error: '',
      notice: ''
    };
    const harness = stateHarness(initial);
    const advisor = {
      invoke: vi.fn(async () => ({ ok: false, canceled: true }))
    };
    const context = adapterContext(advisor, harness);

    await expect(
      executeAdvisorApplicationIntent({ operation: 'model-choose' }, context)
    ).resolves.toEqual({ ok: false, canceled: true });

    expect(harness.state).toEqual(initial);
    expect(context.reportError).not.toHaveBeenCalled();
  });

  it('removes Electron IPC wrappers from picker failures', async () => {
    const harness = stateHarness({
      advisorSettings: { provider: 'custom', localModelPath: '/models/current.gguf' }
    });
    const advisor = {
      invoke: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'cavalry-advisor:choose-local-model': Error: The selected model is unreadable."
        );
      })
    };
    const context = adapterContext(advisor, harness);

    await executeAdvisorApplicationIntent({ operation: 'model-choose' }, context);

    expect(harness.state.error).toBe('The selected model is unreadable.');
    expect(harness.state.error).not.toMatch(/invoking remote method/i);
  });

  it('clears a stale projector when a newly selected model has no verified match', async () => {
    const harness = stateHarness({
      advisorSettings: {
        provider: 'custom',
        localModelPath: '/models/old-model.gguf',
        mmprojPath: '/models/old-mmproj.gguf'
      }
    });
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        path: '/models/new-model.gguf',
        mmprojPath: ''
      }))
    };
    const context = adapterContext(advisor, harness);

    await executeAdvisorApplicationIntent({ operation: 'model-choose' }, context);

    expect(harness.state.advisorSettings).toMatchObject({
      localModelPath: '/models/new-model.gguf',
      mmprojPath: ''
    });
  });

  it('clears the optional projector locally without invoking a privileged command', async () => {
    const harness = stateHarness({
      advisorSettings: {
        provider: 'custom',
        localModelPath: '/models/qwen.gguf',
        mmprojPath: '/models/mmproj.gguf'
      },
      advisorConnection: 'Older test result'
    });
    const advisor = { invoke: vi.fn() };
    const context = adapterContext(advisor, harness);

    await expect(
      executeAdvisorApplicationIntent({ operation: 'vision-projector-clear' }, context)
    ).resolves.toEqual({ ok: true, mmprojPath: '' });

    expect(advisor.invoke).not.toHaveBeenCalled();
    expect(harness.state.advisorSettings.mmprojPath).toBe('');
    expect(harness.state.advisorConnection).toBe('');
    expect(harness.state.notice).toMatch(/projector cleared/i);
  });
});
