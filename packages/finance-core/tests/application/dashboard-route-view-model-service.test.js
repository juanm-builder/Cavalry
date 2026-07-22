// Locks down browser-safe, read-only dashboard route preparation before renderer wire-in.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildDashboardBudgetSummaryViewModel,
  buildDashboardRouteViewModel,
  buildDashboardSpendingSummaryViewModel,
  buildDashboardStatCardsViewModel
} from '@cavalry/finance-core/application/dashboard/dashboard-route-view-model-service.js';
import {
  cloneFixture,
  makeBasicSpendingWorkbook,
  makeIncomeAndExpenseWorkbook,
  makeLine,
  makeMinimalWorkbook,
  makeTransaction
} from '../fixtures/core-workbook-fixtures.js';

function makeBudgetWorkbook() {
  const workbook = cloneFixture(makeBasicSpendingWorkbook());
  workbook.sheets = [
    {
      id: 'sheet-june',
      name: 'June',
      monthIndex: 5,
      budgets: [
        { categoryId: 'food', planned: 200 },
        { categoryId: 'subscriptions', planned: 600 },
        { categoryId: 'archived-shopping', planned: 100 },
        { categoryId: 'missing-category', planned: 50 }
      ],
      budgetLineItems: []
    }
  ];
  return workbook;
}

function makeIncomeBudgetWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.sheets = makeBudgetWorkbook().sheets;
  return workbook;
}

function categoryIds(rows) {
  return rows.map((row) => row.category.id);
}

