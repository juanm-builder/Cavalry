import { getAdvisorPacketSelection } from './contracts.js';
import { normalizeAdvisorProviderProfile } from './provider-profile.js';

export const ADVISOR_TURN_TRACE_VERSION = 'cavalry.advisor_turn_trace.v1';

function asString(value) {
  return String(value || '').trim();
}

function asInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback;
}

function normalizeStringArray(value, limit = 80) {
  const seen = {};
  return (Array.isArray(value) ? value : [])
    .map(asString)
    .filter(Boolean)
    .filter((item) => {
      if (seen[item]) {
        return false;
      }
      seen[item] = true;
      return true;
    })
    .slice(0, limit);
}

function getPacketKinds(summary) {
  return Object.keys(summary && summary.data_packets ? summary.data_packets : {});
}

function getEventTypes(events) {
  return normalizeStringArray(
    (Array.isArray(events) ? events : []).map((event) => event && event.type),
    120
  );
}

function getValidationIssueCodes(events) {
  const codes = [];
  (Array.isArray(events) ? events : []).forEach((event) => {
    normalizeStringArray(event && event.metadata && event.metadata.issueCodes).forEach((code) => {
      if (codes.indexOf(code) < 0) {
        codes.push(code);
      }
    });
  });
  return codes;
}

function summarizeActions(actions) {
  const items = Array.isArray(actions) ? actions : [];
  return {
    count: items.length,
    ids: normalizeStringArray(
      items.map((action) => action && action.id),
      80
    ),
    types: normalizeStringArray(
      items.map((action) => action && action.type),
      20
    ),
    reviewableDraftActionCount: items.filter(
      (action) => action && action.type === 'ai_draft_reference'
    ).length,
    transactionDraftActionCount: items.filter(
      (action) => action && action.type === 'transaction_draft'
    ).length,
    commandActionCount: items.filter((action) => action && action.type === 'advisor_command').length
  };
}

function summarizeDraftGroups(draftGroups) {
  const groups = Array.isArray(draftGroups) ? draftGroups : [];
  return {
    count: groups.length,
    ids: normalizeStringArray(
      groups.map((group) => group && (group.groupId || group.group_id)),
      80
    ),
    statuses: normalizeStringArray(
      groups.map((group) => group && group.status),
      20
    ),
    draftIds: normalizeStringArray(
      groups.reduce(
        (ids, group) => ids.concat(group && Array.isArray(group.draftIds) ? group.draftIds : []),
        []
      ),
      120
    )
  };
}

function summarizeDrafts(drafts) {
  const items = Array.isArray(drafts) ? drafts : [];
  return {
    count: items.length,
    ids: normalizeStringArray(
      items.map((draft) => draft && draft.id),
      100
    ),
    objectTypes: normalizeStringArray(
      items.map((draft) => draft && draft.objectType),
      20
    ),
    operations: normalizeStringArray(
      items.map((draft) => draft && draft.operation),
      20
    ),
    statuses: normalizeStringArray(
      items.map((draft) => draft && draft.status),
      20
    ),
    reviewableCount: items.filter(
      (draft) => draft && ['pending', 'needs_fix'].indexOf(asString(draft.status)) >= 0
    ).length
  };
}

function summarizeBlocked(blockedDraftCandidates) {
  const items = Array.isArray(blockedDraftCandidates) ? blockedDraftCandidates : [];
  return {
    count: items.length,
    stages: normalizeStringArray(
      items.map((item) => item && item.stage),
      20
    ),
    reasons: normalizeStringArray(
      items.map(
        (item) => item && (item.error || item.reason || (item.decision && item.decision.reason))
      ),
      20
    )
  };
}

function summarizeEvidence(evidenceWorkspace) {
  const workspace =
    evidenceWorkspace && typeof evidenceWorkspace === 'object' ? evidenceWorkspace : {};
  return {
    factCount: asInteger(workspace.facts && workspace.facts.length),
    uncertaintyCount: asInteger(workspace.uncertainties && workspace.uncertainties.length),
    coverageCount: asInteger(workspace.coverage && workspace.coverage.length)
  };
}

function summarizeConversation(nextConversationState) {
  const state =
    nextConversationState && typeof nextConversationState === 'object' ? nextConversationState : {};
  const recommendation =
    state.lastRecommendation && typeof state.lastRecommendation === 'object'
      ? state.lastRecommendation
      : null;
  return {
    hasState: !!Object.keys(state).length,
    lastTargetIntent: asString(state.lastTargetIntent),
    lastPacketKind: asString(state.lastPacketKind),
    hasLastRecommendation: !!recommendation,
    lastRecommendationType: asString(recommendation && recommendation.type),
    lastRecommendationCandidateCount: asInteger(
      recommendation && recommendation.candidates && recommendation.candidates.length
    )
  };
}

function summarizeFallback(status, fallbackReason, responseSkeleton, message) {
  const used = asString(status) === 'fallback';
  const text = asString(message && message.text);
  return {
    used,
    reason: asString(fallbackReason),
    usedSkeleton: used && !!(responseSkeleton && responseSkeleton.responseVersion),
    hasUsefulCopy: used
      ? !!text && !/^I could not produce a verified Advisor answer/i.test(text)
      : !!text
  };
}

