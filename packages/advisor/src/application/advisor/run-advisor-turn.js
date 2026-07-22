import {
  buildAdvisorMessageMeta,
  getAdvisorPacketSelection,
  normalizeAdvisorMessageViewModel,
  normalizeAdvisorTraceSummary
} from './contracts.js';
import {
  buildAdvisorConversationSummary,
  detectAdvisorRepeatedQuestion
} from './conversation-summary.js';
import { runConfiguredAdvisorTask } from './configured-task-runner.js';
import { buildAdvisorReadOnlyActions } from './advisor-actions.js';
import { buildNextAdvisorConversationState } from './advisor-conversation-state.js';
import {
  buildAdvisorCategoryCleanupDraftsFromToolResults,
  buildAdvisorPreparedDraftReferenceActions,
  filterAdvisorActionsForPreparedDrafts,
  mergeAdvisorPreparedDraftGroups,
  persistAdvisorPreparedDraftsToWorkbook
} from './category-cleanup-drafts.js';
import { buildAdvisorDataPlan } from './data-plan.js';
import { ADVISOR_DRAFT_GATE_EVENT_TYPES, runAdvisorDraftReviewGate } from './draft-review-gate.js';
import { buildAdvisorDraftGroupsFromToolResults } from './draft-groups.js';
import { buildAdvisorEvidenceWorkspace } from './evidence-workspace.js';
import { buildAdvisorGenerationProfile } from './generation-profiles.js';
import {
  ADVISOR_PROVIDER_KIND,
  buildAdvisorModelCapabilityProfile,
  chooseAdvisorResponseMode,
  getAdvisorProviderKind,
  getAdvisorProviderPrivacyDestination
} from './model-capabilities.js';
import {
  buildAdvisorResponseReferences,
  buildAdvisorResponseSkeleton,
  renderAdvisorResponseMarkdown
} from './response-skeletons.js';
import {
  buildAdvisorResponseRepairPlan,
  repairAdvisorPresentationAnswer
} from './response-repair.js';
import { buildAdvisorModelFailureMessage } from './model-failure-notes.js';
import { buildAdvisorTurnTrace, shouldExposeAdvisorTurnTrace } from './advisor-turn-trace.js';
import { getAdvisorBrainRoute, getAdvisorQaRoute } from './route-registry.js';
import { runAdvisorToolCall } from './tools/registry.js';

export const ADVISOR_TURN_EVENT_TYPES = Object.freeze({
  RESOLVING_TURN: 'resolving_turn',
  COLLECTING_CONTEXT: 'collecting_context',
  EXECUTING_TOOLS: 'executing_tools',
  BUILDING_PACKET: 'building_packet',
  BUILDING_EVIDENCE: 'building_evidence',
  COMPOSING_RESPONSE: 'composing_response',
  RUNNING_RULES: 'running_rules',
  COMPLETED: 'completed',
  FALLBACK_COMPLETED: 'fallback_completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
});

