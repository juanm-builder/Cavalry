import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import { getTransactionContributions } from '../../domain/ledger/transaction-contributions.js';
import {
  getAssetLiabilityTotalsAsOf,
  getLedgerHistoricalBalances
} from '../../domain/ledger/balances.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textKey(value) {
  return asString(value).toLowerCase().replace(/\s+/g, ' ');
}

function baseCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

export function getReportTransactionDate(transaction) {
  return (
    normalizeDateKey(transaction && transaction.date) || asString(transaction && transaction.date)
  );
}

export function getReportMonthKey(transaction) {
  const date = getReportTransactionDate(transaction);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date.slice(0, 7)
    : asString(transaction && transaction.monthKey);
}

function categoryMap(workbook) {
  return new Map(
    asArray(workbook && workbook.categories).map((category) => [
      asString(category && category.id),
      category
    ])
  );
}

function accountMap(workbook) {
  return new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asString(account && account.id),
      account
    ])
  );
}

function isInDateRange(transaction, options = {}) {
  const monthKey = getReportMonthKey(transaction);
  const startMonth = asString(options.startMonth);
  const endMonth = asString(options.endMonth);
  if (startMonth && monthKey && monthKey < startMonth) return false;
  if (endMonth && monthKey && monthKey > endMonth) return false;
  const date = getReportTransactionDate(transaction);
  const start = normalizeDateKey(options.start || options.startDate);
  const end = normalizeDateKey(options.end || options.endDate);
  if (start && date && date < start) return false;
  if (end && date && date > end) return false;
  return true;
}

export function getReportTransactions(workbook, options = {}) {
  return asArray(workbook && workbook.transactions).filter((transaction) =>
    isInDateRange(transaction, options)
  );
}

function makeCashFlowBucket(monthKey = '') {
  return {
    monthKey,
    income: 0,
    expense: 0,
    savings: 0,
    debt: 0,
    outflow: 0,
    net: 0,
    transactionCount: 0,
    transferCount: 0
  };
}

function addFlowAmount(bucket, contribution) {
  if (contribution.eventKind === 'transfer') {
    bucket.transferCount += 1;
    return;
  }
  if (!contribution.resolved) return;
  const kind = contribution.flowKind;
  const amount = contribution.signedBaseAmount;
  if (kind === 'inflow') {
    bucket.income = roundMoney(bucket.income + amount);
    bucket.transactionCount += 1;
  } else if (kind === 'expense') {
    bucket.expense = roundMoney(bucket.expense + amount);
    bucket.transactionCount += 1;
  } else if (kind === 'savings') {
    bucket.savings = roundMoney(bucket.savings + amount);
    bucket.transactionCount += 1;
  } else if (kind === 'debt') {
    bucket.debt = roundMoney(bucket.debt + amount);
    bucket.transactionCount += 1;
  }
  bucket.outflow = roundMoney(bucket.expense + bucket.savings + bucket.debt);
  bucket.net = roundMoney(bucket.income - bucket.outflow);
}

function collectReportLimitations(workbook, transactions) {
  const categories = categoryMap(workbook);
  const accounts = accountMap(workbook);
  const limitations = [];
  if (
    transactions.some(
      (transaction) =>
        asString(transaction && transaction.originalCurrency).toUpperCase() &&
        asString(transaction && transaction.originalCurrency).toUpperCase() !==
          baseCurrency(workbook)
    )
  ) {
    limitations.push('multi_currency_base_amounts');
  }
  if (
    transactions.some(
      (transaction) =>
        transaction && transaction.categoryId && !categories.has(asString(transaction.categoryId))
    )
  ) {
    limitations.push('missing_category_references');
  }
  if (
    transactions.some((transaction) =>
      asArray(transaction && transaction.lines).some(
        (line) => line && line.accountId && !accounts.has(asString(line.accountId))
      )
    )
  ) {
    limitations.push('missing_account_references');
  }
  return limitations;
}