describe('dashboard route view-model service', () => {
  it('builds empty dashboard route data for missing workbooks', () => {
    const model = buildDashboardRouteViewModel(null, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      asOfDate: '2026-06-30',
      currentDate: '2026-06-15'
    });

    expect(model.period).toEqual({
      income: 0,
      expense: 0,
      net: 0
    });
    expect(model.money).toMatchObject({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      balances: {},
      balanceAccounts: [],
      assetAccountRows: [],
      liabilityAccountRows: []
    });
    expect(model.recentTransactions).toEqual([]);
    expect(model.monthlyFlow.rows).toEqual([]);
    expect(model.spendingSummary.rows).toEqual([]);
    expect(model.budgetSummary.rows).toEqual([]);
  });

  it('builds budget rows for a plan with no activity', () => {
    const workbook = makeBudgetWorkbook();
    workbook.transactions = [];
    const budget = buildDashboardBudgetSummaryViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      currentDate: '2026-06-15'
    });

    expect(categoryIds(budget.rows)).toEqual(['subscriptions', 'food']);
    expect(budget.summary).toMatchObject({
      totalBudget: 900,
      spent: 0,
      leftToSpend: 900,
      spentPercent: 0
    });
    expect(budget.rows[0]).toMatchObject({
      planned: 600,
      actual: 0,
      remaining: 600
    });
  });

  it('summarizes dashboard stat cards from income, expense activity, and balances', () => {
    const workbook = makeIncomeBudgetWorkbook();
    const stats = buildDashboardStatCardsViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      asOfDate: '2026-06-30'
    });

    expect(stats.period).toEqual({
      income: 50000,
      expense: 2029,
      outflow: 2029,
      net: 47971
    });
    expect(stats.money).toEqual({
      totalAssets: 49501,
      totalLiabilities: 1200,
      netWorth: 48301
    });
    expect(stats.cards.map((card) => card.label)).toEqual([
      'Net Worth',
      'Total Inflows',
      'Total Outflows',
      'Net Flow'
    ]);
  });

  it('uses canonical current-rate valuation for foreign balances at the requested as-of date', () => {
    const workbook = makeMinimalWorkbook();
    workbook.settings.usdToBaseRate = 61.75;
    workbook.accounts.push({
      id: 'usd-account',
      name: 'USD Account',
      group: 'asset',
      subtype: 'bank',
      currency: 'USD',
      isActive: true
    });
    workbook.transactions.push(
      makeTransaction({
        id: 'txn-usd-opening',
        date: '2026-07-01',
        template: 'opening_balance',
        amount: 252.15,
        baseAmount: 252.15,
        originalCurrency: 'USD',
        lines: [
          {
            id: 'line-usd-opening',
            accountId: 'usd-account',
            direction: 'debit',
            amount: 252.15,
            currency: 'USD',
            baseAmount: 252.15
          },
          {
            id: 'line-usd-equity',
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 252.15,
            currency: 'USD',
            baseAmount: 252.15
          }
        ]
      }),
      makeTransaction({
        id: 'txn-usd-future',
        date: '2026-07-13',
        template: 'opening_balance',
        amount: 10,
        baseAmount: 10,
        originalCurrency: 'USD',
        lines: [
          {
            id: 'line-usd-future',
            accountId: 'usd-account',
            direction: 'debit',
            amount: 10,
            currency: 'USD',
            baseAmount: 10
          },
          {
            id: 'line-usd-future-equity',
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 10,
            currency: 'USD',
            baseAmount: 10
          }
        ]
      })
    );

    const model = buildDashboardRouteViewModel(workbook, {
      range: { start: '2026-01-01', end: '2026-07-12' },
      asOfDate: '2026-07-12',
      currentDate: '2026-07-12'
    });

    expect(model.money.balances['usd-account']).toBe(15570.26);
    expect(model.money).toMatchObject({
      totalAssets: 15570.26,
      totalLiabilities: 0,
      netWorth: 15570.26
    });
    expect(model.stats.money.netWorth).toBe(model.money.netWorth);
  });

  it('uses historical book value when mixed account history makes current-rate valuation unsafe', () => {
    const workbook = makeMinimalWorkbook();
    workbook.settings.usdToBaseRate = 61.75;
    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';
    workbook.transactions.push(
      makeTransaction({
        id: 'txn-prior-cash',
        date: '2026-07-01',
        template: 'opening_balance',
        amount: 112,
        baseAmount: 112,
        lines: [
          {
            id: 'line-prior-cash',
            accountId: 'cash',
            direction: 'debit',
            amount: 112,
            currency: 'PHP',
            baseAmount: 112
          },
          {
            id: 'line-prior-equity',
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 112,
            currency: 'PHP',
            baseAmount: 112
          }
        ]
      }),
      makeTransaction({
        id: 'txn-found-cash',
        date: '2026-07-15',
        template: 'opening_balance',
        amount: 20,
        baseAmount: 20,
        lines: [
          {
            id: 'line-found-cash',
            accountId: 'cash',
            direction: 'debit',
            amount: 0.32,
            currency: 'USD',
            baseAmount: 20
          },
          {
            id: 'line-found-equity',
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 20,
            currency: 'PHP',
            baseAmount: 20
          }
        ]
      })
    );

    const model = buildDashboardRouteViewModel(workbook, {
      range: { start: '2026-01-01', end: '2026-07-15' },
      asOfDate: '2026-07-15',
      currentDate: '2026-07-15'
    });

    expect(model.money.balances.cash).toBe(132);
    expect(model.money).toMatchObject({
      totalAssets: 132,
      totalLiabilities: 0,
      netWorth: 132
    });
    expect(model.stats.money.netWorth).toBe(132);
  });

  it('builds dashboard spending rows with current route ordering', () => {
    const workbook = makeIncomeBudgetWorkbook();
    const spending = buildDashboardSpendingSummaryViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      currentDate: '2026-06-15'
    });

    expect(categoryIds(spending.rows)).toEqual(['shopping', 'subscriptions', 'food', 'transport']);
    expect(spending.rows.map((row) => row.total)).toEqual([1200, 499, 250, 80]);
    expect(spending.total).toBe(2029);
  });

  it('keeps date range filtering and monthly flow clipping used by the dashboard', () => {
    const workbook = makeIncomeBudgetWorkbook();
    const model = buildDashboardRouteViewModel(workbook, {
      range: {
        start: '2026-06-02',
        end: '2026-06-03'
      },
      asOfDate: '2026-06-03',
      currentDate: '2026-06-15'
    });

    expect(model.period).toEqual({
      income: 0,
      expense: 1280,
      net: -1280
    });
    expect(model.recentTransactions.map((transaction) => transaction.id)).toEqual([
      'txn-card-shopping',
      'txn-transport-cash'
    ]);
    expect(model.monthlyFlow.rows).toHaveLength(1);
    expect(model.monthlyFlow.rows[0]).toMatchObject({
      monthKey: '2026-06',
      range: {
        start: '2026-06-02',
        end: '2026-06-03'
      },
      totals: {
        income: 0,
        outflow: 1280,
        actualNet: -1280
      }
    });
  });

  it('preserves dashboard spending month preset behavior', () => {
    const workbook = makeIncomeBudgetWorkbook();
    const spending = buildDashboardSpendingSummaryViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      spendingPreset: 'last_3_months',
      currentDate: '2026-06-15'
    });
    const custom = buildDashboardSpendingSummaryViewModel(workbook, {
      spendingPreset: 'custom',
      spendingStartMonth: '2026-06',
      spendingEndMonth: '2026-04',
      currentDate: '2026-06-15'
    });

    expect(spending.monthRange).toEqual({
      preset: 'last_3_months',
      startMonth: '2026-04',
      endMonth: '2026-06'
    });
    expect(spending.monthReport).toMatchObject({
      total: 2029,
      transactionCount: 4
    });
    expect(custom.monthRange).toEqual({
      preset: 'custom',
      startMonth: '2026-04',
      endMonth: '2026-06'
    });
  });

  it('preserves missing and archived category handling on dashboard summaries', () => {
    const workbook = makeBudgetWorkbook();
    workbook.transactions.push(
      makeTransaction({
        id: 'txn-missing-dashboard-category',
        date: '2026-06-05',
        template: 'expense_paid',
        description: 'Missing category spend',
        categoryId: 'missing-category',
        amount: 30,
        lines: [makeLine('shopping-expense', 'debit', 30), makeLine('cash', 'credit', 30)]
      }),
      makeTransaction({
        id: 'txn-archived-dashboard-category',
        date: '2026-06-06',
        template: 'expense_paid',
        description: 'Archived category spend',
        categoryId: 'archived-shopping',
        amount: 75,
        lines: [makeLine('shopping-expense', 'debit', 75), makeLine('cash', 'credit', 75)]
      })
    );

    const model = buildDashboardRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      asOfDate: '2026-06-30',
      currentDate: '2026-06-15'
    });

    expect(model.periodSummary.categoryTotals['missing-category']).toBe(30);
    expect(categoryIds(model.spendingSummary.rows)).toContain('archived-shopping');
    expect(categoryIds(model.spendingSummary.rows)).not.toContain('missing-category');
    expect(model.spendingSummary.monthReport.categoryTotals['missing-category']).toBeUndefined();
    expect(categoryIds(model.budgetSummary.rows)).not.toContain('archived-shopping');
  });

  it('keeps actuals from retired accounts while dashboard account rows stay active-only', () => {
    const workbook = makeIncomeBudgetWorkbook();
    workbook.accounts.find((account) => account.id === 'cash').isActive = false;
    const model = buildDashboardRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      asOfDate: '2026-06-30',
      currentDate: '2026-06-15'
    });

    expect(model.period.expense).toBe(2029);
    expect(model.money.balanceAccounts.map((account) => account.id)).not.toContain('cash');
  });

  it('does not mutate workbook input or leak mutable row, account, and transaction references', () => {
    const workbook = makeIncomeBudgetWorkbook();
    const before = cloneFixture(workbook);
    const model = buildDashboardRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      asOfDate: '2026-06-30',
      currentDate: '2026-06-15'
    });

    model.spendingSummary.rows[0].category.name = 'Mutated category';
    model.money.balanceAccounts[0].name = 'Mutated account';
    model.recentTransactions[0].amount = 999;

    expect(workbook).toEqual(before);
  });

  it('stays free of direct Node, Electron, DOM, provider, and IPC access', () => {
    const nodeOrElectronImportPattern = [
      'node:',
      'fs',
      'child_process',
      'crypto',
      'net',
      'tls',
      'http',
      'https',
      'electron'
    ].join('|');
    const source = readFileSync(
      fileURLToPath(
        new URL(
          '../../src/application/dashboard/dashboard-route-view-model-service.js',
          import.meta.url
        )
      ),
      'utf8'
    );

    expect(source).not.toMatch(/\b(?:window|document|ipcRenderer|contextBridge|BrowserWindow)\b/);
    expect(source).not.toMatch(
      new RegExp('\\b(?:require|import)\\(\\s*[\'"](?:' + nodeOrElectronImportPattern + ')')
    );
    expect(source).not.toMatch(
      new RegExp('\\bfrom\\s+[\'"](?:' + nodeOrElectronImportPattern + ')')
    );
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|OpenAI|provider)\b/);
  });
});
