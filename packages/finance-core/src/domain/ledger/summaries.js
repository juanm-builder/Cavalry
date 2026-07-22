// Reporting preserves the established posted-flow classification used by schema-v2 workbooks.

import { roundMoney } from '../money.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseISODate(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null;
}

function normalizeDateKey(value) {
  const direct = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return parseISODate(direct[0]) ? direct[0] : '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatISODate(date);
}

function normalizeMonthValue(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{1,2})$/);
  if (!match) {
    return '';
  }
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return '';
  }
  return match[1] + '-' + String(month).padStart(2, '0');
}

function getCategoryById(workbook, categoryId) {
  return workbook && workbook.categories
    ? workbook.categories.find((category) => category.id === categoryId) || null
    : null;
}

function getTransactionBaseAmount(transaction) {
  return roundMoney(
    Number(transaction && transaction.baseAmount ? transaction.baseAmount : 0) || 0
  );
}

function isTransactionWithinDateRange(transaction, startDate, endDate) {
  const date = normalizeDateKey(transaction && transaction.date);
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  if (!date) {
    return false;
  }
  if (start && date < start) {
    return false;
  }
  if (end && date > end) {
    return false;
  }
  return true;
}

function getTransactionsForDateRange(transactions, startDate, endDate) {
  return asArray(transactions).filter((transaction) => {
    return isTransactionWithinDateRange(transaction, startDate, endDate);
  });
}

function getMonthRangeFromKey(monthKey) {
  const normalized = normalizeMonthValue(monthKey);
  if (!normalized) {
    return null;
  }
  const parts = normalized.split('-');
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    start: normalized + '-01',
    end: normalized + '-' + String(lastDay).padStart(2, '0')
  };
}

export function getTransactionFlowKind(transaction, workbook, _options = {}) {
  const template = String(transaction && transaction.template ? transaction.template : '');
  if (template === 'opening_balance' || template === 'existing_liability') {
    return 'opening';
  }
  if (template === 'transfer') {
    return 'transfer';
  }
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  if (category && category.type === 'income') {
    return 'inflow';
  }
  if (category && category.type === 'expense') {
    return 'expense';
  }
  if (category && category.type === 'savings') {
    return 'savings';
  }
  if (category && category.type === 'debt') {
    return 'debt';
  }
  if (template === 'income_received' || template === 'daily_interest') {
    return 'inflow';
  }
  if (template === 'expense_paid' || template === 'expense_charged') {
    return 'expense';
  }
  if (template === 'debt_payment' || template === 'liability_payment') {
    return 'debt';
  }
  return 'transfer';
}

export function flowKindMatches(kind, requestedType) {
  const type = String(requestedType || 'both');
  if (type === 'both') {
    return kind === 'inflow' || kind === 'expense' || kind === 'savings' || kind === 'debt';
  }
  if (type === 'inflow' || type === 'income') {
    return kind === 'inflow';
  }
  if (type === 'expense') {
    return kind === 'expense';
  }
  if (type === 'outflow') {
    return kind === 'expense' || kind === 'savings' || kind === 'debt';
  }
  if (type === 'debt' || type === 'savings') {
    return kind === type;
  }
  return false;
}

export function getFlowTransactions(workbook, rangeOrMonthKey, type, options = {}) {
  const fallbackRange = options.defaultRange || {};
  const range =
    typeof rangeOrMonthKey === 'string'
      ? getMonthRangeFromKey(rangeOrMonthKey)
      : rangeOrMonthKey || fallbackRange;
  return getTransactionsForDateRange(
    workbook && workbook.transactions ? workbook.transactions : [],
    range && range.start,
    range && range.end
  ).filter((transaction) => flowKindMatches(getTransactionFlowKind(transaction, workbook), type));
}

export function getFlowBreakdown(workbook, transactions) {
  const categoryTotals = {};
  asArray(transactions).forEach((transaction) => {
    const categoryId = transaction.categoryId || '__uncategorized';
    categoryTotals[categoryId] = roundMoney(
      (categoryTotals[categoryId] || 0) + getTransactionBaseAmount(transaction)
    );
  });
  return Object.keys(categoryTotals)
    .map((categoryId) => {
      const category =
        categoryId === '__uncategorized' ? null : getCategoryById(workbook, categoryId);
      return {
        id: categoryId,
        name: category ? category.name : 'Uncategorized',
        type: category ? category.type : 'other',
        total: categoryTotals[categoryId]
      };
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export function getMonthlyFlowBreakdown(workbook, monthKey, type, options = {}) {
  const transactions = getFlowTransactions(workbook, monthKey, type, options);
  return {
    transactions,
    rows: getFlowBreakdown(workbook, transactions),
    total: roundMoney(
      transactions.reduce((sum, transaction) => {
        return sum + getTransactionBaseAmount(transaction);
      }, 0)
    )
  };
}

export function getPeriodActivitySummary(workbook, range, _options = {}) {
  const transactions = getTransactionsForDateRange(
    workbook && workbook.transactions ? workbook.transactions : [],
    range && range.start,
    range && range.end
  );
  const summary = {
    income: 0,
    expense: 0,
    savings: 0,
    debt: 0,
    outflow: 0,
    net: 0,
    categoryTotals: {},
    transactions
  };
  transactions.forEach((transaction) => {
    const kind = getTransactionFlowKind(transaction, workbook);
    const amount = getTransactionBaseAmount(transaction);
    if (kind === 'inflow') {
      summary.income = roundMoney(summary.income + amount);
    } else if (kind === 'expense') {
      summary.expense = roundMoney(summary.expense + amount);
    } else if (kind === 'savings') {
      summary.savings = roundMoney(summary.savings + amount);
    } else if (kind === 'debt') {
      summary.debt = roundMoney(summary.debt + amount);
    }
    if (kind === 'inflow' || kind === 'expense' || kind === 'savings' || kind === 'debt') {
      const categoryId = transaction.categoryId || '__uncategorized';
      summary.categoryTotals[categoryId] = roundMoney(
        (summary.categoryTotals[categoryId] || 0) + amount
      );
    }
  });
  summary.outflow = roundMoney(summary.expense + summary.savings + summary.debt);
  summary.net = roundMoney(summary.income - summary.outflow);
  return summary;
}
