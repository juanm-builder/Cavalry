import { ADVISOR_INTENTS } from '../features/advisor/advisor-controller.js';

const ADVISOR_RUNTIME_METHODS = Object.freeze({
  'settings-save': 'saveSettings',
  'connection-test': 'testConnection',
  'model-choose': 'chooseLocalModel',
  'vision-projector-choose': 'chooseMmproj',
  'microphone-request': 'requestMicrophoneAccess',
  'microphone-settings-open': 'openMicrophoneSettings',
  'microphone-status-refresh': 'getMicrophoneStatus'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value);
}

function shouldShowLocalServer(settings, status) {
  const provider = asString(settings && settings.provider);
  return provider === 'custom' || (status && status.running === true && status.manageable === true);
}

function advisorWorkbookContext(workbook) {
  const source = asObject(workbook);
  return {
    workbook: {
      id: asString(source.id),
      name: asString(source.name),
      year: source.year,
      currency: asString(source.currency),
      accounts: asArray(source.accounts),
      categories: asArray(source.categories),
      transactions: asArray(source.transactions).slice(-250),
      recurringItems: asArray(source.recurringItems),
      sheets: asArray(source.sheets)
    }
  };
}

function isAdvisorWriteRequest(prompt) {
  return /\b(add|record|create|log|apply|approve|confirm|post|commit|delete|remove|archive|rename|edit|update)\b/i.test(
    asString(prompt)
  );
}

export function advisorServerToggle(status = {}) {
  return {
    disabled: status.starting === true,
    label: status.running || status.starting ? 'Stop Model' : 'Start Model',
    icon: status.running || status.starting ? 'stop' : 'play_arrow'
  };
}

export function advisorMicrophoneModel(result = {}) {
  const source = asObject(result.status || result);
  const status = asString(source.status || (source.granted ? 'granted' : 'unknown')).toLowerCase();
  const denied = source.needsSystemSettings === true || ['denied', 'restricted'].includes(status);
  const granted = source.granted === true || status === 'granted';
  return {
    status,
    title: granted
      ? 'Microphone enabled'
      : denied
        ? 'Microphone access blocked'
        : 'Microphone access',
    detail:
      asString(source.message || source.error) ||
      (granted
        ? 'Voice input is enabled.'
        : denied
          ? 'Enable Cavalry for Mac in macOS Microphone settings, then quit and reopen the app.'
          : 'Request access to use voice input with Cavalry.'),
    tone: granted ? 'good' : denied ? 'bad' : 'info',
    canRequest: !granted && !denied && source.requestable !== false,
    canOpenSettings: denied,
    canRefresh: true,
    requestLabel: ['not-determined', 'unknown'].includes(status) ? 'Request Access' : 'Check Access'
  };
}

export async function loadAdvisorRuntimeState(advisor) {
  const [settingsResult, serverResult, microphoneResult] = await Promise.allSettled([
    advisor.invoke('getSettings'),
    advisor.invoke('getServerStatus'),
    advisor.invoke('getMicrophoneStatus')
  ]);
  const settingsPayload =
    settingsResult.status === 'fulfilled' ? asObject(settingsResult.value) : {};
  const serverPayload = serverResult.status === 'fulfilled' ? asObject(serverResult.value) : {};
  const microphonePayload =
    microphoneResult.status === 'fulfilled' ? asObject(microphoneResult.value) : {};
  const serverStatus = asObject(serverPayload.status || serverPayload);
  const advisorSettings = asObject(settingsPayload.settings);
  const showLocalServer = shouldShowLocalServer(advisorSettings, serverStatus);
  return {
    advisorSettings,
    advisorServerStatus: serverStatus,
    advisorServerToggleState: advisorServerToggle(serverStatus),
    advisorServerDetail: showLocalServer
      ? asString(serverStatus.message || serverStatus.detail)
      : '',
    advisorMicrophone: advisorMicrophoneModel(microphonePayload)
  };
}

