import {
  ADVISOR_PROVIDER_KIND,
  buildAdvisorModelCapabilityProfile,
  getAdvisorProviderPrivacyDestination
} from './model-capabilities.js';

export const ADVISOR_RUNTIME_PROVIDER_KIND = Object.freeze({
  RULES_ENGINE: 'rules_engine',
  LOCAL_LLM: 'local_llm',
  REMOTE_LLM: 'remote_llm'
});

export const ADVISOR_PROVIDER_PROFILE_VERSION = 'cavalry.advisor_provider_profile.v1';

function asString(value) {
  return String(value || '').trim();
}

function mapRuntimeKind(providerKind) {
  if (providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return ADVISOR_RUNTIME_PROVIDER_KIND.LOCAL_LLM;
  }
  if (providerKind === ADVISOR_PROVIDER_KIND.REMOTE_MODEL) {
    return ADVISOR_RUNTIME_PROVIDER_KIND.REMOTE_LLM;
  }
  return ADVISOR_RUNTIME_PROVIDER_KIND.RULES_ENGINE;
}

function getRuntimeLabel(runtimeProviderKind) {
  if (runtimeProviderKind === ADVISOR_RUNTIME_PROVIDER_KIND.LOCAL_LLM) {
    return 'Local model';
  }
  if (runtimeProviderKind === ADVISOR_RUNTIME_PROVIDER_KIND.REMOTE_LLM) {
    return 'API model';
  }
  return 'Built-in rules advisor';
}

function getRuntimeStatusNoun(runtimeProviderKind) {
  if (runtimeProviderKind === ADVISOR_RUNTIME_PROVIDER_KIND.LOCAL_LLM) {
    return 'local model';
  }
  if (runtimeProviderKind === ADVISOR_RUNTIME_PROVIDER_KIND.REMOTE_LLM) {
    return 'Advisor model';
  }
  return 'built-in rules advisor';
}

export function normalizeAdvisorProviderProfile(settings = {}, calibration = {}) {
  const capabilityProfile = buildAdvisorModelCapabilityProfile(settings, calibration);
  const providerKind = capabilityProfile.providerKind || ADVISOR_PROVIDER_KIND.RULES;
  const runtimeProviderKind = mapRuntimeKind(providerKind);
  return {
    profileVersion: ADVISOR_PROVIDER_PROFILE_VERSION,
    provider: asString(settings.provider) || 'local',
    legacyProviderKind: providerKind,
    runtimeProviderKind,
    label: getRuntimeLabel(runtimeProviderKind),
    statusNoun: getRuntimeStatusNoun(runtimeProviderKind),
    modelIdentity: capabilityProfile.modelIdentity || '',
    privacyDestination: getAdvisorProviderPrivacyDestination(providerKind),
    capabilityProfile
  };
}

export function getAdvisorRuntimeProviderKind(settings = {}, calibration = {}) {
  return normalizeAdvisorProviderProfile(settings, calibration).runtimeProviderKind;
}

export function getAdvisorProviderStatusNoun(settings = {}, calibration = {}) {
  return normalizeAdvisorProviderProfile(settings, calibration).statusNoun;
}

export function getAdvisorProviderStatusCopy(settings = {}, phase = 'running', options = {}) {
  const profile = normalizeAdvisorProviderProfile(settings, options.calibration || {});
  const phaseName = asString(phase) || 'running';
  if (profile.runtimeProviderKind === ADVISOR_RUNTIME_PROVIDER_KIND.RULES_ENGINE) {
    if (phaseName === 'starting') {
      return 'Reviewing...';
    }
    if (phaseName === 'retrying') {
      return 'Retrying built-in rules advisor...';
    }
    return 'Running built-in rules advisor...';
  }
  const noun = profile.statusNoun;
  if (phaseName === 'starting') {
    return 'Starting ' + noun + '...';
  }
  if (phaseName === 'retrying') {
    return 'Retrying ' + noun + '...';
  }
  return 'Running ' + noun + '...';
}
