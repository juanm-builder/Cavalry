import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import {
  getLedgerTransactionBaseAmount,
  getLedgerTransactionFlowKind
} from '../../domain/ledger/transactions.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDate(value) {
  const normalized = normalizeDateKey(value);
  return normalized ? new Date(normalized + 'T00:00:00Z') : null;
}

function formatDate(date) {
  return date ? date.toISOString().slice(0, 10) : '';
}

function monthKeyFromDate(value) {
  const date = normalizeDateKey(value);
  return date ? date.slice(0, 7) : '';
}

function monthKeyFromSheet(workbook, sheet) {
  if (sheet && sheet.monthKey) {
    return asString(sheet.monthKey);
  }
  const year = Number(workbook && workbook.year) || new Date().getFullYear();
  const monthIndex = Number(sheet && sheet.monthIndex) || 0;
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getMonthEndDate(monthKey) {
  const parts = asString(monthKey).split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!(year > 0 && month >= 1 && month <= 12)) {
    return '';
  }
  return formatDate(new Date(Date.UTC(year, month, 0)));
}

function getMonthDiff(startMonthKey, endMonthKey) {
  const start = asString(startMonthKey).split('-');
  const end = asString(endMonthKey).split('-');
  const startYear = Number(start[0]);
  const startMonth = Number(start[1]);
  const endYear = Number(end[0]);
  const endMonth = Number(end[1]);
  if (!(startYear && startMonth && endYear && endMonth)) {
    return 0;
  }
  return (endYear - startYear) * 12 + (endMonth - startMonth);
}

function clampMonthDate(monthKey, day) {
  const parts = asString(monthKey).split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!(year > 0 && month >= 1 && month <= 12)) {
    return '';
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return formatDate(
    new Date(Date.UTC(year, month - 1, Math.min(Math.max(1, Number(day) || 1), lastDay)))
  );
}

