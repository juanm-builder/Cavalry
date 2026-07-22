import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ADVISOR_TRANSCRIPTION_MODEL,
  buildAdvisorTranscriptionFormData,
  callAdvisorAgentTurn,
  callAdvisorTranscription,
  cancelAdvisorRequest,
  getAdvisorMicrophoneAccessStatus,
  getAdvisorTranscriptionEndpoint,
  installAdvisorMediaPermissionHandlers,
  openAdvisorMicrophoneSettings,
  requestAdvisorMicrophoneAccess,
  shouldGrantAdvisorMediaPermission
} = require('../../src/main/index.cjs');
const advisorEndpointHelpers = require('../../src/main/advisor-endpoints.cjs');
const advisorMicrophoneHelpers = require('../../src/main/advisor-microphone.cjs');

describe('advisor voice transcription IPC helpers', () => {
  function makeMediaPreferences(initialStatus, askResult = true, nextStatus = initialStatus) {
    let status = initialStatus;
    return {
      calls: [],
      getMediaAccessStatus(mediaType) {
        this.calls.push(['get', mediaType]);
        return status;
      },
      async askForMediaAccess(mediaType) {
        this.calls.push(['ask', mediaType]);
        status = nextStatus;
        return askResult;
      }
    };
  }

  function makeAppWebContents(url = 'file:///tmp/Cavalry/Cavalry%20for%20Mac/index.html') {
    return {
      session: {},
      getURL: () => url,
      isDestroyed: () => false
    };
  }

  it('reports recoverable macOS microphone permission states', async () => {
    expect(
      getAdvisorMicrophoneAccessStatus(makeMediaPreferences('not-determined'), 'darwin')
    ).toMatchObject({
      ok: true,
      status: 'not-determined',
      granted: false,
      requestable: true,
      needsSystemSettings: false
    });
    expect(
      getAdvisorMicrophoneAccessStatus(makeMediaPreferences('granted'), 'darwin')
    ).toMatchObject({
      status: 'granted',
      granted: true,
      requestable: true,
      needsSystemSettings: false
    });
    expect(
      getAdvisorMicrophoneAccessStatus(makeMediaPreferences('denied'), 'darwin')
    ).toMatchObject({
      status: 'denied',
      granted: false,
      requestable: false,
      needsSystemSettings: true,
      needsRestart: true
    });
    expect(
      getAdvisorMicrophoneAccessStatus(makeMediaPreferences('restricted'), 'darwin')
    ).toMatchObject({
      status: 'restricted',
      granted: false,
      requestable: false,
      needsSystemSettings: true,
      needsRestart: true
    });
    expect(getAdvisorMicrophoneAccessStatus(makeMediaPreferences('denied'), 'linux')).toMatchObject(
      {
        status: 'granted',
        granted: true,
        requestable: true,
        needsSystemSettings: false
      }
    );
  });

  it('requests macOS microphone access only while permission is not determined', async () => {
    const pending = makeMediaPreferences('not-determined', false, 'denied');
    const denied = await requestAdvisorMicrophoneAccess(pending, 'darwin');
    expect(denied).toMatchObject({
      status: 'denied',
      granted: false,
      requestable: false,
      needsSystemSettings: true
    });
    expect(pending.calls).toEqual([
      ['get', 'microphone'],
      ['ask', 'microphone'],
      ['get', 'microphone']
    ]);

    const alreadyDenied = makeMediaPreferences('denied');
    expect(await requestAdvisorMicrophoneAccess(alreadyDenied, 'darwin')).toMatchObject({
      status: 'denied',
      needsSystemSettings: true
    });
    expect(alreadyDenied.calls).toEqual([['get', 'microphone']]);
  });

  it('opens macOS microphone settings with fallbacks', async () => {
    const opened = [];
    const result = await openAdvisorMicrophoneSettings(
      {
        openExternal: async (url) => {
          opened.push(url);
        }
      },
      'darwin'
    );

    expect(result).toMatchObject({ ok: true, opened: true });
    expect(opened[0]).toContain('Privacy_Microphone');
    expect(
      await openAdvisorMicrophoneSettings({ openExternal: async () => {} }, 'linux')
    ).toMatchObject({
      ok: false,
      opened: false
    });
  });

  it('allows only Cavalry window audio media permission requests', () => {
    const appWebContents = makeAppWebContents();
    expect(
      shouldGrantAdvisorMediaPermission(
        appWebContents,
        'media',
        'file://',
        {
          mediaTypes: ['audio'],
          securityOrigin: 'file://'
        },
        appWebContents
      )
    ).toBe(true);

    expect(
      shouldGrantAdvisorMediaPermission(
        appWebContents,
        'media',
        'file://',
        {
          mediaTypes: ['video'],
          securityOrigin: 'file://'
        },
        appWebContents
      )
    ).toBe(false);
    expect(
      shouldGrantAdvisorMediaPermission(
        appWebContents,
        'media',
        'https://example.test',
        {
          mediaTypes: ['audio'],
          securityOrigin: 'https://example.test'
        },
        appWebContents
      )
    ).toBe(false);
    expect(
      shouldGrantAdvisorMediaPermission(
        appWebContents,
        'notifications',
        'file://',
        {
          mediaTypes: ['audio'],
          securityOrigin: 'file://'
        },
        appWebContents
      )
    ).toBe(false);
    expect(
      shouldGrantAdvisorMediaPermission(
        makeAppWebContents(),
        'media',
        'file://',
        {
          mediaTypes: ['audio'],
          securityOrigin: 'file://'
        },
        appWebContents
      )
    ).toBe(false);

    const developmentWebContents = makeAppWebContents('http://127.0.0.1:5173/');
    expect(
      shouldGrantAdvisorMediaPermission(
        developmentWebContents,
        'media',
        'http://127.0.0.1:5173',
        {
          mediaTypes: ['audio'],
          securityOrigin: 'http://127.0.0.1:5173/'
        },
        developmentWebContents
      )
    ).toBe(true);
    expect(
      shouldGrantAdvisorMediaPermission(
        developmentWebContents,
        'media',
        'http://localhost:5173',
        {
          mediaTypes: ['audio'],
          securityOrigin: 'http://localhost:5173/'
        },
        developmentWebContents
      )
    ).toBe(false);
  });

  it('keeps microphone media permission helpers in the helper module', () => {
    const appWebContents = makeAppWebContents();

    expect(advisorMicrophoneHelpers.getAdvisorMediaPermissionTypes({ mediaType: 'audio' })).toEqual(
      ['audio']
    );
    expect(
      advisorMicrophoneHelpers.isAdvisorAudioOnlyMediaPermission({ mediaTypes: ['audio'] })
    ).toBe(true);
    expect(
      advisorMicrophoneHelpers.shouldGrantAdvisorMediaPermission(
        appWebContents,
        'media',
        'file://',
        {
          mediaTypes: ['audio'],
          securityOrigin: 'file://'
        },
        appWebContents
      )
    ).toBe(true);
  });

  it('installs media permission handlers on the Electron session', () => {
    let requestHandler = null;
    let checkHandler = null;
    const appWebContents = makeAppWebContents();
    appWebContents.session = {
      setPermissionRequestHandler(handler) {
        requestHandler = handler;
      },
      setPermissionCheckHandler(handler) {
        checkHandler = handler;
      }
    };
    expect(installAdvisorMediaPermissionHandlers({ webContents: appWebContents })).toBe(true);

    let requestGranted = null;
    requestHandler(
      appWebContents,
      'media',
      (granted) => {
        requestGranted = granted;
      },
      { mediaTypes: ['audio'], securityOrigin: 'file://' }
    );

    expect(requestGranted).toBe(true);
    expect(
      checkHandler(appWebContents, 'media', 'file://', {
        mediaTypes: ['video'],
        securityOrigin: 'file://'
      })
    ).toBe(false);
  });

  it('posts OpenAI agent turns to the Responses API with tools', async () => {
    const calls = [];
    const response = await callAdvisorAgentTurn(
      {
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-agent-test',
        model: 'gpt-5-mini'
      },
      {
        requestId: 'agent_request',
        input: 'Prepare a transaction draft.',
        tools: [
          {
            type: 'function',
            name: 'classify_finance_intent',
            parameters: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
              additionalProperties: false
            }
          }
        ]
      },
      null,
      {
        fetchWithTimeout: async (url, options, timeoutMs, signal) => {
          calls.push({ url, options, timeoutMs, signal });
          return {
            ok: true,
            text: async () => JSON.stringify({ id: 'resp_agent', output: [] })
          };
        }
      }
    );

    expect(response).toEqual({ id: 'resp_agent', output: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-agent-test'
    });
    expect(calls[0].signal).toBeTruthy();
    expect(JSON.parse(calls[0].options.body)).toMatchObject({
      model: 'gpt-5-mini',
      input: 'Prepare a transaction draft.',
      tools: [{ name: 'classify_finance_intent' }]
    });
  });

  it('derives the OpenAI audio transcription endpoint from chat completions settings', () => {
    expect(
      getAdvisorTranscriptionEndpoint({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions'
      })
    ).toBe('https://api.openai.com/v1/audio/transcriptions');

    expect(
      getAdvisorTranscriptionEndpoint({
        provider: 'openai',
        endpoint: 'https://example.test/openai/v1/chat/completions?ignored=true'
      })
    ).toBe('https://example.test/openai/v1/audio/transcriptions');
  });

  it('derives Advisor chat and responses endpoints in the helper module', () => {
    expect(
      advisorEndpointHelpers.getAdvisorChatCompletionsEndpoint({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses?drop=true'
      })
    ).toBe('https://api.openai.com/v1/chat/completions');

    expect(
      advisorEndpointHelpers.getAdvisorResponsesEndpoint({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions?drop=true'
      })
    ).toBe('https://api.openai.com/v1/responses');

    expect(
      advisorEndpointHelpers.getAdvisorEndpoint({
        provider: 'custom',
        endpoint: 'http://127.0.0.1:9292/v1/chat/completions'
      })
    ).toBe('http://127.0.0.1:9292/v1/chat/completions');
  });

  it('requires a saved OpenAI key for voice transcription', async () => {
    const audioBase64 = Buffer.from('voice bytes').toString('base64');

    await expect(
      callAdvisorTranscription(
        {
          provider: 'local'
        },
        {
          audioBase64,
          mimeType: 'audio/webm'
        },
        null,
        {
          fetchWithTimeout: async () => ({ ok: true, text: async () => 'unused' })
        }
      )
    ).rejects.toThrow(/OpenAI API key/);

    await expect(
      callAdvisorTranscription(
        {
          provider: 'openai',
          endpoint: 'https://api.openai.com/v1/chat/completions'
        },
        {
          audioBase64,
          mimeType: 'audio/webm'
        },
        null,
        {
          fetchWithTimeout: async () => ({ ok: true, text: async () => 'unused' })
        }
      )
    ).rejects.toThrow(/API key/);
  });

  it('uses OpenAI transcription while a local chat model is selected', async () => {
    const calls = [];
    const transcript = await callAdvisorTranscription(
      {
        provider: 'custom',
        endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
        apiKey: 'sk-voice-with-local-chat'
      },
      {
        audioBase64: Buffer.from('voice bytes').toString('base64'),
        mimeType: 'audio/webm'
      },
      null,
      {
        fetchWithTimeout: async (url) => {
          calls.push(url);
          return { ok: true, text: async () => 'Add lunch for 250 pesos' };
        }
      }
    );

    expect(transcript).toBe('Add lunch for 250 pesos');
    expect(calls).toEqual(['https://api.openai.com/v1/audio/transcriptions']);
  });

  it('builds multipart transcription requests with the audio file and prompt', async () => {
    const calls = [];
    const audioBase64 = Buffer.from('voice bytes').toString('base64');
    const transcript = await callAdvisorTranscription(
      {
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-voice-test'
      },
      {
        requestId: 'voice_request',
        audioBase64,
        mimeType: 'audio/webm',
        prompt: 'Finance words only.'
      },
      null,
      {
        fetchWithTimeout: async (url, options, timeoutMs, signal) => {
          calls.push({ url, options, timeoutMs, signal });
          return { ok: true, text: async () => 'Coffee 120 pesos' };
        }
      }
    );

    expect(transcript).toBe('Coffee 120 pesos');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.headers).toEqual({ Authorization: 'Bearer sk-voice-test' });
    expect(calls[0].signal).toBeTruthy();

    const form = calls[0].options.body;
    expect(form.get('model')).toBe(ADVISOR_TRANSCRIPTION_MODEL);
    expect(form.get('response_format')).toBe('text');
    expect(form.get('prompt')).toBe('Finance words only.');
    expect(form.get('file').type).toBe('audio/webm');
    expect(await form.get('file').text()).toBe('voice bytes');
  });

  it('exposes the same multipart fields through the form helper', async () => {
    const form = buildAdvisorTranscriptionFormData({
      audioBase64: Buffer.from('clip').toString('base64'),
      mimeType: 'audio/webm',
      language: 'en',
      prompt: 'Transaction dictation.'
    });

    expect(form.get('model')).toBe(ADVISOR_TRANSCRIPTION_MODEL);
    expect(form.get('language')).toBe('en');
    expect(form.get('prompt')).toBe('Transaction dictation.');
    expect(await form.get('file').text()).toBe('clip');
  });

  it('cancels an in-flight voice transcription by request id', async () => {
    let signalReady;
    const ready = new Promise((resolve) => {
      signalReady = resolve;
    });
    const request = callAdvisorTranscription(
      {
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-voice-test'
      },
      {
        requestId: 'voice_cancel',
        audioBase64: Buffer.from('voice bytes').toString('base64'),
        mimeType: 'audio/webm'
      },
      null,
      {
        fetchWithTimeout: async (_url, _options, _timeoutMs, signal) => {
          signalReady(signal);
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                const error = new Error('Advisor request was cancelled.');
                error.name = 'AbortError';
                error.cavalryCancelled = true;
                reject(error);
              },
              { once: true }
            );
          });
        }
      }
    );

    await ready;
    expect(cancelAdvisorRequest('voice_cancel')).toMatchObject({
      ok: true,
      cancelled: true,
      requestId: 'voice_cancel'
    });
    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      cavalryCancelled: true
    });
  });
});
