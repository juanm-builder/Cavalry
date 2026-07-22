export const ADVISOR_RECOMMENDATION_STATE_VERSION = 'cavalry.advisor_recommendation_state.v1';

function asString(value) {
  return String(value || '').trim();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStringArray(value, limit = 80) {
  return (Array.isArray(value) ? value : [])
    .map(asString)
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, limit);
}

function normalizeCandidate(value, index = 0) {
  if (!(value && typeof value === 'object')) {
    return null;
  }
  const sourceRefs = normalizeStringArray(value.sourceRefs || value.source_refs, 20);
  const transactionIds = normalizeStringArray(
    value.transactionIds ||
      value.transaction_ids ||
      value.sourceTransactionIds ||
      value.source_transaction_ids,
    20
  );
  const name = asString(
    value.name ||
      value.label ||
      value.description ||
      value.counterparty_name ||
      value.counterpartyName
  );
  const id =
    asString(value.id) ||
    (transactionIds[0]
      ? 'subscription_candidate_' + transactionIds[0]
      : 'recommendation_candidate_' + String(index + 1));
  if (!(name || sourceRefs.length || transactionIds.length)) {
    return null;
  }
  return {
    id,
    name: name || 'Recommended item ' + String(index + 1),
    label: asString(value.label) || name || 'Recommended item ' + String(index + 1),
    kind: asString(value.kind) || 'recommendation',
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0.7))),
    transactionIds,
    sourceRefs,
    categoryId: asString(value.categoryId || value.category_id),
    accountId: asString(value.accountId || value.account_id),
    counterpartyId: asString(value.counterpartyId || value.counterparty_id),
    counterpartyName: asString(value.counterpartyName || value.counterparty_name),
    amount: asNumber(value.amount, 0),
    amountDisplay: asString(value.amountDisplay || value.amount_display),
    currency: asString(value.currency).toUpperCase(),
    frequency: asString(value.frequency) || 'Monthly',
    anchorDate: asString(value.anchorDate || value.anchor_date || value.date),
    reason: asString(value.reason)
  };
}

export function normalizeAdvisorRecommendation(value) {
  if (!(value && typeof value === 'object')) {
    return null;
  }
  const candidates = (Array.isArray(value.candidates) ? value.candidates : [])
    .map(normalizeCandidate)
    .filter(Boolean)
    .slice(0, 40);
  if (!candidates.length) {
    return null;
  }
  return {
    stateVersion: ADVISOR_RECOMMENDATION_STATE_VERSION,
    id: asString(value.id) || 'advisor_recommendation_last',
    type: asString(value.type) || 'general_recommendation',
    targetObjectType: asString(value.targetObjectType || value.target_object_type),
    recommendedAction: asString(value.recommendedAction || value.recommended_action),
    promptAffordance: asString(value.promptAffordance || value.prompt_affordance),
    sourcePacketKind: asString(value.sourcePacketKind || value.source_packet_kind),
    sourceRefs: normalizeStringArray(value.sourceRefs || value.source_refs, 120),
    candidates
  };
}

function buildSubscriptionCandidateFromRow(row, index) {
  const sourceRefs = normalizeStringArray(
    row &&
      (row.source_refs || row.sourceRefs || row.source_ref
        ? [row.source_ref].concat(row.source_refs || row.sourceRefs || [])
        : []),
    20
  );
  const transactionId = asString(row && (row.transaction_id || row.transactionId));
  const text = normalizeText(
    [
      row && row.description,
      row && row.counterparty_name,
      row && row.category_name,
      row && row.type_label,
      row && row.note
    ]
      .filter(Boolean)
      .join(' ')
  );
  const looksSubscription =
    /\b(subscription|monthly|annual|yearly|auto renew|chatgpt|netflix|spotify|icloud|google|adobe|api)\b/.test(
      text
    );
  return normalizeCandidate(
    {
      id: transactionId
        ? 'subscription_candidate_' + transactionId
        : 'subscription_candidate_' + String(index + 1),
      name: asString(row && (row.description || row.counterparty_name)) || 'Recurring charge',
      label:
        asString(row && row.description) ||
        asString(row && row.counterparty_name) ||
        'Recurring charge',
      kind: looksSubscription ? 'subscription' : 'recurring_item',
      confidence: looksSubscription ? 0.82 : 0.7,
      transactionIds: transactionId ? [transactionId] : [],
      sourceRefs: sourceRefs.length
        ? sourceRefs
        : transactionId
          ? ['transaction:' + transactionId]
          : [],
      categoryId: row && row.category_id,
      counterpartyId: row && row.counterparty_id,
      counterpartyName: row && row.counterparty_name,
      amount: row && row.amount,
      amountDisplay: row && row.amount_display,
      currency: row && row.currency,
      anchorDate: row && row.date,
      frequency: 'Monthly',
      reason: 'Detected as a recurring or subscription-like transaction.'
    },
    index
  );
}

