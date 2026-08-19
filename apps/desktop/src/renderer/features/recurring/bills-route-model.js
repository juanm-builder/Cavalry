import {
  buildBillsRouteViewModel,
  buildRecurringCandidates,
  getRecurringAmountConversion,
  getRecurringOccurrencesForSheet,
  RECURRING_RECONCILIATION_DEFAULTS,
  reconcileRecurringOccurrences
} from '@cavalry/finance-core';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

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

function inferReviewCandidateKind(candidate) {
  const text = `${asString(candidate && (candidate.suggestedName || candidate.name))} ${asString(
    candidate && candidate.categoryName
  )}`.toLowerCase();
  if (
    /(rent|mortgage|loan|insurance|electric|water|internet|phone|mobile|utility|tuition)/.test(text)
  ) {
    return 'bill';
  }
  if (
    asString(candidate && candidate.classification) === 'likely_subscription' ||
    /(subscription|membership|netflix|spotify|chatgpt|openai|apple|icloud|google|youtube|adobe|canva|notion|dropbox|figma|zoom|prime|gym)/.test(
      text
    )
  ) {
    return 'subscription';
  }
  return 'bill';
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function normalizeDateKey(value) {
  let source = value;
  if (source && typeof source.toISOString === 'function') {
    try {
      source = source.toISOString();
    } catch (_error) {
      return '';
    }
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(asString(source));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function readToday(dependencies) {
  const source = asObject(dependencies);
  let value = source.currentDate;
  if (!value && typeof source.clock === 'function') value = source.clock();
  else if (!value && source.clock && typeof source.clock.today === 'function')
    value = source.clock.today();
  else if (!value && source.clock && typeof source.clock.now === 'function')
    value = source.clock.now();
  const today = normalizeDateKey(value);
  if (!today)
    throw new TypeError('Bills route models require an injected ISO currentDate or clock.');
  return today;
}

function dateOrdinal(value) {
  const date = normalizeDateKey(value);
  if (!date) return 0;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  let total =
    365 * (year - 1) +
    Math.floor((year - 1) / 4) -
    Math.floor((year - 1) / 100) +
    Math.floor((year - 1) / 400);
  for (let currentMonth = 1; currentMonth < month; currentMonth += 1) {
    total += daysInMonth(year, currentMonth);
  }
  return total + day;
}

function addDaysToDate(value, amount) {
  const date = normalizeDateKey(value);
  if (!date) return '';
  const next = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  );
  next.setUTCDate(next.getUTCDate() + Number(amount || 0));
  return next.toISOString().slice(0, 10);
}

function addMonthsToDate(value, amount) {
  const date = normalizeDateKey(value);
  if (!date) return '';
  const sourceYear = Number(date.slice(0, 4));
  const sourceMonth = Number(date.slice(5, 7));
  const sourceDay = Number(date.slice(8, 10));
  const target = new Date(Date.UTC(sourceYear, sourceMonth - 1 + Number(amount || 0), 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const targetDay = Math.min(sourceDay, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(
    targetDay
  ).padStart(2, '0')}`;
}

function getNextCandidateDueDate(lastSeenDate, frequency, today) {
  const anchorDate = normalizeDateKey(lastSeenDate);
  const currentDate = normalizeDateKey(today);
  if (!anchorDate) return currentDate;
  if (!currentDate || anchorDate >= currentDate) return anchorDate;

  const normalizedFrequency = asString(frequency).toLowerCase();
  const dayInterval =
    normalizedFrequency === 'weekly'
      ? 7
      : ['every 2 weeks', 'biweekly', 'every two weeks'].includes(normalizedFrequency)
        ? 14
        : 0;
  if (dayInterval) {
    const elapsedDays = Math.max(0, dateOrdinal(currentDate) - dateOrdinal(anchorDate));
    const intervals = Math.max(1, Math.ceil(elapsedDays / dayInterval));
    return addDaysToDate(anchorDate, intervals * dayInterval);
  }

  const monthInterval =
    normalizedFrequency === 'quarterly'
      ? 3
      : ['yearly', 'annual', 'annually'].includes(normalizedFrequency)
        ? 12
        : normalizedFrequency === 'one-time' || normalizedFrequency === 'one time'
          ? 0
          : 1;
  if (!monthInterval) return currentDate;

  const monthDifference =
    (Number(currentDate.slice(0, 4)) - Number(anchorDate.slice(0, 4))) * 12 +
    (Number(currentDate.slice(5, 7)) - Number(anchorDate.slice(5, 7)));
  let intervals = Math.max(1, Math.floor(monthDifference / monthInterval));
  let candidate = addMonthsToDate(anchorDate, intervals * monthInterval);
  if (candidate < currentDate) {
    intervals += 1;
    candidate = addMonthsToDate(anchorDate, intervals * monthInterval);
  }
  return candidate || currentDate;
}

function formatMoney(value, currency) {
  const code = asString(currency).toUpperCase() || 'PHP';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${code} ${(Number(value) || 0).toFixed(2)}`;
  }
}

function formatDate(value) {
  const date = normalizeDateKey(value);
  if (!date) return 'No date';
  return `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

function getRelativeDateLabel(row, today) {
  if (row.status === 'Paid') return 'Paid';
  if (row.status === 'Expected charge not recorded') return 'Expected charge not recorded';
  const difference = dateOrdinal(row.dueDate) - dateOrdinal(today);
  if (difference < 0) return `${Math.abs(difference)} day${difference === -1 ? '' : 's'} overdue`;
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Tomorrow';
  return `In ${difference} days`;
}

function getStatusTone(status) {
  if (status === 'Paid') return 'good';
  if (status === 'Overdue') return 'bad';
  if (status === 'Review match') return 'info';
  return 'warn';
}

function getBillIcon(row) {
  const source = `${asString(row.name)} ${asString(row.categoryName)}`.toLowerCase();
  if (/netflix|movie|entertain/.test(source)) return 'movie';
  if (/spotify|music/.test(source)) return 'graphic_eq';
  if (/rent|home|housing/.test(source)) return 'home';
  if (/electric|utility|power/.test(source)) return 'bolt';
  if (/insurance|health|medical/.test(source)) return 'health_and_safety';
  if (/internet|wifi|phone/.test(source)) return 'wifi';
  if (/gym|fitness/.test(source)) return 'fitness_center';
  return row.kind === 'subscription' ? 'sync' : 'receipt_long';
}

function getWorkbookYear(workbook, today) {
  const candidate = Math.trunc(Number(workbook && workbook.year));
  return candidate >= 1000 && candidate <= 9999 ? candidate : Number(today.slice(0, 4));
}

function getSheetMonthKey(workbook, sheet, today = '') {
  const direct = asString(sheet && sheet.monthKey);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(direct)) return direct;
  const year = getWorkbookYear(workbook, today || `${new Date().getFullYear()}-01-01`);
  const monthIndex = Math.max(0, Math.min(11, Number(sheet && sheet.monthIndex) || 0));
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function selectSheet(workbook, viewState, today) {
  const sheets = asArray(workbook && workbook.sheets)
    .slice()
    .sort((left, right) =>
      getSheetMonthKey(workbook, left, today).localeCompare(
        getSheetMonthKey(workbook, right, today)
      )
    );
  const requestedId = asString(viewState.sheetId);
  const requested = requestedId
    ? sheets.find((sheet) => asString(sheet && sheet.id) === requestedId)
    : null;
  if (requested) return requested;
  const currentMonthKey = today.slice(0, 7);
  const current = sheets.find(
    (sheet) => getSheetMonthKey(workbook, sheet, today) === currentMonthKey
  );
  if (current) return current;
  return sheets[sheets.length - 1] || null;
}

function getSheetLabel(workbook, sheet, today = '') {
  if (!sheet) return 'No billing month';
  const monthKey = getSheetMonthKey(workbook, sheet, today);
  const monthIndex = Number(monthKey.slice(5, 7)) - 1;
  return `${MONTH_NAMES[monthIndex]} ${monthKey.slice(0, 4)}`;
}

function getRecurringItemPresentation(workbook, item) {
  const category = asArray(workbook && workbook.categories).find(
    (candidate) => candidate && candidate.id === item.categoryId
  );
  const account = asArray(workbook && workbook.accounts).find(
    (candidate) => candidate && candidate.id === item.accountId
  );
  const conversion = getRecurringAmountConversion(
    workbook,
    item.amount,
    item.currency || workbook.currency
  );
  const currency = conversion.sourceCurrency;
  const kind = asString(item.kind) === 'subscription' ? 'subscription' : 'bill';
  const categoryName = category ? asString(category.name) : 'Missing category';
  const categoryIsUsable = !!category && category.isActive !== false;
  const categoryWarning = !category
    ? 'This recurring item has no matching category and is excluded from trusted totals.'
    : category.isActive === false
      ? 'This recurring item uses an archived category and is excluded from trusted totals.'
      : '';
  const baseAmountVerified = conversion.resolved && categoryIsUsable;
  return {
    id: asString(item.id),
    recurringItemId: asString(item.id),
    kind,
    name: asString(item.name) || 'Untitled recurring item',
    categoryId: asString(item.categoryId),
    category: category
      ? { id: asString(category.id), name: categoryName, type: asString(category.type) }
      : null,
    categoryName,
    categoryType: asString(category && category.type),
    categoryIsActive: category ? category.isActive !== false : false,
    accountId: asString(item.accountId),
    paymentMethod: account ? asString(account.name) : 'Not set',
    amount: baseAmountVerified ? conversion.amount : 0,
    baseAmountVerified,
    baseConversionStatus: !categoryIsUsable ? 'category-unresolved' : conversion.status,
    fxWarning: categoryWarning || conversion.warning || '',
    originalAmount: conversion.nativeAmount,
    nativeAmount: conversion.nativeAmount,
    currency,
    nativeCurrency: currency,
    amountCopy: formatMoney(conversion.nativeAmount, currency),
    baseAmountCopy: baseAmountVerified
      ? formatMoney(conversion.amount, conversion.baseCurrency)
      : 'Not included in totals',
    frequency: asString(item.frequency) || 'Monthly',
    dueDate: asString(item.anchorDate || item.dueDate),
    dueDateCopy: formatDate(item.anchorDate || item.dueDate),
    note: asString(item.note),
    autoRenew: item.autoRenew === true,
    isActive: item.isActive !== false,
    icon: getBillIcon({ ...item, kind, categoryName }),
    editorValues: {
      recurringItemId: asString(item.id),
      kind,
      name: asString(item.name),
      categoryId: asString(item.categoryId),
      accountId: asString(item.accountId),
      amount: String(Number(item.amount) || 0),
      currency,
      frequency: asString(item.frequency) || 'Monthly',
      dueDate: asString(item.anchorDate || item.dueDate),
      autoRenew: item.autoRenew === true,
      isActive: item.isActive !== false,
      note: asString(item.note)
    }
  };
}

function buildRecurringTemplateRows(workbook, { active } = {}) {
  return asArray(workbook && workbook.recurringItems)
    .filter((item) => item && (active === undefined || (item.isActive !== false) === active))
    .map((item) => getRecurringItemPresentation(workbook, item))
    .sort(
      (left, right) =>
        asString(left.name).localeCompare(asString(right.name)) ||
        asString(left.recurringItemId).localeCompare(asString(right.recurringItemId))
    );
}

function getTransactionAccountName(workbook, occurrence, transaction) {
  const accounts = new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asString(account && account.id),
      account
    ])
  );
  const template = asString(transaction && transaction.template);
  const expectedDirection =
    occurrence.expectedTransactionKind === 'liability_payment' ? 'debit' : 'credit';
  const expectedGroup =
    occurrence.expectedTransactionKind === 'liability_payment' || template === 'expense_charged'
      ? 'liability'
      : 'asset';
  const line = asArray(transaction && transaction.lines).find((entry) => {
    const account = accounts.get(asString(entry && entry.accountId));
    return account && account.group === expectedGroup && entry.direction === expectedDirection;
  });
  return asString(accounts.get(asString(line && line.accountId))?.name);
}

function getReconciliationStatusLabel(occurrence, transaction, state) {
  const template = asString(transaction && transaction.template);
  const isCardCharge = template === 'expense_charged';
  const isLiabilityPayment =
    occurrence.expectedTransactionKind === 'liability_payment' ||
    ['debt_payment', 'liability_payment', 'transfer'].includes(template);
  if (state === 'partial') {
    if (isCardCharge) return 'Partially charged';
    if (isLiabilityPayment) return 'Partially settled';
    return 'Partially paid';
  }
  if (isCardCharge) return 'Charged';
  if (isLiabilityPayment) return 'Settled';
  return 'Paid';
}

function getMatchExplanation(result) {
  if (!result) return '';
  if (result.reason === 'ambiguous_candidates') {
    return 'More than one transaction is similarly likely. Confirm the correct one.';
  }
  if (result.reason === 'transaction_ambiguous_between_occurrences') {
    return 'This transaction could belong to more than one occurrence.';
  }
  const labels = [];
  asArray(result.signals).forEach((entry) => {
    const code = asString(entry && entry.code);
    if (!(entry && entry.matched)) return;
    if (code.startsWith('merchant_')) labels.push('merchant');
    else if (code.startsWith('amount_')) labels.push('amount');
    else if (code === 'account_match') labels.push('account');
    else if (code.startsWith('date_')) labels.push('date');
    else if (code === 'category_match') labels.push('category');
  });
  const unique = Array.from(new Set(labels)).slice(0, 4);
  return unique.length ? `Matched using ${unique.join(', ')}.` : '';
}

function transactionSummary(workbook, occurrence, value) {
  if (!value) return null;
  return {
    id: asString(value.id),
    date: asString(value.date),
    description: asString(value.description),
    amount: Number(value.amount) || Number(value.baseAmount) || 0,
    amountCopy: formatMoney(
      Number(value.baseAmount) || Number(value.amount) || 0,
      workbook.currency
    ),
    accountName: getTransactionAccountName(workbook, occurrence, value)
  };
}

function buildReconciliationModel(workbook, occurrence, result) {
  const matchedTransaction = result && result.transaction;
  const candidateTransaction = result && result.candidate && result.candidate.transaction;
  const firstAllocation = asArray(result && result.settlement && result.settlement.allocations)[0];
  const proofTransaction =
    matchedTransaction || (firstAllocation && firstAllocation.transaction) || null;
  if (result && result.decision === 'matched') {
    const source =
      result.matchType === 'stored'
        ? asString(firstAllocation && firstAllocation.method) || 'manual'
        : asString(result.matchType) || 'automatic';
    return {
      state: 'matched',
      source,
      statusLabel: getReconciliationStatusLabel(occurrence, proofTransaction, 'matched'),
      title:
        source === 'automatic'
          ? 'Matched automatically'
          : source === 'manual'
            ? 'Confirmed match'
            : 'Linked transaction',
      detail: '',
      explanation: getMatchExplanation(result),
      transaction: transactionSummary(workbook, occurrence, proofTransaction),
      canConfirm: false,
      canReject: false,
      canUndo: !!proofTransaction
    };
  }
  if (result && result.decision === 'partial') {
    const allocated = Number(result.settlement && result.settlement.allocatedBaseAmount) || 0;
    const expected =
      Number(result.settlement && result.settlement.expectedBaseAmount) || occurrence.amount;
    const remaining = Number(result.settlement && result.settlement.remainingBaseAmount) || 0;
    const pendingCandidate =
      result.candidate && result.candidate.transaction
        ? {
            state: 'candidate',
            source: 'scored',
            statusLabel: 'Review match',
            title:
              result.ambiguity && result.ambiguity.isAmbiguous
                ? 'Possible remaining payments found'
                : 'Likely remaining payment found',
            detail: '',
            explanation: getMatchExplanation(result),
            transaction: transactionSummary(workbook, occurrence, result.candidate.transaction),
            canConfirm: true,
            canReject: true,
            canUndo: false
          }
        : null;
    return {
      state: 'partial',
      source: asString(firstAllocation && firstAllocation.method) || 'manual',
      statusLabel: getReconciliationStatusLabel(occurrence, proofTransaction, 'partial'),
      title: 'Partial payment recorded',
      detail: `${formatMoney(allocated, workbook.currency)} of ${formatMoney(expected, workbook.currency)}`,
      explanation: `${formatMoney(remaining, workbook.currency)} remains.`,
      transaction: transactionSummary(workbook, occurrence, proofTransaction),
      pendingCandidate,
      canConfirm: false,
      canReject: false,
      canUndo: !!proofTransaction
    };
  }
  if (result && result.decision === 'review' && candidateTransaction) {
    return {
      state: 'candidate',
      source: 'scored',
      statusLabel: 'Review match',
      title:
        result.ambiguity && result.ambiguity.isAmbiguous
          ? 'Possible matches found'
          : 'Likely transaction found',
      detail: '',
      explanation: getMatchExplanation(result),
      transaction: transactionSummary(workbook, occurrence, candidateTransaction),
      canConfirm: true,
      canReject: true,
      canUndo: false
    };
  }
  return {
    state: 'unmatched',
    source: '',
    statusLabel: '',
    title: '',
    detail: '',
    explanation: '',
    transaction: null,
    canConfirm: false,
    canReject: false,
    canUndo: false
  };
}

function buildOccurrenceRows(workbook, sheet, today) {
  if (!sheet) return [];
  const occurrences = getRecurringOccurrencesForSheet(workbook, sheet);
  const allOccurrences = asArray(workbook && workbook.sheets).flatMap((candidateSheet) =>
    getRecurringOccurrencesForSheet(workbook, candidateSheet)
  );
  const transactions = asArray(workbook.transactions);
  const transactionCandidatesForOccurrence = createTransactionCandidateSelector(transactions);
  const reconciliationOccurrences = selectCompetingOccurrences(
    allOccurrences.length ? allOccurrences : occurrences,
    occurrences,
    transactionCandidatesForOccurrence
  );
  const reconciliation = reconcileRecurringOccurrences(
    workbook,
    reconciliationOccurrences,
    transactions,
    { transactionCandidatesForOccurrence }
  );
  const reconciliationByOccurrenceId = new Map(
    reconciliationOccurrences.map((occurrence, index) => [
      occurrence.id,
      reconciliation.results[index] || null
    ])
  );
  return occurrences.map((occurrence, occurrenceIndex) => {
    const result =
      reconciliationByOccurrenceId.get(occurrence.id) ||
      reconciliation.results[occurrenceIndex] ||
      null;
    const reconciliationModel = buildReconciliationModel(workbook, occurrence, result);
    const transaction =
      reconciliationModel.state === 'matched' ? reconciliationModel.transaction : null;
    const possibleTransaction =
      reconciliationModel.state === 'candidate'
        ? reconciliationModel.transaction
        : (reconciliationModel.pendingCandidate &&
            reconciliationModel.pendingCandidate.transaction) ||
          null;
    const category =
      asArray(workbook.categories).find((item) => item && item.id === occurrence.categoryId) ||
      null;
    const recurringItem =
      asArray(workbook.recurringItems).find(
        (item) => item && item.id === occurrence.recurringItemId
      ) || null;
    const isExpectedAutomaticCharge =
      occurrence.kind === 'subscription' ||
      occurrence.expectedTransactionKind === 'card_charge' ||
      (recurringItem && recurringItem.autoRenew === true);
    const status =
      reconciliationModel.state === 'matched'
        ? 'Paid'
        : reconciliationModel.state === 'partial'
          ? 'Partial'
          : reconciliationModel.state === 'candidate'
            ? 'Review match'
            : occurrence.dueDate < today
              ? isExpectedAutomaticCharge
                ? 'Expected charge not recorded'
                : 'Overdue'
              : 'Upcoming';
    const remainingAmount =
      reconciliationModel.state === 'partial'
        ? Number(result && result.settlement && result.settlement.remainingBaseAmount) || 0
        : 0;
    const originalAmount = Number(occurrence.originalAmount) || Number(occurrence.amount) || 0;
    const paymentAmount =
      reconciliationModel.state === 'partial' && Number(occurrence.amount) > 0
        ? Math.round((originalAmount * remainingAmount * 100) / Number(occurrence.amount)) / 100
        : originalAmount;
    const row = {
      ...occurrence,
      category: category ? { id: category.id, name: category.name, type: category.type } : null,
      categoryName: category ? asString(category.name) : 'Uncategorized',
      status,
      remainingAmount,
      paymentAmount,
      transaction,
      possibleTransaction,
      reconciliation: reconciliationModel,
      possibleMatchScore:
        possibleTransaction && result && result.candidate ? Number(result.candidate.score) || 0 : 0,
      possibleMatchLabel: possibleTransaction
        ? 'Likely transaction found — confirm or reject this match'
        : '',
      note: asString(occurrence.note || (recurringItem && recurringItem.note)),
      autoRenew: recurringItem && recurringItem.autoRenew === true,
      paymentTemplate:
        occurrence.expectedTransactionKind === 'liability_payment'
          ? 'transfer'
          : occurrence.expectedTransactionKind === 'card_charge'
            ? 'expense_charged'
            : 'expense_paid',
      fundingAccountId: '',
      isActive: recurringItem ? recurringItem.isActive !== false : true
    };
    row.tone = getStatusTone(status);
    row.icon = getBillIcon(row);
    row.amountCopy =
      row.baseAmountVerified === false
        ? formatMoney(row.nativeAmount, row.nativeCurrency)
        : formatMoney(row.amount, workbook.currency);
    row.dueAmountCopy =
      row.baseAmountVerified === false
        ? row.amountCopy
        : formatMoney(
            row.status === 'Partial' ? row.remainingAmount : row.amount,
            workbook.currency
          );
    row.dueDateCopy = formatDate(row.dueDate);
    row.relativeDateLabel = getRelativeDateLabel(row, today);
    row.metaLabel = [
      row.kind === 'subscription' ? 'Subscription' : 'Bill',
      row.categoryName,
      row.paymentMethod,
      row.frequency
    ]
      .filter(Boolean)
      .join(' • ');
    row.actions = {
      canPay:
        !!row.recurringItemId &&
        reconciliationModel.state !== 'matched' &&
        reconciliationModel.state !== 'candidate' &&
        !reconciliationModel.pendingCandidate,
      canEdit: !!row.recurringItemId,
      canArchive: !!row.recurringItemId,
      canOpenTransaction:
        !!transaction ||
        (reconciliationModel.state === 'partial' && !!reconciliationModel.transaction),
      canReviewPossibleTransaction: !!possibleTransaction
    };
    row.editorValues = {
      recurringItemId: asString(row.recurringItemId),
      kind: asString(row.kind) || 'bill',
      name: asString(row.name),
      categoryId: asString(row.categoryId),
      accountId: asString(row.accountId),
      amount: String(Number(recurringItem && recurringItem.amount) || Number(row.amount) || 0),
      currency: asString(
        (recurringItem && recurringItem.currency) || workbook.currency
      ).toUpperCase(),
      frequency: asString(row.frequency) || 'Monthly',
      dueDate: asString((recurringItem && recurringItem.anchorDate) || row.dueDate),
      autoRenew: recurringItem && recurringItem.autoRenew === true,
      isActive: recurringItem ? recurringItem.isActive !== false : true,
      note: asString(recurringItem && recurringItem.note)
    };
    return row;
  });
}

function createTransactionCandidateSelector(transactions) {
  const source = asArray(transactions);
  const indexesByDate = new Map();
  const indexesByOccurrenceId = new Map();
  const indexesByOccurrenceDate = new Map();

  source.forEach((transaction, index) => {
    const date = normalizeDateKey(transaction && transaction.date);
    if (date) {
      const ordinal = dateOrdinal(date);
      const indexes = indexesByDate.get(ordinal) || [];
      indexes.push(index);
      indexesByDate.set(ordinal, indexes);
    }
    const recurringItemId = asString(transaction && transaction.recurringItemId);
    const recurringOccurrenceId = asString(transaction && transaction.recurringOccurrenceId);
    if (recurringItemId && recurringOccurrenceId) {
      const indexes = indexesByOccurrenceId.get(recurringOccurrenceId) || [];
      indexes.push(index);
      indexesByOccurrenceId.set(recurringOccurrenceId, indexes);
    }
    const recurringOccurrenceDate = normalizeDateKey(
      transaction && transaction.recurringOccurrenceDate
    );
    if (recurringItemId && recurringOccurrenceDate) {
      const key = `${recurringItemId}:${recurringOccurrenceDate}`;
      const indexes = indexesByOccurrenceDate.get(key) || [];
      indexes.push(index);
      indexesByOccurrenceDate.set(key, indexes);
    }
  });

  const indexesForOccurrence = (occurrence) => {
    const selectedIndexes = new Set();
    const dueDate = normalizeDateKey(occurrence && occurrence.dueDate);
    const dueOrdinal = dateOrdinal(dueDate);
    if (dueOrdinal) {
      const { beforeDays, afterDays } = RECURRING_RECONCILIATION_DEFAULTS;
      for (let ordinal = dueOrdinal - beforeDays; ordinal <= dueOrdinal + afterDays; ordinal += 1) {
        asArray(indexesByDate.get(ordinal)).forEach((index) => selectedIndexes.add(index));
      }
    }
    asArray(indexesByOccurrenceId.get(asString(occurrence && occurrence.id))).forEach((index) =>
      selectedIndexes.add(index)
    );
    const recurringItemId = asString(occurrence && occurrence.recurringItemId);
    asArray(indexesByOccurrenceDate.get(`${recurringItemId}:${dueDate}`)).forEach((index) =>
      selectedIndexes.add(index)
    );
    return [...selectedIndexes].sort((left, right) => left - right);
  };
  const selectTransactions = (occurrence) =>
    indexesForOccurrence(occurrence).map((index) => source[index]);
  selectTransactions.indexesForOccurrence = indexesForOccurrence;
  return selectTransactions;
}

function selectCompetingOccurrences(allOccurrences, selectedOccurrences, candidateSelector) {
  const occurrences = asArray(allOccurrences);
  const selectedIds = new Set(
    asArray(selectedOccurrences).map((occurrence) => asString(occurrence && occurrence.id))
  );
  const candidateIndexes = occurrences.map((occurrence) =>
    candidateSelector.indexesForOccurrence(occurrence)
  );
  const occurrenceIndexesByTransaction = new Map();
  candidateIndexes.forEach((indexes, occurrenceIndex) => {
    indexes.forEach((transactionIndex) => {
      const occurrenceIndexes = occurrenceIndexesByTransaction.get(transactionIndex) || [];
      occurrenceIndexes.push(occurrenceIndex);
      occurrenceIndexesByTransaction.set(transactionIndex, occurrenceIndexes);
    });
  });

  const includedOccurrenceIndexes = new Set();
  const queuedOccurrenceIndexes = [];
  occurrences.forEach((occurrence, occurrenceIndex) => {
    if (selectedIds.has(asString(occurrence && occurrence.id))) {
      includedOccurrenceIndexes.add(occurrenceIndex);
      queuedOccurrenceIndexes.push(occurrenceIndex);
    }
  });
  while (queuedOccurrenceIndexes.length) {
    const occurrenceIndex = queuedOccurrenceIndexes.shift();
    candidateIndexes[occurrenceIndex].forEach((transactionIndex) => {
      asArray(occurrenceIndexesByTransaction.get(transactionIndex)).forEach((competitorIndex) => {
        if (includedOccurrenceIndexes.has(competitorIndex)) return;
        includedOccurrenceIndexes.add(competitorIndex);
        queuedOccurrenceIndexes.push(competitorIndex);
      });
    });
  }

  return occurrences.filter((_occurrence, index) => includedOccurrenceIndexes.has(index));
}

function getFilterOptions(workbook) {
  return {
    accounts: [{ value: '', label: 'All Accounts' }].concat(
      asArray(workbook.accounts)
        .filter((account) => {
          return (
            account && account.isActive !== false && ['asset', 'liability'].includes(account.group)
          );
        })
        .map((account) => ({ value: account.id, label: account.name }))
    ),
    categories: [{ value: '', label: 'All Categories' }].concat(
      asArray(workbook.categories)
        .filter((category) => {
          return (
            category && category.isActive !== false && ['expense', 'debt'].includes(category.type)
          );
        })
        .map((category) => ({
          value: category.id,
          label: category.name,
          type: category.type
        }))
    ),
    statuses: [
      { value: 'all', label: 'All Statuses' },
      { value: 'attention', label: 'Needs Attention' },
      { value: 'review', label: 'Review Match' },
      { value: 'partial', label: 'Partial' },
      { value: 'due', label: 'Due' },
      { value: 'upcoming', label: 'Upcoming' },
      { value: 'paid', label: 'Completed' },
      { value: 'overdue', label: 'Overdue' },
      { value: 'unrecorded', label: 'Expected charge not recorded' }
    ],
    sorts: [
      { value: 'dueDate', label: 'Sort: Due Date' },
      { value: 'name', label: 'Sort: Name' },
      { value: 'amount', label: 'Sort: Amount' },
      { value: 'status', label: 'Sort: Status' },
      { value: 'category', label: 'Sort: Category' }
    ]
  };
}

function getFilterChips(filters, options) {
  const chips = [];
  if (filters.search) chips.push(`Search: ${filters.search}`);
  if (filters.status !== 'all') {
    const status = options.statuses.find((item) => item.value === filters.status);
    if (status) chips.push(status.label);
  }
  if (filters.date) chips.push(`Due ${formatDate(filters.date)}`);
  const category = filters.categoryId
    ? options.categories.find((item) => item.value === filters.categoryId)
    : null;
  const account = filters.accountId
    ? options.accounts.find((item) => item.value === filters.accountId)
    : null;
  if (category) chips.push(category.label);
  if (account) chips.push(account.label);
  return chips.length ? chips : ['All recurring items'];
}

function getDueGroups(rows, today) {
  const groups = { Overdue: [], Unrecorded: [], Today: [], Tomorrow: [], Later: [] };
  rows.forEach((row) => {
    const difference = dateOrdinal(row.dueDate) - dateOrdinal(today);
    const key =
      row.status === 'Expected charge not recorded'
        ? 'Unrecorded'
        : difference < 0
          ? 'Overdue'
          : difference === 0
            ? 'Today'
            : difference === 1
              ? 'Tomorrow'
              : 'Later';
    groups[key].push(row);
  });
  return Object.entries(groups)
    .filter(([, groupRows]) => groupRows.length)
    .map(([label, groupRows]) => ({
      label,
      rows: groupRows
    }));
}

export function getBillsRouteBaseCacheKey(viewState = {}, dependencies = {}) {
  return `${readToday(dependencies)}:${asString(asObject(viewState).sheetId)}`;
}

export function buildBillsRouteBaseModel(workbook, viewState = {}, dependencies = {}) {
  if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
    throw new TypeError('Bills route models require a hydrated workbook.');
  }
  const state = asObject(viewState);
  const today = readToday(dependencies);
  const sheet = selectSheet(workbook, state, today);
  const rows = buildOccurrenceRows(workbook, sheet, today);
  const recurringRows = buildRecurringTemplateRows(workbook, { active: true });
  const filterOptions = getFilterOptions(workbook);
  const currency = asString(workbook.currency).toUpperCase() || 'PHP';
  return {
    today,
    sheet,
    rows,
    recurringRows,
    filterOptions,
    currency,
    periodLabel: getSheetLabel(workbook, sheet, today),
    sheetOptions: asArray(workbook.sheets)
      .slice()
      .sort((left, right) =>
        getSheetMonthKey(workbook, left, today).localeCompare(
          getSheetMonthKey(workbook, right, today)
        )
      )
      .map((item) => ({
        value: asString(item.id),
        label: getSheetLabel(workbook, item, today),
        monthKey: getSheetMonthKey(workbook, item, today)
      })),
    inactiveItems: buildRecurringTemplateRows(workbook, { active: false })
  };
}

export function buildBillsRouteModelFromBase(workbook, baseModel, viewState = {}) {
  if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
    throw new TypeError('Bills route models require a hydrated workbook.');
  }
  const state = asObject(viewState);
  const base = asObject(baseModel);
  const today = asString(base.today);
  const sheet = base.sheet || null;
  const rows = asArray(base.rows);
  const coreModel = buildBillsRouteViewModel(rows, {
    recurringRows: asArray(base.recurringRows),
    filterKind: state.filterKind,
    accountId: state.accountId,
    categoryId: state.categoryId,
    status: state.status,
    date: state.date,
    search: state.search,
    sort: state.sort,
    page: state.page,
    rowsPerPage: state.rowsPerPage,
    today
  });
  const filterOptions = asObject(base.filterOptions);
  const review = asObject(state.subscriptionReview);
  const reviewCandidates = (
    review.status === 'complete'
      ? buildRecurringCandidates(workbook, {
          includeIgnored: review.includeIgnored === true,
          asOfDate: today
        })
      : asArray(review.candidates)
  )
    .filter(
      (candidate) => !(candidate && (candidate.alreadyTracked || candidate.existingRecurringItemId))
    )
    .slice(0, 12);
  const currency = asString(base.currency).toUpperCase() || 'PHP';
  const attentionTotal =
    coreModel.summary.totalUnrecorded +
    coreModel.summary.totalReview +
    coreModel.summary.totalPartial;
  const overdueTotal = Number(coreModel.summary.totalOverdue) || 0;
  const dueWeekTotal = Number(coreModel.summary.totalDueWeek) || 0;
  const paidTotal = Number(coreModel.summary.totalPaid) || 0;
  return cloneSerializable({
    header: {
      sheetId: sheet ? asString(sheet.id) : '',
      sheetOptions: asArray(base.sheetOptions),
      scanDisabled: review.status === 'modeling',
      scanIcon: review.status === 'modeling' ? 'hourglass_top' : 'manage_search',
      scanLabel:
        review.status === 'modeling'
          ? `Looking${review.progressPercent ? ` · ${Math.round(Number(review.progressPercent))}%` : '…'}`
          : 'Find recurring charges'
    },
    currency,
    today,
    periodLabel: asString(base.periodLabel),
    sheet: sheet
      ? {
          id: asString(sheet.id),
          name: asString(sheet.name),
          monthKey: getSheetMonthKey(workbook, sheet, today),
          monthIndex: Number(getSheetMonthKey(workbook, sheet, today).slice(5, 7)) - 1
        }
      : null,
    filters: coreModel.filters,
    filterOpen: state.filterOpen === true,
    filterOptions,
    filterChips: getFilterChips(coreModel.filters, filterOptions),
    rows: coreModel.pageRows,
    hasRows: coreModel.pageRows.length > 0,
    rowCount: coreModel.rowCount,
    summaryPills: [
      {
        tone: attentionTotal > 0 ? 'warn' : 'neutral',
        status: 'attention',
        label: 'Needs Attention',
        value: formatMoney(attentionTotal, currency),
        detail: `${
          coreModel.summary.unrecordedCount +
          coreModel.summary.reviewCount +
          coreModel.summary.partialCount
        } items`
      },
      {
        tone: overdueTotal > 0 ? 'bad' : 'neutral',
        status: 'overdue',
        label: 'Overdue',
        value: formatMoney(overdueTotal, currency),
        detail: `${coreModel.summary.overdueCount} items`
      },
      {
        tone: dueWeekTotal > 0 ? 'warn' : 'neutral',
        status: 'due',
        label: 'Due Soon',
        value: formatMoney(dueWeekTotal, currency),
        detail: `${coreModel.summary.dueWeekCount} this week`
      },
      {
        tone: paidTotal > 0 ? 'good' : 'neutral',
        status: 'paid',
        label: 'Completed',
        value: formatMoney(paidTotal, currency),
        detail: `${coreModel.summary.paidCount} reconciled`
      }
    ],
    pagination: {
      ...coreModel.pagination,
      visible: coreModel.pagination.totalPages > 1,
      rowCount: coreModel.rowCount
    },
    dueNextGroups: getDueGroups(coreModel.dueNextRows, today),
    recurring: {
      monthlyCount: coreModel.recurring.monthlyEquivalentCount,
      monthlyTotal: coreModel.recurring.monthlyEquivalentTotal,
      monthlyEquivalentCount: coreModel.recurring.monthlyEquivalentCount,
      monthlyEquivalentTotal: coreModel.recurring.monthlyEquivalentTotal,
      monthlyTotalCopy: formatMoney(coreModel.recurring.monthlyEquivalentTotal, currency),
      unresolvedFxCount: coreModel.recurring.unresolvedFxCount,
      explanation:
        'Monthly equivalent across all active recurring items. Weekly, biweekly, quarterly, and yearly schedules are normalized.'
    },
    inactiveItems: cloneSerializable(asArray(base.inactiveItems)),
    editorOptions: {
      currency,
      categories: filterOptions.categories.filter((item) => item.value),
      accounts: filterOptions.accounts.filter((item) => item.value),
      frequencies: ['Monthly', 'Weekly', 'Every 2 Weeks', 'Quarterly', 'Yearly', 'One-time']
    },
    subscriptionReview: {
      status: asString(review.status),
      progressPercent: Math.max(0, Math.min(100, Math.round(Number(review.progressPercent) || 0))),
      error: asString(review.error),
      candidates: reviewCandidates.map((candidate) => ({
        id: asString(candidate.id),
        name: asString(candidate.suggestedName || candidate.name),
        kind: inferReviewCandidateKind(candidate),
        classification: asString(candidate.classification),
        confidence: Number(candidate.confidence) || 0,
        confidenceLabel:
          Number(candidate.confidence) >= 0.75
            ? 'Strong pattern'
            : Number(candidate.confidence) >= 0.5
              ? 'Likely recurring'
              : 'Possible recurring',
        amount: Number(candidate.amount) || 0,
        amountCopy: formatMoney(
          candidate.amount,
          asString(candidate.currency).toUpperCase() || currency
        ),
        currency: asString(candidate.currency).toUpperCase() || currency,
        frequency: asString(candidate.suggestedFrequency) || 'Monthly',
        transactionCount: Number(candidate.transactionCount) || 0,
        categoryId: asString(candidate.categoryId),
        categoryName: asString(candidate.categoryName),
        accountId: asString(candidate.accountId),
        accountName: asString(candidate.accountName),
        firstSeenDate: normalizeDateKey(candidate.firstSeenDate || candidate.firstDate),
        lastSeenDate: normalizeDateKey(candidate.lastSeenDate || candidate.lastDate),
        nextDueDate: getNextCandidateDueDate(
          candidate.lastSeenDate || candidate.lastDate,
          candidate.suggestedFrequency,
          today
        ),
        reason: asString(candidate.reason)
      }))
    },
    feedback: {
      error: asString(state.error),
      notice: asString(state.notice)
    }
  });
}

export function buildBillsRouteModel(workbook, viewState = {}, dependencies = {}) {
  return buildBillsRouteModelFromBase(
    workbook,
    buildBillsRouteBaseModel(workbook, viewState, dependencies),
    viewState
  );
}
