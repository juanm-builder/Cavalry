import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import {
  getLedgerTransactionBaseAmount,
  getLedgerTransactionFlowKind
} from '../../domain/ledger/transactions.js';
import { getRecurringOccurrenceDatesForMonth } from './recurring-analysis-service.js';

export const RECURRING_RECONCILIATION_DEFAULTS = Object.freeze({
  beforeDays: 14,
  afterDays: 14,
  autoMatchScore: 90,
  reviewScore: 65,
  ambiguityMargin: 10
});

export const RECURRING_RECONCILIATION_METHODS = Object.freeze([
  'explicit',
  'automatic',
  'manual',
  'legacy'
]);

const EXPENSE_TEMPLATES = Object.freeze(['expense_paid', 'expense_charged']);
const DEBT_TEMPLATES = Object.freeze(['debt_payment', 'liability_payment', 'transfer']);
const ELIGIBLE_TEMPLATES = Object.freeze([...EXPENSE_TEMPLATES, ...DEBT_TEMPLATES]);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function resolveOptions(options) {
  const source = options && typeof options === 'object' ? options : {};
  return {
    ...source,
    beforeDays: nonNegative(source.beforeDays, RECURRING_RECONCILIATION_DEFAULTS.beforeDays),
    afterDays: nonNegative(source.afterDays, RECURRING_RECONCILIATION_DEFAULTS.afterDays),
    autoMatchScore: nonNegative(
      source.autoMatchScore,
      RECURRING_RECONCILIATION_DEFAULTS.autoMatchScore
    ),
    reviewScore: nonNegative(source.reviewScore, RECURRING_RECONCILIATION_DEFAULTS.reviewScore),
    ambiguityMargin: nonNegative(
      source.ambiguityMargin,
      RECURRING_RECONCILIATION_DEFAULTS.ambiguityMargin
    ),
    confirmedTransactionId: asString(source.confirmedTransactionId || source.forcedTransactionId)
  };
}

function parseDate(value) {
  const dateKey = normalizeDateKey(value);
  if (!dateKey) return null;
  const date = new Date(
    Date.UTC(
      Number(dateKey.slice(0, 4)),
      Number(dateKey.slice(5, 7)) - 1,
      Number(dateKey.slice(8, 10))
    )
  );
  return date.toISOString().slice(0, 10) === dateKey ? date : null;
}

function dateDistance(expectedDate, actualDate) {
  const expected = parseDate(expectedDate);
  const actual = parseDate(actualDate);
  return expected && actual ? Math.round((actual.getTime() - expected.getTime()) / 86400000) : null;
}

function findById(items, id) {
  const targetId = asString(id);
  return targetId
    ? asArray(items).find((item) => asString(item && item.id) === targetId) || null
    : null;
}

function isScheduledOccurrenceDate(workbook, recurringItemId, value) {
  const recurringItem = findById(workbook && workbook.recurringItems, recurringItemId);
  const occurrenceDate = normalizeDateKey(value);
  if (!(recurringItem && occurrenceDate)) return false;

  // Older workbooks may have tracker links without enough schedule metadata to
  // prove that an occurrence is obsolete. Keep those links conservative.
  const anchorDate = normalizeDateKey(recurringItem.anchorDate || recurringItem.dueDate);
  if (!anchorDate) return true;
  return getRecurringOccurrenceDatesForMonth(recurringItem, occurrenceDate.slice(0, 7)).includes(
    occurrenceDate
  );
}

function hasId(collection, id) {
  const targetId = asString(id);
  if (!(collection && targetId)) return false;
  if (typeof collection.has === 'function') return collection.has(targetId);
  return asArray(collection).some((candidate) => asString(candidate) === targetId);
}

function getRecurringItem(occurrence) {
  return occurrence && occurrence.recurringItem && typeof occurrence.recurringItem === 'object'
    ? occurrence.recurringItem
    : null;
}

function getOccurrenceValue(occurrence, key) {
  const recurringItem = getRecurringItem(occurrence);
  return occurrence && occurrence[key] != null
    ? occurrence[key]
    : recurringItem && recurringItem[key];
}

function getAccountGroup(workbook, accountId) {
  return asString(findById(workbook && workbook.accounts, accountId)?.group).toLowerCase();
}

function getCategoryType(workbook, occurrence) {
  return asString(
    findById(workbook && workbook.categories, occurrence && occurrence.categoryId)?.type
  ).toLowerCase();
}

function getReconciliationKind(workbook, occurrence) {
  const expectedTemplate = asString(getOccurrenceValue(occurrence, 'expectedTemplate'));
  return DEBT_TEMPLATES.includes(expectedTemplate) ||
    asString(getOccurrenceValue(occurrence, 'liabilityAccountId')) ||
    getCategoryType(workbook, occurrence) === 'debt'
    ? 'debt'
    : 'expense';
}

function getExpectedTemplates(workbook, occurrence) {
  const explicitTemplate = asString(getOccurrenceValue(occurrence, 'expectedTemplate'));
  if (ELIGIBLE_TEMPLATES.includes(explicitTemplate)) return [explicitTemplate];
  if (getReconciliationKind(workbook, occurrence) === 'debt') return [...DEBT_TEMPLATES];
  const accountGroup = getAccountGroup(workbook, getOccurrenceValue(occurrence, 'accountId'));
  if (accountGroup === 'asset') return ['expense_paid'];
  if (accountGroup === 'liability') return ['expense_charged'];
  return [...EXPENSE_TEMPLATES];
}