function getPrimaryPacket(summary) {
  const packets = summary && summary.data_packets ? summary.data_packets : {};
  if (packets.transaction_analysis) {
    return { kind: 'transaction_analysis', packet: packets.transaction_analysis };
  }
  if (packets.categorization_review) {
    return { kind: 'categorization_review', packet: packets.categorization_review };
  }
  const keys = Object.keys(packets);
  return keys.length ? { kind: keys[0], packet: packets[keys[0]] } : { kind: '', packet: null };
}

export function buildAdvisorRecommendationFromSummary({ summary } = {}) {
  const primary = getPrimaryPacket(summary || {});
  const packet = primary.packet || {};
  const recurringRows = Array.isArray(packet.recurring_or_subscription_rows)
    ? packet.recurring_or_subscription_rows
    : [];
  if (recurringRows.length) {
    const candidates = recurringRows.map(buildSubscriptionCandidateFromRow).filter(Boolean);
    return normalizeAdvisorRecommendation({
      id: 'last_subscription_candidates',
      type: 'subscription_candidates',
      targetObjectType: 'recurringItem',
      recommendedAction: 'create_recurring_item_draft',
      promptAffordance: 'add/apply/track those subscriptions',
      sourcePacketKind: primary.kind,
      sourceRefs: candidates.reduce((refs, candidate) => refs.concat(candidate.sourceRefs), []),
      candidates
    });
  }
  return null;
}

function promptHasReferent(prompt) {
  const lower = normalizeText(prompt);
  return (
    /\b(those|these|them|that|it|ones|same|previous|recommendations?)\b/.test(lower) ||
    /\b(first|top)\s+\d+\b/.test(lower) ||
    /\b(do it|go ahead|apply|add|track|queue|create)\b/.test(lower)
  );
}

function promptRequestsApply(prompt) {
  const lower = normalizeText(prompt);
  return /\b(add|apply|track|queue|create|draft|prepare|do it|go ahead|yes|yep|confirm)\b/.test(
    lower
  );
}

function getRequestedLimit(prompt, total) {
  const lower = normalizeText(prompt);
  const match = /\b(?:first|top)\s+(\d+)\b/.exec(lower);
  if (match) {
    return Math.max(0, Math.min(total, Math.round(Number(match[1]) || total)));
  }
  if (/\b(that|it)\b/.test(lower) && total > 1 && !/\b(those|these|them|all)\b/.test(lower)) {
    return 1;
  }
  return total;
}

export function resolveAdvisorReferents(prompt, conversationState = {}) {
  const recommendation = normalizeAdvisorRecommendation(
    conversationState && conversationState.lastRecommendation
  );
  if (!recommendation) {
    return {
      resolved: false,
      reason: 'no_last_recommendation',
      items: []
    };
  }
  if (!promptHasReferent(prompt)) {
    return {
      resolved: false,
      reason: 'no_referent_signal',
      recommendation,
      items: []
    };
  }
  const limit = getRequestedLimit(prompt, recommendation.candidates.length);
  const items = recommendation.candidates.slice(0, limit);
  return {
    resolved: items.length > 0,
    reason: items.length ? 'resolved_last_recommendation' : 'empty_selection',
    action: promptRequestsApply(prompt)
      ? recommendation.recommendedAction
      : 'inspect_recommendation',
    recommendation,
    targetObjectType: recommendation.targetObjectType,
    items
  };
}

export function shouldApplySubscriptionRecommendation(prompt, conversationState = {}) {
  const resolved = resolveAdvisorReferents(prompt, conversationState);
  if (!resolved.resolved || resolved.action !== 'create_recurring_item_draft') {
    return false;
  }
  const lower = normalizeText(prompt);
  const explicitRecurringTarget =
    /\b(subscription|subscriptions|recurring|recurring\s+items?|bills?)\b/.test(lower);
  const pluralReferent =
    /\b(those|these|them|all)\b/.test(lower) || /\b(first|top)\s+\d+\b/.test(lower);
  return (
    resolved.recommendation.type === 'subscription_candidates' &&
    (explicitRecurringTarget || pluralReferent)
  );
}
