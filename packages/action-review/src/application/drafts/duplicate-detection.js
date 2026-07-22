import { roundMoney } from '@cavalry/finance-core/domain/money.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function textKey(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenSet(value) {
  return new Set(textKey(value).split(/\s+/).filter(Boolean));
}

function textSimilarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) {
    return 0;
  }
  let overlap = 0;
  a.forEach((token) => {
    if (b.has(token)) {
      overlap += 1;
    }
  });
  return overlap / Math.max(a.size, b.size);
}

function sameDate(left, right) {
  return (
    asString(left && left.date) && asString(left && left.date) === asString(right && right.date)
  );
}

function sameCurrency(left, right) {
  const leftCurrency = asString(left && (left.currency || left.originalCurrency)).toUpperCase();
  const rightCurrency = asString(right && (right.currency || right.originalCurrency)).toUpperCase();
  return leftCurrency && rightCurrency && leftCurrency === rightCurrency;
}

function sameAmount(left, right) {
  return roundMoney(left && left.amount) === roundMoney(right && right.amount);
}

function sameAccount(left, right) {
  const leftAccount = asString(
    left && (left.payment_account_id || left.primaryAccountId || left.account_id)
  );
  const rightAccount = asString(
    right && (right.payment_account_id || right.primaryAccountId || right.account_id)
  );
  if (!(leftAccount && rightAccount)) {
    return false;
  }
  return leftAccount === rightAccount;
}

export function scoreTransactionDuplicate(existing, draftCandidate) {
  const leftCurrency = asString(
    existing && (existing.currency || existing.originalCurrency)
  ).toUpperCase();
  const rightCurrency = asString(
    draftCandidate && (draftCandidate.currency || draftCandidate.originalCurrency)
  ).toUpperCase();
  if (leftCurrency && rightCurrency && leftCurrency !== rightCurrency) {
    return {
      score: 0,
      reasons: ['different_currency']
    };
  }
  let score = 0;
  const reasons = [];
  if (sameDate(existing, draftCandidate)) {
    score += 0.3;
    reasons.push('same_date');
  }
  if (sameAmount(existing, draftCandidate)) {
    score += 0.3;
    reasons.push('same_amount');
  }
  if (sameCurrency(existing, draftCandidate)) {
    score += 0.15;
    reasons.push('same_currency');
  }
  const similarity = textSimilarity(
    existing && (existing.description || existing.merchant),
    draftCandidate && (draftCandidate.description || draftCandidate.merchant)
  );
  if (similarity >= 0.75) {
    score += 0.2;
    reasons.push('similar_description');
  } else if (similarity >= 0.45) {
    score += 0.1;
    reasons.push('related_description');
  }
  if (sameAccount(existing, draftCandidate)) {
    score += 0.05;
    reasons.push('same_account');
  }
  return {
    score: Number(Math.min(1, score).toFixed(2)),
    reasons
  };
}

function getPendingExternalTransactionDrafts(workbook) {
  return (
    workbook && Array.isArray(workbook.externalDraftGroups) ? workbook.externalDraftGroups : []
  )
    .filter((group) =>
      ['pending_review', 'partially_ready', 'needs_info', 'blocked'].includes(
        asString(group.status)
      )
    )
    .flatMap((group) =>
      (Array.isArray(group.drafts) ? group.drafts : []).map((draft) => ({
        id: draft.draft_id,
        date: draft.proposed_values && draft.proposed_values.date,
        description: draft.proposed_values && draft.proposed_values.description,
        amount: draft.proposed_values && draft.proposed_values.amount,
        currency: draft.proposed_values && draft.proposed_values.currency,
        payment_account_id: draft.proposed_values && draft.proposed_values.payment_account_id,
        source: 'pending_draft',
        draft_group_id: group.draft_group_id
      }))
    )
    .filter((draft) => draft.id);
}

export function findTransactionDuplicateCandidates(workbook, draftCandidate, options = {}) {
  const threshold = Number(options.threshold || 0.75);
  const existing = (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : [])
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
      currency: transaction.originalCurrency || transaction.currency,
      payment_account_id: transaction.primaryAccountId,
      source: 'transaction'
    }))
    .concat(getPendingExternalTransactionDrafts(workbook));
  return existing
    .map((candidate) => {
      const scored = scoreTransactionDuplicate(candidate, draftCandidate);
      return {
        ref:
          candidate.source === 'pending_draft'
            ? 'draft:' + candidate.id
            : 'transaction:' + candidate.id,
        transaction_id: candidate.source === 'transaction' ? candidate.id : undefined,
        draft_id: candidate.source === 'pending_draft' ? candidate.id : undefined,
        draft_group_id: candidate.draft_group_id,
        score: scored.score,
        reasons: scored.reasons,
        date: candidate.date,
        description: candidate.description,
        amount: candidate.amount,
        currency: candidate.currency
      };
    })
    .filter((candidate) => candidate.score >= threshold);
}