function normalizeText(value) {
  return asString(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenTextValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenTextValues);
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function getLearnedOccurrenceText(workbook, occurrence, options) {
  const recurringItemId = asString(occurrence && occurrence.recurringItemId);
  if (!recurringItemId) return [];
  const transactionById = new Map(
    asArray(workbook && workbook.transactions).map((transaction) => [
      asString(transaction && transaction.id),
      transaction
    ])
  );
  return getRecords(workbook, options)
    .filter(
      (record) =>
        asString(record && record.recurringItemId) === recurringItemId &&
        asString(record && record.decision).toLowerCase() === 'matched'
    )
    .flatMap((record) => {
      const transaction = transactionById.get(asString(record && record.transactionId));
      return transaction ? getTransactionText(workbook, transaction) : [];
    });
}

function getOccurrenceText(workbook, occurrence, options) {
  const counterparty = findById(
    workbook && workbook.counterparties,
    getOccurrenceValue(occurrence, 'counterpartyId')
  );
  return flattenTextValues([
    occurrence && occurrence.name,
    getOccurrenceValue(occurrence, 'name'),
    getOccurrenceValue(occurrence, 'aliases'),
    getOccurrenceValue(occurrence, 'merchantAliases'),
    counterparty && counterparty.name,
    counterparty && counterparty.aliases,
    getLearnedOccurrenceText(workbook, occurrence, options)
  ]);
}

function getTransactionText(workbook, transaction) {
  const counterparty = findById(
    workbook && workbook.counterparties,
    transaction && transaction.counterpartyId
  );
  return flattenTextValues([
    transaction && transaction.description,
    transaction && transaction.merchantName,
    transaction && transaction.counterpartyName,
    counterparty && counterparty.name,
    counterparty && counterparty.aliases
  ]);
}

function bestTextMatch(leftValues, rightValues) {
  let best = { points: 0, code: 'merchant_no_match', detail: '' };
  leftValues.forEach((left) => {
    rightValues.forEach((right) => {
      let candidate = best;
      if (left === right) {
        candidate = { points: 25, code: 'merchant_exact', detail: left };
      } else if (
        (left.length >= 4 && right.includes(left)) ||
        (right.length >= 4 && left.includes(right))
      ) {
        candidate = { points: 23, code: 'merchant_contains', detail: `${left} / ${right}` };
      } else {
        const leftTokens = new Set(left.split(' ').filter(Boolean));
        const rightTokens = new Set(right.split(' ').filter(Boolean));
        const overlap = [...leftTokens].filter((token) => rightTokens.has(token));
        const coverage = overlap.length / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
        if (overlap.length >= 2 && coverage >= 0.67) {
          candidate = {
            points: 18,
            code: 'merchant_strong_tokens',
            detail: overlap.join(', ')
          };
        } else if (overlap.length && overlap[0].length >= 4) {
          candidate = {
            points: coverage >= 0.5 ? 14 : 10,
            code: 'merchant_partial_tokens',
            detail: overlap.join(', ')
          };
        }
      }
      if (candidate.points > best.points) best = candidate;
    });
  });
  return best;
}

function signal(code, points, matched, message, detail = '') {
  return { code, points, matched, message, detail: asString(detail) };
}

function amountSignal(occurrence, transaction) {
  const expected = roundMoney(Number(occurrence && occurrence.amount) || 0);
  const actual = getLedgerTransactionBaseAmount(transaction);
  const difference = roundMoney(Math.abs(expected - actual));
  const differencePercent = expected > 0 ? Math.round((difference / expected) * 1000) / 10 : null;
  let evidence = signal('amount_unavailable', 0, false, 'No expected amount is available.');
  if (expected > 0 && difference <= Math.max(0.01, expected * 0.005)) {
    evidence = signal('amount_exact', 25, true, 'The amount matches.', difference);
  } else if (expected > 0 && difference <= Math.max(1, expected * 0.05)) {
    evidence = signal('amount_close', 20, true, 'The amount is within 5%.', difference);
  } else if (expected > 0 && difference <= Math.max(5, expected * 0.15)) {
    evidence = signal('amount_variable', 10, true, 'The amount is within 15%.', difference);
  } else if (expected > 0) {
    evidence = signal('amount_mismatch', 0, false, 'The amount differs.', difference);
  }
  return { evidence, expected, actual, difference, differencePercent };
}

function dateSignal(distanceDays) {
  const distance = Math.abs(Number(distanceDays));
  if (distance === 0) return signal('date_exact', 20, true, 'The dates match.', '0 days');
  if (distance <= 3) {
    return signal(
      'date_very_close',
      18,
      true,
      'The transaction is within 3 days.',
      `${distance} days`
    );
  }
  if (distance <= 7) {
    return signal('date_close', 14, true, 'The transaction is within 7 days.', `${distance} days`);
  }
  return signal(
    'date_in_window',
    8,
    true,
    'The transaction is inside the date window.',
    `${distance} days`
  );
}

function getTransactionAccountId(workbook, occurrence, transaction) {
  const kind = getReconciliationKind(workbook, occurrence);
  const expectedGroup =
    kind === 'debt'
      ? 'liability'
      : transaction.template === 'expense_charged'
        ? 'liability'
        : 'asset';
  const expectedDirection = kind === 'debt' ? 'debit' : 'credit';
  const accounts = new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asString(account && account.id),
      account
    ])
  );
  const line = asArray(transaction && transaction.lines).find((candidate) => {
    const account = accounts.get(asString(candidate && candidate.accountId));
    return (
      account &&
      account.group === expectedGroup &&
      asString(candidate && candidate.direction).toLowerCase() === expectedDirection
    );
  });
  return asString(line && line.accountId);
}

function isLiabilitySettlementTransfer(workbook, occurrence, transaction) {
  if (asString(transaction && transaction.template) !== 'transfer') return false;
  const targetLiabilityId = asString(
    getOccurrenceValue(occurrence, 'liabilityAccountId') ||
      getOccurrenceValue(occurrence, 'accountId')
  );
  if (!targetLiabilityId || getAccountGroup(workbook, targetLiabilityId) !== 'liability') {
    return false;
  }
  const accounts = new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asString(account && account.id),
      account
    ])
  );
  const lines = asArray(transaction && transaction.lines);
  const targetsLiability = lines.some(
    (line) =>
      asString(line && line.accountId) === targetLiabilityId &&
      asString(line && line.direction).toLowerCase() === 'debit'
  );
  const fundedByAsset = lines.some((line) => {
    const account = accounts.get(asString(line && line.accountId));
    return (
      account && account.group === 'asset' && asString(line.direction).toLowerCase() === 'credit'
    );
  });
  return targetsLiability && fundedByAsset;
}

