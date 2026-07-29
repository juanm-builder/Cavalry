const CAVALRY_LOCAL_ADVISOR_ENDPOINT = 'http://127.0.0.1:8080/v1/chat/completions';
const CAVALRY_LOCAL_ADVISOR_MODEL = 'cavalry-advisor';
const OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_ADVISOR_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const OPENAI_ADVISOR_ENDPOINT = OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT;
const ADVISOR_PROVIDERS = ['local', 'openai', 'custom'];
const ADVISOR_API_MODE = Object.freeze({
  RESPONSES: 'responses',
  CHAT_COMPLETIONS: 'chat_completions'
});
const ADVISOR_API_MODES = [ADVISOR_API_MODE.RESPONSES, ADVISOR_API_MODE.CHAT_COMPLETIONS];
const ADVISOR_PROVIDER_KIND = Object.freeze({
  RULES: 'rules',
  LOCAL_MODEL: 'local_model',
  REMOTE_MODEL: 'remote_model'
});
const DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS = 32768;
const ADVISOR_CONTEXT_WINDOW_TOKEN_OPTIONS = [8192, 16384, 32768, 49152, 65536, 98304, 131072];
const ADVISOR_LLAMA_IMAGE_MIN_TOKENS = 1024;
const ADVISOR_API_KEY_MASK = '************';

function normalizeAdvisorContextWindowTokens(value, fallback) {
  const fallbackValue = Number(fallback) || DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallbackValue;
  }
  const rounded = Math.round(numeric);
  return ADVISOR_CONTEXT_WINDOW_TOKEN_OPTIONS.indexOf(rounded) >= 0 ? rounded : fallbackValue;
}

function getDefaultAdvisorSettings() {
  return {
    provider: 'local',
    providerKind: ADVISOR_PROVIDER_KIND.RULES,
    apiMode: ADVISOR_API_MODE.CHAT_COMPLETIONS,
    endpoint: '',
    model: '',
    localModelPath: '',
    mmprojPath: '',
    contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
    apiKey: ''
  };
}

function getDefaultAdvisorPublicSettings() {
  return {
    provider: 'local',
    providerKind: ADVISOR_PROVIDER_KIND.RULES,
    apiMode: ADVISOR_API_MODE.CHAT_COMPLETIONS,
    endpoint: '',
    model: '',
    localModelPath: '',
    mmprojPath: '',
    contextWindowTokens: DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
    hasApiKey: false,
    apiKeyPreview: ''
  };
}

function normalizeAdvisorProvider(provider, fallback) {
  const value = String(provider || fallback || 'local');
  if (value === ADVISOR_PROVIDER_KIND.RULES || value === 'rules') {
    return 'local';
  }
  if (value === ADVISOR_PROVIDER_KIND.LOCAL_MODEL || value === 'llama_cpp') {
    return 'custom';
  }
  if (value === ADVISOR_PROVIDER_KIND.REMOTE_MODEL || value === 'remote' || value === 'api') {
    return 'openai';
  }
  return ADVISOR_PROVIDERS.indexOf(value) >= 0 ? value : 'local';
}

function normalizeAdvisorProviderKind(provider, fallback) {
  const value = String(provider || fallback || 'local');
  if (value === 'custom' || value === 'llama_cpp' || value === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return ADVISOR_PROVIDER_KIND.LOCAL_MODEL;
  }
  if (
    value === 'openai' ||
    value === 'remote' ||
    value === 'api' ||
    value === ADVISOR_PROVIDER_KIND.REMOTE_MODEL
  ) {
    return ADVISOR_PROVIDER_KIND.REMOTE_MODEL;
  }
  return ADVISOR_PROVIDER_KIND.RULES;
}

function normalizeAdvisorApiMode(value, provider, fallback) {
  const raw = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (raw === ADVISOR_API_MODE.RESPONSES || raw === 'response' || raw === 'agent') {
    return ADVISOR_API_MODE.RESPONSES;
  }
  if (
    raw === ADVISOR_API_MODE.CHAT_COMPLETIONS ||
    raw === 'chat' ||
    raw === 'completion' ||
    raw === 'completions'
  ) {
    return ADVISOR_API_MODE.CHAT_COMPLETIONS;
  }
  return provider === 'openai' ? ADVISOR_API_MODE.RESPONSES : ADVISOR_API_MODE.CHAT_COMPLETIONS;
}