function shiftMonthKey(monthKey, monthOffset) {
  const parts = asString(monthKey).split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!(year > 0 && month >= 1 && month <= 12)) {
    return '';
  }
  const shifted = new Date(Date.UTC(year, month - 1 + Number(monthOffset || 0), 1));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(
    shifted.getUTCMonth() + 1
  ).padStart(2, '0')}`;
}

function textKey(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCategoryById(workbook, categoryId) {
  const id = asString(categoryId);
  return (
    asArray(workbook && workbook.categories).find(
      (category) => asString(category && category.id) === id
    ) || null
  );
}

function getAccountById(workbook, accountId) {
  const id = asString(accountId);
  return (
    asArray(workbook && workbook.accounts).find(
      (account) => asString(account && account.id) === id
    ) || null
  );
}

function getTransactionPrimaryAccount(workbook, transaction) {
  const accounts = new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asString(account && account.id),
      account
    ])
  );
  const template = asString(transaction && transaction.template);
  const lines = asArray(transaction && transaction.lines);
  if (template === 'expense_charged') {
    const line = lines.find(
      (item) =>
        item.direction === 'credit' &&
        accounts.get(asString(item.accountId)) &&
        accounts.get(asString(item.accountId)).group === 'liability'
    );
    return line ? accounts.get(asString(line.accountId)) : null;
  }
  const line = lines.find(
    (item) =>
      item.direction === 'credit' &&
      accounts.get(asString(item.accountId)) &&
      accounts.get(asString(item.accountId)).group === 'asset'
  );
  return line ? accounts.get(asString(line.accountId)) : null;
}

export function normalizeRecurringFrequency(value) {
  const source = asString(value).toLowerCase();
  if (source === 'weekly') return 'Weekly';
  if (source === 'every 2 weeks' || source === 'biweekly' || source === 'every two weeks')
    return 'Every 2 Weeks';
  if (source === 'quarterly') return 'Quarterly';
  if (source === 'yearly' || source === 'annual' || source === 'annually') return 'Yearly';
  if (source === 'one-time' || source === 'one time' || source === 'once') return 'One-time';
  return 'Monthly';
}

export function normalizeRecurringKind(value) {
  return asString(value).toLowerCase() === 'subscription' ? 'subscription' : 'bill';
}

export function getRecurringOccurrenceDatesForMonth(item, monthKey) {
  if (!(item && monthKey) || item.isActive === false) {
    return [];
  }
  const monthStart = monthKey + '-01';
  const monthEnd = getMonthEndDate(monthKey);
  const anchorDate =
    normalizeDateKey(item.anchorDate) || normalizeDateKey(item.dueDate) || monthStart;
  const anchor = parseDate(anchorDate);
  if (!(monthEnd && anchor)) {
    return [];
  }
  const frequency = normalizeRecurringFrequency(item.frequency);
  if (frequency === 'One-time') {
    return anchorDate >= monthStart && anchorDate <= monthEnd ? [anchorDate] : [];
  }
  if (frequency === 'Weekly' || frequency === 'Every 2 Weeks') {
    const intervalDays = frequency === 'Weekly' ? 7 : 14;
    const dates = [];
    let cursor = anchor;
    while (formatDate(cursor) < monthStart) {
      cursor = addDays(cursor, intervalDays);
    }
    while (formatDate(cursor) <= monthEnd) {
      dates.push(formatDate(cursor));
      cursor = addDays(cursor, intervalDays);
    }
    return dates;
  }
  const anchorMonthKey = monthKeyFromDate(anchorDate);
  const diff = getMonthDiff(anchorMonthKey, monthKey);
  if (diff < 0) {
    return [];
  }
  if (frequency === 'Quarterly' && diff % 3 !== 0) {
    return [];
  }
  if (frequency === 'Yearly' && diff % 12 !== 0) {
    return [];
  }
  return [clampMonthDate(monthKey, anchor.getUTCDate())];
}

export function getRecurringScheduleSummary(item, asOfDate) {
  const anchorDate =
    normalizeDateKey(item && item.anchorDate) || normalizeDateKey(item && item.dueDate);
  const asOf = normalizeDateKey(asOfDate);
  const summary = {
    anchorDate,
    currentOccurrenceDate: '',
    nextExpectedDate: ''
  };
  const anchor = parseDate(anchorDate);
  const current = parseDate(asOf);
  if (!(anchor && current)) {
    return summary;
  }

  const frequency = normalizeRecurringFrequency(item && item.frequency);
  if (frequency === 'One-time') {
    if (anchorDate <= asOf) summary.currentOccurrenceDate = anchorDate;
    else summary.nextExpectedDate = anchorDate;
    return summary;
  }

  if (frequency === 'Weekly' || frequency === 'Every 2 Weeks') {
    if (anchorDate > asOf) {
      summary.nextExpectedDate = anchorDate;
      return summary;
    }
    const intervalDays = frequency === 'Weekly' ? 7 : 14;
    const elapsedDays = Math.floor((current.getTime() - anchor.getTime()) / 86400000);
    const elapsedIntervals = Math.floor(elapsedDays / intervalDays);
    const occurrence = addDays(anchor, elapsedIntervals * intervalDays);
    summary.currentOccurrenceDate = formatDate(occurrence);
    summary.nextExpectedDate = formatDate(addDays(occurrence, intervalDays));
    return summary;
  }

  const intervalMonths = frequency === 'Quarterly' ? 3 : frequency === 'Yearly' ? 12 : 1;
  const anchorMonthKey = monthKeyFromDate(anchorDate);
  const asOfMonthKey = monthKeyFromDate(asOf);
  const elapsedMonths = getMonthDiff(anchorMonthKey, asOfMonthKey);
  if (elapsedMonths < 0) {
    summary.nextExpectedDate = anchorDate;
    return summary;
  }

  let elapsedIntervals = Math.floor(elapsedMonths / intervalMonths);
  let occurrenceMonthKey = shiftMonthKey(anchorMonthKey, elapsedIntervals * intervalMonths);
  let occurrenceDate = clampMonthDate(occurrenceMonthKey, anchor.getUTCDate());
  if (occurrenceDate > asOf) {
    summary.nextExpectedDate = occurrenceDate;
    elapsedIntervals -= 1;
    if (elapsedIntervals >= 0) {
      occurrenceMonthKey = shiftMonthKey(anchorMonthKey, elapsedIntervals * intervalMonths);
      summary.currentOccurrenceDate = clampMonthDate(occurrenceMonthKey, anchor.getUTCDate());
    }
    return summary;
  }

  summary.currentOccurrenceDate = occurrenceDate;
  summary.nextExpectedDate = clampMonthDate(
    shiftMonthKey(anchorMonthKey, (elapsedIntervals + 1) * intervalMonths),
    anchor.getUTCDate()
  );
  return summary;
}

export function getRecurringAmountConversion(workbook, amount, currency) {
  const base = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const source = asString(currency).toUpperCase() || base;
  const nativeAmount = roundMoney(Number(amount) || 0);
  if (source === base) {
    return {
      resolved: true,
      amount: nativeAmount,
      nativeAmount,
      sourceCurrency: source,
      baseCurrency: base,
      rate: 1,
      status: 'same_currency'
    };
  }

  const rates = asArray(workbook && workbook.fxRates);
  const exact = rates.find(
    (rate) =>
      asString(rate && rate.fromCurrency).toUpperCase() === source &&
      asString(rate && rate.toCurrency).toUpperCase() === base &&
      Number(rate && rate.rate) > 0
  );
  if (exact) {
    const rate = Number(exact.rate);
    return {
      resolved: true,
      amount: roundMoney(nativeAmount * rate),
      nativeAmount,
      sourceCurrency: source,
      baseCurrency: base,
      rate,
      status: 'converted'
    };
  }

  const inverse = rates.find(
    (rate) =>
      asString(rate && rate.fromCurrency).toUpperCase() === base &&
      asString(rate && rate.toCurrency).toUpperCase() === source &&
      Number(rate && rate.rate) > 0
  );
  if (inverse) {
    const rate = 1 / Number(inverse.rate);
    return {
      resolved: true,
      amount: roundMoney(nativeAmount * rate),
      nativeAmount,
      sourceCurrency: source,
      baseCurrency: base,
      rate,
      status: 'converted_inverse'
    };
  }

  const usdToBaseRate =
    Number(workbook && workbook.settings && workbook.settings.usdToBaseRate) || 0;
  if (source === 'USD' && usdToBaseRate > 0) {
    return {
      resolved: true,
      amount: roundMoney(nativeAmount * usdToBaseRate),
      nativeAmount,
      sourceCurrency: source,
      baseCurrency: base,
      rate: usdToBaseRate,
      status: 'converted_settings'
    };
  }

  return {
    resolved: false,
    amount: null,
    nativeAmount,
    sourceCurrency: source,
    baseCurrency: base,
    rate: null,
    status: 'missing_fx_rate',
    warning: `Add a ${source} to ${base} FX rate before this commitment can be included in totals.`
  };
}

function convertRecurringAmountToBase(workbook, amount, currency) {
  const conversion = getRecurringAmountConversion(workbook, amount, currency);
  return conversion.resolved ? conversion.amount : null;
}

function canConvertRecurringAmountToBase(workbook, currency) {
  return getRecurringAmountConversion(workbook, 1, currency).resolved;
}

export function getRecurringOccurrencesForSheet(workbook, sheet) {
  const monthKey = monthKeyFromSheet(workbook, sheet);
  return asArray(workbook && workbook.recurringItems)
    .filter((item) => item && item.isActive !== false)
    .flatMap((item) => {
      const category = getCategoryById(workbook, item.categoryId);
      if (!(category && ['expense', 'debt'].includes(category.type))) {
        return [];
      }
      return getRecurringOccurrenceDatesForMonth(item, monthKey).map((dueDate, index) => {
        const account = item.accountId ? getAccountById(workbook, item.accountId) : null;
        const expectedTransactionKind =
          category.type === 'debt'
            ? 'liability_payment'
            : account && account.group === 'liability'
              ? 'card_charge'
              : 'direct_payment';
        const conversion = getRecurringAmountConversion(
          workbook,
          item.amount,
          item.currency || (workbook && workbook.currency)
        );
        return {
          id: `${asString(item.id)}:${dueDate}:${String(index)}`,
          recurringItemId: asString(item.id),
          recurringItem: item,
          name: asString(item.name),
          kind: normalizeRecurringKind(item.kind),
          categoryId: asString(item.categoryId),
          categoryName: category.name,
          categoryType: category.type,
          dueDate,
          amount: conversion.resolved ? conversion.amount : 0,
          baseAmount: conversion.amount,
          baseCurrency: conversion.baseCurrency,
          baseAmountVerified: conversion.resolved,
          baseConversionStatus: conversion.status,
          fxRateToBase: conversion.rate,
          fxWarning: conversion.warning || '',
          originalAmount: conversion.nativeAmount,
          nativeAmount: conversion.nativeAmount,
          currency: conversion.sourceCurrency,
          nativeCurrency: conversion.sourceCurrency,
          frequency: normalizeRecurringFrequency(item.frequency),
          accountId: asString(item.accountId),
          paymentMethod: account ? account.name : 'Not set',
          expectedTransactionKind,
          note: asString(item.note)
        };
      });
    });
}

export function getRecurringCommitmentSummaryByCategory(workbook, sheet) {
  const rows = getRecurringOccurrencesForSheet(workbook, sheet).filter(
    (row) => row.categoryType === 'expense'
  );
  const totalsByCategory = {};
  const unresolvedByCategory = {};
  rows.forEach((row) => {
    if (!row.baseAmountVerified) {
      if (!unresolvedByCategory[row.categoryId]) unresolvedByCategory[row.categoryId] = [];
      unresolvedByCategory[row.categoryId].push(row);
      return;
    }
    totalsByCategory[row.categoryId] = roundMoney(
      (totalsByCategory[row.categoryId] || 0) + row.amount
    );
  });
  return {
    rows,
    totalsByCategory,
    unresolvedByCategory,
    total: roundMoney(Object.values(totalsByCategory).reduce((sum, amount) => sum + amount, 0)),
    unresolvedCount: Object.values(unresolvedByCategory).reduce(
      (sum, categoryRows) => sum + categoryRows.length,
      0
    )
  };
}

export function getRecurringProjectionTotalsByCategory(workbook, sheet) {
  return getRecurringCommitmentSummaryByCategory(workbook, sheet).totalsByCategory;
}

function getCounterpartyById(workbook, counterpartyId) {
  const id = asString(counterpartyId);
  return (
    asArray(workbook && workbook.counterparties).find(
      (counterparty) => asString(counterparty && counterparty.id) === id
    ) || null
  );
}

function getRecurringMatchText(workbook, value, isTransaction) {
  const category = getCategoryById(workbook, value && value.categoryId);
  const counterparty = getCounterpartyById(workbook, value && value.counterpartyId);
  return textKey(
    [
      isTransaction ? value && value.description : value && value.name,
      value && value.note,
      category && category.name,
      counterparty && counterparty.name,
      isTransaction && value && value.counterpartyName
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function getTextMatchScore(leftValue, rightValue) {
  const left = textKey(leftValue);
  const right = textKey(rightValue);
  if (!(left && right)) {
    return 0;
  }
  if (left === right || left.includes(right) || right.includes(left)) {
    return 25;
  }
  const leftTokens = left.split(/\s+/).filter((token) => token.length > 2);
  const rightTokens = new Set(right.split(/\s+/).filter((token) => token.length > 2));
  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  return overlap >= 2 ? 18 : overlap === 1 ? 10 : 0;
}

function recurringCandidateSlug(value) {
  return (
    asString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 96) || 'candidate'
  );
}

function recurringCandidateSourceRef(transaction) {
  const id =
    asString(transaction && transaction.id)
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'unknown';
  return `transaction:${id}`;
}

function getRecurringCandidateExistingMatch(workbook, candidate, transactions) {
  const linkedId =
    asArray(transactions)
      .map((transaction) => asString(transaction && transaction.recurringItemId))
      .find(Boolean) || '';
  if (linkedId) {
    return { recurringItemId: linkedId, score: 100 };
  }
  return asArray(workbook && workbook.recurringItems).reduce((best, item) => {
    if (!item) {
      return best;
    }
    let score = 0;
    if (asString(item.categoryId) && asString(item.categoryId) === candidate.categoryId) {
      score += 25;
    }
    if (asString(item.accountId) && asString(item.accountId) === candidate.accountId) {
      score += 10;
    }
    score += getTextMatchScore(item.name, candidate.name);
    const recurringAmount = convertRecurringAmountToBase(
      workbook,
      item.amount,
      item.currency || baseCurrency(workbook)
    );
    if (Math.abs(recurringAmount - candidate.amount) <= Math.max(5, candidate.amount * 0.08)) {
      score += 25;
    }
    return !best || score > best.score ? { recurringItemId: asString(item.id), score } : best;
  }, null);
}

export function scoreRecurringOccurrenceMatch(workbook, row, transaction) {
  if (!(workbook && row && transaction)) {
    return 0;
  }
  const category = getCategoryById(workbook, transaction.categoryId);
  if (!(category && category.type === 'expense')) {
    return 0;
  }
  let score = row.categoryId && row.categoryId === transaction.categoryId ? 25 : 0;
  score += getTextMatchScore(
    getRecurringMatchText(workbook, row.recurringItem || row, false),
    getRecurringMatchText(workbook, transaction, true)
  );
  const rowAmount = Number(row.amount) || 0;
  const amountDiff = Math.abs(rowAmount - getLedgerTransactionBaseAmount(transaction));
  if (amountDiff <= Math.max(5, Math.abs(rowAmount) * 0.05)) {
    score += 25;
  } else if (amountDiff <= Math.max(10, Math.abs(rowAmount) * 0.15)) {
    score += 10;
  }
  const account = getTransactionPrimaryAccount(workbook, transaction);
  if (row.accountId && account && row.accountId === account.id) {
    score += 10;
  }
  const dueDate = parseDate(row.dueDate);
  const transactionDate = parseDate(transaction.date);
  const dateDistance =
    dueDate && transactionDate
      ? Math.abs(Math.round((dueDate.getTime() - transactionDate.getTime()) / 86400000))
      : 9999;
  if (dateDistance <= 7) {
    score += 15;
  } else if (dateDistance <= 14) {
    score += 8;
  }
  return score;
}

function amountSpreadPercent(amounts) {
  const numeric = asArray(amounts)
    .map(Number)
    .filter((value) => value > 0);
  if (!numeric.length) {
    return 0;
  }
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  return average > 0 ? Math.round(((max - min) / average) * 1000) / 10 : 0;
}

function median(values) {
  const sorted = asArray(values)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function recurringStaleAfterDays(frequency) {
  const normalized = normalizeRecurringFrequency(frequency);
  if (normalized === 'Weekly') return 18;
  if (normalized === 'Every 2 Weeks') return 35;
  if (normalized === 'Quarterly') return 155;
  if (normalized === 'Yearly') return 455;
  if (normalized === 'One-time') return 45;
  return 62;
}

function recurringActivitySummary(lastSeenDate, asOfDate, frequency) {
  const lastSeen = parseDate(lastSeenDate);
  const asOf = parseDate(asOfDate);
  const staleAfterDays = recurringStaleAfterDays(frequency);
  if (!lastSeen) {
    return {
      activityStatus: 'no_charge_evidence',
      daysSinceLastSeen: null,
      staleAfterDays,
      isStale: false
    };
  }
  if (!asOf) {
    return {
      activityStatus: 'recency_unknown',
      daysSinceLastSeen: null,
      staleAfterDays,
      isStale: false
    };
  }
  const daysSinceLastSeen = Math.floor((asOf.getTime() - lastSeen.getTime()) / 86400000);
  if (daysSinceLastSeen < 0) {
    return {
      activityStatus: 'future_dated_evidence',
      daysSinceLastSeen,
      staleAfterDays,
      isStale: false
    };
  }
  const isStale = daysSinceLastSeen > staleAfterDays;
  return {
    activityStatus: isStale ? 'stale_charge_evidence' : 'recent_charge_evidence',
    daysSinceLastSeen,
    staleAfterDays,
    isStale
  };
}

export function inferRecurringCadence(dates) {
  const sorted = asArray(dates).map(normalizeDateKey).filter(Boolean).sort();
  if (sorted.length < 2) {
    return { frequency: 'Monthly', rhythm: 'single', confidence: 0.25 };
  }
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = parseDate(sorted[index - 1]);
    const current = parseDate(sorted[index]);
    if (previous && current) {
      gaps.push(Math.round((current.getTime() - previous.getTime()) / 86400000));
    }
  }
  const gap = median(gaps);
  if (gap >= 6 && gap <= 8) return { frequency: 'Weekly', rhythm: 'weekly', confidence: 0.82 };
  if (gap >= 12 && gap <= 16)
    return { frequency: 'Every 2 Weeks', rhythm: 'biweekly', confidence: 0.82 };
  if (gap >= 25 && gap <= 35) return { frequency: 'Monthly', rhythm: 'monthly', confidence: 0.9 };
  if (gap >= 80 && gap <= 105)
    return { frequency: 'Quarterly', rhythm: 'quarterly', confidence: 0.84 };
  if (gap >= 330 && gap <= 400) return { frequency: 'Yearly', rhythm: 'yearly', confidence: 0.8 };
  return {
    frequency: 'Monthly',
    rhythm: 'irregular',
    confidence: Math.min(0.55, Math.max(0.2, sorted.length / 10))
  };
}

function isBillLikeText(value) {
  return /\b(subscription|subscript|netflix|spotify|prime|icloud|membership|dues|rent|utility|utilities|insurance|internet|phone|bill|gym|software|cloud)\b/i.test(
    asString(value)
  );
}

function isKnownVariableExpense(value) {
  return /\b(load|top[ -]?up|rfid|toll|parking|gas|fuel)\b/i.test(asString(value));
}

function merchantLabel(workbook, transaction) {
  const category = getCategoryById(workbook, transaction && transaction.categoryId);
  return (
    asString(transaction && transaction.description) || (category && category.name) || 'Transaction'
  );
}

function merchantKey(workbook, transaction) {
  return textKey(
    merchantLabel(workbook, transaction)
      .replace(
        /(?:paid|payment|charged|charge|subscription|bill|monthly|annual|yearly|auto|renewal|renewed)\b/gi,
        ' '
      )
      .replace(/\b\d{1,4}\b/g, ' ')
  );
}

function classifyCandidate(candidate) {
  const stableAmount = candidate.amountSpreadPercent <= 15;
  const repeated = candidate.transactionCount >= 2;
  const strongRhythm = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].includes(
    candidate.rhythm
  );
  if (candidate.alreadyTracked) {
    return {
      classification: 'likely_subscription',
      confidence: 0.98,
      reason: 'Already linked to a recurring tracker.'
    };
  }
  if (isKnownVariableExpense(candidate.name)) {
    return {
      classification: 'variable_expense',
      confidence: 0.86,
      reason: 'This is a known variable expense such as load, top-up, RFID, toll, or fuel.'
    };
  }
  if (isBillLikeText(`${candidate.name} ${candidate.categoryName}`) && (repeated || stableAmount)) {
    const hasStrongStablePattern = repeated && stableAmount && strongRhythm;
    return {
      classification: hasStrongStablePattern ? 'likely_subscription' : 'maybe_subscription',
      confidence: hasStrongStablePattern ? 0.82 : repeated ? 0.58 : 0.62,
      reason: hasStrongStablePattern
        ? 'Bill-like name/category with repeated stable charges.'
        : repeated
          ? 'Bill-like repeated charges without a reliable cadence.'
          : 'Bill-like name/category with limited history.'
    };
  }
  if (repeated && stableAmount && strongRhythm) {
    return {
      classification: 'likely_subscription',
      confidence: 0.72,
      reason:
        'Repeated stable charges follow a strong cadence, though the merchant name is generic.'
    };
  }
  return repeated && !stableAmount
    ? {
        classification: 'variable_expense',
        confidence: 0.76,
        reason: 'Repeated merchant with variable amounts.'
      }
    : {
        classification: 'maybe_subscription',
        confidence: 0.38,
        reason: 'Not enough recurring evidence yet.'
      };
}

function buildCandidate(workbook, group, index, options = {}) {
  const transactions = group.transactions
    .slice()
    .sort((a, b) => asString(a.date).localeCompare(asString(b.date)));
  const first = transactions[0] || {};
  const category = getCategoryById(workbook, first.categoryId);
  const account = getTransactionPrimaryAccount(workbook, first);
  const amounts = transactions.map(getLedgerTransactionBaseAmount);
  const cadence = inferRecurringCadence(transactions.map((transaction) => transaction.date));
  const asOfDate = normalizeDateKey(options.asOfDate || options.currentDate);
  const amount = roundMoney(
    amounts.reduce((sum, value) => sum + value, 0) / Math.max(1, amounts.length)
  );
  const decisionKey = recurringCandidateSlug(
    [group.merchantKey, asString(first.categoryId), account ? account.id : '', Math.round(amount)]
      .filter(Boolean)
      .join('|')
  );
  const activity = recurringActivitySummary(getLastDate(transactions), asOfDate, cadence.frequency);
  const candidate = {
    id: `subscription_review_${decisionKey}`,
    decisionKey,
    name: merchantLabel(workbook, first),
    suggestedName: merchantLabel(workbook, first),
    merchantKey: group.merchantKey,
    categoryId: asString(first.categoryId),
    categoryName: category ? category.name : 'Uncategorized',
    accountId: account ? account.id : '',
    accountName: account ? account.name : 'Not set',
    amount,
    currency: baseCurrency(workbook),
    amountSpreadPercent: amountSpreadPercent(amounts),
    transactionCount: transactions.length,
    firstSeenDate: getFirstDate(transactions),
    lastSeenDate: getLastDate(transactions),
    firstDate: getFirstDate(transactions),
    lastDate: getLastDate(transactions),
    asOfDate,
    ...activity,
    suggestedFrequency: cadence.frequency,
    rhythm: cadence.rhythm,
    rhythmConfidence: cadence.confidence,
    transactionIds: transactions.map((transaction) => transaction.id).filter(Boolean),
    source_refs: transactions.map(recurringCandidateSourceRef),
    transactions,
    index,
    alreadyTracked: transactions.some((transaction) => !!transaction.recurringItemId)
  };
  const existingMatch = getRecurringCandidateExistingMatch(workbook, candidate, transactions);
  candidate.existingRecurringItemId =
    existingMatch && existingMatch.score >= 55 ? existingMatch.recurringItemId : '';
  candidate.existingRecurringScore = existingMatch ? existingMatch.score : 0;
  const linkedTracker = asArray(workbook && workbook.recurringItems).find(
    (item) => asString(item && item.id) === candidate.existingRecurringItemId
  );
  candidate.linkedTrackerStatus = linkedTracker
    ? linkedTracker.isActive === false
      ? 'inactive'
      : 'active'
    : 'unknown';
  const decision =
    workbook && workbook.settings && workbook.settings.subscriptionReviewDecisions
      ? workbook.settings.subscriptionReviewDecisions[decisionKey]
      : null;
  candidate.decision = asString(
    typeof decision === 'string' ? decision : decision && decision.decision
  );
  return Object.assign(candidate, classifyCandidate(candidate));
}

function baseCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

function getFirstDate(transactions) {
  return (
    asArray(transactions)
      .map((transaction) => normalizeDateKey(transaction && transaction.date))
      .filter(Boolean)
      .sort()[0] || ''
  );
}

function getLastDate(transactions) {
  return (
    asArray(transactions)
      .map((transaction) => normalizeDateKey(transaction && transaction.date))
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || ''
  );
}

export function buildRecurringCandidates(workbook, options = {}) {
  const groups = {};
  const asOfDate = normalizeDateKey(options.asOfDate || options.currentDate);
  asArray(workbook && workbook.transactions).forEach((transaction) => {
    const transactionDate = normalizeDateKey(transaction && transaction.date);
    if (asOfDate && transactionDate && transactionDate > asOfDate) {
      return;
    }
    if (getLedgerTransactionFlowKind(workbook, transaction) !== 'expense') {
      return;
    }
    const category = getCategoryById(workbook, transaction.categoryId);
    if (!(category && category.type === 'expense')) {
      return;
    }
    const account = getTransactionPrimaryAccount(workbook, transaction);
    const key = [
      merchantKey(workbook, transaction),
      transaction.categoryId || '',
      account ? account.id : ''
    ].join('|');
    groups[key] = groups[key] || [];
    const amount = getLedgerTransactionBaseAmount(transaction);
    let cluster = isKnownVariableExpense(merchantLabel(workbook, transaction))
      ? groups[key][0]
      : groups[key].find(
          (item) =>
            Math.abs((Number(item.averageAmount) || 0) - amount) <=
            Math.max(10, (Number(item.averageAmount) || amount) * 0.18)
        );
    if (!cluster) {
      cluster = { averageAmount: amount, transactions: [] };
      groups[key].push(cluster);
    }
    cluster.transactions.push(transaction);
    cluster.averageAmount = roundMoney(
      cluster.transactions.reduce((sum, item) => sum + getLedgerTransactionBaseAmount(item), 0) /
        cluster.transactions.length
    );
  });
  const candidates = [];
  Object.values(groups).forEach((clusters) => {
    clusters.forEach((cluster) => {
      const candidate = buildCandidate(workbook, cluster, candidates.length, options);
      const hasEvidence =
        candidate.alreadyTracked ||
        candidate.transactionCount >= 2 ||
        isBillLikeText(`${candidate.name} ${candidate.categoryName}`) ||
        isKnownVariableExpense(candidate.name);
      if (!hasEvidence) {
        return;
      }
      if (
        options.includeIgnored !== true &&
        (candidate.decision === 'ignored' || candidate.decision === 'not_subscription')
      ) {
        return;
      }
      if (
        options.includeFalsePositives !== true &&
        ['not_subscription', 'variable_expense'].includes(candidate.classification)
      ) {
        return;
      }
      candidates.push(candidate);
    });
  });
  const rank = {
    likely_subscription: 0,
    maybe_subscription: 1,
    variable_expense: 2,
    not_subscription: 3
  };
  return candidates.sort(
    (a, b) =>
      rank[a.classification] - rank[b.classification] ||
      b.confidence - a.confidence ||
      b.transactionCount - a.transactionCount
  );
}

export function buildRecurringItemRows(workbook, options = {}) {
  const asOfDate = normalizeDateKey(options.asOfDate || options.currentDate);
  return asArray(workbook && workbook.recurringItems).map((item) => {
    const allLinkedTransactions = asArray(workbook && workbook.transactions).filter(
      (transaction) =>
        asString(transaction && transaction.recurringItemId) === asString(item && item.id)
    );
    const linkedTransactions = asOfDate
      ? allLinkedTransactions.filter((transaction) => {
          const transactionDate = normalizeDateKey(transaction && transaction.date);
          return !transactionDate || transactionDate <= asOfDate;
        })
      : allLinkedTransactions;
    const category = getCategoryById(workbook, item.categoryId);
    const account = item.accountId ? getAccountById(workbook, item.accountId) : null;
    const schedule = getRecurringScheduleSummary(item, asOfDate);
    const nativeCurrency = asString(item && item.currency).toUpperCase() || baseCurrency(workbook);
    const nativeAmount = roundMoney(Number(item && item.amount) || 0);
    const baseAmountVerified = canConvertRecurringAmountToBase(workbook, nativeCurrency);
    const baseAmount = baseAmountVerified
      ? convertRecurringAmountToBase(workbook, nativeAmount, nativeCurrency)
      : null;
    const lastSeenDate = getLastDate(linkedTransactions);
    const activity = recurringActivitySummary(lastSeenDate, asOfDate, item && item.frequency);
    return {
      id: asString(item && item.id),
      name: asString(item && item.name),
      kind: normalizeRecurringKind(item && item.kind),
      categoryId: asString(item && item.categoryId),
      categoryName: category ? category.name : 'Missing category',
      accountId: asString(item && item.accountId),
      accountName: account ? account.name : 'Not set',
      amount: nativeAmount,
      currency: nativeCurrency,
      nativeAmount,
      nativeCurrency,
      baseAmount,
      baseCurrency: baseCurrency(workbook),
      baseAmountVerified,
      baseConversionStatus:
        nativeCurrency === baseCurrency(workbook)
          ? 'same_currency'
          : baseAmountVerified
            ? 'converted'
            : 'missing_fx_rate',
      frequency: normalizeRecurringFrequency(item && item.frequency),
      anchorDate: schedule.anchorDate,
      currentOccurrenceDate: schedule.currentOccurrenceDate,
      nextExpectedDate: schedule.nextExpectedDate,
      isActive: item && item.isActive !== false,
      trackerStatus: item && item.isActive !== false ? 'active' : 'inactive',
      asOfDate,
      lastSeenDate,
      linkedTransactionCount: linkedTransactions.length,
      futureLinkedTransactionCount: Math.max(
        0,
        allLinkedTransactions.length - linkedTransactions.length
      ),
      ...activity
    };
  });
}

export function buildRecurringAnalysis(workbook, options = {}) {
  return {
    currency: baseCurrency(workbook),
    recurringItems: buildRecurringItemRows(workbook, options),
    candidates: buildRecurringCandidates(workbook, options)
  };
}
