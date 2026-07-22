export const ADVISOR_PROVIDER_KIND = Object.freeze({
  RULES: 'rules',
  LOCAL_MODEL: 'local_model',
  REMOTE_MODEL: 'remote_model'
});

export const ADVISOR_MODEL_PROFILE_VERSION = 'cavalry.advisor_model_profile.v1';

function asString(value) {
  return String(value || '').trim();
}

function asInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

export function normalizeAdvisorProviderKind(provider, fallback) {
  const value = asString(provider || fallback || 'local');
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

export function getAdvisorProviderKind(settings = {}) {
  return normalizeAdvisorProviderKind(settings.providerKind || settings.provider);
}

export function getAdvisorProviderPrivacyDestination(providerKind) {
  if (providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return 'localhost';
  }
  if (providerKind === ADVISOR_PROVIDER_KIND.REMOTE_MODEL) {
    return 'remote';
  }
  return 'none';
}

export function getAdvisorProviderLabelForKind(providerKind) {
  if (providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return 'Local model';
  }
  if (providerKind === ADVISOR_PROVIDER_KIND.REMOTE_MODEL) {
    return 'Remote/API model';
  }
  return 'Built-in rules';
}

export function getAdvisorPrivacyLabelForKind(providerKind) {
  if (providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return 'Selected context sent to localhost';
  }
  if (providerKind === ADVISOR_PROVIDER_KIND.REMOTE_MODEL) {
    return 'Selected context sent to configured endpoint';
  }
  return 'No model call';
}

export function buildAdvisorModelCapabilityProfile(settings = {}, calibration = {}) {
  const providerKind = getAdvisorProviderKind(settings);
  const contextWindow = asInteger(
    settings.contextWindowTokens,
    providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL ? 32768 : 128000
  );
  const modelIdentity =
    asString(settings.model) ||
    (providerKind === ADVISOR_PROVIDER_KIND.RULES ? 'built-in-rules' : 'configured-model');
  const calibrated = calibration && typeof calibration === 'object' ? calibration : {};
  if (providerKind === ADVISOR_PROVIDER_KIND.RULES) {
    return {
      profileVersion: ADVISOR_MODEL_PROFILE_VERSION,
      providerKind,
      modelIdentity,
      supportsJsonObject: false,
      supportsJsonSchema: false,
      supportsGrammar: false,
      supportsToolSelection: false,
      supportsVision: false,
      reliableContextTokens: 0,
      preferredResponseMode: 'rules',
      maxReliableOutputTokens: 0,
      calibrationTimestamp: asString(calibrated.calibrationTimestamp),
      calibrationResults: calibrated.calibrationResults || {}
    };
  }
  if (providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return {
      profileVersion: ADVISOR_MODEL_PROFILE_VERSION,
      providerKind,
      modelIdentity,
      supportsJsonObject: !!calibrated.supportsJsonObject,
      supportsJsonSchema: !!calibrated.supportsJsonSchema,
      supportsGrammar: !!calibrated.supportsGrammar,
      supportsToolSelection: !!calibrated.supportsToolSelection,
      supportsVision: !!(settings.mmprojPath || calibrated.supportsVision),
      reliableContextTokens: Math.min(
        contextWindow,
        asInteger(calibrated.reliableContextTokens, contextWindow)
      ),
      preferredResponseMode: calibrated.preferredResponseMode || 'prose',
      maxReliableOutputTokens: asInteger(calibrated.maxReliableOutputTokens, 1800),
      calibrationTimestamp: asString(calibrated.calibrationTimestamp),
      calibrationResults: calibrated.calibrationResults || {}
    };
  }
  return {
    profileVersion: ADVISOR_MODEL_PROFILE_VERSION,
    providerKind,
    modelIdentity,
    supportsJsonObject: calibrated.supportsJsonObject !== false,
    supportsJsonSchema: calibrated.supportsJsonSchema !== false,
    supportsGrammar: !!calibrated.supportsGrammar,
    supportsToolSelection: calibrated.supportsToolSelection !== false,
    supportsVision: calibrated.supportsVision !== false,
    reliableContextTokens: Math.min(
      contextWindow,
      asInteger(calibrated.reliableContextTokens, contextWindow)
    ),
    preferredResponseMode: calibrated.preferredResponseMode || 'prose',
    maxReliableOutputTokens: asInteger(calibrated.maxReliableOutputTokens, 2600),
    calibrationTimestamp: asString(calibrated.calibrationTimestamp),
    calibrationResults: calibrated.calibrationResults || {}
  };
}

export function chooseAdvisorResponseMode(capabilityProfile = {}, route = {}) {
  const providerKind = capabilityProfile.providerKind || ADVISOR_PROVIDER_KIND.RULES;
  if (providerKind === ADVISOR_PROVIDER_KIND.RULES) {
    return 'rules';
  }
  if (route && route.responseMode) {
    return asString(route.responseMode);
  }
  if (
    capabilityProfile.preferredResponseMode === 'json_schema' &&
    capabilityProfile.supportsJsonSchema
  ) {
    return 'json_schema';
  }
  if (capabilityProfile.preferredResponseMode === 'json' && capabilityProfile.supportsJsonObject) {
    return 'json';
  }
  return 'prose';
}