function accountSignal(workbook, occurrence, transaction) {
  const expected = asString(
    getReconciliationKind(workbook, occurrence) === 'debt'
      ? getOccurrenceValue(occurrence, 'liabilityAccountId') ||
          getOccurrenceValue(occurrence, 'accountId')
      : getOccurrenceValue(occurrence, 'accountId')
  );
  const actual = getTransactionAccountId(workbook, occurrence, transaction);
  if (!expected) {
    return {
      evidence: signal('account_unset', 0, false, 'No expected account is set.'),
      expected,
      actual
    };
  }
  if (!actual) {
    return {
      evidence: signal('account_unresolved', 0, false, 'The transaction account is unavailable.'),
      expected,
      actual
    };
  }
  return expected === actual
    ? {
        evidence: signal('account_match', 15, true, 'The account matches.', expected),
        expected,
        actual
      }
    : {
        evidence: signal(
          'account_mismatch',
          -12,
          false,
          'The account differs.',
          `${expected} / ${actual}`
        ),
        expected,
        actual
      };
}

function categorySignal(occurrence, transaction) {
  const expected = asString(occurrence && occurrence.categoryId);
  const actual = asString(transaction && transaction.categoryId);
  if (asString(transaction && transaction.template) === 'transfer' && !actual) {
    return signal(
      'category_not_applicable',
      0,
      true,
      'Liability-settlement transfers do not require a category.'
    );
  }
  if (!expected) return signal('category_unset', 0, false, 'No expected category is set.');
  return expected === actual
    ? signal('category_match', 10, true, 'The category matches.', expected)
    : signal('category_mismatch', -8, false, 'The category differs.', `${expected} / ${actual}`);
}

function counterpartySignal(occurrence, transaction) {
  const expected = asString(getOccurrenceValue(occurrence, 'counterpartyId'));
  const actual = asString(transaction && transaction.counterpartyId);
  if (!(expected && actual)) {
    return signal('counterparty_unavailable', 0, false, 'A payee comparison is unavailable.');
  }
  return expected === actual
    ? signal('counterparty_match', 5, true, 'The merchant or payee matches.', expected)
    : signal(
        'counterparty_mismatch',
        -5,
        false,
        'The merchant or payee differs.',
        `${expected} / ${actual}`
      );
}

export function recurringReconciliationKey(recurringItemId, occurrenceDate, transactionId) {
  return [
    asString(recurringItemId),
    normalizeDateKey(occurrenceDate),
    asString(transactionId)
  ].join('::');
}

function occurrenceRecordKey(occurrence, transactionId) {
  return recurringReconciliationKey(
    occurrence && occurrence.recurringItemId,
    occurrence && occurrence.dueDate,
    transactionId
  );
}

function getRecords(workbook, options) {
  return asArray(
    options && Array.isArray(options.reconciliationRecords)
      ? options.reconciliationRecords
      : workbook && workbook.recurringReconciliations
  );
}

function latestOccurrenceRecords(workbook, occurrence, options) {
  const prefix = recurringReconciliationKey(
    occurrence && occurrence.recurringItemId,
    occurrence && occurrence.dueDate,
    ''
  ).slice(0, -1);
  const records = new Map();
  getRecords(workbook, options).forEach((record) => {
    const key = recurringReconciliationKey(
      record && record.recurringItemId,
      record && record.occurrenceDate,
      record && record.transactionId
    );
    if (key.startsWith(prefix) && asString(record && record.transactionId))
      records.set(key, record);
  });
  return [...records.values()];
}

function recordMatchesOccurrence(record, occurrence) {
  return (
    asString(record && record.recurringItemId) ===
      asString(occurrence && occurrence.recurringItemId) &&
    normalizeDateKey(record && record.occurrenceDate) ===
      normalizeDateKey(occurrence && occurrence.dueDate)
  );
}

function explicitLinkKind(occurrence, transaction) {
  const itemId = asString(occurrence && occurrence.recurringItemId);
  if (!(itemId && asString(transaction && transaction.recurringItemId) === itemId)) return '';
  const occurrenceId = asString(occurrence && occurrence.id);
  const linkedOccurrenceId = asString(transaction && transaction.recurringOccurrenceId);
  if (occurrenceId && linkedOccurrenceId === occurrenceId) return 'explicit';
  const occurrenceDate = normalizeDateKey(occurrence && occurrence.dueDate);
  if (
    occurrenceDate &&
    normalizeDateKey(transaction && transaction.recurringOccurrenceDate) === occurrenceDate
  ) {
    return 'explicit';
  }
  return 'legacy';
}

