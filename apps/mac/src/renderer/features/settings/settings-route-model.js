import { buildSettingsRouteViewModel } from '@cavalry/finance-core';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function getActiveCounterparties(workbook) {
  return asArray(workbook && workbook.counterparties).filter((counterparty) => {
    return counterparty && counterparty.isActive !== false;
  });
}

export function buildSettingsRouteModel(workbook, viewState = {}, runtime = {}) {
  if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
    throw new TypeError('Settings route models require a hydrated workbook.');
  }

  const state = asObject(viewState);
  const facts = asObject(runtime);
  const model = buildSettingsRouteViewModel(workbook, {
    saveStatusLabel: asString(facts.saveStatusLabel || state.saveStatusLabel),
    fileAutosave: asObject(facts.fileAutosave || state.fileAutosave),
    canSaveFileNow: facts.canSaveFileNow === true || state.canSaveFileNow === true,
    canRevealFile: facts.canRevealFile === true || state.canRevealFile === true,
    canChooseAutosaveFile:
      facts.canChooseAutosaveFile === true || state.canChooseAutosaveFile === true,
    counterparties: getActiveCounterparties(workbook),
    health: asObject(facts.health || state.health),
    visibleRangeLabel: asString(facts.visibleRangeLabel || state.visibleRangeLabel),
    lastSavedAt: asString(facts.lastSavedAt || state.lastSavedAt),
    advisorSettings: asObject(facts.advisorSettings || state.advisorSettings),
    advisorProviderLabel: asString(facts.advisorProviderLabel || state.advisorProviderLabel),
    advisorStatus: asString(facts.advisorStatus || state.advisorStatus),
    advisorConnection: asString(facts.advisorConnection || state.advisorConnection),
    advisorServerStatus: asObject(facts.advisorServerStatus || state.advisorServerStatus),
    advisorServerToggleState: asObject(
      facts.advisorServerToggleState || state.advisorServerToggleState
    ),
    advisorServerDetail: asString(facts.advisorServerDetail || state.advisorServerDetail),
    advisorMicrophone: asObject(facts.advisorMicrophone || state.advisorMicrophone),
    defaultContextWindowTokens:
      Number(facts.defaultContextWindowTokens || state.defaultContextWindowTokens) || 32768,
    contextWindowTokenOptions: asArray(
      facts.contextWindowTokenOptions || state.contextWindowTokenOptions
    ),
    localAdvisorModel: asString(facts.localAdvisorModel || state.localAdvisorModel),
    localAdvisorEndpoint: asString(facts.localAdvisorEndpoint || state.localAdvisorEndpoint),
    openAiModelPlaceholder: asString(facts.openAiModelPlaceholder || state.openAiModelPlaceholder),
    openAiEndpoint: asString(facts.openAiEndpoint || state.openAiEndpoint),
    openAiResponsesEndpoint: asString(
      facts.openAiResponsesEndpoint || state.openAiResponsesEndpoint
    )
  });

  return cloneSerializable({
    ...model,
    cloud: asObject(facts.cloud || state.cloud),
    activeSection: asString(facts.activeSection || state.activeSection),
    activeSectionKey: asString(facts.activeSectionKey || state.activeSectionKey),
    feedback: {
      error: asString(facts.error || state.error),
      notice: asString(facts.notice || state.notice),
      section: asString(facts.feedbackSection || state.feedbackSection)
    },
    viewState: {
      saveStatusLabel: asString(facts.saveStatusLabel || state.saveStatusLabel),
      visibleRangeLabel: asString(facts.visibleRangeLabel || state.visibleRangeLabel)
    }
  });
}
