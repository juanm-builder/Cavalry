// Reporting preserves the established posted-flow classification used by schema-v2 workbooks.

import { roundMoney } from '../money.js';
import {
  createTransactionContributionReader,
  getTransactionContributions
} from './transaction-contributions.js';

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

function isTransactionWithinDateRange(transaction, start, end) {
  const date = normalizeDateKey(transaction && transaction.date);
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
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  return asArray(transactions).filter((transaction) => {
    return isTransactionWithinDateRange(transaction, start, end);
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
  return getTransactionContributions(workbook, transaction).flowKind;
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
  const readContribution = createTransactionContributionReader(workbook);
  return getTransactionsForDateRange(
    workbook && workbook.transactions ? workbook.transactions : [],
    range && range.start,
    range && range.end
  ).filter((transaction) => flowKindMatches(readContribution(transaction).flowKind, type));
}

export function getFlowBreakdown(workbook, transactions) {
  // Imported identifiers may also be Object prototype names.
  const categoryTotals = Object.create(null);
  const readContribution = createTransactionContributionReader(workbook);
  asArray(transactions).forEach((transaction) => {
    const contribution = readContribution(transaction);
    const categoryId = contribution.categoryId;
    categoryTotals[categoryId] = roundMoney(
      (categoryTotals[categoryId] || 0) + contribution.signedBaseAmount
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
  const readContribution = createTransactionContributionReader(workbook);
  return {
    transactions,
    rows: getFlowBreakdown(workbook, transactions),
    total: roundMoney(
      transactions.reduce((sum, transaction) => {
        return sum + readContribution(transaction).signedBaseAmount;
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
    categoryTotals: Object.create(null),
    transactions
  };
  const readContribution = createTransactionContributionReader(workbook);
  transactions.forEach((transaction) => {
    const contribution = readContribution(transaction);
    const kind = contribution.flowKind;
    const amount = contribution.signedBaseAmount;
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
      const categoryId = contribution.categoryId;
      summary.categoryTotals[categoryId] = roundMoney(
        (summary.categoryTotals[categoryId] || 0) + amount
      );
    }
  });
  summary.outflow = roundMoney(summary.expense + summary.savings + summary.debt);
  summary.net = roundMoney(summary.income - summary.outflow);
  summary.categoryTotals = { ...summary.categoryTotals };
  return summary;
}
