import {
  buildBudgetSummary,
  buildIncomeExpenseBreakdown,
  buildRecurringItemRows,
  buildTransactionTableView,
  getAccountBalances,
  getAssetLiabilityTotalsAsOf
} from '@cavalry/finance-core';

import { accountBalanceProjection } from './cavalry-assistant-tool-presenters.js';

export const CAVALRY_ASSISTANT_SNAPSHOT_MAX_CHARS = 4500;

const ACCOUNT_LIMIT = 24;
const TOP_CATEGORY_LIMIT = 6;
const BUDGET_LINE_LIMIT = 6;
const UPCOMING_BILL_LIMIT = 5;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function quietly(build) {
  try {
    return build();
  } catch (_error) {
    return null;
  }
}

function isoMonthRange(today) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asText(today));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!(year > 0 && month >= 1 && month <= 12)) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthPart = String(month).padStart(2, '0');
  return {
    start: `${year}-${monthPart}-01`,
    end: `${year}-${monthPart}-${String(lastDay).padStart(2, '0')}`
  };
}

function positionSection(workbook, today) {
  const totals = getAssetLiabilityTotalsAsOf(workbook, asText(today));
  return {
    assets: round2(totals.assets),
    liabilities: round2(totals.liabilities),
    netWorth: round2(totals.netWorth)
  };
}

function accountsSection(workbook, limit) {
  const balances = getAccountBalances(workbook, {});
  const baseCurrency = asText(workbook.currency).toUpperCase();
  const rows = asArray(workbook.accounts)
    .filter((account) => account && account.isActive !== false)
    .map((account) => {
      const projection = accountBalanceProjection(account, workbook, balances);
      const row = {
        name: asText(account.name),
        group: asText(account.group),
        currency: projection.currency,
        balance: round2(projection.balance)
      };
      if (projection.currency && projection.currency !== baseCurrency) {
        row.baseBalance = round2(projection.baseBalance);
      }
      return row;
    })
    .sort(
      (left, right) =>
        Math.abs(right.baseBalance ?? right.balance) - Math.abs(left.baseBalance ?? left.balance)
    );
  return {
    rows: rows.slice(0, limit),
    omittedCount: Math.max(0, rows.length - limit)
  };
}

function monthSection(workbook, range) {
  if (!range) return null;
  const flow = buildIncomeExpenseBreakdown(workbook, { start: range.start, end: range.end });
  return {
    range,
    income: round2(flow.income),
    expense: round2(flow.expense),
    net: round2(flow.net)
  };
}

function topCategoriesSection(workbook, range, limit) {
  if (!range) return null;
  const view = buildTransactionTableView(workbook, {
    type: 'expense',
    start: range.start,
    end: range.end,
    page: 1,
    pageSize: 1
  });
  const groups = new Map();
  view.allRows
    .filter((row) => row.hasMissingReference !== true && row.contributions?.resolved !== false)
    .forEach((row) => {
      const label = asText(row.categoryLabel) || 'Uncategorized';
      const group = groups.get(label) || { category: label, total: 0, transactionCount: 0 };
      const signedAmount = Number(row.signedBaseAmount);
      group.total = round2(
        group.total + (Number.isFinite(signedAmount) ? signedAmount : Number(row.baseAmount) || 0)
      );
      group.transactionCount += 1;
      groups.set(label, group);
    });
  return Array.from(groups.values())
    .sort((left, right) => right.total - left.total)
    .slice(0, limit);
}

function budgetsSection(workbook, today, limit) {
  const sheets = asArray(workbook.sheets);
  if (!sheets.length) return null;
  const monthKey = asText(today).slice(0, 7);
  const summaries = sheets.map((sheet) => buildBudgetSummary(workbook, sheet));
  const summary =
    summaries.find((candidate) => asText(candidate.monthKey) === monthKey) ||
    summaries[summaries.length - 1];
  if (!summary) return null;
  const lines = asArray(summary.rows)
    .filter((row) => row.planned > 0 && row.categoryType !== 'income' && !row.isArchived)
    .map((row) => ({
      category: row.categoryName,
      planned: round2(row.planned),
      actual: round2(row.actual),
      remaining: round2(row.remaining)
    }))
    .sort((left, right) => right.actual / (right.planned || 1) - left.actual / (left.planned || 1));
  return {
    monthKey: asText(summary.monthKey),
    rows: lines.slice(0, limit),
    omittedCount: Math.max(0, lines.length - limit)
  };
}

