import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import { isNaturalDebitGroup } from '../../domain/ledger/balances.js';
import { getLedgerTransactionBaseAmount } from '../../domain/ledger/transactions.js';
import {
  asArray,
  asString,
  clonePlain,
  formatVisibleDateRangeLabel,
  getDashboardSpendingRangeLabel,
  getTemplateLabel,
  normalizeMonthValue
} from './dashboard-view-model-helpers.js';

function getCategoryById(workbook, categoryId) {
  const id = asString(categoryId);
  return (
    asArray(workbook && workbook.categories).find((category) => {
      return asString(category && category.id) === id;
    }) || null
  );
}

function getAccountById(workbook, accountId) {
  const id = asString(accountId);
  return (
    asArray(workbook && workbook.accounts).find((account) => {
      return asString(account && account.id) === id;
    }) || null
  );
}

function getCounterpartyById(workbook, counterpartyId) {
  const id = asString(counterpartyId);
  return (
    asArray(workbook && workbook.counterparties).find((counterparty) => {
      return asString(counterparty && counterparty.id) === id;
    }) || null
  );
}

function getTransactionMonthKey(transaction) {
  const date = normalizeDateKey(transaction && transaction.date);
  return date ? date.slice(0, 7) : normalizeMonthValue(transaction && transaction.monthKey);
}

function transactionIsInDateRange(transaction, range) {
  const date = asString(transaction && transaction.date);
  return !!(date && date >= range.start && date <= range.end);
}

function normalizeDrilldownRange(options = {}) {
  const rangeStart = asString(options.rangeStart || options.start || options.startDate);
  const rangeEnd = asString(options.rangeEnd || options.end || options.endDate);
  const dateStart = normalizeDateKey(rangeStart);
  const dateEnd = normalizeDateKey(rangeEnd);
  if (dateStart && dateEnd) {
    const dateRange = {
      start: dateStart,
      end: dateEnd
    };
    return {
      kind: 'date',
      dateRange,
      monthRange: null,
      rangeLabel: formatVisibleDateRangeLabel(dateRange)
    };
  }

  const monthStart = normalizeMonthValue(rangeStart);
  const monthEnd = normalizeMonthValue(rangeEnd);
  if (monthStart && monthEnd) {
    const monthRange = {
      startMonth: monthStart,
      endMonth: monthEnd
    };
    return {
      kind: 'month',
      dateRange: null,
      monthRange,
      rangeLabel: getDashboardSpendingRangeLabel(monthRange)
    };
  }

  return {
    kind: 'all',
    dateRange: null,
    monthRange: null,
    rangeLabel: 'All transactions'
  };
}

function normalizeRelatedLabelParts(parts) {
  const seen = {};
  return asArray(parts).reduce((list, part) => {
    asString(part)
      .split('•')
      .forEach((piece) => {
        const trimmed = piece.trim();
        if (!trimmed) {
          return;
        }
        const key = trimmed.toLowerCase().replace(/^(from|to|into|charged to)\s+/, '');
        if (seen[key]) {
          return;
        }
        seen[key] = true;
        list.push(trimmed);
      });
    return list;
  }, []);
}

function buildRelatedLabel(parts, fallback) {
  const normalized = normalizeRelatedLabelParts(parts);
  return normalized.length ? normalized.join(' • ') : fallback || 'Related';
}

function describeTransactionAccounts(workbook, transaction) {
  const debitLine = asArray(transaction && transaction.lines).find(
    (line) => line.direction === 'debit'
  );
  const creditLine = asArray(transaction && transaction.lines).find(
    (line) => line.direction === 'credit'
  );
  const debitAccount = debitLine ? getAccountById(workbook, debitLine.accountId) : null;
  const creditAccount = creditLine ? getAccountById(workbook, creditLine.accountId) : null;
  if (!debitAccount && !creditAccount) {
    return 'Unmapped';
  }
  if (!debitAccount) {
    return creditAccount.name;
  }
  if (!creditAccount) {
    return debitAccount.name;
  }
  return debitAccount.name + ' ← ' + creditAccount.name;
}

