import { describe, expect, it, vi } from 'vitest';

import {
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
});