export function getRecurringCandidateEligibility(workbook, occurrence, transaction, options = {}) {
  const resolved = resolveOptions(options);
  const transactionId = asString(transaction && transaction.id);
  const template = asString(transaction && transaction.template);
  const flowKind =
    workbook && transaction ? getLedgerTransactionFlowKind(workbook, transaction) : '';
  const reconciliationKind = getReconciliationKind(workbook, occurrence);
  const expectedFlowKind = reconciliationKind === 'debt' ? 'debt' : 'expense';
  const expectedTemplates = getExpectedTemplates(workbook, occurrence);
  const occurrenceDate = normalizeDateKey(occurrence && occurrence.dueDate);
  const transactionDate = normalizeDateKey(transaction && transaction.date);
  const distanceDays = dateDistance(occurrenceDate, transactionDate);
  const linkKind = explicitLinkKind(occurrence, transaction);
  const records = latestOccurrenceRecords(workbook, occurrence, resolved);
  const rejected = records.some(
    (record) =>
      asString(record && record.transactionId) === transactionId &&
      asString(record && record.decision).toLowerCase() === 'rejected'
  );
  const matchedElsewhere = getRecords(workbook, resolved).some(
    (record) =>
      asString(record && record.transactionId) === transactionId &&
      asString(record && record.decision).toLowerCase() === 'matched' &&
      !recordMatchesOccurrence(record, occurrence) &&
      isScheduledOccurrenceDate(
        workbook,
        record && record.recurringItemId,
        record && record.occurrenceDate
      )
  );
  const isConfirmedOverride = resolved.confirmedTransactionId === transactionId;
  let rejectionCode = '';

  if (!(workbook && occurrence && transaction)) rejectionCode = 'invalid_input';
  else if (hasId(resolved.usedTransactionIds, transactionId))
    rejectionCode = 'transaction_already_used';
  else if (hasId(resolved.excludedTransactionIds, transactionId))
    rejectionCode = 'transaction_excluded';
  else if (matchedElsewhere) rejectionCode = 'transaction_matched_elsewhere';
  else if (rejected && !isConfirmedOverride) rejectionCode = 'stored_rejection';
  else if (!ELIGIBLE_TEMPLATES.includes(template)) rejectionCode = 'unsupported_template';
  else if (!expectedTemplates.includes(template)) rejectionCode = 'unexpected_template';
  else if (
    template === 'transfer' &&
    !isLiabilitySettlementTransfer(workbook, occurrence, transaction)
  ) {
    rejectionCode = 'ordinary_transfer';
  } else if (flowKind !== expectedFlowKind && template !== 'transfer') {
    rejectionCode = expectedFlowKind === 'debt' ? 'non_debt_flow' : 'non_expense_flow';
  } else if (getLedgerTransactionBaseAmount(transaction) <= 0)
    rejectionCode = 'non_positive_amount';
  else {
    const itemId = asString(occurrence.recurringItemId);
    const linkedItemId = asString(transaction.recurringItemId);
    const linkedOccurrenceId = asString(transaction.recurringOccurrenceId);
    const linkedOccurrenceDate = normalizeDateKey(transaction.recurringOccurrenceDate);
    const isStaleSameTrackerDate =
      linkedItemId === itemId &&
      !!linkedOccurrenceDate &&
      !isScheduledOccurrenceDate(workbook, linkedItemId, linkedOccurrenceDate);
    if (linkedItemId && linkedItemId !== itemId) rejectionCode = 'linked_to_other_tracker';
    else if (linkedOccurrenceId && occurrence.id && linkedOccurrenceId !== occurrence.id) {
      rejectionCode = 'linked_to_other_occurrence';
    } else if (
      linkedOccurrenceDate &&
      linkedOccurrenceDate !== occurrenceDate &&
      !isStaleSameTrackerDate
    ) {
      rejectionCode = 'linked_to_other_occurrence';
    } else if (!(occurrenceDate && transactionDate && distanceDays != null))
      rejectionCode = 'invalid_date';
    else if (
      linkKind !== 'explicit' &&
      (distanceDays < -resolved.beforeDays || distanceDays > resolved.afterDays)
    ) {
      rejectionCode = 'outside_date_window';
    }
  }

  return {
    eligible: !rejectionCode,
    rejectionCode,
    transactionId,
    template,
    flowKind,
    reconciliationKind,
    expectedFlowKind,
    expectedTemplates,
    linkKind,
    occurrenceDate,
    transactionDate,
    distanceDays,
    dateWindow: { beforeDays: resolved.beforeDays, afterDays: resolved.afterDays }
  };
}

export function scoreRecurringReconciliationCandidate(
  workbook,
  occurrence,
  transaction,
  options = {}
) {
  const resolved = resolveOptions(options);
  const eligibility = getRecurringCandidateEligibility(workbook, occurrence, transaction, resolved);
  if (!eligibility.eligible) {
    return { ...eligibility, score: 0, confidence: 0, signals: [], transaction };
  }
  const amount = amountSignal(occurrence, transaction);
  const date = dateSignal(eligibility.distanceDays);
  const account = accountSignal(workbook, occurrence, transaction);
  const category = categorySignal(occurrence, transaction);
  const counterparty = counterpartySignal(occurrence, transaction);
  const transactionForm = signal(
    'transaction_form_match',
    5,
    true,
    eligibility.template === 'transfer'
      ? 'The transfer settles the expected liability.'
      : 'The transaction flow and template match the tracker.',
    eligibility.template
  );
  const occurrenceText = Array.isArray(resolved.occurrenceText)
    ? resolved.occurrenceText
    : getOccurrenceText(workbook, occurrence, resolved);
  const transactionTextCache = resolved.transactionTextCache;
  let transactionText =
    transactionTextCache && typeof transactionTextCache.get === 'function'
      ? transactionTextCache.get(transaction)
      : null;
  if (!transactionText) {
    transactionText = getTransactionText(workbook, transaction);
    if (transactionTextCache && typeof transactionTextCache.set === 'function') {
      transactionTextCache.set(transaction, transactionText);
    }
  }
  const text = bestTextMatch(occurrenceText, transactionText);
  const merchant = signal(
    text.code,
    text.points,
    text.points > 0,
    text.points > 0 ? 'The merchant text matches.' : 'The merchant text does not match.',
    text.detail
  );
  const signals = [
    transactionForm,
    amount.evidence,
    merchant,
    date,
    account.evidence,
    category,
    counterparty
  ];
  if (eligibility.linkKind) {
    signals.unshift(
      signal(
        eligibility.linkKind === 'explicit' ? 'explicit_occurrence_link' : 'legacy_tracker_link',
        0,
        true,
        eligibility.linkKind === 'explicit'
          ? 'The transaction explicitly identifies this occurrence.'
          : 'The transaction is linked to this recurring tracker.'
      )
    );
  }
  const evidenceScore = clamp(
    signals.reduce((sum, entry) => sum + Number(entry.points || 0), 0),
    0,
    100
  );
  const score = eligibility.linkKind ? 100 : evidenceScore;
  return {
    ...eligibility,
    score,
    evidenceScore,
    confidence: score,
    signals,
    amount: {
      expected: amount.expected,
      transaction: amount.actual,
      difference: amount.difference,
      differencePercent: amount.differencePercent
    },
    account: { expected: account.expected, transaction: account.actual },
    transaction
  };
}

