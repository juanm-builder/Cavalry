// Registers the narrow Advisor preload contract and translates runtime errors into renderer-safe results.

'use strict';

const nodePath = require('path');

const ADVISOR_IPC_CHANNELS = Object.freeze([
  'cavalry-advisor:get-settings',
  'cavalry-advisor:save-settings',
  'cavalry-advisor:get-memory',
  'cavalry-advisor:refresh-memory',
  'cavalry-advisor:save-memory',
  'cavalry-advisor:clear-memory',
  'cavalry-advisor:create-memory-item',
  'cavalry-advisor:update-memory-item',
  'cavalry-advisor:delete-memory-item',
  'cavalry-advisor:open-memory-file',
  'cavalry-advisor:open-memory-folder',
  'cavalry-advisor:reveal-memory',
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
]);

function isAdvisorSecretFieldName(key) {
  const normalized = String(key == null ? '' : key)
    .replace(/[\s_-]/g, '')
    .toLowerCase();
  return [
    'apikey',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'credential',
    'credentials',
    'clientsecret'
  ].includes(normalized);
}

function scrubAdvisorSecretsForRenderer(value) {
  if (Array.isArray(value)) {
    return value.map(scrubAdvisorSecretsForRenderer);
  }
  if (!(value && typeof value === 'object')) {
    return value;
  }
  return Object.keys(value).reduce((result, key) => {
    if (!isAdvisorSecretFieldName(key)) {
      result[key] = scrubAdvisorSecretsForRenderer(value[key]);
    }
    return result;
  }, {});
}

function getResponsesOutputText(response) {
  if (response && typeof response.output_text === 'string') return response.output_text;
  const output = Array.isArray(response && response.output) ? response.output : [];
  return output
    .flatMap((item) => (Array.isArray(item && item.content) ? item.content : []))
    .filter((item) => item && item.type === 'output_text')
    .map((item) => String(item.text || ''))
    .join('')
    .trim();
}

function normalizeAdvisorIpcError(error) {
  const source = error && typeof error === 'object' ? error : {};
  const message = String(
    source.userMessage || source.message || error || 'Assistant operation failed.'
  )
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i, '')
    .trim()
    .slice(0, 1000);
  return {
    ok: false,
    error: message || 'Assistant operation failed.',
    code: String(source.code || 'ADVISOR_OPERATION_FAILED').slice(0, 120),
    ...(source.conflict === true ? { conflict: true } : {}),
    ...(source.memory && typeof source.memory === 'object'
      ? { memory: scrubAdvisorSecretsForRenderer(source.memory) }
      : {}),
    ...(source.detail ? { detail: String(source.detail).slice(0, 2000) } : {}),
    ...(source.logPath ? { logPath: String(source.logPath).slice(0, 1000) } : {})
  };
}

