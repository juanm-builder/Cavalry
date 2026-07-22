import { buildAdvisorAnswerPlan, getAdvisorTaskDataNeeds } from '../../domain/advisor/task-spec.js';
import {
  buildAdvisorRecommendationFromSummary,
  normalizeAdvisorRecommendation
} from './referent-resolution.js';

function asString(value) {
  return String(value || '').trim();
}

function asInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback;
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : []).map((item) => asString(item)).filter(Boolean);
}

function getPrimaryPacketKind(summary) {
  const packets = summary && summary.data_packets ? summary.data_packets : {};
  const keys = Object.keys(packets);
  return keys[0] || '';
}

function getPrimaryPacket(summary) {
  const packets = summary && summary.data_packets ? summary.data_packets : {};
  const kind = getPrimaryPacketKind(summary);
  return kind ? packets[kind] : null;
}

function collectPacketSourceRefs(packet) {
  const refs = [];
  const push = (value) => {
    const ref = asString(value);
    if (ref && refs.indexOf(ref) < 0) {
      refs.push(ref);
    }
  };
  if (!packet || typeof packet !== 'object') {
    return refs;
  }
  normalizeStringArray(packet.source_refs).forEach(push);
  const selection = packet.selection || {};
  normalizeStringArray(selection.included_refs).forEach(push);
  normalizeStringArray(selection.included_transaction_ids).forEach((id) =>
    push(id.indexOf('transaction:') === 0 ? id : 'transaction:' + id)
  );
  return refs.slice(0, 80);
}

function normalizePlainObject(value) {
  if (!(value && typeof value === 'object') || Array.isArray(value)) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return Object.assign({}, value);
  }
}

