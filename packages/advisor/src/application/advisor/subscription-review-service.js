import { normalizeRecurringFrequency } from '@cavalry/finance-core/application/recurring/recurring-analysis-service.js';

const CLASSIFICATIONS = new Set(['likely_subscription', 'maybe_subscription', 'not_subscription']);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function extractSubscriptionReviewJson(text) {
  const raw = asString(text);
  if (!raw) {
    return null;
  }
  const candidates = [raw];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced && fenced[1]) {
    candidates.push(fenced[1].trim());
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // Try the next bounded JSON representation.
    }
  }
  return null;
}

export function normalizeSubscriptionReviewConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

export function normalizeSubscriptionReviewSuggestedFrequency(value) {
  const frequencies = {
    weekly: 'Weekly',
    biweekly: 'Every 2 Weeks',
    'every 2 weeks': 'Every 2 Weeks',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
    annual: 'Yearly',
    annually: 'Yearly',
    'one-time': 'One-time',
    'one time': 'One-time'
  };
  return frequencies[asString(value).toLowerCase()] || '';
}

export function validateSubscriptionReviewModelSuggestions(text, candidates) {
  const parsed = extractSubscriptionReviewJson(text);
  const items =
    parsed && Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : Array.isArray(parsed)
        ? parsed
        : [];
  const candidatesById = new Map(
    asArray(candidates).map((candidate) => [asString(candidate && candidate.id), candidate])
  );
  return items.flatMap((item) => {
    const candidate = candidatesById.get(asString(item && item.candidate_id));
    const classification = asString(item && item.classification);
    const frequency = normalizeSubscriptionReviewSuggestedFrequency(
      item && item.suggested_frequency
    );
    if (!(candidate && CLASSIFICATIONS.has(classification) && frequency)) {
      return [];
    }
    const allowedTransactionIds = new Set(asArray(candidate.transactionIds).map(asString));
    const representativeTransactionIds = asArray(item.representative_transaction_ids)
      .map(asString)
      .filter(Boolean);
    if (representativeTransactionIds.some((id) => !allowedTransactionIds.has(id))) {
      return [];
    }
    const allowedSourceRefs = new Set(asArray(candidate.source_refs).map(asString));
    const sourceRefs = asArray(item.source_refs).map(asString).filter(Boolean);
    if (sourceRefs.some((ref) => !allowedSourceRefs.has(ref))) {
      return [];
    }
    return [
      {
        candidateId: candidate.id,
        classification,
        confidence: normalizeSubscriptionReviewConfidence(item.confidence),
        reason: asString(item.reason || candidate.reason),
        suggestedName: asString(item.suggested_name || candidate.suggestedName || candidate.name),
        suggestedFrequency: frequency,
        representativeTransactionIds: representativeTransactionIds.length
          ? representativeTransactionIds
          : asArray(candidate.transactionIds).slice(0, 6),
        source_refs: sourceRefs.length ? sourceRefs : asArray(candidate.source_refs).slice(0, 6)
      }
    ];
  });
}

export function materializeSubscriptionReviewModelSuggestions(candidates, suggestions) {
  const candidatesById = new Map(
    asArray(candidates).map((candidate) => [asString(candidate && candidate.id), candidate])
  );
  return asArray(suggestions).flatMap((suggestion) => {
    const candidate = candidatesById.get(asString(suggestion && suggestion.candidateId));
    if (!candidate) {
      return [];
    }
    return [
      {
        ...candidate,
        classification: suggestion.classification,
        confidence: Number.isFinite(Number(suggestion.confidence))
          ? Number(suggestion.confidence)
          : candidate.confidence,
        reason: suggestion.reason || candidate.reason,
        suggestedName: suggestion.suggestedName || candidate.suggestedName,
        suggestedFrequency: suggestion.suggestedFrequency || candidate.suggestedFrequency,
        modelReviewed: true
      }
    ];
  });
}

export function completeSubscriptionReviewScan(candidates, result) {
  return result && result.ok
    ? materializeSubscriptionReviewModelSuggestions(candidates, result.suggestions)
    : [];
}

export function normalizeSubscriptionReviewProgressPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
}

export function buildRecurringDraftProposalFromSubscriptionCandidate(workbook, candidate) {
  const transactionsById = new Map(
    asArray(workbook && workbook.transactions).map((transaction) => [
      asString(transaction && transaction.id),
      transaction
    ])
  );
  const transactions = asArray(candidate && candidate.transactionIds)
    .map((id) => transactionsById.get(asString(id)))
    .filter(Boolean)
    .sort(
      (left, right) =>
        asString(left.date).localeCompare(asString(right.date)) ||
        asString(left.id).localeCompare(asString(right.id))
    );
  const first = transactions[0];
  const category = asArray(workbook && workbook.categories).find(
    (item) => asString(item && item.id) === asString(candidate && candidate.categoryId)
  );
  if (!(first && category && category.type === 'expense')) {
    return null;
  }
  const name =
    asString(candidate && (candidate.suggestedName || candidate.name)) || 'Recurring charge';
  const kind = /subscription|subscript|netflix|spotify|prime|icloud|membership|dues/i.test(
    `${asString(category.name)} ${name}`
  )
    ? 'subscription'
    : 'bill';
  return {
    kind,
    name,
    categoryId: category.id,
    counterpartyId: asString(first.counterpartyId),
    accountId: asString(candidate && candidate.accountId),
    amount: Number(candidate && candidate.amount) || Number(first.amount) || 0,
    currency:
      asString(first.originalCurrency || (workbook && workbook.currency)).toUpperCase() || 'PHP',
    frequency: normalizeRecurringFrequency(candidate && candidate.suggestedFrequency),
    anchorDate: asString(first.date),
    autoRenew: kind === 'subscription',
    isActive: true,
    note: 'Created from AI Subscription Review',
    createdFromTransactionId: first.id,
    sourceTransactionIds: transactions.map((transaction) => transaction.id)
  };
}