function compareCandidates(left, right) {
  const linkRank = { explicit: 2, legacy: 1, '': 0 };
  return (
    (linkRank[right.linkKind] || 0) - (linkRank[left.linkKind] || 0) ||
    right.score - left.score ||
    Math.abs(left.distanceDays) - Math.abs(right.distanceDays) ||
    asString(left.transactionDate).localeCompare(asString(right.transactionDate)) ||
    asString(left.transactionId).localeCompare(asString(right.transactionId))
  );
}

function storedSettlement(workbook, occurrence, transactions, options) {
  const records = latestOccurrenceRecords(workbook, occurrence, options);
  const transactionById = new Map(
    [...asArray(workbook && workbook.transactions), ...asArray(transactions)].map((transaction) => [
      asString(transaction && transaction.id),
      transaction
    ])
  );
  const matchedRecords = records.filter(
    (record) => asString(record && record.decision).toLowerCase() === 'matched'
  );
  const evaluatedAllocations = matchedRecords.map((record) => {
    const transaction = transactionById.get(asString(record.transactionId)) || null;
    const method = RECURRING_RECONCILIATION_METHODS.includes(asString(record.method).toLowerCase())
      ? asString(record.method).toLowerCase()
      : 'legacy';
    const validationTransaction =
      transaction && method === 'explicit'
        ? {
            ...transaction,
            recurringItemId: asString(occurrence && occurrence.recurringItemId),
            recurringOccurrenceDate: normalizeDateKey(occurrence && occurrence.dueDate)
          }
        : transaction;
    const eligibility = validationTransaction
      ? getRecurringCandidateEligibility(workbook, occurrence, validationTransaction, {
          confirmedTransactionId: asString(transaction && transaction.id)
        })
      : null;
    const transactionBaseAmount = getLedgerTransactionBaseAmount(transaction);
    return {
      record,
      transaction,
      transactionId: asString(record.transactionId),
      allocatedBaseAmount: roundMoney(
        Math.min(
          Math.max(0, Number(record.allocatedBaseAmount) || 0),
          Math.max(0, transactionBaseAmount)
        )
      ),
      method,
      eligibility,
      confidence: clamp(Number(record.confidence) || 0, 0, 100)
    };
  });
  const allocations = evaluatedAllocations.filter(
    (allocation) =>
      allocation.transaction && allocation.eligibility && allocation.eligibility.eligible
  );
  const expectedBaseAmount = roundMoney(Math.max(0, Number(occurrence && occurrence.amount) || 0));
  const allocatedBaseAmount = roundMoney(
    allocations.reduce((sum, allocation) => sum + allocation.allocatedBaseAmount, 0)
  );
  const remainingBaseAmount = roundMoney(Math.max(0, expectedBaseAmount - allocatedBaseAmount));
  const state =
    allocatedBaseAmount <= 0 ? 'unmatched' : remainingBaseAmount <= 0.01 ? 'matched' : 'partial';
  return {
    state,
    expectedBaseAmount,
    allocatedBaseAmount,
    remainingBaseAmount,
    allocations,
    invalidAllocations: evaluatedAllocations
      .filter(
        (allocation) =>
          allocation.transaction && allocation.eligibility && !allocation.eligibility.eligible
      )
      .map((allocation) => ({
        record: allocation.record,
        transaction: allocation.transaction,
        transactionId: allocation.transactionId,
        rejectionCode: allocation.eligibility.rejectionCode
      })),
    orphanedAllocations: matchedRecords
      .filter((record) => !transactionById.has(asString(record && record.transactionId)))
      .map((record) => ({ record, transactionId: asString(record && record.transactionId) })),
    rejectedTransactionIds: records
      .filter((record) => asString(record && record.decision).toLowerCase() === 'rejected')
      .map((record) => asString(record.transactionId))
      .filter(Boolean)
  };
}

function ambiguity(top, runnerUp, requiredMargin) {
  const margin = top && runnerUp ? top.score - runnerUp.score : null;
  return {
    isAmbiguous: !!(top && runnerUp && margin < requiredMargin),
    margin,
    requiredMargin,
    runnerUpTransactionId: runnerUp ? runnerUp.transactionId : '',
    runnerUpScore: runnerUp ? runnerUp.score : null
  };
}

function resultFields(scored, settlement, resolved) {
  const candidates = scored.filter((candidate) => candidate.eligible).sort(compareCandidates);
  const rejectedCandidates = scored.filter((candidate) => !candidate.eligible);
  const top = candidates[0] || null;
  const runnerUp = candidates[1] || null;
  return {
    candidates,
    rejectedCandidates,
    rejectedTransactionIds: rejectedCandidates.map((candidate) => candidate.transactionId),
    top,
    runnerUp,
    ambiguity: ambiguity(top, runnerUp, resolved.ambiguityMargin),
    settlement
  };
}

function scoreRecurringCandidateWithCache(
  workbook,
  occurrence,
  transaction,
  resolved,
  usedTransactionIds
) {
  const cache = resolved.candidateScoreCache;
  if (!(cache && typeof cache.get === 'function' && typeof cache.set === 'function')) {
    return scoreRecurringReconciliationCandidate(workbook, occurrence, transaction, {
      ...resolved,
      usedTransactionIds
    });
  }

  let candidate = cache.get(transaction);
  if (!candidate) {
    candidate = scoreRecurringReconciliationCandidate(workbook, occurrence, transaction, {
      ...resolved,
      usedTransactionIds: []
    });
    cache.set(transaction, candidate);
  }
  if (!hasId(usedTransactionIds, candidate.transactionId)) return candidate;

  const {
    account: _account,
    amount: _amount,
    evidenceScore: _evidenceScore,
    ...eligibility
  } = candidate;
  return {
    ...eligibility,
    eligible: false,
    rejectionCode: 'transaction_already_used',
    score: 0,
    confidence: 0,
    signals: [],
    transaction
  };
}