function describeTransactionFlow(workbook, transaction) {
  const counterparty =
    transaction && transaction.counterpartyId
      ? getCounterpartyById(workbook, transaction.counterpartyId)
      : null;
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  const debitLine = asArray(transaction && transaction.lines).find(
    (line) => line.direction === 'debit'
  );
  const creditLine = asArray(transaction && transaction.lines).find(
    (line) => line.direction === 'credit'
  );
  const debitAccount = debitLine ? getAccountById(workbook, debitLine.accountId) : null;
  const creditAccount = creditLine ? getAccountById(workbook, creditLine.accountId) : null;
  const template = asString(transaction && transaction.template);

  if (template === 'income_received') {
    return buildRelatedLabel(
      [
        counterparty ? 'From ' + counterparty.name : '',
        debitAccount ? 'Into ' + debitAccount.name : 'Income'
      ],
      'Income'
    );
  }
  if (template === 'expense_paid') {
    return buildRelatedLabel(
      [
        creditAccount ? 'From ' + creditAccount.name : 'Expense',
        counterparty ? 'To ' + counterparty.name : '',
        category ? category.name : ''
      ],
      'Expense'
    );
  }
  if (template === 'expense_charged') {
    return buildRelatedLabel(
      [
        creditAccount ? 'Charged to ' + creditAccount.name : 'Charged',
        counterparty ? counterparty.name : '',
        category ? category.name : ''
      ],
      'Charged expense'
    );
  }
  if (template === 'debt_payment' || template === 'liability_payment') {
    return (
      (creditAccount ? 'From ' + creditAccount.name : 'Debt payment') +
      (debitAccount ? ' • To ' + debitAccount.name : '') +
      (category ? ' • ' + category.name : '')
    );
  }
  if (template === 'transfer') {
    return (
      (creditAccount ? creditAccount.name : 'Account') +
      ' → ' +
      (debitAccount ? debitAccount.name : 'Account')
    );
  }
  if (template === 'opening_balance') {
    return 'Opening balance setup';
  }
  if (template === 'existing_liability') {
    return 'Existing liability balance';
  }
  if (template === 'time_deposit_redeemed') {
    return 'Time deposit maturity';
  }
  if (template === 'daily_interest') {
    return (
      (debitAccount ? 'Into ' + debitAccount.name : 'Daily interest') +
      (category ? ' • ' + category.name : '')
    );
  }
  return describeTransactionAccounts(workbook, transaction);
}

function getTransactionImpact(workbook, transaction) {
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  const template = asString(transaction && transaction.template);
  let assetDelta = 0;
  let positiveAssetDelta = 0;
  let liabilityDelta = 0;
  asArray(transaction && transaction.lines).forEach((line) => {
    const account = getAccountById(workbook, line.accountId);
    if (!account) {
      return;
    }
    const sign = isNaturalDebitGroup(account.group)
      ? line.direction === 'debit'
        ? 1
        : -1
      : line.direction === 'credit'
        ? 1
        : -1;
    const delta = roundMoney(sign * (Number(line.baseAmount) || 0));
    if (account.group === 'asset') {
      assetDelta = roundMoney(assetDelta + delta);
      if (delta > 0) {
        positiveAssetDelta = roundMoney(positiveAssetDelta + delta);
      }
    }
    if (account.group === 'liability') {
      liabilityDelta = roundMoney(liabilityDelta + delta);
    }
  });
  const netWorthDelta = roundMoney(assetDelta - liabilityDelta);
  const isDebtLike =
    template === 'existing_liability' ||
    template === 'expense_paid' ||
    template === 'expense_charged' ||
    template === 'debt_payment' ||
    template === 'liability_payment' ||
    (category && (category.type === 'expense' || category.type === 'debt'));
  const isHelpful =
    template === 'income_received' ||
    template === 'daily_interest' ||
    template === 'time_deposit_redeemed' ||
    (category && category.type === 'income') ||
    netWorthDelta > 0.01 ||
    positiveAssetDelta > 0.01;
  let tone = 'info';
  if (liabilityDelta > 0.01 || isDebtLike || netWorthDelta < -0.01) {
    tone = 'bad';
  } else if (isHelpful) {
    tone = 'good';
  }
  return {
    tone,
    assetDelta,
    positiveAssetDelta,
    liabilityDelta,
    netWorthDelta,
    categoryType: category ? category.type : ''
  };
}