function defaultRequestId() {
  return (
    'advisor_request_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  );
}

function normalizeAnswerResult(result) {
  if (
    result &&
    typeof result === 'object' &&
    Object.prototype.hasOwnProperty.call(result, 'text')
  ) {
    return {
      text: String(result.text || ''),
      references: Array.isArray(result.references) ? result.references : [],
      responseV2: result.responseV2 || result.response_v2 || null,
      evidenceWorkspace: result.evidenceWorkspace || result.evidence_workspace || null,
      draftGroups: Array.isArray(result.draftGroups || result.draft_groups)
        ? result.draftGroups || result.draft_groups
        : []
    };
  }
  return {
    text: String(result || ''),
    references: [],
    responseV2: null,
    evidenceWorkspace: null,
    draftGroups: []
  };
}

function getProvider(settings) {
  return String(settings && settings.provider ? settings.provider : 'local');
}

function isRulesProvider(settings) {
  return getAdvisorProviderKind(settings) === ADVISOR_PROVIDER_KIND.RULES;
}

function callIfFunction(fn, ...args) {
  return typeof fn === 'function' ? fn(...args) : undefined;
}

function getPacketKinds(summary) {
  return Object.keys(summary && summary.data_packets ? summary.data_packets : {});
}

function getResponseMode(settings, capabilityProfile, route) {
  return chooseAdvisorResponseMode(
    capabilityProfile || buildAdvisorModelCapabilityProfile(settings),
    route
  );
}

function buildModelFailureAnswer() {
  return {
    text: buildAdvisorModelFailureMessage(),
    references: []
  };
}

function shouldShowFallbackDiagnosticCopy(input = {}, settings = {}) {
  return (
    input.devMode === true ||
    settings.devMode === true ||
    input.showAdvisorModelFailureCopy === true ||
    settings.showAdvisorModelFailureCopy === true
  );
}

function buildSkeletonFallbackAnswer(skeletonAnswer, options = {}) {
  const answer = normalizeAnswerResult(skeletonAnswer);
  if (!answer.text) {
    return normalizeAnswerResult(buildModelFailureAnswer());
  }
  if (!options.showDiagnosticCopy) {
    return Object.assign({}, answer, {
      text: [
        "Here is Cavalry's verified built-in review. Nothing changed in your workbook.",
        answer.text
      ].join('\n\n')
    });
  }
  return Object.assign({}, answer, {
    text: [
      "I had trouble generating the polished Advisor answer, so I am showing Cavalry's verified built-in review instead. Nothing changed in your workbook.",
      answer.text
    ].join('\n\n')
  });
}

function buildTraceSummary(events, status, extra = {}) {
  return normalizeAdvisorTraceSummary(
    Object.assign(
      {
        events,
        status
      },
      extra
    )
  );
}

function buildMessageViewModel(
  message,
  summary,
  settings,
  status,
  responseMode,
  attempts,
  fallbackReason,
  actions,
  extras = {}
) {
  const messageDraftGroups =
    Array.isArray(message && message.draftGroups) && message.draftGroups.length
      ? message.draftGroups
      : extras.draftGroups;
  return normalizeAdvisorMessageViewModel({
    text: message && message.text,
    references: message && message.references,
    actions,
    responseV2: message && message.responseV2 ? message.responseV2 : extras.responseV2,
    evidenceWorkspace:
      message && message.evidenceWorkspace ? message.evidenceWorkspace : extras.evidenceWorkspace,
    draftGroups: messageDraftGroups,
    turnTrace: extras.turnTrace,
    advisorMeta: buildAdvisorMessageMeta({
      summary,
      settings,
      status,
      responseMode,
      attempts,
      fallbackReason
    })
  });
}

function exposeTurnTraceOnMessage(message, turnTrace, input, settings) {
  if (!shouldExposeAdvisorTurnTrace(input, settings)) {
    return message;
  }
  return Object.assign({}, message, {
    turnTrace
  });
}

function buildNextState(previousState, turn, summary, message) {
  return buildNextAdvisorConversationState({
    previousState,
    turn,
    summary,
    answerText: message && message.text
  });
}

function getToolWorkbook(input, dependencies) {
  if (input.workbook) {
    return input.workbook;
  }
  if (input.context && input.context.workbook) {
    return input.context.workbook;
  }
  return dependencies.workbook || null;
}

function getToolDateScope(summary, turn) {
  const scope = summary && summary.scope ? summary.scope : {};
  const dateScope = turn && turn.taskSpec && turn.taskSpec.dateScope ? turn.taskSpec.dateScope : {};
  return {
    start: String(scope.period_start || dateScope.start || ''),
    end: String(scope.period_end || dateScope.end || ''),
    label: String(scope.period_label || dateScope.label || ''),
    source: String(scope.scope_source || dateScope.source || '')
  };
}

function getRouteToolLimit(route, input) {
  if (Number.isFinite(Number(input.maxToolCalls))) {
    return Math.max(0, Math.round(Number(input.maxToolCalls)));
  }
  if (Number.isFinite(Number(route && route.maxToolCalls))) {
    return Math.max(0, Math.round(Number(route.maxToolCalls)));
  }
  return route && route.intent === 'categorization_review' ? 6 : 4;
}

function runDeterministicTools({ route, input, dependencies, summary, turn, question }) {
  if (typeof dependencies.runToolCalls === 'function') {
    return dependencies.runToolCalls({ route, input, summary, turn, question }) || [];
  }
  const toolNames = Array.isArray(route && route.toolNames) ? route.toolNames : [];
  const workbook = getToolWorkbook(input, dependencies);
  if (!(toolNames.length && workbook)) {
    return [];
  }
  const maxToolCalls = getRouteToolLimit(route, input);
  const dateScope = getToolDateScope(summary, turn);
  return toolNames.slice(0, maxToolCalls).map((toolName, index) =>
    runAdvisorToolCall(
      {
        id: 'tool_' + String(index + 1) + '_' + String(toolName),
        tool: toolName,
        arguments: {
          date_scope: dateScope,
          prompt: question,
          percent: 10
        }
      },
      {
        workbook,
        context: input.context || {},
        services: input.services || dependencies.services || {}
      }
    )
  );
}

function buildPrivacySummary(settings, packetKinds) {
  return {
    destination: getAdvisorProviderPrivacyDestination(getAdvisorProviderKind(settings)),
    packetKinds: Array.isArray(packetKinds) ? packetKinds : [],
    documentChunksSent: 0
  };
}

export async function runAdvisorTurn(input = {}, dependencies = {}) {
  const requestId = String(input.requestId || defaultRequestId());
  const traceId = String(input.traceId || requestId);
  const question = String(input.message || input.question || '').trim();
  const settings = input.settings || {};
  const history = Array.isArray(input.history) ? input.history : [];
  const capabilityProfile =
    input.capabilityProfile ||
    buildAdvisorModelCapabilityProfile(settings, input.modelCalibration || {});
  const conversationSummary = buildAdvisorConversationSummary(
    input.conversationState || {},
    history
  );
  const repeatedQuestion = detectAdvisorRepeatedQuestion(question, input.conversationState || {});
  const events = [];

  const emit = (type, metadata = {}) => {
    const event = {
      requestId,
      traceId,
      type,
      at: callIfFunction(dependencies.now) || new Date().toISOString(),
      metadata
    };
    events.push(event);
    callIfFunction(dependencies.onEvent, event);
  };

  emit(ADVISOR_TURN_EVENT_TYPES.RESOLVING_TURN);
  const turn =
    input.turn ||
    callIfFunction(dependencies.resolveTurn, question, input.context, input.conversationState);
  const route =
    getAdvisorQaRoute(turn && turn.targetIntent) || getAdvisorBrainRoute(turn && turn.targetIntent);
  const responseMode = getResponseMode(settings, capabilityProfile, route || {});
  const dataPlan = buildAdvisorDataPlan(turn || {}, route || {});
  if (!route) {
    emit(ADVISOR_TURN_EVENT_TYPES.FAILED, {
      reason: 'unsupported_intent',
      targetIntent: turn && turn.targetIntent ? turn.targetIntent : ''
    });
    const traceSummary = buildTraceSummary(events, 'failed', {
      requestId,
      traceId,
      provider: getProvider(settings),
      responseMode,
      dataPlan
    });
    const turnTrace = buildAdvisorTurnTrace({
      requestId,
      traceId,
      status: 'failed',
      provider: getProvider(settings),
      settings,
      capabilityProfile,
      responseMode,
      route,
      turn,
      events,
      dataPlan,
      fallbackReason: 'unsupported_intent'
    });
    return {
      status: 'failed',
      requestId,
      traceId,
      turn,
      error: 'runAdvisorTurn does not support that Advisor route yet.',
      traceSummary,
      turnTrace
    };
  }

  emit(ADVISOR_TURN_EVENT_TYPES.COLLECTING_CONTEXT, {
    targetIntent: turn.targetIntent,
    dataPlan,
    repeatedQuestion
  });

  const summary = callIfFunction(dependencies.buildSummary, question, input.context, turn);
  const readOnlyActions =
    route.route === 'brain' ? [] : buildAdvisorReadOnlyActions({ turn, summary });
  const toolResults = runDeterministicTools({
    route,
    input,
    dependencies,
    summary,
    turn,
    question
  });
  const toolWorkbook = getToolWorkbook(input, dependencies);
  const draftCreatedAt = callIfFunction(dependencies.now) || new Date().toISOString();
  const preparedDraftArtifacts = buildAdvisorCategoryCleanupDraftsFromToolResults({
    workbook: toolWorkbook,
    taskSpec: turn && turn.taskSpec ? turn.taskSpec : summary && summary.task_spec,
    toolResults,
    requestId,
    traceId,
    createdAt: draftCreatedAt,
    createId: input.createId || dependencies.createId
  });
  const preparedDraftGate = preparedDraftArtifacts.drafts.length
    ? runAdvisorDraftReviewGate({
        workbook: toolWorkbook,
        candidates: preparedDraftArtifacts.drafts,
        draftGroups: preparedDraftArtifacts.draftGroups,
        validateDraft: dependencies.validateDraftCandidate,
        reviewDraft: dependencies.reviewDraftCandidate,
        reviewer: typeof dependencies.reviewDraftCandidate === 'function' ? 'model' : 'rules',
        now: dependencies.now,
        checkedAt: draftCreatedAt,
        createId: input.createId || dependencies.createId,
        onEvent: (type, metadata) => emit(type, metadata)
      })
    : {
        approvedDrafts: [],
        blockedCandidates: [],
        decisions: [],
        draftGroups: []
      };
  const preparedDraftArtifactsAfterGate = Object.assign({}, preparedDraftArtifacts, {
    drafts: preparedDraftGate.approvedDrafts,
    draftGroups: preparedDraftGate.draftGroups,
    blockedCandidates: preparedDraftGate.blockedCandidates,
    gateDecisions: preparedDraftGate.decisions
  });
  const shouldPersistAdvisorDrafts =
    input.persistAdvisorDrafts !== false && input.persistDrafts !== false;
  const preparedDraftPersistence =
    shouldPersistAdvisorDrafts && preparedDraftArtifactsAfterGate.drafts.length
      ? persistAdvisorPreparedDraftsToWorkbook(toolWorkbook, preparedDraftArtifactsAfterGate, {
          createdAt: draftCreatedAt,
          createId: input.createId || dependencies.createId
        })
      : preparedDraftArtifactsAfterGate;
  if (shouldPersistAdvisorDrafts && Array.isArray(preparedDraftPersistence.drafts)) {
    preparedDraftPersistence.drafts.forEach((draft) => {
      emit(ADVISOR_DRAFT_GATE_EVENT_TYPES.PERSISTED, {
        draftId: draft && draft.id,
        objectType: draft && draft.objectType,
        operation: draft && draft.operation
      });
    });
  }
  const preparedDraftActions = buildAdvisorPreparedDraftReferenceActions(
    preparedDraftPersistence.drafts
  );
  const filteredReadOnlyActions = filterAdvisorActionsForPreparedDrafts(
    readOnlyActions,
    Object.assign({}, preparedDraftPersistence, {
      skippedResolvedDrafts: preparedDraftArtifacts.skippedResolvedDrafts
    })
  );
  const messageActions = preparedDraftActions.concat(filteredReadOnlyActions);
  emit(ADVISOR_TURN_EVENT_TYPES.EXECUTING_TOOLS, {
    toolNames: toolResults.map((result) => result.toolName),
    toolCallCount: toolResults.length,
    toolResults
  });
  const evidenceWorkspace = buildAdvisorEvidenceWorkspace({
    taskSpec: turn && turn.taskSpec ? turn.taskSpec : summary && summary.task_spec,
    summary,
    toolResults,
    actions: messageActions
  });
  const draftGroups = mergeAdvisorPreparedDraftGroups(
    buildAdvisorDraftGroupsFromToolResults({
      taskSpec: turn && turn.taskSpec ? turn.taskSpec : summary && summary.task_spec,
      toolResults
    }),
    preparedDraftPersistence.draftGroups
  );
  emit(ADVISOR_TURN_EVENT_TYPES.BUILDING_EVIDENCE, {
    evidenceFacts: evidenceWorkspace.facts.length,
    evidenceCoverage: evidenceWorkspace.coverage.length
  });
  const responseSkeleton = buildAdvisorResponseSkeleton({
    turn,
    summary,
    evidenceWorkspace,
    actions: messageActions,
    repeatedQuestion,
    draftGroups
  });
  if (preparedDraftPersistence.drafts.length) {
    const hasCleanupDraft = preparedDraftPersistence.drafts.some(
      (draft) => draft.objectType === 'ledgerCleanup'
    );
    const reusedDraft =
      Array.isArray(preparedDraftArtifacts.reusedDrafts) &&
      preparedDraftArtifacts.reusedDrafts.length;
    responseSkeleton.directAnswer = hasCleanupDraft
      ? reusedDraft
        ? 'I found an existing reviewable category cleanup draft for this evidence. Nothing has changed yet.'
        : 'I prepared a reviewable category cleanup draft. Nothing has changed yet.'
      : 'I prepared a manual category review draft because the evidence is not safe enough for automatic cleanup.';
  } else if (
    Array.isArray(preparedDraftArtifactsAfterGate.blockedCandidates) &&
    preparedDraftArtifactsAfterGate.blockedCandidates.length
  ) {
    const firstBlocked = preparedDraftArtifactsAfterGate.blockedCandidates[0];
    responseSkeleton.directAnswer =
      'I prepared a draft candidate, but Advisor blocked it before showing it in the review queue: ' +
      String(
        firstBlocked.error ||
          (firstBlocked.decision && firstBlocked.decision.reason) ||
          'it needs safer details'
      ) +
      '. Nothing has changed yet.';
  } else if (
    Array.isArray(preparedDraftArtifacts.skippedResolvedDrafts) &&
    preparedDraftArtifacts.skippedResolvedDrafts.length
  ) {
    responseSkeleton.directAnswer =
      'I found the same category cleanup proposal already reviewed, so I did not create another draft.';
  }
  responseSkeleton.drafts = draftGroups.map((group) => group.groupId);
  const skeletonAnswer = {
    text: renderAdvisorResponseMarkdown(responseSkeleton),
    references: buildAdvisorResponseReferences(responseSkeleton),
    responseV2: responseSkeleton,
    evidenceWorkspace,
    draftGroups
  };
  emit(ADVISOR_TURN_EVENT_TYPES.COMPOSING_RESPONSE, {
    responseVersion: responseSkeleton.responseVersion
  });
  emit(ADVISOR_TURN_EVENT_TYPES.BUILDING_PACKET, {
    packetKinds: getPacketKinds(summary),
    packetSelection: getAdvisorPacketSelection(summary),
    dataPlan
  });

  const buildRulesAnswer = () =>
    normalizeAnswerResult(
      callIfFunction(dependencies.buildRulesAnswer, question, input.context, turn, summary, {
        toolResults,
        evidenceWorkspace,
        responseSkeleton,
        draftGroups,
        preparedDrafts: preparedDraftPersistence.drafts,
        blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
        conversationSummary,
        repeatedQuestion
      }) || skeletonAnswer
    );
  const privacy = buildPrivacySummary(settings, getPacketKinds(summary));
  const buildTurnTraceForResult = ({
    status,
    provider,
    attempts = 0,
    fallbackReason = '',
    message = null,
    nextConversationState = null,
    responseModeOverride = responseMode,
    actions = messageActions,
    preparedDrafts = preparedDraftPersistence.drafts,
    blockedDraftCandidates = preparedDraftPersistence.blockedCandidates,
    modelDiagnostics = null
  } = {}) =>
    buildAdvisorTurnTrace({
      requestId,
      traceId,
      status,
      provider: provider || getProvider(settings),
      settings,
      capabilityProfile,
      responseMode: responseModeOverride,
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
      directWorkbookMutation: false,
      modelOutputAcceptedAsMutation: false,
      modelDiagnostics
    });

  if (isRulesProvider(settings)) {
    emit(ADVISOR_TURN_EVENT_TYPES.RUNNING_RULES, {
      provider: getProvider(settings)
    });
    const answer = buildRulesAnswer();
    emit(ADVISOR_TURN_EVENT_TYPES.COMPLETED, {
      provider: 'rules'
    });
    const message = buildMessageViewModel(
      answer,
      summary,
      settings,
      'answered',
      'rules',
      0,
      '',
      messageActions,
      {
        responseV2: responseSkeleton,
        evidenceWorkspace,
        draftGroups
      }
    );
    const nextConversationState = buildNextState(input.conversationState, turn, summary, answer);
    const traceSummary = buildTraceSummary(events, 'answered', {
      requestId,
      traceId,
      provider: 'rules',
      responseMode: 'rules',
      packetKinds: getPacketKinds(summary),
      packetSelection: getAdvisorPacketSelection(summary),
      dataPlan,
      attempts: 0,
      toolResults,
      evidenceWorkspace,
      draftGroups,
      preparedDrafts: preparedDraftPersistence.drafts,
      blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
      privacy
    });
    const turnTrace = buildTurnTraceForResult({
      status: 'answered',
      provider: 'rules',
      attempts: 0,
      message,
      nextConversationState,
      responseModeOverride: 'rules'
    });
    return {
      status: 'answered',
      requestId,
      traceId,
      provider: 'rules',
      turn,
      summary,
      toolResults,
      evidenceWorkspace,
      responseSkeleton,
      draftGroups,
      preparedDrafts: preparedDraftPersistence.drafts,
      blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
      message: exposeTurnTraceOnMessage(message, turnTrace, input, settings),
      nextConversationState,
      traceSummary,
      turnTrace
    };
  }

  const generationProfile = buildAdvisorGenerationProfile({
    turn,
    summary,
    responseMode,
    capabilityProfile
  });
  const proseMode = responseMode === 'prose';
  const messages = callIfFunction(dependencies.buildMessages, question, input.context, summary, {
    proseMode,
    turn,
    history,
    toolResults,
    evidenceWorkspace,
    responseSkeleton,
    conversationSummary,
    repeatedQuestion,
    draftGroups,
    preparedDrafts: preparedDraftPersistence.drafts,
    blockedDraftCandidates: preparedDraftPersistence.blockedCandidates
  });
  const responseFormat =
    responseMode === 'json_schema' ? callIfFunction(dependencies.getResponseFormat) : null;
  const generationOptions = {
    temperature: generationProfile.temperature,
    retryTemperature: generationProfile.retryTemperature,
    topP: generationProfile.topP,
    maxTokens: generationProfile.maxTokens
  };

  try {
    const result = await runConfiguredAdvisorTask({
      requestId,
      traceId,
      messages,
      modelClient: dependencies.modelClient,
      responseFormat,
      generationOptions,
      onEvent: (event) => {
        const forwarded = {
          requestId,
          traceId,
          type: event && event.type ? event.type : '',
          at: callIfFunction(dependencies.now) || new Date().toISOString(),
          metadata: event && event.metadata ? event.metadata : {}
        };
        events.push(forwarded);
        callIfFunction(dependencies.onEvent, forwarded);
      },
      formatResult: (modelResult) =>
        proseMode
          ? dependencies.formatProseResponse(modelResult.text, summary)
          : dependencies.formatModelResponse(modelResult.text, summary),
      validateResult: (formatted) =>
        dependencies.validateAnswer({
          text: formatted.text,
          summary,
          taskSpec: turn && turn.taskSpec ? turn.taskSpec : summary && summary.task_spec
        }),
      repairResult: ({ formatted, validation }) => {
        const presentationRepair = repairAdvisorPresentationAnswer({
          text: formatted && formatted.text,
          validation
        });
        if (presentationRepair.ok) {
          const repairedValidation = dependencies.validateAnswer({
            text: presentationRepair.text,
            summary,
            taskSpec: turn && turn.taskSpec ? turn.taskSpec : summary && summary.task_spec
          });
          if (repairedValidation && repairedValidation.ok) {
            return {
              ok: true,
              text: presentationRepair.text,
              references: Array.isArray(formatted && formatted.references)
                ? formatted.references
                : [],
              repairPlan: {
                repairVersion: 'cavalry.advisor_response_repair.v1',
                repairNeeded: true,
                issueCodes:
                  validation && Array.isArray(validation.issues)
                    ? validation.issues.map((issue) => issue && issue.code).filter(Boolean)
                    : [],
                reason: presentationRepair.reason
              }
            };
          }
        }
        const repairPlan = buildAdvisorResponseRepairPlan({
          text: formatted && formatted.text,
          validation,
          summary,
          taskSpec: turn && turn.taskSpec ? turn.taskSpec : summary && summary.task_spec
        });
        return {
          ok: false,
          text: '',
          references: [],
          repairPlan
        };
      }
    });

    if (result && result.ok) {
      emit(ADVISOR_TURN_EVENT_TYPES.COMPLETED, {
        provider: getProvider(settings),
        attempts: result.attempts || 1
      });
      const message = buildMessageViewModel(
        {
          text: String(result.text || ''),
          references: Array.isArray(result.references) ? result.references : [],
          responseV2: responseSkeleton,
          evidenceWorkspace,
          draftGroups
        },
        summary,
        settings,
        'answered',
        responseMode,
        result.attempts || 1,
        '',
        messageActions,
        {
          responseV2: responseSkeleton,
          evidenceWorkspace,
          draftGroups
        }
      );
      const nextConversationState = buildNextState(input.conversationState, turn, summary, message);
      const traceSummary = buildTraceSummary(events, 'answered', {
        requestId,
        traceId,
        provider: getProvider(settings),
        responseMode,
        packetKinds: getPacketKinds(summary),
        packetSelection: getAdvisorPacketSelection(summary),
        dataPlan,
        attempts: result.attempts || 1,
        toolResults,
        evidenceWorkspace,
        draftGroups,
        preparedDrafts: preparedDraftPersistence.drafts,
        blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
        privacy
      });
      const turnTrace = buildTurnTraceForResult({
        status: 'answered',
        attempts: result.attempts || 1,
        message,
        nextConversationState,
        modelDiagnostics: result.modelDiagnostics || null
      });
      return {
        status: 'answered',
        requestId,
        traceId,
        provider: getProvider(settings),
        turn,
        summary,
        toolResults,
        evidenceWorkspace,
        responseSkeleton,
        draftGroups,
        preparedDrafts: preparedDraftPersistence.drafts,
        blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
        message: exposeTurnTraceOnMessage(message, turnTrace, input, settings),
        nextConversationState,
        attempts: result.attempts || 1,
        traceSummary,
        turnTrace
      };
    }

    if (result && result.cancelled) {
      const reason = result.error || 'Advisor request was cancelled.';
      emit(ADVISOR_TURN_EVENT_TYPES.CANCELLED, {
        provider: getProvider(settings),
        reason,
        attempts: result.attempts || 0
      });
      const message = buildMessageViewModel(
        {
          text: 'Cancelled. No answer was generated.',
          references: []
        },
        summary,
        settings,
        'cancelled',
        responseMode,
        result.attempts || 0,
        '',
        [],
        {
          evidenceWorkspace,
          draftGroups
        }
      );
      const nextConversationState = input.conversationState || null;
      const traceSummary = buildTraceSummary(events, 'cancelled', {
        requestId,
        traceId,
        provider: getProvider(settings),
        responseMode,
        packetKinds: getPacketKinds(summary),
        packetSelection: getAdvisorPacketSelection(summary),
        dataPlan,
        attempts: result.attempts || 0,
        toolResults,
        evidenceWorkspace,
        draftGroups,
        preparedDrafts: preparedDraftPersistence.drafts,
        blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
        privacy
      });
      const turnTrace = buildTurnTraceForResult({
        status: 'cancelled',
        attempts: result.attempts || 0,
        message,
        nextConversationState,
        actions: [],
        modelDiagnostics: result.modelDiagnostics || null
      });
      return {
        status: 'cancelled',
        requestId,
        traceId,
        provider: getProvider(settings),
        turn,
        summary,
        toolResults,
        evidenceWorkspace,
        draftGroups,
        preparedDrafts: preparedDraftPersistence.drafts,
        blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
        message: exposeTurnTraceOnMessage(message, turnTrace, input, settings),
        nextConversationState,
        attempts: result.attempts || 0,
        traceSummary,
        turnTrace
      };
    }

    const reason =
      result && result.error ? result.error : 'The configured model did not return an answer.';
    const fallbackAnswer = buildSkeletonFallbackAnswer(skeletonAnswer, {
      showDiagnosticCopy: shouldShowFallbackDiagnosticCopy(input, settings)
    });
    const attempts = result && result.attempts ? result.attempts : 0;
    const validationIssueCodes =
      result && Array.isArray(result.validationIssueCodes) ? result.validationIssueCodes : [];
    emit(ADVISOR_TURN_EVENT_TYPES.FALLBACK_COMPLETED, {
      provider: getProvider(settings),
      reason
    });
    const message = buildMessageViewModel(
      fallbackAnswer,
      summary,
      settings,
      'fallback',
      responseMode,
      attempts,
      reason,
      messageActions,
      {
        responseV2: responseSkeleton,
        evidenceWorkspace,
        draftGroups
      }
    );
    const nextConversationState = buildNextState(
      input.conversationState,
      turn,
      summary,
      fallbackAnswer
    );
    const traceSummary = buildTraceSummary(events, 'fallback', {
      requestId,
      traceId,
      provider: getProvider(settings),
      responseMode,
      packetKinds: getPacketKinds(summary),
      packetSelection: getAdvisorPacketSelection(summary),
      dataPlan,
      attempts,
      fallbackReason: reason,
      validationIssueCodes,
      toolResults,
      evidenceWorkspace,
      draftGroups,
      preparedDrafts: preparedDraftPersistence.drafts,
      blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
      privacy
    });
    const turnTrace = buildTurnTraceForResult({
      status: 'fallback',
      attempts,
      fallbackReason: reason,
      message,
      nextConversationState,
      modelDiagnostics: (result && result.modelDiagnostics) || null
    });
    return {
      status: 'fallback',
      requestId,
      traceId,
      provider: getProvider(settings),
      turn,
      summary,
      toolResults,
      evidenceWorkspace,
      responseSkeleton,
      draftGroups,
      preparedDrafts: preparedDraftPersistence.drafts,
      blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
      message: exposeTurnTraceOnMessage(message, turnTrace, input, settings),
      nextConversationState,
      fallbackReason: reason,
      traceSummary,
      turnTrace
    };
  } catch (error) {
    const reason = String(error && error.message ? error.message : 'The configured model failed.');
    const fallbackAnswer = buildSkeletonFallbackAnswer(skeletonAnswer, {
      showDiagnosticCopy: shouldShowFallbackDiagnosticCopy(input, settings)
    });
    emit(ADVISOR_TURN_EVENT_TYPES.FALLBACK_COMPLETED, {
      provider: getProvider(settings),
      reason
    });
    const message = buildMessageViewModel(
      fallbackAnswer,
      summary,
      settings,
      'fallback',
      responseMode,
      0,
      reason,
      messageActions,
      {
        responseV2: responseSkeleton,
        evidenceWorkspace,
        draftGroups
      }
    );
    const nextConversationState = buildNextState(
      input.conversationState,
      turn,
      summary,
      fallbackAnswer
    );
    const traceSummary = buildTraceSummary(events, 'fallback', {
      requestId,
      traceId,
      provider: getProvider(settings),
      responseMode,
      packetKinds: getPacketKinds(summary),
      packetSelection: getAdvisorPacketSelection(summary),
      dataPlan,
      attempts: 0,
      fallbackReason: reason,
      toolResults,
      evidenceWorkspace,
      draftGroups,
      preparedDrafts: preparedDraftPersistence.drafts,
      blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
      privacy
    });
    const turnTrace = buildTurnTraceForResult({
      status: 'fallback',
      attempts: 0,
      fallbackReason: reason,
      message,
      nextConversationState,
      modelDiagnostics: {
        schemaVersion: 'cavalry.advisor_model_diagnostics.v1',
        attempts: [],
        retryAttempted: false,
        finalFailureReason: reason,
        finalValidationIssueCodes: []
      }
    });
    return {
      status: 'fallback',
      requestId,
      traceId,
      provider: getProvider(settings),
      turn,
      summary,
      toolResults,
      evidenceWorkspace,
      responseSkeleton,
      draftGroups,
      preparedDrafts: preparedDraftPersistence.drafts,
      blockedDraftCandidates: preparedDraftPersistence.blockedCandidates,
      message: exposeTurnTraceOnMessage(message, turnTrace, input, settings),
      nextConversationState,
      fallbackReason: reason,
      traceSummary,
      turnTrace
    };
  }
}
