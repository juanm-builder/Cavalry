import {
  getAdvisorPrivacyLabelForKind,
  getAdvisorProviderKind,
  getAdvisorProviderLabelForKind
} from './model-capabilities.js';
import { classifyAdvisorModelFailure, getAdvisorModelFailureLabel } from './model-failure-notes.js';

function asString(value) {
  return String(value || '').trim();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asInteger(value, fallback = 0) {
  return Math.max(0, Math.round(asNumber(value, fallback)));
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : []).map((item) => asString(item)).filter(Boolean);
}

function normalizeSourceRefs(value) {
  return normalizeStringArray(value);
}

export function normalizeAdvisorReference(reference) {
  return {
    token: asString(reference && reference.token),
    source_refs: normalizeSourceRefs(reference && reference.source_refs)
  };
}

export function normalizeAdvisorReferences(references) {
  return (Array.isArray(references) ? references : [])
    .map(normalizeAdvisorReference)
    .filter((reference) => reference.token && reference.source_refs.length);
}

function normalizeAdvisorAction(action = {}) {
  if (asString(action.type) === 'ai_draft_reference') {
    const status =
      ['pending', 'needs_fix', 'confirmed', 'rejected', 'failed'].indexOf(
        asString(action.status)
      ) >= 0
        ? asString(action.status)
        : 'pending';
    const normalized = {
      id: asString(action.id),
      type: 'ai_draft_reference',
      aiDraftId: asString(action.aiDraftId || action.ai_draft_id),
      title: asString(action.title || 'AI Draft'),
      summary: asString(action.summary),
      status
    };
    return normalized.id && normalized.aiDraftId ? normalized : null;
  }
  if (asString(action.type) !== 'advisor_command') {
    return null;
  }
  const command = action.command && typeof action.command === 'object' ? action.command : {};
  const normalized = {
    id: asString(action.id),
    type: 'advisor_command',
    label: asString(action.label),
    icon: asString(action.icon || 'north_east'),
    prompt: asString(action.prompt),
    visual_kind: asString(action.visual_kind || action.visualKind || 'chip'),
    safety_level: asString(action.safety_level || action.safetyLevel || 'read_only'),
    creates_proposal: !!(action.creates_proposal || action.createsProposal),
    requires_confirmation: !!(action.requires_confirmation || action.requiresConfirmation),
    result_behavior: asString(action.result_behavior || action.resultBehavior),
    command: {
      intent: asString(command.intent),
      source_refs: normalizeStringArray(command.source_refs)
    }
  };
  return normalized.id && normalized.label && normalized.prompt ? normalized : null;
}