function getOpenAIAdvisorEndpointForMode(apiMode) {
  return normalizeAdvisorApiMode(apiMode, 'openai') === ADVISOR_API_MODE.CHAT_COMPLETIONS
    ? OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT
    : OPENAI_ADVISOR_RESPONSES_ENDPOINT;
}

function getAdvisorProviderKind(settings) {
  const source = settings || {};
  return normalizeAdvisorProviderKind(source.providerKind || source.provider);
}

function normalizeCustomAdvisorEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value || /:\/\/(127\.0\.0\.1|localhost):11434\//.test(value)) {
    return CAVALRY_LOCAL_ADVISOR_ENDPOINT;
  }
  return value;
}

function normalizeAdvisorSettings(raw, existing) {
  const previous = existing || getDefaultAdvisorSettings();
  const rawProvider =
    raw && (raw.providerKind || raw.provider)
      ? raw.providerKind || raw.provider
      : previous.providerKind || previous.provider;
  const provider = normalizeAdvisorProvider(rawProvider);
  const providerKind = normalizeAdvisorProviderKind(rawProvider);
  const previousProvider = normalizeAdvisorProvider(previous.providerKind || previous.provider);
  const apiMode =
    provider === 'openai'
      ? ADVISOR_API_MODE.RESPONSES
      : normalizeAdvisorApiMode(
          raw && typeof raw.apiMode !== 'undefined' ? raw.apiMode : undefined,
          provider,
          previousProvider === provider ? previous.apiMode : undefined
        );
  const fallbackEndpoint =
    provider === 'openai'
      ? getOpenAIAdvisorEndpointForMode(apiMode)
      : provider === 'custom'
        ? CAVALRY_LOCAL_ADVISOR_ENDPOINT
        : '';
  const rawEndpoint =
    String(
      raw && typeof raw.endpoint !== 'undefined'
        ? raw.endpoint
        : previous.endpoint || fallbackEndpoint
    ).trim() || fallbackEndpoint;
  const endpoint =
    provider === 'custom'
      ? normalizeCustomAdvisorEndpoint(rawEndpoint)
      : provider === 'openai'
        ? OPENAI_ADVISOR_RESPONSES_ENDPOINT
        : rawEndpoint;
  const model =
    String(raw && typeof raw.model !== 'undefined' ? raw.model : previous.model || '').trim() ||
    (provider === 'custom' ? CAVALRY_LOCAL_ADVISOR_MODEL : '');
  const localModelPath = String(
    raw && typeof raw.localModelPath !== 'undefined'
      ? raw.localModelPath
      : previous.localModelPath || ''
  ).trim();
  const mmprojPath = String(
    raw && typeof raw.mmprojPath !== 'undefined' ? raw.mmprojPath : previous.mmprojPath || ''
  ).trim();
  const contextWindowTokens = normalizeAdvisorContextWindowTokens(
    raw && typeof raw.contextWindowTokens !== 'undefined'
      ? raw.contextWindowTokens
      : previous.contextWindowTokens,
    previous.contextWindowTokens
  );
  const nextKey =
    raw && Object.prototype.hasOwnProperty.call(raw, 'apiKey')
      ? String(raw.apiKey || '').trim()
      : previous.apiKey || '';
  return {
    provider,
    providerKind,
    apiMode: provider === 'openai' ? apiMode : ADVISOR_API_MODE.CHAT_COMPLETIONS,
    endpoint: provider === 'local' ? '' : endpoint,
    model: provider === 'local' ? '' : model,
    localModelPath: provider === 'custom' ? localModelPath : '',
    mmprojPath: provider === 'custom' ? mmprojPath : '',
    contextWindowTokens:
      provider === 'custom' ? contextWindowTokens : DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
    apiKey: nextKey
  };
}

function hasPublicAdvisorApiKey(raw, previous) {
  const source = raw || {};
  const prior = previous || {};
  if (Object.prototype.hasOwnProperty.call(source, 'apiKey')) {
    return !!String(source.apiKey || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(source, 'hasApiKey')) {
    return !!source.hasApiKey;
  }
  return !!(prior.hasApiKey || prior.apiKey);
}

function maskAdvisorApiKey(apiKey) {
  return String(apiKey || '').trim() ? ADVISOR_API_KEY_MASK : '';
}

function getPublicAdvisorApiKeyPreview(raw, previous, hasApiKey) {
  const source = raw || {};
  const prior = previous || {};
  if (!hasApiKey) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(source, 'apiKeyPreview') && source.apiKeyPreview) {
    return String(source.apiKeyPreview);
  }
  if (
    Object.prototype.hasOwnProperty.call(source, 'apiKey') &&
    String(source.apiKey || '').trim()
  ) {
    return maskAdvisorApiKey(source.apiKey);
  }
  if (prior.apiKeyPreview) {
    return String(prior.apiKeyPreview);
  }
  if (prior.apiKey) {
    return maskAdvisorApiKey(prior.apiKey);
  }
  return ADVISOR_API_KEY_MASK;
}

