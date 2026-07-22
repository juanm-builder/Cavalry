export const IN_APP_ADVISOR_FOUNDATION_VERSION = 'cavalry.in_app_advisor.foundation.v1';

export const IN_APP_ADVISOR_DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  provider: 'local_rules',
  allowDraftCreation: false,
  allowExternalNetwork: false,
  allowDirectMutation: false,
  allowDraftApply: false,
  apiKeyConfigured: false
});

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function isSecretFieldName(key) {
  const normalized = asString(key)
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

export function scrubAdvisorSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(scrubAdvisorSecrets);
  }
  if (!(value && typeof value === 'object')) {
    return value;
  }
  return Object.keys(value).reduce((result, key) => {
    if (!isSecretFieldName(key)) {
      result[key] = scrubAdvisorSecrets(value[key]);
    }
    return result;
  }, {});
}

export function normalizeInAppAdvisorSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled === true,
    provider: ['local_rules', 'disabled'].includes(asString(source.provider))
      ? asString(source.provider)
      : 'local_rules',
    allowDraftCreation: source.allowDraftCreation === true,
    allowExternalNetwork: false,
    allowDirectMutation: false,
    allowDraftApply: false,
    apiKeyConfigured: !!asString(source.apiKey || source.api_key || source.apiKeyConfigured),
    modelLabel: asString(source.modelLabel || source.model || ''),
    lastUpdatedAt: asString(source.lastUpdatedAt || source.last_updated_at)
  };
}

export function getRendererSafeAdvisorSettings(settings = {}) {
  const normalized = normalizeInAppAdvisorSettings(settings);
  return {
    enabled: normalized.enabled,
    provider: normalized.provider,
    allowDraftCreation: normalized.allowDraftCreation,
    allowExternalNetwork: false,
    allowDirectMutation: false,
    allowDraftApply: false,
    apiKeyConfigured: normalized.apiKeyConfigured,
    modelLabel: normalized.modelLabel,
    lastUpdatedAt: normalized.lastUpdatedAt
  };
}

export function assertInAppAdvisorEnabled(settings = {}) {
  const normalized = normalizeInAppAdvisorSettings(settings);
  if (!normalized.enabled || normalized.provider === 'disabled') {
    return {
      ok: false,
      code: 'advisor_disabled',
      message: 'In-app Advisor is disabled.'
    };
  }
  return { ok: true, code: 'ok', message: '', settings: normalized };
}

export function createAdvisorProvider(provider = {}) {
  if (!(provider && typeof provider.run === 'function')) {
    throw new Error('Advisor provider must expose a run function.');
  }
  return Object.freeze({
    id: asString(provider.id || 'local_rules'),
    kind: asString(provider.kind || 'local'),
    label: asString(provider.label || 'Local rules advisor'),
    network: provider.network === true || provider.network === 'external' ? 'external' : 'none',
    run: provider.run,
    runAgentTurn: typeof provider.runAgentTurn === 'function' ? provider.runAgentTurn : null
  });
}

export async function runAdvisorProvider(provider, request = {}) {
  const normalizedProvider = createAdvisorProvider(provider);
  const enabled = assertInAppAdvisorEnabled(request.settings || {});
  if (!enabled.ok) {
    return {
      ok: false,
      status: 'disabled',
      code: enabled.code,
      message: enabled.message,
      settings: getRendererSafeAdvisorSettings(request.settings || {})
    };
  }
  if (normalizedProvider.network === 'external' && enabled.settings.allowExternalNetwork !== true) {
    return {
      ok: false,
      status: 'blocked',
      code: 'external_network_disabled',
      message: 'External AI providers are disabled for the in-app Advisor foundation.'
    };
  }
  const result = await normalizedProvider.run(
    Object.assign({}, request, {
      settings: enabled.settings
    })
  );
  return Object.assign(
    {
      ok: true,
      status: 'ok',
      providerId: normalizedProvider.id,
      providerKind: normalizedProvider.kind,
      foundationVersion: IN_APP_ADVISOR_FOUNDATION_VERSION
    },
    scrubAdvisorSecrets(clonePlain(result || {}))
  );
}

export async function runAdvisorProviderAgentTurn(provider, request = {}) {
  const normalizedProvider = createAdvisorProvider(provider);
  const enabled = assertInAppAdvisorEnabled(request.settings || {});
  if (!enabled.ok) {
    return {
      ok: false,
      status: 'disabled',
      code: enabled.code,
      message: enabled.message,
      settings: getRendererSafeAdvisorSettings(request.settings || {})
    };
  }
  if (typeof normalizedProvider.runAgentTurn !== 'function') {
    return {
      ok: false,
      status: 'unsupported',
      code: 'agent_turn_unsupported',
      message: 'Advisor provider does not support agent turns.'
    };
  }
  if (normalizedProvider.network === 'external' && enabled.settings.allowExternalNetwork !== true) {
    return {
      ok: false,
      status: 'blocked',
      code: 'external_network_disabled',
      message: 'External AI providers are disabled for the in-app Advisor foundation.'
    };
  }
  const result = await normalizedProvider.runAgentTurn(
    Object.assign({}, request, {
      settings: enabled.settings
    })
  );
  return Object.assign(
    {
      ok: true,
      status: 'ok',
      providerId: normalizedProvider.id,
      providerKind: normalizedProvider.kind,
      foundationVersion: IN_APP_ADVISOR_FOUNDATION_VERSION
    },
    scrubAdvisorSecrets(clonePlain(result || {}))
  );
}