export function createAdvisorRuntimeProvider({ advisor, createId, settings }) {
  const runtimeSettings = asObject(settings);
  if (!runtimeSettings.provider || runtimeSettings.provider === 'local') return null;
  return {
    id: `desktop_${runtimeSettings.provider}`,
    kind: 'desktop-adapter',
    network: false,
    async run(request = {}) {
      if (isAdvisorWriteRequest(request.prompt)) {
        return {
          ok: false,
          status: 'draft_fallback',
          message: 'Write requests are routed through Cavalry’s local draft-first safety layer.'
        };
      }
      const requestId = createId('advisor_request');
      const result = await advisor.invoke('chat', {
        requestId,
        temperature: 0.15,
        top_p: 0.9,
        max_tokens: 1400,
        messages: [
          {
            role: 'system',
            content:
              'You are Cavalry. Answer only from the supplied workbook context. Never claim to mutate, post, apply, delete, or save workbook data.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              question: asString(request.prompt),
              ...advisorWorkbookContext(request.workbook)
            })
          }
        ]
      });
      if (!(result && result.ok)) {
        return {
          ok: false,
          status: result && result.cancelled ? 'cancelled' : 'unavailable',
          message: asString(result && result.error) || 'The configured model is unavailable.'
        };
      }
      return {
        ok: true,
        status: 'answered',
        message: asString(result.text) || 'The configured model returned an empty response.'
      };
    }
  };
}

export function createAdvisorServices(featureServices, provider) {
  return {
    ...featureServices,
    provider: provider || undefined,
    settings: {
      enabled: true,
      provider: 'local_rules',
      allowDraftCreation: true,
      allowExternalNetwork: false,
      allowDirectMutation: false,
      allowDraftApply: false
    }
  };
}

export async function executeAdvisorApplicationIntent(payload, context) {
  const { advisor, navigate, reportError, setBillsViewState, setSettingsViewState } = context;
  const operation = asString(payload && payload.operation);
  const isRecurringScan = operation === 'recurring-scan';
  if (isRecurringScan) {
    setBillsViewState((current) => ({
      ...current,
      subscriptionReview: {
        status: 'modeling',
        progressPercent: 0,
        candidates: [],
        includeIgnored: payload.includeIgnored === true,
        error: ''
      }
    }));
  }
  try {
    if (operation === 'provider-change') {
      const provider = asString(payload.provider) || 'local';
      setSettingsViewState((current) => ({
        ...current,
        advisorSettings: {
          ...asObject(current.advisorSettings),
          provider,
          ...(provider === 'openai'
            ? {
                apiMode: 'responses',
                endpoint: 'https://api.openai.com/v1/responses',
                model: 'gpt-5.4-mini'
              }
            : provider === 'custom'
              ? {
                  apiMode: 'chat_completions',
                  endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
                  model: 'cavalry-advisor'
                }
              : { apiMode: 'chat_completions', endpoint: '', model: '' })
        },
        advisorConnection: '',
        advisorServerDetail: provider === 'custom' ? current.advisorServerDetail : '',
        error: '',
        feedbackSection: 'settings-advisor',
        notice: 'Assistant connection updated. Save Assistant to persist it.'
      }));
      return { ok: true };
    }
    if (operation === 'summary-open') {
      navigate('dashboard');
      return { ok: true };
    }
    if (isRecurringScan) {
      setBillsViewState((current) => ({
        ...current,
        subscriptionReview: {
          status: 'complete',
          progressPercent: 100,
          candidates: [],
          includeIgnored: payload.includeIgnored === true,
          error: ''
        }
      }));
      return {
        ok: true,
        candidates: [],
        message: 'No subscription candidates were created without an explicit review model result.'
      };
    }

    let method = ADVISOR_RUNTIME_METHODS[operation];
    let result;
    if (operation === 'server-toggle') {
      const currentStatusResult = await advisor.invoke('getServerStatus', payload);
      const currentStatus = asObject(
        currentStatusResult && (currentStatusResult.status || currentStatusResult)
      );
      method = currentStatus.running || currentStatus.starting ? 'stopServer' : 'startServer';
    }
    if (!method) {
      throw new Error(`Assistant operation ${operation || 'unknown'} is unavailable.`);
    }
    if (operation === 'connection-test') {
      setSettingsViewState((current) => ({
        ...current,
        advisorConnection:
          payload.provider === 'custom' ? 'Testing local model…' : 'Testing OpenAI…',
        error: '',
        feedbackSection: 'settings-advisor',
        notice: 'Running a live model test…'
      }));
    }
    result = await advisor.invoke(method, payload);
    if (!result || result.ok === false || result.error) {
      const message = asString(
        (result && result.error) || `Assistant ${operation || 'request'} is unavailable.`
      );
      setSettingsViewState((current) => ({
        ...current,
        error: message,
        feedbackSection: 'settings-advisor',
        notice: ''
      }));
      reportError('advisor-intent', message, `advisor-intent.${operation || 'unknown'}-failed`);
      return result || { ok: false, error: message };
    }
    const safeSettings = { ...asObject(payload), ...asObject(result.settings) };
    delete safeSettings.operation;
    delete safeSettings.apiKey;
    if (operation === 'model-choose' && result.path) safeSettings.localModelPath = result.path;
    if (operation === 'model-choose' && result.mmprojPath)
      safeSettings.mmprojPath = result.mmprojPath;
    if (operation === 'vision-projector-choose' && result.path)
      safeSettings.mmprojPath = result.path;
    const serverStatus = asObject(result.status);
    const effectiveSettings = {
      ...asObject(payload),
      ...asObject(result.settings)
    };
    const showLocalServer = shouldShowLocalServer(effectiveSettings, serverStatus);
    const microphoneOperation = operation.startsWith('microphone-');
    setSettingsViewState((current) => ({
      ...current,
      advisorSettings: {
        ...asObject(current.advisorSettings),
        ...safeSettings
      },
      ...(Object.keys(serverStatus).length
        ? {
            advisorServerStatus: serverStatus,
            advisorServerToggleState: advisorServerToggle(serverStatus),
            advisorServerDetail: showLocalServer
              ? asString(serverStatus.message || serverStatus.detail)
              : ''
          }
        : {}),
      ...(microphoneOperation ? { advisorMicrophone: advisorMicrophoneModel(result) } : {}),
      advisorConnection:
        operation === 'connection-test' ? asString(result.message) : current.advisorConnection,
      error: '',
      feedbackSection: 'settings-advisor',
      notice: asString(result.message) || `Assistant ${operation || 'request'} completed.`
    }));
    return result;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (isRecurringScan) {
      setBillsViewState((current) => ({
        ...current,
        subscriptionReview: {
          ...asObject(current.subscriptionReview),
          status: 'error',
          error: message
        }
      }));
    } else {
      setSettingsViewState((current) => ({
        ...current,
        error: message,
        feedbackSection: 'settings-advisor',
        notice: ''
      }));
    }
    reportError('advisor-intent', message, `advisor-intent.${operation || 'unknown'}-failed`);
    return { ok: false, error: message };
  }
}