function createAdvisorIpcController({
  ipcMain,
  dialog,
  runtime,
  path = nodePath,
  assertTrustedSender
} = {}) {
  if (!runtime) {
    throw new Error('Advisor runtime is required.');
  }

  function registerHandlers() {
    if (!(ipcMain && typeof ipcMain.handle === 'function')) {
      throw new Error('ipcMain with a handle function is required.');
    }
    if (typeof assertTrustedSender !== 'function') {
      throw new Error('A trusted IPC sender guard is required.');
    }
    const handle = (channel, handler) => {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedSender(event);
        return handler(event, ...args);
      });
    };

    handle('cavalry-advisor:get-settings', async () => {
      try {
        const settings = await runtime.loadAdvisorRuntimeSettings();
        return { ok: true, settings: runtime.publicAdvisorSettings(settings) };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:save-settings', async (_event, payload) => {
      const settings = runtime.normalizeAdvisorSettings(
        payload || {},
        await runtime.loadAdvisorRuntimeSettings()
      );
      try {
        const savedSettings = await runtime.saveAdvisorSettings(settings);
        const status = await runtime.getLocalAdvisorServerStatus(savedSettings);
        return {
          ok: true,
          settings: runtime.publicAdvisorSettings(savedSettings),
          status,
          message: 'Settings saved.'
        };
      } catch (error) {
        const failure = normalizeAdvisorIpcError(error);
        try {
          failure.status = await runtime.getLocalAdvisorServerStatus(settings);
        } catch (_statusError) {
          // Preserve the validation failure when status reconciliation also fails.
        }
        return failure;
      }
    });

    handle('cavalry-advisor:get-memory', async () => {
      try {
        return { ok: true, memory: await runtime.loadAdvisorMemory() };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:refresh-memory', async () => {
      try {
        return { ok: true, memory: await runtime.refreshAdvisorMemory(), refreshed: true };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:save-memory', async (_event, payload) => {
      try {
        return {
          ok: true,
          memory: await runtime.saveAdvisorMemory(payload || {}),
          message: 'Companion memory saved locally.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:clear-memory', async (_event, payload) => {
      try {
        return {
          ok: true,
          memory: await runtime.clearAdvisorMemory(payload || {}),
          message: 'Companion memory cleared.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:create-memory-item', async (_event, payload) => {
      try {
        return {
          ok: true,
          memory: await runtime.createAdvisorMemoryItem(payload || {}),
          message: 'Memory item added.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:update-memory-item', async (_event, payload) => {
      try {
        return {
          ok: true,
          memory: await runtime.updateAdvisorMemoryItem(payload || {}),
          message: 'Memory item updated.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:delete-memory-item', async (_event, payload) => {
      try {
        return {
          ok: true,
          memory: await runtime.deleteAdvisorMemoryItem(payload || {}),
          message: 'Memory item deleted.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:open-memory-file', async () => {
      try {
        return {
          ok: true,
          memory: await runtime.openAdvisorMemoryFile(),
          message: 'Opened memory.md.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:open-memory-folder', async () => {
      try {
        return {
          ok: true,
          memory: await runtime.openAdvisorMemoryFolder(),
          message: 'Opened the memory.md folder.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:reveal-memory', async () => {
      try {
        return {
          ok: true,
          memory: await runtime.revealAdvisorMemory(),
          message: 'Revealed memory.md in its local folder.'
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:get-server-status', async (_event, payload) => {
      try {
        const settings = runtime.normalizeAdvisorSettings(
          payload || {},
          await runtime.loadAdvisorRuntimeSettings()
        );
        const status = await runtime.getLocalAdvisorServerStatus(settings);
        return { ok: true, status };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:start-server', async (event, payload) => {
      const settings = runtime.normalizeAdvisorSettings(
        payload || {},
        await runtime.loadAdvisorRuntimeSettings()
      );
      try {
        const server = await runtime.ensureLocalAdvisorServer(settings, event);
        const savedSettings = await runtime.saveAdvisorSettings(settings, {
          allowActiveLocalConfiguration: true
        });
        const status = await runtime.getLocalAdvisorServerStatus(savedSettings);
        return {
          ok: true,
          settings: runtime.publicAdvisorSettings(savedSettings),
          status,
          message: server && server.message ? server.message : 'Local model started.'
        };
      } catch (error) {
        const failure = normalizeAdvisorIpcError(error);
        try {
          failure.status = await runtime.getLocalAdvisorServerStatus(settings);
        } catch (_statusError) {
          // Preserve the original launch failure when status reconciliation also fails.
        }
        return failure;
      }
    });

    handle('cavalry-advisor:stop-server', async (event, payload) => {
      const settings = runtime.normalizeAdvisorSettings(
        payload || {},
        await runtime.loadAdvisorRuntimeSettings()
      );
      try {
        return await runtime.stopLocalAdvisorServer(settings, event, {
          wait: true,
          forceAfterMs: 2500
        });
      } catch (error) {
        const failure = normalizeAdvisorIpcError(error);
        try {
          failure.status = await runtime.getLocalAdvisorServerStatus(settings);
        } catch (_statusError) {
          // Preserve the original stop failure when status reconciliation also fails.
        }
        return failure;
      }
    });

    handle('cavalry-advisor:choose-local-model', async (_event, payload) => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Choose Local AI Model',
          properties: ['openFile'],
          filters: [
            { name: 'GGUF Model Files', extensions: ['gguf'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        if (result.canceled || !result.filePaths.length) {
          return { ok: false, canceled: true };
        }
        const mmprojPath = await runtime.findAdjacentMmprojPath(result.filePaths[0]);
        const settings = runtime.normalizeAdvisorSettings(
          {
            ...(payload || {}),
            provider: 'custom',
            localModelPath: result.filePaths[0],
            mmprojPath
          },
          await runtime.loadAdvisorRuntimeSettings()
        );
        await runtime.assertAdvisorLocalModelCompatibility(settings);
        return {
          ok: true,
          path: result.filePaths[0],
          name: path.basename(result.filePaths[0]),
          mmprojPath,
          mmprojName: mmprojPath ? path.basename(mmprojPath) : ''
        };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    handle('cavalry-advisor:choose-mmproj', async (_event, payload) => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Choose Multimodal Projector',
          properties: ['openFile'],
          filters: [
            { name: 'Multimodal Projector Files', extensions: ['gguf', 'mmproj'] },
            { name: 'GGUF Files', extensions: ['gguf'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        if (result.canceled || !result.filePaths.length) {
          return { ok: false, canceled: true };
        }
        const settings = runtime.normalizeAdvisorSettings(
          {
            ...(payload || {}),
            provider: 'custom',
            mmprojPath: result.filePaths[0]
          },
          await runtime.loadAdvisorRuntimeSettings()
        );
        await runtime.assertAdvisorLocalModelCompatibility(settings);
        return { ok: true, path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
      } catch (error) {
        return normalizeAdvisorIpcError(error);
      }
    });

    async function settingsForRequest(payload) {
      const saved = await runtime.loadAdvisorRuntimeSettings();
      return runtime.normalizeAdvisorSettings(
        payload && payload.connection ? payload.connection : {},
        saved
      );
    }

    handle('cavalry-advisor:test', async (event, payload) => {
      const settings = runtime.normalizeAdvisorSettings(
        payload || {},
        await runtime.loadAdvisorRuntimeSettings()
      );
      try {
        let message = 'Using the built-in rules advisor.';
        if (settings.provider !== 'local') {
          const text =
            settings.provider === 'openai'
              ? getResponsesOutputText(
                  await runtime.callAdvisorAgentTurn(
                    settings,
                    {
                      instructions:
                        'Reply with exactly this phrase and nothing else: Model test passed.',
                      input: 'Run Cavalry assistant model test.',
                      max_output_tokens: 80
                    },
                    event
                  )
                )
              : await runtime.callAdvisorModel(settings, {
                  temperature: 0,
                  max_tokens: 80,
                  messages: [
                    {
                      role: 'system',
                      content: 'Reply with exactly this phrase and nothing else: Model test passed.'
                    },
                    { role: 'user', content: 'Run Cavalry advisor model test.' }
                  ]
                });
          if (!text) throw new Error('The model test returned no text.');
          message = text;
        }
        const savedSettings = await runtime.saveAdvisorSettings(settings, {
          allowActiveLocalConfiguration: true
        });
        const status = await runtime.getLocalAdvisorServerStatus(savedSettings);
        return {
          ok: true,
          settings: runtime.publicAdvisorSettings(savedSettings),
          status,
          message
        };
      } catch (error) {
        const failure = normalizeAdvisorIpcError(error);
        try {
          failure.status = await runtime.getLocalAdvisorServerStatus(settings);
        } catch (_statusError) {
          // Preserve the original model-test failure when status reconciliation also fails.
        }
        return failure;
      }
    });

    handle('cavalry-advisor:chat', async (event, payload) => {
      const settings = await settingsForRequest(payload);
      if (settings.provider === 'local') {
        return { ok: false, local: true, error: 'The built-in rules advisor is selected.' };
      }
      try {
        const contextualPayload = await runtime.addAdvisorMemoryContext(
          payload || {},
          'chat_completions'
        );
        const result = await runtime.callAdvisorModel(settings, contextualPayload, event);
        if (result && typeof result === 'object') {
          return scrubAdvisorSecretsForRenderer({
            ok: true,
            text: String(result.text == null ? '' : result.text),
            ...(result.message ? { message: result.message } : {}),
            ...(result.usage ? { usage: result.usage } : {})
          });
        }
        return { ok: true, text: result };
      } catch (error) {
        if (runtime.isAdvisorCancellationError(error)) {
          return {
            ok: false,
            cancelled: true,
            requestId: runtime.normalizeAdvisorRequestId(payload && payload.requestId),
            error: 'Cavalry request was cancelled.'
          };
        }
        if (runtime.isAdvisorTimeoutError(error)) {
          return {
            ok: false,
            timeout: true,
            requestId: runtime.normalizeAdvisorRequestId(payload && payload.requestId),
            error:
              'The model did not answer within 5 minutes. Try again, or check the model connection in Settings.'
          };
        }
        throw error;
      }
    });

    handle('cavalry-advisor:agent', async (event, payload) => {
      const settings = await settingsForRequest(payload);
      if (settings.provider === 'local') {
        return { ok: false, local: true, error: 'The built-in rules advisor is selected.' };
      }
      try {
        // A provider response is untrusted input. Strip credential-shaped fields before IPC crosses into the renderer.
        const contextualPayload = await runtime.addAdvisorMemoryContext(payload || {}, 'responses');
        const response = await runtime.callAdvisorAgentTurn(settings, contextualPayload, event);
        return { ok: true, response: scrubAdvisorSecretsForRenderer(response) };
      } catch (error) {
        if (runtime.isAdvisorCancellationError(error)) {
          return {
            ok: false,
            cancelled: true,
            requestId: runtime.normalizeAdvisorRequestId(payload && payload.requestId),
            error: 'Cavalry request was cancelled.'
          };
        }
        throw error;
      }
    });

    handle('cavalry-advisor:get-microphone-status', async () =>
      runtime.getAdvisorMicrophoneAccessStatus()
    );
    handle('cavalry-advisor:request-microphone-access', async () =>
      runtime.requestAdvisorMicrophoneAccess()
    );
    handle('cavalry-advisor:open-microphone-settings', async () =>
      runtime.openAdvisorMicrophoneSettings()
    );

    handle('cavalry-advisor:transcribe-audio', async (event, payload) => {
      const settings = await runtime.loadAdvisorRuntimeSettings();
      try {
        return {
          ok: true,
          text: await runtime.callAdvisorTranscription(settings, payload || {}, event),
          requestId: runtime.normalizeAdvisorRequestId(payload && payload.requestId)
        };
      } catch (error) {
        if (runtime.isAdvisorCancellationError(error)) {
          return {
            ok: false,
            cancelled: true,
            requestId: runtime.normalizeAdvisorRequestId(payload && payload.requestId),
            error: 'Voice transcription was cancelled.'
          };
        }
        if (runtime.isAdvisorTimeoutError(error)) {
          return {
            ok: false,
            timeout: true,
            requestId: runtime.normalizeAdvisorRequestId(payload && payload.requestId),
            error: 'Voice transcription timed out.'
          };
        }
        return {
          ok: false,
          requestId: runtime.normalizeAdvisorRequestId(payload && payload.requestId),
          error: error && error.message ? error.message : 'Voice transcription failed.'
        };
      }
    });

    handle('cavalry-advisor:cancel', async (event, payload) => {
      return runtime.cancelAdvisorRequest(payload && payload.requestId, event);
    });

    return { channels: ADVISOR_IPC_CHANNELS.slice() };
  }

  return { registerHandlers };
}

module.exports = {
  ADVISOR_IPC_CHANNELS,
  createAdvisorIpcController,
  normalizeAdvisorIpcError,
  scrubAdvisorSecretsForRenderer
};