function upcomingBillsSection(workbook, today, limit) {
  const asOfDate = asText(today);
  return buildRecurringItemRows(workbook, { asOfDate })
    .filter(
      (row) =>
        row.isActive !== false && asText(row.nextExpectedDate) && row.nextExpectedDate >= asOfDate
    )
    .sort((left, right) => asText(left.nextExpectedDate).localeCompare(right.nextExpectedDate))
    .slice(0, limit)
    .map((row) => ({
      name: row.name,
      amount: round2(row.amount),
      currency: row.currency,
      nextExpectedDate: row.nextExpectedDate
    }));
}

function countsSection(workbook) {
  return {
    transactions: asArray(workbook.transactions).length,
    accounts: asArray(workbook.accounts).length,
    categories: asArray(workbook.categories).length,
    recurringItems: asArray(workbook.recurringItems).length,
    counterparties: asArray(workbook.counterparties).length,
    budgetSheets: asArray(workbook.sheets).length
  };
}

function serialized(snapshot) {
  try {
    return JSON.stringify(snapshot);
  } catch (_error) {
    return '';
  }
}

export function buildCavalryAssistantWorkspaceSnapshot(workbook, { today } = {}) {
  if (!workbook || typeof workbook !== 'object') return null;
  const range = quietly(() => isoMonthRange(today));
  const snapshot = {
    workbook: {
      name: asText(workbook.name),
      year: Number(workbook.year) || 0,
      currency: asText(workbook.currency).toUpperCase()
    },
    asOf: asText(today)
  };
  const position = quietly(() => positionSection(workbook, today));
  if (position) snapshot.position = position;
  const accounts = quietly(() => accountsSection(workbook, ACCOUNT_LIMIT));
  if (accounts && accounts.rows.length) snapshot.accounts = accounts;
  const month = quietly(() => monthSection(workbook, range));
  if (month) snapshot.thisMonth = month;
  const topCategories = quietly(() => topCategoriesSection(workbook, range, TOP_CATEGORY_LIMIT));
  if (topCategories && topCategories.length) {
    snapshot.thisMonth = snapshot.thisMonth || {};
    snapshot.thisMonth.topExpenseCategories = topCategories;
  }
  const budgets = quietly(() => budgetsSection(workbook, today, BUDGET_LINE_LIMIT));
  if (budgets && budgets.rows.length) snapshot.budgets = budgets;
  const upcomingBills = quietly(() => upcomingBillsSection(workbook, today, UPCOMING_BILL_LIMIT));
  if (upcomingBills && upcomingBills.length) snapshot.upcomingBills = upcomingBills;
  const counts = quietly(() => countsSection(workbook));
  if (counts) snapshot.counts = counts;

  const reducers = [
    () => {
      if (snapshot.accounts && snapshot.accounts.rows.length > 12) {
        snapshot.accounts.omittedCount += snapshot.accounts.rows.length - 12;
        snapshot.accounts.rows = snapshot.accounts.rows.slice(0, 12);
        return true;
      }
      return false;
    },
    () => {
      if (snapshot.thisMonth && asArray(snapshot.thisMonth.topExpenseCategories).length > 3) {
        snapshot.thisMonth.topExpenseCategories = snapshot.thisMonth.topExpenseCategories.slice(
          0,
          3
        );
        return true;
      }
      return false;
    },
    () => {
      if (snapshot.budgets) {
        delete snapshot.budgets;
        return true;
      }
      return false;
    },
    () => {
      if (snapshot.upcomingBills) {
        delete snapshot.upcomingBills;
        return true;
      }
      return false;
    },
    () => {
      if (snapshot.accounts && snapshot.accounts.rows.length > 8) {
        snapshot.accounts.omittedCount += snapshot.accounts.rows.length - 8;
        snapshot.accounts.rows = snapshot.accounts.rows.slice(0, 8);
        return true;
      }
      return false;
    }
  ];
  let json = serialized(snapshot);
  let reducerIndex = 0;
  while (json.length > CAVALRY_ASSISTANT_SNAPSHOT_MAX_CHARS && reducerIndex < reducers.length) {
    if (reducers[reducerIndex]()) json = serialized(snapshot);
    reducerIndex += 1;
  }
  if (!json || json === '{}') return null;
  return { snapshot, json };
}