export function buildMonthlyCashFlowReport(workbook, options = {}) {
  const transactions = getReportTransactions(workbook, options);
  const months = new Map();
  const summary = makeCashFlowBucket('');
  transactions.forEach((transaction) => {
    const contribution = getTransactionContributions(workbook || {}, transaction || {});
    const monthKey = getReportMonthKey(transaction) || 'unknown';
    if (!months.has(monthKey)) {
      months.set(monthKey, makeCashFlowBucket(monthKey));
    }
    addFlowAmount(months.get(monthKey), contribution);
    addFlowAmount(summary, contribution);
  });
  return {
    currency: baseCurrency(workbook),
    start: normalizeDateKey(options.start || options.startDate),
    end: normalizeDateKey(options.end || options.endDate),
    months: Array.from(months.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
    summary,
    limitations: collectReportLimitations(workbook, transactions)
  };
}

function makeCategoryRow(categoryId, category, amount, transaction) {
  const missing = !!(categoryId && !category);
  return {
    categoryId: categoryId || '__uncategorized',
    categoryName: category ? category.name : categoryId ? 'Missing category' : 'Uncategorized',
    categoryType: category ? category.type : 'expense',
    isArchived: category ? category.isActive === false : false,
    isMissing: missing,
    total: amount,
    transactionCount: 0,
    firstDate: getReportTransactionDate(transaction),
    lastDate: getReportTransactionDate(transaction)
  };
}

export function buildCategorySpendingReport(workbook, options = {}) {
  const categories = categoryMap(workbook);
  const rows = new Map();
  const transactions = getReportTransactions(workbook, options);
  let total = 0;
  let transferCount = 0;
  transactions.forEach((transaction) => {
    const contribution = getTransactionContributions(workbook || {}, transaction || {});
    if (contribution.eventKind === 'transfer') {
      transferCount += 1;
      return;
    }
    if (!contribution.resolved || contribution.flowKind !== 'expense') {
      return;
    }
    const categoryId = asString(transaction && transaction.categoryId);
    const category = categoryId ? categories.get(categoryId) || null : null;
    if (!category && options.includeMissingCategories === false) {
      return;
    }
    const rowKey = categoryId || '__uncategorized';
    const amount = contribution.metrics.expense;
    const current = rows.get(rowKey) || makeCategoryRow(categoryId, category, 0, transaction);
    current.total = roundMoney(current.total + amount);
    current.transactionCount += 1;
    current.firstDate =
      current.firstDate && current.firstDate < getReportTransactionDate(transaction)
        ? current.firstDate
        : getReportTransactionDate(transaction);
    current.lastDate =
      current.lastDate && current.lastDate > getReportTransactionDate(transaction)
        ? current.lastDate
        : getReportTransactionDate(transaction);
    rows.set(rowKey, current);
    total = roundMoney(total + amount);
  });
  return {
    currency: baseCurrency(workbook),
    total,
    transactionCount: Array.from(rows.values()).reduce((sum, row) => sum + row.transactionCount, 0),
    transferCount,
    rows: Array.from(rows.values()).sort(
      (a, b) => b.total - a.total || a.categoryName.localeCompare(b.categoryName)
    ),
    limitations: collectReportLimitations(workbook, transactions)
  };
}

export function buildIncomeExpenseBreakdown(workbook, options = {}) {
  const cashFlow = buildMonthlyCashFlowReport(workbook, options);
  return {
    currency: cashFlow.currency,
    income: cashFlow.summary.income,
    expense: cashFlow.summary.expense,
    savings: cashFlow.summary.savings,
    debt: cashFlow.summary.debt,
    outflow: cashFlow.summary.outflow,
    net: cashFlow.summary.net,
    transferCount: cashFlow.summary.transferCount,
    limitations: cashFlow.limitations
  };
}

export function buildTopDescriptionReport(workbook, options = {}) {
  const groups = new Map();
  const transactions = getReportTransactions(workbook, options);
  transactions.forEach((transaction) => {
    const contribution = getTransactionContributions(workbook || {}, transaction || {});
    const kind = contribution.flowKind;
    if (!contribution.resolved || contribution.eventKind === 'transfer') {
      return;
    }
    const key = textKey(transaction && transaction.description) || 'uncategorized';
    const amount =
      contribution.eventKind === 'merchant_refund'
        ? contribution.signedBaseAmount
        : contribution.baseAmount;
    const current = groups.get(key) || {
      description: asString(transaction && transaction.description) || 'Unlabeled transaction',
      kind,
      total: 0,
      transactionCount: 0,
      firstDate: getReportTransactionDate(transaction),
      lastDate: getReportTransactionDate(transaction)
    };
    current.total = roundMoney(current.total + amount);
    current.transactionCount += 1;
    current.firstDate =
      current.firstDate && current.firstDate < getReportTransactionDate(transaction)
        ? current.firstDate
        : getReportTransactionDate(transaction);
    current.lastDate =
      current.lastDate && current.lastDate > getReportTransactionDate(transaction)
        ? current.lastDate
        : getReportTransactionDate(transaction);
    groups.set(key, current);
  });
  return {
    currency: baseCurrency(workbook),
    rows: Array.from(groups.values()).sort(
      (a, b) => b.total - a.total || a.description.localeCompare(b.description)
    ),
    limitations: collectReportLimitations(workbook, transactions)
  };
}

export function buildAccountBalanceSummary(workbook, options = {}) {
  const balances = getLedgerHistoricalBalances(workbook || {});
  const totals = getAssetLiabilityTotalsAsOf(workbook || {}, options.asOfDate || '');
  const accounts = asArray(workbook && workbook.accounts).map((account) => ({
    accountId: asString(account && account.id),
    accountName: asString(account && account.name),
    group: asString(account && account.group),
    currency: asString(account && account.currency).toUpperCase() || baseCurrency(workbook),
    isArchived: account && account.isActive === false,
    balance: roundMoney(balances[asString(account && account.id)] || 0)
  }));
  const accountIds = new Set(accounts.map((account) => account.accountId));
  const missingAccountIds = Array.from(
    new Set(
      asArray(workbook && workbook.transactions).flatMap((transaction) => {
        return asArray(transaction && transaction.lines)
          .map((line) => asString(line && line.accountId))
          .filter((id) => id && !accountIds.has(id));
      })
    )
  ).sort();
  return {
    currency: baseCurrency(workbook),
    assets: totals.assets,
    liabilities: totals.liabilities,
    netWorth: totals.netWorth,
    accounts: accounts.sort(
      (a, b) => a.group.localeCompare(b.group) || a.accountName.localeCompare(b.accountName)
    ),
    missingAccountIds,
    limitations: missingAccountIds.length ? ['missing_account_references'] : []
  };
}