function transactionMatchesDrilldown(transaction, category, rangeModel) {
  if (!(transaction && category && transaction.categoryId === category.id)) {
    return false;
  }
  if (rangeModel.dateRange) {
    return transactionIsInDateRange(transaction, rangeModel.dateRange);
  }
  if (rangeModel.monthRange) {
    const monthKey = getTransactionMonthKey(transaction);
    return (
      !monthKey ||
      (monthKey >= rangeModel.monthRange.startMonth && monthKey <= rangeModel.monthRange.endMonth)
    );
  }
  return true;
}

function sortTransactionsNewestFirst(transactions) {
  return transactions.slice().sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });
}

function buildTransactionRow(workbook, transaction) {
  return {
    transaction: clonePlain(transaction),
    transactionId: asString(transaction && transaction.id),
    date: asString(transaction && transaction.date),
    description: asString(transaction && transaction.description),
    template: asString(transaction && transaction.template),
    templateLabel: getTemplateLabel(transaction && transaction.template),
    flowLabel: describeTransactionFlow(workbook, transaction),
    amount: Number(transaction && transaction.amount) || 0,
    originalCurrency: asString(transaction && transaction.originalCurrency),
    baseAmount: getLedgerTransactionBaseAmount(transaction),
    tone: getTransactionImpact(workbook, transaction).tone
  };
}

export function buildDashboardCategoryDrilldownRows(workbook, options = {}) {
  const category = getCategoryById(workbook, options.categoryId);
  const rangeModel = normalizeDrilldownRange(options);
  if (!category) {
    return [];
  }
  return sortTransactionsNewestFirst(
    asArray(workbook && workbook.transactions).filter((transaction) => {
      return transactionMatchesDrilldown(transaction, category, rangeModel);
    })
  ).map((transaction) => buildTransactionRow(workbook, transaction));
}

export function buildDashboardCategoryDrilldownSummary(workbook, options = {}) {
  const category = getCategoryById(workbook, options.categoryId);
  const rows = options.rows || buildDashboardCategoryDrilldownRows(workbook, options);
  const linkedAccount = category ? getAccountById(workbook, category.linkedAccountId) : null;
  const total = roundMoney(
    asArray(rows).reduce((sum, row) => {
      return sum + (Number(row && row.baseAmount) || 0);
    }, 0)
  );
  const tone = category && category.type === 'income' ? 'good' : 'bad';
  return {
    category: clonePlain(category),
    linkedAccount: clonePlain(linkedAccount),
    total,
    transactionCount: rows.length,
    type: category ? asString(category.type) : '',
    postingAccountName: linkedAccount ? asString(linkedAccount.name) : 'Missing',
    tone
  };
}

export function buildDashboardCategoryDrilldownViewModel(workbook, options = {}) {
  const category = getCategoryById(workbook, options.categoryId);
  const rangeModel = normalizeDrilldownRange(options);
  const rows = buildDashboardCategoryDrilldownRows(workbook, options);
  return {
    category: clonePlain(category),
    categoryId: asString(options.categoryId),
    isKnownCategory: !!category,
    rangeKind: rangeModel.kind,
    dateRange: clonePlain(rangeModel.dateRange),
    monthRange: clonePlain(rangeModel.monthRange),
    rangeLabel: rangeModel.rangeLabel,
    rows,
    transactions: rows.map((row) => clonePlain(row.transaction)),
    summary: buildDashboardCategoryDrilldownSummary(workbook, Object.assign({}, options, { rows }))
  };
}