export async function executeAdvisorViewIntent(intent, context) {
  const { advisor, filePicker, getWorkbook, navigate, saveDownload, setSelectedDraftKey } = context;
  const source = asObject(intent);
  const payload = asObject(source.payload);
  if (source.type === 'advisor/provider-action') {
    const draftGroupId = asString(payload.draftGroupId || payload.draft_group_id);
    if (draftGroupId) setSelectedDraftKey(`external:${draftGroupId}`);
    navigate('dashboard');
    return { ok: true };
  }
  if (source.type === ADVISOR_INTENTS.OPEN_SETTINGS) {
    navigate('settings');
    return { ok: true };
  }
  if (source.type === ADVISOR_INTENTS.CANCEL_REQUEST) {
    return advisor.invoke('cancel', payload);
  }
  if (source.type === ADVISOR_INTENTS.PICK_ATTACHMENTS) {
    return filePicker.openText({ accept: payload.accept || '' });
  }
  if (source.type === ADVISOR_INTENTS.TOGGLE_VOICE) {
    const statusResult = await advisor.invoke('getMicrophoneStatus');
    const status = asObject(statusResult && (statusResult.status || statusResult));
    if (status.granted === true || status.status === 'granted') return statusResult;
    return advisor.invoke('requestMicrophoneAccess');
  }
  if (source.type === ADVISOR_INTENTS.EXPORT_THREAD) {
    const workbook = getWorkbook();
    const thread = asArray(workbook && workbook.advisorThreads).find(
      (item) => item && item.id === payload.threadId
    );
    if (!thread) return { ok: false, error: 'Legacy chat thread was not found.' };
    const contents = [
      `# ${asString(thread.title) || 'Legacy chat'}`,
      '',
      ...asArray(thread.messages).flatMap((message) => [
        `## ${message && message.role === 'user' ? 'You' : 'Cavalry'}`,
        '',
        asString(message && (message.text || message.content)),
        ''
      ])
    ].join('\n');
    return saveDownload(
      {
        suggestedName: `${
          asString(thread.title || 'advisor-chat')
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase() || 'advisor-chat'
        }.md`,
        mimeType: 'text/markdown;charset=utf-8',
        contents
      },
      'advisor-export'
    );
  }
  if ([ADVISOR_INTENTS.REMOVE_ATTACHMENT, ADVISOR_INTENTS.OPEN_SOURCE].includes(source.type)) {
    return { ok: true };
  }
  return { ok: false, unsupported: true };
}