export function reconcileRecurringOccurrence(
  workbook,
  occurrence,
  transactions = workbook && workbook.transactions,
  options = {}
) {
  const resolved = resolveOptions(options);
  const sourceTransactions = asArray(transactions);
  const settlement =
    resolved.precomputedSettlement && typeof resolved.precomputedSettlement === 'object'
      ? resolved.precomputedSettlement
      : storedSettlement(workbook, occurrence, sourceTransactions, resolved);
  const allocatedIds = new Set(
    settlement.allocations.map((allocation) => allocation.transactionId)
  );
  const usedIds = new Set([
    ...(resolved.usedTransactionIds &&
    typeof resolved.usedTransactionIds[Symbol.iterator] === 'function'
      ? resolved.usedTransactionIds
      : asArray(resolved.usedTransactionIds)),
    ...allocatedIds
  ]);

  if (settlement.state === 'matched') {
    return {
      decision: 'matched',
      reason: 'stored_allocations_complete',
      matchType: 'stored',
      transaction: settlement.allocations[0]?.transaction || null,
      candidate: null,
      candidates: [],
      rejectedCandidates: [],
      rejectedTransactionIds: [],
      signals: [],
      ambiguity: ambiguity(null, null, resolved.ambiguityMargin),
      settlement
    };
  }

  const amountToMatch =
    settlement.remainingBaseAmount || Number(occurrence && occurrence.amount) || 0;
  const scoringOccurrence = { ...occurrence, amount: amountToMatch };
  const scoringOptions = {
    ...resolved,
    occurrenceText: getOccurrenceText(workbook, scoringOccurrence, resolved)
  };
  const scored = sourceTransactions.map((transaction) =>
    scoreRecurringCandidateWithCache(
      workbook,
      scoringOccurrence,
      transaction,
      scoringOptions,
      usedIds
    )
  );
  const fields = resultFields(scored, settlement, resolved);
  const confirmed = resolved.confirmedTransactionId
    ? scored.find((candidate) => candidate.transactionId === resolved.confirmedTransactionId) ||
      null
    : null;

  if (settlement.state === 'partial') {
    const candidate = fields.top && fields.top.score >= resolved.reviewScore ? fields.top : null;
    return {
      decision: 'partial',
      reason: candidate ? 'partial_candidate_needs_review' : 'stored_allocations_partial',
      matchType: 'stored',
      transaction: null,
      candidate,
      candidates: fields.candidates,
      rejectedCandidates: fields.rejectedCandidates,
      rejectedTransactionIds: fields.rejectedTransactionIds,
      signals: candidate ? candidate.signals : [],
      ambiguity: fields.ambiguity,
      settlement
    };
  }

  if (resolved.confirmedTransactionId) {
    if (confirmed && confirmed.eligible) {
      return {
        decision: 'matched',
        reason: 'confirmed_transaction',
        matchType: 'manual',
        transaction: confirmed.transaction,
        candidate: confirmed,
        candidates: fields.candidates,
        rejectedCandidates: fields.rejectedCandidates,
        rejectedTransactionIds: fields.rejectedTransactionIds,
        signals: confirmed.signals,
        ambiguity: fields.ambiguity,
        settlement
      };
    }
    return {
      decision: 'unmatched',
      reason: confirmed ? 'confirmed_transaction_ineligible' : 'confirmed_transaction_not_found',
      matchType: '',
      transaction: null,
      candidate: confirmed,
      candidates: fields.candidates,
      rejectedCandidates: fields.rejectedCandidates,
      rejectedTransactionIds: fields.rejectedTransactionIds,
      signals: [],
      ambiguity: fields.ambiguity,
      settlement
    };
  }

  const explicit = fields.candidates.filter((candidate) => candidate.linkKind === 'explicit');
  const legacy = fields.candidates.filter((candidate) => candidate.linkKind === 'legacy');
  const linked = explicit.length ? explicit : legacy;
  const top = linked[0] || fields.top;
  const runnerUp = linked.length ? linked[1] || null : fields.runnerUp;
  const candidateAmbiguity = ambiguity(top, runnerUp, resolved.ambiguityMargin);

  if (linked.length === 1) {
    return {
      decision: 'matched',
      reason: top.linkKind === 'explicit' ? 'explicit_occurrence_link' : 'legacy_tracker_link',
      matchType: top.linkKind,
      transaction: top.transaction,
      candidate: top,
      candidates: fields.candidates,
      rejectedCandidates: fields.rejectedCandidates,
      rejectedTransactionIds: fields.rejectedTransactionIds,
      signals: top.signals,
      ambiguity: candidateAmbiguity,
      settlement
    };
  }
  if (linked.length > 1) {
    return {
      decision: 'review',
      reason: 'ambiguous_linked_transactions',
      matchType: '',
      transaction: null,
      candidate: top,
      candidates: fields.candidates,
      rejectedCandidates: fields.rejectedCandidates,
      rejectedTransactionIds: fields.rejectedTransactionIds,
      signals: top.signals,
      ambiguity: { ...candidateAmbiguity, isAmbiguous: true },
      settlement
    };
  }
  if (top && top.score >= resolved.autoMatchScore && !candidateAmbiguity.isAmbiguous) {
    return {
      decision: 'matched',
      reason: 'unique_high_confidence',
      matchType: 'automatic',
      transaction: top.transaction,
      candidate: top,
      candidates: fields.candidates,
      rejectedCandidates: fields.rejectedCandidates,
      rejectedTransactionIds: fields.rejectedTransactionIds,
      signals: top.signals,
      ambiguity: candidateAmbiguity,
      settlement
    };
  }
  if (top && top.score >= resolved.reviewScore) {
    return {
      decision: 'review',
      reason: candidateAmbiguity.isAmbiguous ? 'ambiguous_candidates' : 'candidate_needs_review',
      matchType: '',
      transaction: null,
      candidate: top,
      candidates: fields.candidates,
      rejectedCandidates: fields.rejectedCandidates,
      rejectedTransactionIds: fields.rejectedTransactionIds,
      signals: top.signals,
      ambiguity: candidateAmbiguity,
      settlement
    };
  }
  return {
    decision: 'unmatched',
    reason: top ? 'insufficient_evidence' : 'no_eligible_candidate',
    matchType: '',
    transaction: null,
    candidate: null,
    candidates: fields.candidates,
    rejectedCandidates: fields.rejectedCandidates,
    rejectedTransactionIds: fields.rejectedTransactionIds,
    signals: [],
    ambiguity: candidateAmbiguity,
    settlement
  };
}