function isAdvisorApiKeyMask(value, currentSettings) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  const current = normalizeAdvisorPublicSettings(currentSettings);
  return (
    !!current.hasApiKey &&
    (normalized === ADVISOR_API_KEY_MASK ||
      normalized === String(current.apiKeyPreview || '').trim())
  );
}

function normalizeAdvisorPublicSettings(raw, existing) {
  const previous = existing || getDefaultAdvisorPublicSettings();
  const rawProvider =
    raw && (raw.providerKind || raw.provider)
      ? raw.providerKind || raw.provider
      : previous.providerKind || previous.provider;
  const provider = normalizeAdvisorProvider(rawProvider);
  const providerKind = normalizeAdvisorProviderKind(rawProvider);
  const previousProvider = normalizeAdvisorProvider(previous.providerKind || previous.provider);
  const apiMode =
    provider === 'openai'
      ? ADVISOR_API_MODE.RESPONSES
      : normalizeAdvisorApiMode(
          raw && typeof raw.apiMode !== 'undefined' ? raw.apiMode : undefined,
          provider,
          previousProvider === provider ? previous.apiMode : undefined
        );
  const fallbackEndpoint =
    provider === 'openai'
      ? getOpenAIAdvisorEndpointForMode(apiMode)
      : provider === 'custom'
        ? CAVALRY_LOCAL_ADVISOR_ENDPOINT
        : '';
  const rawEndpoint =
    String(
      raw && typeof raw.endpoint !== 'undefined'
        ? raw.endpoint
        : previous.endpoint || fallbackEndpoint
    ).trim() || fallbackEndpoint;
  const endpoint =
    provider === 'custom'
      ? normalizeCustomAdvisorEndpoint(rawEndpoint)
      : provider === 'openai'
        ? OPENAI_ADVISOR_RESPONSES_ENDPOINT
        : rawEndpoint;
  const model =
    String(raw && typeof raw.model !== 'undefined' ? raw.model : previous.model || '').trim() ||
    (provider === 'custom' ? CAVALRY_LOCAL_ADVISOR_MODEL : '');
  const localModelPath = String(
    raw && typeof raw.localModelPath !== 'undefined'
      ? raw.localModelPath
      : previous.localModelPath || ''
  ).trim();
  const mmprojPath = String(
    raw && typeof raw.mmprojPath !== 'undefined' ? raw.mmprojPath : previous.mmprojPath || ''
  ).trim();
  const contextWindowTokens = normalizeAdvisorContextWindowTokens(
    raw && typeof raw.contextWindowTokens !== 'undefined'
      ? raw.contextWindowTokens
      : previous.contextWindowTokens,
    previous.contextWindowTokens
  );
  const hasApiKey = hasPublicAdvisorApiKey(raw, previous);
  return {
    provider,
    providerKind,
    apiMode: provider === 'openai' ? apiMode : ADVISOR_API_MODE.CHAT_COMPLETIONS,
    endpoint: provider === 'local' ? '' : endpoint,
    model: provider === 'local' ? '' : model,
    localModelPath: provider === 'custom' ? localModelPath : '',
    mmprojPath: provider === 'custom' ? mmprojPath : '',
    contextWindowTokens:
      provider === 'custom' ? contextWindowTokens : DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
    hasApiKey,
    apiKeyPreview: getPublicAdvisorApiKeyPreview(raw, previous, hasApiKey)
  };
}

function publicAdvisorSettings(settings) {
  const normalized = normalizeAdvisorSettings(settings);
  return {
    provider: normalized.provider,
    providerKind: normalized.providerKind,
    apiMode: normalized.apiMode,
    endpoint: normalized.endpoint,
    model: normalized.model,
    localModelPath: normalized.localModelPath,
    mmprojPath: normalized.mmprojPath,
    contextWindowTokens: normalized.contextWindowTokens,
    hasApiKey: !!normalized.apiKey,
    apiKeyPreview: maskAdvisorApiKey(normalized.apiKey)
  };
}