function normalizeObjectArray(value, limit) {
  return (Array.isArray(value) ? value : [])
    .map(normalizePlainObject)
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeStoredCategorizationReview(value) {
  if (!(value && typeof value === 'object')) {
    return null;
  }
  const candidateCleanup = normalizePlainObject(value.candidate_cleanup || value.candidateCleanup);
  const candidateImprovements = normalizeObjectArray(
    value.candidate_improvements || value.candidateImprovements,
    40
  );
  const sampleTransactions = normalizeObjectArray(
    value.sample_transactions_needing_review || value.sampleTransactionsNeedingReview,
    40
  );
  const sourceRefs = normalizeStringArray(value.source_refs || value.sourceRefs).slice(0, 120);
  if (!(
    candidateCleanup ||
    candidateImprovements.length ||
    sampleTransactions.length ||
    sourceRefs.length
  )) {
    return null;
  }
  return {
    packet_version: asString(value.packet_version || value.packetVersion),
    period: normalizePlainObject(value.period),
    counts: normalizePlainObject(value.counts),
    candidate_cleanup: candidateCleanup,
    candidate_improvements: candidateImprovements,
    sample_transactions_needing_review: sampleTransactions,
    source_refs: sourceRefs
  };
}

function buildStoredCategorizationReview(packet) {
  if (!(packet && typeof packet === 'object')) {
    return null;
  }
  return normalizeStoredCategorizationReview({
    packet_version: packet.packet_version,
    period: packet.period,
    counts: packet.counts,
    candidate_cleanup: packet.candidate_cleanup,
    candidate_improvements: packet.candidate_improvements,
    sample_transactions_needing_review: packet.sample_transactions_needing_review,
    source_refs: collectPacketSourceRefs(packet)
  });
}

function buildContinuation(summary) {
  const packet = getPrimaryPacket(summary);
  const selection = packet && packet.selection ? packet.selection : null;
  if (!(selection && selection.continuation_supported)) {
    return null;
  }
  return {
    cursor: asString(selection.cursor || ''),
    remainingCount: asInteger(selection.omitted_count),
    offset: asInteger(selection.included_count),
    pageSize: asInteger(selection.included_count),
    selectionPolicy: asString(selection.policy)
  };
}

export function normalizeAdvisorConversationState(value) {
  if (!(value && typeof value === 'object')) {
    return null;
  }
  const activeScope =
    value.activeScope && typeof value.activeScope === 'object' ? value.activeScope : null;
  const selectedEntity =
    value.selectedEntity && typeof value.selectedEntity === 'object' ? value.selectedEntity : null;
  const continuation =
    value.continuation && typeof value.continuation === 'object' ? value.continuation : null;
  return {
    lastIntent: asString(value.lastIntent),
    lastTargetIntent: asString(value.lastTargetIntent),
    lastResponseStyle: asString(value.lastResponseStyle),
    lastQuestion: asString(value.lastQuestion),
    lastResolvedQuestion: asString(value.lastResolvedQuestion),
    lastDatasetRef: asString(value.lastDatasetRef),
    lastPacketKind: asString(value.lastPacketKind),
    lastSourceRefs: normalizeStringArray(value.lastSourceRefs),
    activeScope: activeScope
      ? {
          start: asString(activeScope.start),
          end: asString(activeScope.end),
          label: asString(activeScope.label),
          source: asString(activeScope.source),
          type: asString(activeScope.type)
        }
      : null,
    selectedEntity: selectedEntity
      ? {
          kind: asString(selectedEntity.kind),
          id: asString(selectedEntity.id)
        }
      : null,
    continuation: continuation
      ? {
          cursor: asString(continuation.cursor),
          remainingCount: asInteger(continuation.remainingCount),
          offset: asInteger(continuation.offset),
          pageSize: asInteger(continuation.pageSize),
          selectionPolicy: asString(continuation.selectionPolicy)
        }
      : null,
    pendingDraftId: asString(value.pendingDraftId),
    pendingWorkbookDraft: normalizePlainObject(
      value.pendingWorkbookDraft || value.pending_workbook_draft
    ),
    pendingTaskSpec: value.pendingTaskSpec || null,
    lastTaskSpec: value.lastTaskSpec || null,
    lastAnswerSummary: asString(value.lastAnswerSummary),
    currentGoals: normalizeStringArray(value.currentGoals || value.userGoals).slice(0, 10),
    explainedConcepts: normalizeStringArray(value.explainedConcepts).slice(0, 30),
    deliveredRecommendationIds: normalizeStringArray(value.deliveredRecommendationIds).slice(0, 50),
    acceptedRecommendationIds: normalizeStringArray(value.acceptedRecommendationIds).slice(0, 50),
    rejectedRecommendationIds: normalizeStringArray(value.rejectedRecommendationIds).slice(0, 50),
    lastRecommendation: normalizeAdvisorRecommendation(
      value.lastRecommendation || value.last_recommendation
    ),
    unresolvedQuestions: normalizeStringArray(value.unresolvedQuestions).slice(0, 20),
    knownClassifications: normalizeObjectArray(value.knownClassifications, 80),
    lastPeriod: value.lastPeriod || null,
    lastCategorizationReview: normalizeStoredCategorizationReview(
      value.lastCategorizationReview || value.last_categorization_review
    )
  };
}

function inferGoalFromTurn(turn) {
  const targetIntent = asString(turn && turn.targetIntent);
  if (targetIntent === 'spending_analysis') {
    return 'Improve spending decisions using verified workbook data.';
  }
  if (targetIntent === 'categorization_review') {
    return 'Improve category reliability and prepare safe cleanup actions.';
  }
  return '';
}

function buildAdvisorPendingTaskSpec(turn, summary) {
  if (asString(turn && turn.targetIntent) !== 'transaction_capability') {
    return null;
  }
  const source =
    turn && turn.taskSpec
      ? turn.taskSpec
      : (summary && (summary.task_spec || summary.taskSpec)) || {};
  const scope = summary && summary.scope ? summary.scope : {};
  const dateScope =
    source.dateScope && typeof source.dateScope === 'object'
      ? normalizePlainObject(source.dateScope)
      : {
          type: asString(scope.scope_type) || 'visible_range',
          start: asString(scope.period_start),
          end: asString(scope.period_end),
          label: asString(scope.period_label),
          source: asString(scope.scope_source) || 'visible_range'
        };
  const taskSpec = {
    spec_version: asString(source.spec_version || source.specVersion) || 'cavalry.advisor_task.v1',
    intent: 'transaction_analysis',
    raw_intent: 'transaction_analysis',
    dateScope,
    outputMode: 'analysis',
    dataNeeds: getAdvisorTaskDataNeeds('transaction_analysis'),
    followUpOf: 'transaction_capability',
    assumptions: Array.isArray(source.assumptions) ? source.assumptions.slice() : [],
    requiresClarification: false,
    originalQuestion:
      asString(turn && turn.question) ||
      asString(summary && summary.question) ||
      asString(source.originalQuestion || source.original_question)
  };
  taskSpec.answerPlan = buildAdvisorAnswerPlan(taskSpec);
  return taskSpec;
}

function mergeUniqueStrings(existing, nextValue, limit) {
  const values = normalizeStringArray(existing).slice();
  const next = asString(nextValue);
  if (next && values.indexOf(next) < 0) {
    values.unshift(next);
  }
  return values.slice(0, limit);
}

export function buildNextAdvisorConversationState({
  previousState,
  turn,
  summary,
  answerText
} = {}) {
  const previous = normalizeAdvisorConversationState(previousState) || {};
  const scope = summary && summary.scope ? summary.scope : {};
  const packetKind = getPrimaryPacketKind(summary);
  const primaryPacket = getPrimaryPacket(summary);
  const storedCategorizationReview =
    packetKind === 'categorization_review'
      ? buildStoredCategorizationReview(primaryPacket)
      : previous.lastCategorizationReview || null;
  const lastRecommendation =
    buildAdvisorRecommendationFromSummary({ summary }) || previous.lastRecommendation || null;
  const next = {
    lastIntent: asString(turn && turn.intent),
    lastTargetIntent: asString(turn && turn.targetIntent),
    lastResponseStyle: asString(turn && turn.responseStyle),
    lastQuestion: asString(turn && turn.question),
    lastResolvedQuestion: asString(turn && turn.resolvedQuestion),
    lastDatasetRef: asString(turn && turn.datasetRef),
    lastPacketKind: packetKind,
    lastSourceRefs: collectPacketSourceRefs(primaryPacket),
    activeScope: {
      start: asString(scope.period_start),
      end: asString(scope.period_end),
      label: asString(scope.period_label),
      source: asString(scope.scope_source),
      type: asString(scope.scope_type)
    },
    selectedEntity: previous.selectedEntity || null,
    continuation: buildContinuation(summary),
    pendingDraftId: previous.pendingDraftId || '',
    pendingWorkbookDraft: previous.pendingWorkbookDraft || null,
    pendingTaskSpec: buildAdvisorPendingTaskSpec(turn, summary),
    lastTaskSpec:
      turn && turn.taskSpec
        ? turn.taskSpec
        : summary && summary.task_spec
          ? summary.task_spec
          : null,
    lastAnswerSummary: asString(answerText).replace(/\s+/g, ' ').slice(0, 320),
    currentGoals: mergeUniqueStrings(previous.currentGoals, inferGoalFromTurn(turn), 10),
    explainedConcepts: previous.explainedConcepts || [],
    deliveredRecommendationIds: previous.deliveredRecommendationIds || [],
    acceptedRecommendationIds: previous.acceptedRecommendationIds || [],
    rejectedRecommendationIds: previous.rejectedRecommendationIds || [],
    lastRecommendation,
    unresolvedQuestions: previous.unresolvedQuestions || [],
    knownClassifications: previous.knownClassifications || [],
    lastPeriod: {
      start: asString(scope.period_start),
      end: asString(scope.period_end),
      label: asString(scope.period_label)
    },
    lastCategorizationReview: storedCategorizationReview
  };
  return normalizeAdvisorConversationState(next);
}