function confirmedIdForOccurrence(options, occurrence) {
  const direct = asString(
    options && (options.confirmedTransactionId || options.forcedTransactionId)
  );
  if (direct) return direct;
  const mapping = options && options.confirmedTransactionIdsByOccurrence;
  const occurrenceId = asString(occurrence && occurrence.id);
  if (mapping && typeof mapping.get === 'function') return asString(mapping.get(occurrenceId));
  return asString(mapping && mapping[occurrenceId]);
}

function batchClaimPriority(result) {
  if (result.reason === 'confirmed_transaction') return 4;
  if (result.matchType === 'explicit') return 3;
  if (result.matchType === 'legacy') return 2;
  if (result.matchType === 'automatic') return 1;
  return 0;
}

export function reconcileRecurringOccurrences(
  workbook,
  occurrences,
  transactions = workbook && workbook.transactions,
  options = {}
) {
  const resolved = resolveOptions(options);
  const rows = asArray(occurrences).map((occurrence, index) => ({
    occurrence,
    index,
    candidateScoreCache: new Map(),
    settlement: storedSettlement(workbook, occurrence, transactions, resolved)
  }));
  const transactionTextCache = new Map();
  const results = new Array(rows.length);
  const used = new Set(
    resolved.usedTransactionIds &&
      typeof resolved.usedTransactionIds[Symbol.iterator] === 'function'
      ? resolved.usedTransactionIds
      : asArray(resolved.usedTransactionIds)
  );
  rows.forEach(({ settlement }) => {
    settlement.allocations.forEach((allocation) => {
      if (allocation.transactionId) used.add(allocation.transactionId);
    });
  });
  let pending = rows.slice();

  while (pending.length) {
    const evaluations = pending.map((row) => {
      const confirmedTransactionId = confirmedIdForOccurrence(options, row.occurrence);
      const selectedTransactions =
        typeof resolved.transactionCandidatesForOccurrence === 'function'
          ? resolved.transactionCandidatesForOccurrence(row.occurrence)
          : null;
      const candidateTransactions = Array.isArray(selectedTransactions)
        ? selectedTransactions.slice()
        : transactions;
      if (
        confirmedTransactionId &&
        Array.isArray(candidateTransactions) &&
        !candidateTransactions.some(
          (transaction) => asString(transaction && transaction.id) === confirmedTransactionId
        )
      ) {
        const confirmedTransaction = findById(transactions, confirmedTransactionId);
        if (confirmedTransaction) candidateTransactions.push(confirmedTransaction);
      }
      return {
        ...row,
        result: reconcileRecurringOccurrence(workbook, row.occurrence, candidateTransactions, {
          ...resolved,
          candidateScoreCache: row.candidateScoreCache,
          confirmedTransactionId,
          precomputedSettlement: row.settlement,
          transactionTextCache,
          usedTransactionIds: used
        })
      };
    });
    const claims = evaluations.filter(
      (entry) => entry.result.decision === 'matched' && entry.result.transaction
    );
    if (!claims.length) {
      evaluations.forEach((entry) => {
        results[entry.index] = entry.result;
      });
      break;
    }

    const byTransaction = new Map();
    claims.forEach((claim) => {
      const id = asString(claim.result.transaction.id);
      byTransaction.set(id, [...(byTransaction.get(id) || []), claim]);
    });
    const safeClaims = [];
    const ambiguousIndexes = new Set();
    byTransaction.forEach((transactionClaims) => {
      transactionClaims.sort((left, right) => {
        return (
          batchClaimPriority(right.result) - batchClaimPriority(left.result) ||
          (right.result.candidate?.score || 0) - (left.result.candidate?.score || 0) ||
          left.index - right.index
        );
      });
      const winner = transactionClaims[0];
      const runnerUp = transactionClaims[1];
      const scoreMargin = runnerUp
        ? (winner.result.candidate?.score || 0) - (runnerUp.result.candidate?.score || 0)
        : null;
      const priorityMargin = runnerUp
        ? batchClaimPriority(winner.result) - batchClaimPriority(runnerUp.result)
        : 1;
      if (runnerUp && priorityMargin === 0 && scoreMargin < resolved.ambiguityMargin) {
        transactionClaims.forEach((claim) => {
          ambiguousIndexes.add(claim.index);
          results[claim.index] = {
            ...claim.result,
            decision: 'review',
            reason: 'transaction_ambiguous_between_occurrences',
            matchType: '',
            transaction: null,
            ambiguity: {
              ...claim.result.ambiguity,
              isAmbiguous: true,
              allocationMargin: scoreMargin,
              competingOccurrenceIds: transactionClaims
                .filter((candidate) => candidate.index !== claim.index)
                .map((candidate) => asString(candidate.occurrence && candidate.occurrence.id))
            }
          };
        });
      } else {
        safeClaims.push(winner);
      }
    });
    safeClaims.forEach((claim) => {
      results[claim.index] = claim.result;
      used.add(asString(claim.result.transaction.id));
    });
    const completed = new Set([...safeClaims.map((claim) => claim.index), ...ambiguousIndexes]);
    pending = pending.filter((row) => !completed.has(row.index));
    if (!completed.size) {
      evaluations.forEach((entry) => {
        results[entry.index] = entry.result;
      });
      break;
    }
  }

  const matchedTransactionIds = results
    .map((result) => asString(result && result.transaction && result.transaction.id))
    .filter(Boolean);
  return {
    results,
    matchedTransactionIds,
    matchedCount: results.filter((result) => result && result.decision === 'matched').length,
    partialCount: results.filter((result) => result && result.decision === 'partial').length,
    reviewCount: results.filter((result) => result && result.decision === 'review').length,
    unmatchedCount: results.filter((result) => result && result.decision === 'unmatched').length
  };
}