function getAdvisorProviderLabel(provider) {
  const providerKind = normalizeAdvisorProviderKind(provider);
  if (providerKind === ADVISOR_PROVIDER_KIND.REMOTE_MODEL) {
    return 'OpenAI/API';
  }
  if (providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return 'Local llama.cpp';
  }
  return 'Built-in Rules';
}

function getDefaultAdvisorServerStatus() {
  return {
    running: false,
    healthy: false,
    starting: false,
    stopping: false,
    manageable: false,
    source: 'unknown',
    pid: 0,
    baseUrl: '',
    message: ''
  };
}

function normalizeAdvisorServerStatus(status) {
  const source = status || {};
  const pid = Number(source.pid) || 0;
  return {
    running: !!source.running,
    healthy: !!source.healthy,
    starting: !!source.starting,
    stopping: !!source.stopping,
    manageable: !!source.manageable,
    source: String(source.source || 'unknown'),
    pid: pid > 0 ? pid : 0,
    baseUrl: String(source.baseUrl || ''),
    message: String(source.message || '')
  };
}

function isAdvisorServerStoppable(status) {
  const normalized = normalizeAdvisorServerStatus(status);
  return (
    (normalized.running || normalized.starting) &&
    normalized.manageable &&
    (normalized.source === 'managed' || normalized.source === 'adopted')
  );
}

function getAdvisorServerToggleState(settings, status) {
  const normalizedSettings = normalizeAdvisorPublicSettings(settings);
  const normalizedStatus = normalizeAdvisorServerStatus(status);
  if (normalizedStatus.stopping) {
    return {
      shouldStop: false,
      disabled: true,
      label: 'Stopping Model…',
      icon: 'stop_circle'
    };
  }
  const shouldStop = isAdvisorServerStoppable(normalizedStatus);
  if (shouldStop) {
    return {
      shouldStop,
      disabled: false,
      label: 'Stop Model',
      icon: 'stop_circle'
    };
  }
  return {
    shouldStop,
    disabled:
      normalizedSettings.provider !== 'custom' ||
      !normalizedSettings.localModelPath ||
      normalizedStatus.starting,
    label: shouldStop ? 'Stop Model' : normalizedStatus.starting ? 'Starting Model' : 'Start Model',
    icon: shouldStop ? 'stop_circle' : normalizedStatus.starting ? 'hourglass_top' : 'play_arrow'
  };
}

function getAdvisorServerDetail(settings, status) {
  const normalizedSettings = normalizeAdvisorPublicSettings(settings);
  const normalizedStatus = normalizeAdvisorServerStatus(status);
  if (normalizedSettings.provider !== 'custom' && !isAdvisorServerStoppable(normalizedStatus)) {
    return '';
  }
  return (
    (normalizedStatus.message || 'Local model server status is not loaded.') +
    (normalizedStatus.pid ? ' PID ' + String(normalizedStatus.pid) + '.' : '') +
    (normalizedStatus.source && normalizedStatus.source !== 'unknown'
      ? ' Source: ' + normalizedStatus.source + '.'
      : '')
  );
}

function buildAdvisorSettingsPayload(values, currentSettings) {
  const source = values || {};
  const current = normalizeAdvisorPublicSettings(currentSettings);
  const apiKey = String(source.apiKey || '').trim();
  const payload = {
    provider: normalizeAdvisorProvider(source.provider),
    providerKind: normalizeAdvisorProviderKind(source.providerKind || source.provider),
    apiMode:
      normalizeAdvisorProvider(source.provider) === 'openai'
        ? ADVISOR_API_MODE.RESPONSES
        : normalizeAdvisorApiMode(
            source.apiMode,
            normalizeAdvisorProvider(source.provider),
            current.apiMode
          ),
    endpoint: String(source.endpoint || '').trim(),
    model: String(source.model || '').trim(),
    localModelPath: String(source.localModelPath || '').trim(),
    mmprojPath: String(source.mmprojPath || '').trim(),
    contextWindowTokens: normalizeAdvisorContextWindowTokens(
      source.contextWindowTokens,
      current.contextWindowTokens
    )
  };
  if (
    Object.prototype.hasOwnProperty.call(source, 'apiKey') &&
    !isAdvisorApiKeyMask(apiKey, current)
  ) {
    payload.apiKey = apiKey;
  }
  return payload;
}

