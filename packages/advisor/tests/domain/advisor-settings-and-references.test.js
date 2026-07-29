// Tests for Advisor references and settings.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  advisorReferenceKey,
  normalizeAdvisorReference
} from '@cavalry/advisor/domain/advisor/references.js';

const require = createRequire(import.meta.url);
const {
  ADVISOR_API_MODE,
  ADVISOR_API_KEY_MASK,
  ADVISOR_PROVIDER_KIND,
  CAVALRY_LOCAL_ADVISOR_ENDPOINT,
  CAVALRY_LOCAL_ADVISOR_MODEL,
  DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
  OPENAI_ADVISOR_ENDPOINT,
  OPENAI_ADVISOR_RESPONSES_ENDPOINT,
  applyAdvisorProviderDefaults,
  buildAdvisorSettingsPayload,
  buildAdvisorSettingsStoragePayload,
  getAdvisorLlamaVisionArgs,
  getAdvisorProviderKind,
  getAdvisorServerDetail,
  getAdvisorServerToggleState,
  isAdvisorApiKeyMask,
  normalizeAdvisorSettings,
  normalizeAdvisorProviderKind,
  normalizeAdvisorPublicSettings,
  normalizeAdvisorServerStatus,
  publicAdvisorSettings
} = require('@cavalry/advisor/domain/advisor/settings.cjs');

describe('advisor references', () => {
  it('normalizes source_refs and camelCase sourceRefs', () => {
    expect(
      normalizeAdvisorReference({
        token: ' ₱1,000 ',
        sourceRefs: [' computed.totals.net_worth ', '', null]
      })
    ).toEqual({
      token: '₱1,000',
      source_refs: ['computed.totals.net_worth']
    });
  });

  it('creates stable lookup keys for advisor tokens', () => {
    expect(advisorReferenceKey('  Net   Worth ')).toBe('net worth');
  });
});