function cloneWorkbookWithRecords(workbook) {
  return {
    ...(workbook || {}),
    recurringReconciliations: asArray(workbook && workbook.recurringReconciliations).map(
      (record) => ({
        ...(record || {})
      })
    )
  };
}

function commandFailure(workbook, code, message) {
  return { ok: false, workbook, error: { code, message } };
}

function readTimestamp(services) {
  const value =
    services && typeof services.now === 'function' ? services.now() : services && services.now;
  return asString(value);
}

function reconciliationId(input, services) {
  if (asString(input && input.id)) return asString(input.id);
  if (services && typeof services.createId === 'function') {
    return asString(services.createId('recurring_reconciliation'));
  }
  return `recurring_reconciliation_${[
    input.recurringItemId,
    input.occurrenceDate,
    input.transactionId
  ]
    .map((value) => asString(value).replace(/[^A-Za-z0-9_-]+/g, '_'))
    .join('_')}`;
}

function upsertDecision(workbook, input, decision, services) {
  const recurringItemId = asString(input && input.recurringItemId);
  const occurrenceDate = normalizeDateKey(input && input.occurrenceDate);
  const transactionId = asString(input && input.transactionId);
  if (!(workbook && recurringItemId && occurrenceDate && transactionId)) {
    return commandFailure(
      workbook,
      'recurring_reconciliation.invalid_target',
      'Choose a recurring occurrence and transaction.'
    );
  }
  if (
    !findById(workbook.recurringItems, recurringItemId) ||
    !findById(workbook.transactions, transactionId)
  ) {
    return commandFailure(
      workbook,
      'recurring_reconciliation.target_not_found',
      'The recurring tracker or transaction no longer exists.'
    );
  }
  const next = cloneWorkbookWithRecords(workbook);
  const key = recurringReconciliationKey(recurringItemId, occurrenceDate, transactionId);
  const existing = next.recurringReconciliations.find(
    (record) =>
      recurringReconciliationKey(
        record.recurringItemId,
        record.occurrenceDate,
        record.transactionId
      ) === key
  );
  const timestamp = readTimestamp(services);
  const methodValue = asString(input && input.method).toLowerCase();
  const method = RECURRING_RECONCILIATION_METHODS.includes(methodValue) ? methodValue : 'manual';
  const allocatedBaseAmount =
    decision === 'matched'
      ? roundMoney(
          Math.max(
            0,
            Number(input && input.allocatedBaseAmount) ||
              getLedgerTransactionBaseAmount(findById(workbook.transactions, transactionId))
          )
        )
      : 0;
  const record = {
    ...(existing || {}),
    ...(input && input.matchSignals ? { matchSignals: input.matchSignals } : {}),
    id: (existing && existing.id) || reconciliationId(input, services),
    recurringItemId,
    occurrenceDate,
    transactionId,
    decision,
    method,
    allocatedBaseAmount,
    confidence: clamp(
      Number(input && input.confidence) || (decision === 'matched' ? 100 : 0),
      0,
      100
    ),
    createdAt: asString(existing && existing.createdAt) || timestamp,
    updatedAt: timestamp || asString(existing && existing.updatedAt)
  };
  next.recurringReconciliations = next.recurringReconciliations.filter(
    (candidate) =>
      recurringReconciliationKey(
        candidate.recurringItemId,
        candidate.occurrenceDate,
        candidate.transactionId
      ) !== key
  );
  next.recurringReconciliations.push(record);
  return { ok: true, workbook: next, record };
}

export function confirmRecurringReconciliationCommand(workbook, input, services = {}) {
  const recurringItem = findById(
    workbook && workbook.recurringItems,
    input && input.recurringItemId
  );
  const transaction = findById(workbook && workbook.transactions, input && input.transactionId);
  if (recurringItem && transaction) {
    const method = asString(input && input.method).toLowerCase();
    const occurrenceDate = normalizeDateKey(input && input.occurrenceDate);
    const candidateTransaction =
      method === 'explicit'
        ? {
            ...transaction,
            recurringItemId: asString(recurringItem.id),
            recurringOccurrenceDate: occurrenceDate
          }
        : transaction;
    const eligibility = getRecurringCandidateEligibility(
      workbook,
      {
        id: asString(input && input.occurrenceId),
        recurringItemId: asString(recurringItem.id),
        recurringItem,
        categoryId: asString(recurringItem.categoryId),
        accountId: asString(recurringItem.accountId),
        dueDate: occurrenceDate
      },
      candidateTransaction,
      { confirmedTransactionId: asString(transaction.id) }
    );
    if (!eligibility.eligible) {
      return commandFailure(
        workbook,
        'recurring_reconciliation.ineligible_transaction',
        'This transaction can no longer be matched to that occurrence.'
      );
    }
  }
  return upsertDecision(workbook, input, 'matched', services);
}

export function rejectRecurringReconciliationCommand(workbook, input, services = {}) {
  return upsertDecision(workbook, input, 'rejected', services);
}

export function unlinkRecurringReconciliationCommand(workbook, input) {
  const recurringItemId = asString(input && input.recurringItemId);
  const occurrenceDate = normalizeDateKey(input && input.occurrenceDate);
  const transactionId = asString(input && input.transactionId);
  if (!(workbook && recurringItemId && occurrenceDate && transactionId)) {
    return commandFailure(
      workbook,
      'recurring_reconciliation.invalid_target',
      'Choose a recurring occurrence and transaction.'
    );
  }
  const key = recurringReconciliationKey(recurringItemId, occurrenceDate, transactionId);
  const next = cloneWorkbookWithRecords(workbook);
  const removedRecords = next.recurringReconciliations.filter(
    (record) =>
      recurringReconciliationKey(
        record.recurringItemId,
        record.occurrenceDate,
        record.transactionId
      ) === key
  );
  next.recurringReconciliations = next.recurringReconciliations.filter(
    (record) =>
      recurringReconciliationKey(
        record.recurringItemId,
        record.occurrenceDate,
        record.transactionId
      ) !== key
  );
  return { ok: true, workbook: next, removedRecords };
}