function buildAdvisorSettingsStoragePayload(payload, currentSettings) {
  const normalized = normalizeAdvisorSettings(payload, currentSettings);
  const stored = {
    provider: normalized.provider,
    providerKind: normalized.providerKind,
    apiMode: normalized.apiMode,
    endpoint: normalized.endpoint,
    model: normalized.model,
    localModelPath: normalized.localModelPath,
    mmprojPath: normalized.mmprojPath,
    contextWindowTokens: normalized.contextWindowTokens
  };
  if (normalized.apiKey) {
    stored.apiKey = normalized.apiKey;
  }
  return stored;
}

function applyAdvisorProviderDefaults(currentSettings, provider) {
  const current = normalizeAdvisorPublicSettings(currentSettings);
  const nextProvider = normalizeAdvisorProvider(provider);
  const nextProviderKind = normalizeAdvisorProviderKind(provider);
  const endpoint =
    nextProvider === 'openai'
      ? getOpenAIAdvisorEndpointForMode(ADVISOR_API_MODE.RESPONSES)
      : nextProvider === 'custom'
        ? CAVALRY_LOCAL_ADVISOR_ENDPOINT
        : '';
  return normalizeAdvisorPublicSettings(
    Object.assign({}, current, {
      provider: nextProvider,
      providerKind: nextProviderKind,
      apiMode:
        nextProvider === 'openai' ? ADVISOR_API_MODE.RESPONSES : ADVISOR_API_MODE.CHAT_COMPLETIONS,
      endpoint: nextProvider === current.provider ? current.endpoint : endpoint,
      model:
        nextProvider === 'custom' && (!current.model || current.provider !== 'custom')
          ? CAVALRY_LOCAL_ADVISOR_MODEL
          : current.model
    }),
    current
  );
}

function llamaServerHelpSupportsFlag(helpText, flag) {
  const escaped = String(flag || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!escaped && new RegExp('(^|\\s)' + escaped + '([,\\s]|$)').test(String(helpText || ''));
}

function getAdvisorLlamaVisionArgs(settings, helpText) {
  const normalized = normalizeAdvisorSettings(settings);
  if (!(normalized.provider === 'custom' && normalized.mmprojPath)) {
    return [];
  }
  if (!llamaServerHelpSupportsFlag(helpText, '--image-min-tokens')) {
    return [];
  }
  return ['--image-min-tokens', String(ADVISOR_LLAMA_IMAGE_MIN_TOKENS)];
}

module.exports = {
  ADVISOR_API_KEY_MASK,
  ADVISOR_API_MODE,
  ADVISOR_API_MODES,
  ADVISOR_LLAMA_IMAGE_MIN_TOKENS,
  ADVISOR_CONTEXT_WINDOW_TOKEN_OPTIONS,
  ADVISOR_PROVIDER_KIND,
  ADVISOR_PROVIDERS,
  CAVALRY_LOCAL_ADVISOR_ENDPOINT,
  CAVALRY_LOCAL_ADVISOR_MODEL,
  DEFAULT_LOCAL_ADVISOR_CONTEXT_WINDOW_TOKENS,
  OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT,
  OPENAI_ADVISOR_ENDPOINT,
  OPENAI_ADVISOR_RESPONSES_ENDPOINT,
  applyAdvisorProviderDefaults,
  buildAdvisorSettingsPayload,
  buildAdvisorSettingsStoragePayload,
  getAdvisorProviderLabel,
  getAdvisorProviderKind,
  getAdvisorLlamaVisionArgs,
  getAdvisorServerDetail,
  getAdvisorServerToggleState,
  getDefaultAdvisorSettings,
  getDefaultAdvisorPublicSettings,
  getDefaultAdvisorServerStatus,
  isAdvisorApiKeyMask,
  isAdvisorServerStoppable,
  maskAdvisorApiKey,
  normalizeAdvisorApiMode,
  normalizeAdvisorSettings,
  normalizeAdvisorContextWindowTokens,
  normalizeAdvisorProvider,
  normalizeAdvisorProviderKind,
  normalizeAdvisorPublicSettings,
  normalizeAdvisorServerStatus,
  normalizeCustomAdvisorEndpoint,
  publicAdvisorSettings
};