function normalizeAdvisorActions(actions) {
  return (Array.isArray(actions) ? actions : []).map(normalizeAdvisorAction).filter(Boolean);
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

function normalizeObjectArray(value, limit = 50) {
  return (Array.isArray(value) ? value : [])
    .map(normalizePlainObject)
    .filter(Boolean)
    .slice(0, limit);
}

export function getAdvisorProviderDescriptor(settings = {}) {
  const provider = asString(settings.provider) || 'local';
  const providerKind = getAdvisorProviderKind(settings);
  return {
    provider,
    providerMode: providerKind,
    providerLabel: getAdvisorProviderLabelForKind(providerKind),
    privacyLabel: getAdvisorPrivacyLabelForKind(providerKind)
  };
}

function getAdvisorPrimaryPacket(summary) {
  const packets = summary && summary.data_packets ? summary.data_packets : {};
  const preferred = [
    'account_snapshot',
    'category_inventory',
    'transaction_analysis',
    'transaction_list',
    'transaction_net_worth_impact',
    'categorization_review'
  ];
  for (let index = 0; index < preferred.length; index += 1) {
    if (packets[preferred[index]]) {
      return packets[preferred[index]];
    }
  }
  const keys = Object.keys(packets);
  return keys.length ? packets[keys[0]] : null;
}

export function getAdvisorPacketSelection(summary) {
  const packet = getAdvisorPrimaryPacket(summary);
  if (!(packet && packet.selection)) {
    return null;
  }
  return {
    policy: asString(packet.selection.policy),
    source_count: asInteger(packet.selection.source_count),
    included_count: asInteger(packet.selection.included_count),
    omitted_count: asInteger(packet.selection.omitted_count),
    continuation_supported: !!packet.selection.continuation_supported
  };
}

export function buildAdvisorMessageMeta({
  summary,
  settings,
  status,
  responseMode,
  attempts,
  fallbackReason
} = {}) {
  const provider = getAdvisorProviderDescriptor(settings);
  const scope = summary && summary.scope ? summary.scope : {};
  const packet = getAdvisorPrimaryPacket(summary);
  const counts = packet && packet.counts ? packet.counts : {};
  const selection = getAdvisorPacketSelection(summary);
  const fallbackReasonText = asString(fallbackReason);
  const fallback = classifyAdvisorModelFailure(fallbackReasonText);
  return {
    schema_version: 'cavalry.advisor_message_meta.v1',
    status: asString(status),
    provider: provider.provider,
    provider_mode: provider.providerMode,
    provider_label: provider.providerLabel,
    privacy_label: provider.privacyLabel,
    response_mode: asString(responseMode),
    attempts: asInteger(attempts, attempts ? 1 : 0),
    fallback_reason: fallbackReasonText,
    fallback_reason_code: fallbackReasonText ? fallback.code : '',
    fallback_reason_label: fallbackReasonText ? fallback.label : '',
    fallback_note: fallbackReasonText ? fallback.note : '',
    scope: {
      label: asString(scope.period_label),
      start: asString(scope.period_start),
      end: asString(scope.period_end),
      currency: asString(scope.currency)
    },
    records_reviewed: selection
      ? selection.source_count
      : asInteger(counts.selected_period_transactions),
    included_count: selection ? selection.included_count : 0,
    omitted_count: selection ? selection.omitted_count : 0,
    selection_policy: selection ? selection.policy : '',
    packet_kinds: Object.keys(summary && summary.data_packets ? summary.data_packets : {})
  };
}

export function normalizeAdvisorMessageMeta(meta) {
  if (!(meta && typeof meta === 'object')) {
    return null;
  }
  const scope = meta.scope && typeof meta.scope === 'object' ? meta.scope : {};
  const fallbackKey = asString(meta.fallback_reason_code || meta.fallback_reason);
  return {
    schema_version: asString(meta.schema_version) || 'cavalry.advisor_message_meta.v1',
    status: asString(meta.status),
    provider: asString(meta.provider),
    provider_mode: asString(meta.provider_mode),
    provider_label: asString(meta.provider_label),
    privacy_label: asString(meta.privacy_label),
    response_mode: asString(meta.response_mode),
    attempts: asInteger(meta.attempts),
    fallback_reason: asString(meta.fallback_reason),
    fallback_reason_code: asString(meta.fallback_reason_code),
    fallback_reason_label:
      asString(meta.fallback_reason_label) ||
      (fallbackKey ? getAdvisorModelFailureLabel(fallbackKey) : ''),
    fallback_note: asString(meta.fallback_note),
    scope: {
      label: asString(scope.label),
      start: asString(scope.start),
      end: asString(scope.end),
      currency: asString(scope.currency)
    },
    records_reviewed: asInteger(meta.records_reviewed),
    included_count: asInteger(meta.included_count),
    omitted_count: asInteger(meta.omitted_count),
    selection_policy: asString(meta.selection_policy),
    packet_kinds: normalizeStringArray(meta.packet_kinds)
  };
}

export function normalizeAdvisorMessageViewModel(message = {}) {
  return {
    text: asString(message.text),
    references: normalizeAdvisorReferences(message.references),
    actions: normalizeAdvisorActions(message.actions),
    responseV2: normalizePlainObject(message.responseV2 || message.response_v2),
    evidenceWorkspace: normalizePlainObject(
      message.evidenceWorkspace || message.evidence_workspace
    ),
    draftGroups: normalizeObjectArray(message.draftGroups || message.draft_groups, 20),
    turnTrace: normalizePlainObject(message.turnTrace || message.turn_trace),
    traceSummary: normalizePlainObject(message.traceSummary || message.trace_summary),
    advisorMeta: normalizeAdvisorMessageMeta(
      message.advisorMeta || message.meta || message.advisor_meta
    )
  };
}

function sanitizeTraceMetadata(metadata = {}) {
  const output = {};
  const allowedKeys = [
    'attempt',
    'retrying',
    'responseMode',
    'provider',
    'reason',
    'issueCodes',
    'targetIntent',
    'packetKinds',
    'packetSelection',
    'dataPlan',
    'attempts',
    'toolNames',
    'toolResults',
    'toolCallCount',
    'evidenceFacts',
    'evidenceCoverage',
    'repeatedQuestion',
    'responseVersion',
    'privacy'
  ];
  allowedKeys.forEach((key) => {
    const value = metadata[key];
    if (typeof value === 'undefined' || value === null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      output[key] = normalizeStringArray(value);
    } else if (key === 'packetSelection' && typeof value === 'object') {
      output[key] = {
        policy: asString(value.policy),
        source_count: asInteger(value.source_count),
        included_count: asInteger(value.included_count),
        omitted_count: asInteger(value.omitted_count),
        continuation_supported: !!value.continuation_supported
      };
    } else if (key === 'dataPlan' && typeof value === 'object') {
      output[key] = {
        intent: asString(value.intent),
        packet_kinds: normalizeStringArray(value.packet_kinds),
        data_needs: normalizeStringArray(value.data_needs),
        tool_names: normalizeStringArray(value.tool_names),
        action_ids: normalizeStringArray(value.action_ids),
        selection_policy: asString(value.selection_policy),
        maximum_rows: asInteger(value.maximum_rows),
        include_source_refs: value.include_source_refs !== false
      };
    } else if (key === 'toolResults' && Array.isArray(value)) {
      output[key] = value
        .map((result) => ({
          toolName: asString(result && result.toolName),
          ok: !!(result && result.ok),
          returnedRecords: asInteger(result && result.coverage && result.coverage.returnedRecords),
          totalEligibleRecords: asInteger(
            result && result.coverage && result.coverage.totalEligibleRecords
          )
        }))
        .filter((result) => result.toolName);
    } else if (key === 'repeatedQuestion' && typeof value === 'object') {
      output[key] = {
        repeated: !!value.repeated,
        similarity: asNumber(value.similarity),
        reason: asString(value.reason)
      };
    } else if (key === 'privacy' && typeof value === 'object') {
      output[key] = {
        destination: asString(value.destination),
        packetKinds: normalizeStringArray(value.packetKinds),
        documentChunksSent: asInteger(value.documentChunksSent)
      };
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      output[key] = value;
    } else {
      output[key] = asString(value);
    }
  });
  return output;
}

function getElapsedMs(startAt, at) {
  const start = Date.parse(asString(startAt));
  const current = Date.parse(asString(at));
  if (!Number.isFinite(start) || !Number.isFinite(current)) {
    return null;
  }
  return Math.max(0, current - start);
}

export function normalizeAdvisorTraceSummary({
  requestId,
  traceId,
  status,
  provider,
  responseMode,
  packetKinds,
  packetSelection,
  events,
  attempts,
  fallbackReason,
  toolResults,
  evidenceWorkspace,
  privacy
} = {}) {
  const normalizedEvents = (Array.isArray(events) ? events : [])
    .map((event) => ({
      type: asString(event && event.type),
      at: asString(event && event.at),
      metadata: sanitizeTraceMetadata(event && event.metadata ? event.metadata : {})
    }))
    .filter((event) => event.type);
  const firstAt = normalizedEvents[0] ? normalizedEvents[0].at : '';
  const lastAt = normalizedEvents.length ? normalizedEvents[normalizedEvents.length - 1].at : '';
  const issueCodes = [];
  normalizedEvents.forEach((event) => {
    normalizeStringArray(event.metadata.issueCodes).forEach((code) => {
      if (issueCodes.indexOf(code) < 0) {
        issueCodes.push(code);
      }
    });
  });
  return {
    schema_version: 'cavalry.advisor_trace.v1',
    trace_version: 'cavalry.advisor_trace.v2',
    requestId: asString(requestId),
    traceId: asString(traceId),
    status: asString(status),
    provider: asString(provider),
    responseMode: asString(responseMode),
    packetKinds: normalizeStringArray(packetKinds),
    packetSelection: packetSelection || null,
    attempts: asInteger(attempts),
    fallbackReason: asString(fallbackReason),
    validationIssueCodes: issueCodes,
    toolCalls: (Array.isArray(toolResults) ? toolResults : [])
      .map((result) => ({
        toolCallId: asString(result && result.toolCallId),
        toolName: asString(result && result.toolName),
        ok: !!(result && result.ok),
        returnedRecords: asInteger(result && result.coverage && result.coverage.returnedRecords),
        totalEligibleRecords: asInteger(
          result && result.coverage && result.coverage.totalEligibleRecords
        ),
        selectionPolicy: asString(result && result.coverage && result.coverage.selectionPolicy)
      }))
      .filter((result) => result.toolName),
    evidence: evidenceWorkspace
      ? {
          factCount: asInteger(evidenceWorkspace.facts && evidenceWorkspace.facts.length),
          uncertaintyCount: asInteger(
            evidenceWorkspace.uncertainties && evidenceWorkspace.uncertainties.length
          ),
          coverageCount: asInteger(evidenceWorkspace.coverage && evidenceWorkspace.coverage.length)
        }
      : null,
    privacy: privacy || null,
    startedAt: firstAt,
    completedAt: lastAt,
    durationMs: getElapsedMs(firstAt, lastAt),
    stages: normalizedEvents.map((event) => ({
      type: event.type,
      at: event.at,
      elapsedMs: getElapsedMs(firstAt, event.at),
      metadata: event.metadata
    }))
  };
}