function buildSafetySummary({
  actions,
  preparedDrafts,
  draftGroups,
  blockedDraftCandidates,
  directWorkbookMutation,
  modelOutputAcceptedAsMutation
} = {}) {
  const draftSummary = summarizeDrafts(preparedDrafts);
  const groupSummary = summarizeDraftGroups(draftGroups);
  const actionSummary = summarizeActions(actions);
  return {
    directWorkbookMutation: directWorkbookMutation === true,
    modelOutputAcceptedAsMutation: modelOutputAcceptedAsMutation === true,
    writesRequireReview: true,
    reviewableDraftCount: draftSummary.reviewableCount,
    reviewableDraftActionCount: actionSummary.reviewableDraftActionCount,
    reviewableActionCount:
      actionSummary.reviewableDraftActionCount + actionSummary.transactionDraftActionCount,
    draftGroupCount: groupSummary.count,
    blockedDraftCandidateCount: summarizeBlocked(blockedDraftCandidates).count
  };
}

function summarizeModelDiagnostics(modelDiagnostics) {
  const source = modelDiagnostics && typeof modelDiagnostics === 'object' ? modelDiagnostics : {};
  const attempts = (Array.isArray(source.attempts) ? source.attempts : []).map((attempt) => ({
    attempt: asInteger(attempt && attempt.attempt),
    retrying: attempt && attempt.retrying === true,
    responseMode: asString(attempt && attempt.responseMode),
    modelAttempted: attempt && attempt.modelAttempted === true,
    transportSucceeded: attempt && attempt.transportSucceeded === true,
    parseSucceeded: attempt && attempt.parseSucceeded === true,
    validationSucceeded: attempt && attempt.validationSucceeded === true,
    validationIssueCodes: normalizeStringArray(attempt && attempt.validationIssueCodes, 40),
    retryInstruction: asString(attempt && attempt.retryInstruction),
    failureReason: asString(attempt && attempt.failureReason),
    modelOutputExcerpt: asString(attempt && attempt.modelOutputExcerpt)
  }));
  return {
    schemaVersion: asString(source.schemaVersion) || 'cavalry.advisor_model_diagnostics.v1',
    attempts,
    retryAttempted: source.retryAttempted === true || attempts.some((attempt) => attempt.retrying),
    finalFailureReason: asString(source.finalFailureReason),
    finalValidationIssueCodes: normalizeStringArray(source.finalValidationIssueCodes, 60)
  };
}

export function buildAdvisorTurnTrace({
  requestId,
  traceId,
  status,
  provider,
  settings,
  capabilityProfile,
  responseMode,
  route,
  turn,
  summary,
  events,
  dataPlan,
  attempts,
  fallbackReason,
  responseSkeleton,
  toolResults,
  evidenceWorkspace,
  actions,
  draftGroups,
  preparedDrafts,
  blockedDraftCandidates,
  nextConversationState,
  message,
  privacy,
  directWorkbookMutation,
  modelOutputAcceptedAsMutation,
  modelDiagnostics
} = {}) {
  const providerSettings = settings && Object.keys(settings).length ? settings : { provider };
  const providerProfile = normalizeAdvisorProviderProfile(
    providerSettings,
    capabilityProfile || {}
  );
  return {
    traceVersion: ADVISOR_TURN_TRACE_VERSION,
    requestId: asString(requestId),
    traceId: asString(traceId),
    status: asString(status),
    provider: asString(provider || providerProfile.provider),
    providerProfile: {
      runtimeProviderKind: providerProfile.runtimeProviderKind,
      legacyProviderKind: providerProfile.legacyProviderKind,
      label: providerProfile.label,
      privacyDestination: providerProfile.privacyDestination,
      modelIdentity: providerProfile.modelIdentity
    },
    route: {
      route: asString(route && route.route),
      intent: asString(route && route.intent),
      targetIntent: asString(turn && (turn.targetIntent || turn.intent)),
      responseMode: asString(responseMode)
    },
    packet: {
      kinds: getPacketKinds(summary),
      selection: getAdvisorPacketSelection(summary)
    },
    dataPlan: dataPlan || null,
    attempts: asInteger(attempts),
    events: {
      count: Array.isArray(events) ? events.length : 0,
      types: getEventTypes(events),
      validationIssueCodes: getValidationIssueCodes(events)
    },
    fallback: summarizeFallback(status, fallbackReason, responseSkeleton, message),
    actions: summarizeActions(actions),
    draftGroups: summarizeDraftGroups(draftGroups),
    preparedDrafts: summarizeDrafts(preparedDrafts),
    blockedDraftCandidates: summarizeBlocked(blockedDraftCandidates),
    evidence: summarizeEvidence(evidenceWorkspace),
    tools: {
      count: Array.isArray(toolResults) ? toolResults.length : 0,
      names: normalizeStringArray(
        (Array.isArray(toolResults) ? toolResults : []).map((result) => result && result.toolName),
        40
      )
    },
    conversation: summarizeConversation(nextConversationState),
    safety: buildSafetySummary({
      actions,
      preparedDrafts,
      draftGroups,
      blockedDraftCandidates,
      directWorkbookMutation,
      modelOutputAcceptedAsMutation
    }),
    modelDiagnostics: summarizeModelDiagnostics(modelDiagnostics),
    privacy: privacy || null
  };
}

export function shouldExposeAdvisorTurnTrace(input = {}, settings = {}) {
  return (
    input.exposeTurnTrace === true ||
    input.devMode === true ||
    settings.exposeAdvisorTrace === true ||
    settings.devMode === true
  );
}