describe('advisor settings', () => {
  it('normalizes local settings without active endpoints or models while preserving secrets', () => {
    expect(
      normalizeAdvisorSettings({
        provider: 'local',
        endpoint: 'https://example.test/v1/chat/completions',
        model: 'gpt-test',
        apiKey: 'secret'
      })
    ).toEqual({
      provider: 'local',
      providerKind: ADVISOR_PROVIDER_KIND.RULES,
      apiMode: ADVISOR_API_MODE.CHAT_COMPLETIONS,
      endpoint: '',
      model: '',
      localModelPath: '',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
      apiKey: 'secret'
    });
  });

  it('defaults custom llama.cpp settings to the Cavalry endpoint and model', () => {
    expect(
      normalizeAdvisorSettings({
        provider: 'custom',
        endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
        localModelPath: '/models/cavalry.gguf'
      })
    ).toEqual({
      provider: 'custom',
      providerKind: ADVISOR_PROVIDER_KIND.LOCAL_MODEL,
      apiMode: ADVISOR_API_MODE.CHAT_COMPLETIONS,
      endpoint: CAVALRY_LOCAL_ADVISOR_ENDPOINT,
      model: CAVALRY_LOCAL_ADVISOR_MODEL,
      localModelPath: '/models/cavalry.gguf',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
      apiKey: ''
    });
  });

  it('maps legacy provider names and explicit provider kinds consistently', () => {
    expect(normalizeAdvisorProviderKind('local')).toBe(ADVISOR_PROVIDER_KIND.RULES);
    expect(normalizeAdvisorProviderKind('custom')).toBe(ADVISOR_PROVIDER_KIND.LOCAL_MODEL);
    expect(normalizeAdvisorProviderKind('openai')).toBe(ADVISOR_PROVIDER_KIND.REMOTE_MODEL);
    expect(
      normalizeAdvisorSettings({
        providerKind: 'local_model',
        localModelPath: '/models/cavalry.gguf'
      })
    ).toMatchObject({
      provider: 'custom',
      providerKind: ADVISOR_PROVIDER_KIND.LOCAL_MODEL
    });
    expect(getAdvisorProviderKind({ provider: 'rules' })).toBe(ADVISOR_PROVIDER_KIND.RULES);
  });

  it('keeps API keys until a blank key is explicitly submitted', () => {
    const existing = normalizeAdvisorSettings({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: 'saved'
    });
    expect(
      normalizeAdvisorSettings({ provider: 'openai', model: 'gpt-4.1' }, existing).apiKey
    ).toBe('saved');
    expect(normalizeAdvisorSettings({ provider: 'local' }, existing).apiKey).toBe('saved');
    expect(normalizeAdvisorSettings({ provider: 'openai', apiKey: '' }, existing).apiKey).toBe('');
  });

  it('repairs a localhost endpoint when OpenAI is selected', () => {
    expect(
      normalizeAdvisorSettings({
        provider: 'openai',
        apiMode: 'responses',
        endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
        model: 'gpt-5.4-mini',
        apiKey: 'saved'
      })
    ).toMatchObject({
      provider: 'openai',
      apiMode: ADVISOR_API_MODE.RESPONSES,
      endpoint: OPENAI_ADVISOR_RESPONSES_ENDPOINT,
      model: 'gpt-5.4-mini',
      apiKey: 'saved'
    });
  });

  it('returns public settings without exposing the API key', () => {
    expect(
      publicAdvisorSettings({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4.1',
        apiKey: 'secret'
      })
    ).toEqual({
      provider: 'openai',
      providerKind: ADVISOR_PROVIDER_KIND.REMOTE_MODEL,
      apiMode: ADVISOR_API_MODE.RESPONSES,
      endpoint: OPENAI_ADVISOR_RESPONSES_ENDPOINT,
      model: 'gpt-4.1',
      localModelPath: '',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
      hasApiKey: true,
      apiKeyPreview: ADVISOR_API_KEY_MASK
    });
  });

  it('normalizes renderer-safe settings with a masked key preview', () => {
    expect(
      normalizeAdvisorPublicSettings({
        provider: 'openai',
        model: 'gpt-4.1-mini',
        hasApiKey: true
      })
    ).toEqual({
      provider: 'openai',
      providerKind: ADVISOR_PROVIDER_KIND.REMOTE_MODEL,
      apiMode: ADVISOR_API_MODE.RESPONSES,
      endpoint: OPENAI_ADVISOR_RESPONSES_ENDPOINT,
      model: 'gpt-4.1-mini',
      localModelPath: '',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
      hasApiKey: true,
      apiKeyPreview: ADVISOR_API_KEY_MASK
    });

    const localPublic = normalizeAdvisorPublicSettings({
      provider: 'local',
      endpoint: OPENAI_ADVISOR_ENDPOINT,
      model: 'gpt-4.1-mini',
      hasApiKey: true
    });
    expect(localPublic.hasApiKey).toBe(true);
    expect(localPublic.apiKeyPreview).toBe(ADVISOR_API_KEY_MASK);
  });

  it('builds the Test Model save payload so a blank submitted key clears persisted API access', () => {
    const current = normalizeAdvisorPublicSettings({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      hasApiKey: true
    });
    const payload = buildAdvisorSettingsPayload(
      {
        provider: 'openai',
        endpoint: '',
        model: 'gpt-4.1',
        localModelPath: '/ignored.gguf',
        apiKey: ''
      },
      current
    );

    expect(payload).toEqual({
      provider: 'openai',
      providerKind: ADVISOR_PROVIDER_KIND.REMOTE_MODEL,
      apiMode: ADVISOR_API_MODE.RESPONSES,
      endpoint: '',
      model: 'gpt-4.1',
      localModelPath: '/ignored.gguf',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
      apiKey: ''
    });
    expect(buildAdvisorSettingsStoragePayload(payload, current)).toEqual({
      provider: 'openai',
      providerKind: ADVISOR_PROVIDER_KIND.REMOTE_MODEL,
      apiMode: ADVISOR_API_MODE.RESPONSES,
      endpoint: OPENAI_ADVISOR_RESPONSES_ENDPOINT,
      model: 'gpt-4.1',
      localModelPath: '',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS
    });
  });

  it('treats the masked API key field as keep the persisted key', () => {
    const current = normalizeAdvisorSettings({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-real'
    });
    const payload = buildAdvisorSettingsPayload(
      {
        provider: 'openai',
        endpoint: '',
        model: 'gpt-4.1-mini',
        apiKey: ADVISOR_API_KEY_MASK
      },
      current
    );

    expect(isAdvisorApiKeyMask(ADVISOR_API_KEY_MASK, publicAdvisorSettings(current))).toBe(true);
    expect(payload).toMatchObject({
      provider: 'openai',
      providerKind: ADVISOR_PROVIDER_KIND.REMOTE_MODEL
    });
    expect(Object.prototype.hasOwnProperty.call(payload, 'apiKey')).toBe(false);
    expect(buildAdvisorSettingsStoragePayload(payload, current)).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-real'
    });
  });

  it('preserves the API key when a form submits without a key field', () => {
    const current = normalizeAdvisorSettings({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-real'
    });
    const payload = buildAdvisorSettingsPayload(
      {
        provider: 'local',
        endpoint: '',
        model: ''
      },
      publicAdvisorSettings(current)
    );

    expect(Object.prototype.hasOwnProperty.call(payload, 'apiKey')).toBe(false);
    expect(buildAdvisorSettingsStoragePayload(payload, current)).toMatchObject({
      provider: 'local',
      apiKey: 'sk-real'
    });
  });

  it('applies provider defaults while preserving persisted key state', () => {
    expect(
      applyAdvisorProviderDefaults(
        {
          provider: 'openai',
          endpoint: OPENAI_ADVISOR_ENDPOINT,
          model: 'gpt-4.1-mini',
          hasApiKey: true
        },
        'custom'
      )
    ).toEqual({
      provider: 'custom',
      providerKind: ADVISOR_PROVIDER_KIND.LOCAL_MODEL,
      apiMode: ADVISOR_API_MODE.CHAT_COMPLETIONS,
      endpoint: CAVALRY_LOCAL_ADVISOR_ENDPOINT,
      model: CAVALRY_LOCAL_ADVISOR_MODEL,
      localModelPath: '',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
      hasApiKey: true,
      apiKeyPreview: ADVISOR_API_KEY_MASK
    });

    expect(
      applyAdvisorProviderDefaults(
        {
          provider: 'openai',
          endpoint: OPENAI_ADVISOR_ENDPOINT,
          model: 'gpt-4.1-mini',
          hasApiKey: true
        },
        'local'
      )
    ).toEqual({
      provider: 'local',
      providerKind: ADVISOR_PROVIDER_KIND.RULES,
      apiMode: ADVISOR_API_MODE.CHAT_COMPLETIONS,
      endpoint: '',
      model: '',
      localModelPath: '',
      mmprojPath: '',
      contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
      hasApiKey: true,
      apiKeyPreview: ADVISOR_API_KEY_MASK
    });
  });

  it('normalizes local llama.cpp context allocation to supported presets', () => {
    expect(
      normalizeAdvisorSettings({
        provider: 'custom',
        contextWindowTokens: 65536
      }).contextWindowTokens
    ).toBe(65536);

    expect(
      normalizeAdvisorSettings({
        provider: 'custom',
        contextWindowTokens: 12345
      }).contextWindowTokens
    ).toBe(DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS);

    expect(
      buildAdvisorSettingsPayload(
        {
          provider: 'custom',
          contextWindowTokens: 49152
        },
        normalizeAdvisorPublicSettings({
          provider: 'custom',
          contextWindowTokens: 32768
        })
      ).contextWindowTokens
    ).toBe(49152);
  });

  it('preserves local llama.cpp multimodal projector paths', () => {
    expect(
      normalizeAdvisorSettings({
        provider: 'custom',
        localModelPath: '/models/qwen.gguf',
        mmprojPath: '/models/mmproj-qwen.gguf'
      })
    ).toMatchObject({
      provider: 'custom',
      localModelPath: '/models/qwen.gguf',
      mmprojPath: '/models/mmproj-qwen.gguf'
    });
    expect(
      normalizeAdvisorPublicSettings({
        provider: 'local',
        mmprojPath: '/models/mmproj-qwen.gguf'
      }).mmprojPath
    ).toBe('');
  });

  it('adds llama.cpp image token defaults only for multimodal local models', () => {
    const helpText = '--mmproj FILE\n--image-min-tokens N\n--ctx-size N';

    expect(
      getAdvisorLlamaVisionArgs(
        {
          provider: 'custom',
          localModelPath: '/models/qwen.gguf',
          mmprojPath: '/models/mmproj-qwen.gguf'
        },
        helpText
      )
    ).toEqual(['--image-min-tokens', '1024']);

    expect(
      getAdvisorLlamaVisionArgs(
        {
          provider: 'custom',
          localModelPath: '/models/qwen.gguf',
          mmprojPath: ''
        },
        helpText
      )
    ).toEqual([]);

    expect(
      getAdvisorLlamaVisionArgs(
        {
          provider: 'custom',
          localModelPath: '/models/qwen.gguf',
          mmprojPath: '/models/mmproj-qwen.gguf'
        },
        '--mmproj FILE'
      )
    ).toEqual([]);
  });

  it('derives Start/Stop Model button state from normalized server status', () => {
    expect(getAdvisorServerToggleState({ provider: 'local' }, null)).toMatchObject({
      disabled: true,
      label: 'Start Model',
      icon: 'play_arrow',
      shouldStop: false
    });

    expect(
      getAdvisorServerToggleState(
        {
          provider: 'custom',
          localModelPath: '/models/cavalry.gguf'
        },
        {
          running: true,
          manageable: true,
          source: 'managed',
          pid: 123
        }
      )
    ).toMatchObject({
      disabled: false,
      label: 'Stop Model',
      icon: 'stop_circle',
      shouldStop: true
    });

    expect(
      getAdvisorServerToggleState(
        {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          hasApiKey: true
        },
        {
          running: true,
          manageable: true,
          source: 'managed',
          pid: 123
        }
      )
    ).toMatchObject({
      disabled: false,
      label: 'Stop Model',
      icon: 'stop_circle',
      shouldStop: true
    });

    expect(
      getAdvisorServerToggleState(
        {
          provider: 'custom',
          localModelPath: '/models/cavalry.gguf'
        },
        {
          starting: true
        }
      )
    ).toMatchObject({
      disabled: true,
      label: 'Starting Model',
      icon: 'hourglass_top',
      shouldStop: false
    });

    expect(
      getAdvisorServerToggleState(
        {
          provider: 'custom',
          localModelPath: '/models/cavalry.gguf'
        },
        {
          running: false,
          starting: true,
          manageable: true,
          source: 'managed',
          pid: 123
        }
      )
    ).toMatchObject({
      disabled: false,
      label: 'Stop Model',
      icon: 'stop_circle',
      shouldStop: true
    });

    expect(
      getAdvisorServerToggleState(
        {
          provider: 'custom',
          localModelPath: '/models/cavalry.gguf'
        },
        {
          stopping: true,
          manageable: true,
          source: 'managed',
          pid: 123
        }
      )
    ).toMatchObject({
      disabled: true,
      label: 'Stopping Model…',
      icon: 'stop_circle',
      shouldStop: false
    });
  });

  it('formats local model server detail when a managed server can be stopped', () => {
    const status = normalizeAdvisorServerStatus({
      running: true,
      manageable: true,
      message: 'Local model server is running.',
      pid: 123,
      source: 'managed'
    });

    expect(
      getAdvisorServerDetail(
        {
          provider: 'custom',
          localModelPath: '/models/cavalry.gguf'
        },
        status
      )
    ).toBe('Local model server is running. PID 123. Source: managed.');

    expect(
      getAdvisorServerDetail(
        {
          provider: 'local'
        },
        status
      )
    ).toBe('Local model server is running. PID 123. Source: managed.');

    expect(
      getAdvisorServerDetail(
        {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          hasApiKey: true
        },
        status
      )
    ).toBe('Local model server is running. PID 123. Source: managed.');
  });
});
