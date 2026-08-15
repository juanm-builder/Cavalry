// Locks down browser-safe, read-only budget route preparation before renderer wire-in.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildBudgetCategoryRowsViewModel,
  buildBudgetPeriodSummaryViewModel,
  buildBudgetPlanVsActualViewModel,
  buildBudgetRouteViewModel
} from '@cavalry/finance-core/application/budgets/budget-route-view-model-service.js';
import {
  cloneFixture,
  makeBasicSpendingWorkbook,
  makeIncomeAndExpenseWorkbook,
  makeLine,
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

function ids(rows) {
  return rows.map((row) => row.category.id);
}

describe('budget route view-model service', () => {
  it('builds empty budget route data for missing workbooks', () => {
    const model = buildBudgetRouteViewModel(null, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      currentDate: '2026-06-15'
    });

    expect(model.summary).toMatchObject({
      totalBudget: 0,
      plannedSpending: 0,
      committedSpending: 0,
      spent: 0,
      leftToSpend: 0,
      plannedSavings: 0,
      plannedDebt: 0,
      plannedIncome: 0,
      unallocated: 0,
      spentPercent: 0,
      dailyAverage: 0,
      periodDays: 30,
      daysElapsed: 15,
      remainingDays: 16,
      dailyBudget: 0,
      todaySpent: 0,
      remainingToday: 0,
      safeToSpendToday: 0,
      leftTone: 'good',
      leftCopy: 'You are under budget'
    });
    expect(model.periodSummary).toMatchObject({
      income: 0,
      expense: 0,
      savings: 0,
      debt: 0,
      outflow: 0,
      net: 0,
      categoryTotals: {},
      transactions: []
    });
    expect(model.categoryRows).toEqual([]);
    expect(model.spendingRows).toEqual([]);
  });

  it('builds planned category rows when a budget has no activity', () => {
    const workbook = makeBudgetWorkbook();
    workbook.transactions = [];
    const rows = buildBudgetCategoryRowsViewModel(workbook, {
      start: '2026-06-01',
      end: '2026-06-30'
    });

    expect(ids(rows)).toEqual(['missing-category', 'archived-shopping', 'subscriptions', 'food']);
    expect(rows.find((row) => row.category.id === 'missing-category')).toMatchObject({
      planned: 50,
      trustedPlanned: 0,
      actual: 0,
      isMissing: true,
      includedInPlanTotals: false
    });
    expect(rows.find((row) => row.category.id === 'archived-shopping')).toMatchObject({
      planned: 100,
      trustedPlanned: 0,
      actual: 0,
      isArchived: true,
      includedInPlanTotals: false
    });
    expect(rows.find((row) => row.category.id === 'subscriptions')).toMatchObject({
      planned: 600,
      actual: 0,
      remaining: 600,
      percent: 0,
      progressPercent: 0
    });
    expect(rows.find((row) => row.category.id === 'food')).toMatchObject({
      planned: 200,
      actual: 0,
      remaining: 200
    });
  });

  it('summarizes budget plan, actual activity, and route stat copy', () => {
    const workbook = makeIncomeBudgetWorkbook();
    const model = buildBudgetRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      currentDate: '2026-06-15'
    });

    expect(model.planVsActual).toMatchObject({
      plannedByType: {
        income: 0,
        expense: 800,
        savings: 0,
        debt: 0
      },
      plannedOutflow: 800,
      plannedNet: -800,
      actualNet: 47971,
      variance: 48771
    });
    expect(model.periodSummary).toMatchObject({
      income: 50000,
      expense: 2029,
      outflow: 2029,
      net: 47971
    });
    expect(model.summary).toMatchObject({
      totalBudget: 800,
      plannedSpending: 800,
      committedSpending: 0,
      spent: 2029,
      leftToSpend: -1229,
      spentPercent: 254,
      plannedOutflow: 800,
      income: 50000,
      incomePlanBasis: 50000,
      unallocated: 49200,
      dailyAverage: 135.27,
      periodDays: 30,
      daysElapsed: 15,
      remainingDays: 16,
      dailyBudget: 26.67,
      todaySpent: 0,
      remainingToday: 26.67,
      safeToSpendToday: 0,
      leftTone: 'bad',
      leftCopy: 'You are over budget'
    });
  });

  it('derives active, upcoming, and completed period timing and daily spending metrics', () => {
    const workbook = makeBudgetWorkbook();

    const active = buildBudgetRouteViewModel(workbook, {
      range: { start: '2026-06-01', end: '2026-06-30' },
      currentDate: '2026-06-02'
    });
    expect(active.summary).toMatchObject({
      periodDays: 30,
      daysElapsed: 2,
      remainingDays: 29,
      dailyBudget: 26.67,
      todaySpent: 80,
      remainingToday: -53.33,
      safeToSpendToday: 0
    });

    workbook.transactions = [];
    const underBudget = buildBudgetRouteViewModel(workbook, {
      range: { start: '2026-06-01', end: '2026-06-30' },
      currentDate: '2026-06-15'
    });
    expect(underBudget.summary).toMatchObject({
      daysElapsed: 15,
      remainingDays: 16,
      dailyBudget: 26.67,
      todaySpent: 0,
      remainingToday: 26.67,
      safeToSpendToday: 50
    });

    const upcoming = buildBudgetRouteViewModel(workbook, {
      range: { start: '2026-06-01', end: '2026-06-30' },
      currentDate: '2026-05-31'
    });
    expect(upcoming.summary).toMatchObject({
      daysElapsed: 0,
      remainingDays: 30,
      todaySpent: 0,
      remainingToday: 0,
      safeToSpendToday: 0
    });

    const completed = buildBudgetRouteViewModel(workbook, {
      range: { start: '2026-06-01', end: '2026-06-30' },
      currentDate: '2026-07-01'
    });
    expect(completed.summary).toMatchObject({
      daysElapsed: 30,
      remainingDays: 0,
      todaySpent: 0,
      remainingToday: 0,
      safeToSpendToday: 0
    });
  });

  it('uses exact actual dates and excludes a full-month plan from a partial-month range', () => {
    const workbook = makeBudgetWorkbook();
    const planVsActual = buildBudgetPlanVsActualViewModel(workbook, {
      start: '2026-06-02',
      end: '2026-06-03'
    });

    expect(planVsActual.actual).toMatchObject({
      income: 0,
      expense: 1280,
      outflow: 1280,
      net: -1280
    });
    expect(planVsActual.actual.transactions.map((transaction) => transaction.id)).toEqual([
      'txn-transport-cash',
      'txn-card-shopping'
    ]);
    expect(planVsActual.plannedByType.expense).toBe(0);
    expect(planVsActual.planScope).toEqual({
      includedMonthKeys: [],
      excludedPartialMonthKeys: ['2026-06']
    });
    expect(planVsActual.attention).toEqual([
      expect.objectContaining({ code: 'partial_month_plan_excluded', monthKey: '2026-06' })
    ]);
  });

  it('orders category rows with overspent categories first, then largest activity or plan', () => {
    const workbook = makeBudgetWorkbook();
    const rows = buildBudgetCategoryRowsViewModel(workbook, {
      start: '2026-06-02',
      end: '2026-06-03'
    });

    expect(ids(rows)).toEqual(['shopping', 'transport']);
    expect(rows.find((row) => row.category.id === 'shopping')).toMatchObject({
      planned: 0,
      actual: 1200,
      remaining: -1200,
      percent: 100,
      progressPercent: 100
    });
  });

  it('surfaces missing and archived category plans for repair but excludes them from trusted totals', () => {
    const workbook = makeBudgetWorkbook();
    workbook.transactions.push(
      makeTransaction({
        id: 'txn-archived-shopping',
        date: '2026-06-05',
        template: 'expense_paid',
        description: 'Old category spend',
        categoryId: 'archived-shopping',
        amount: 75,
        lines: [makeLine('shopping-expense', 'debit', 75), makeLine('cash', 'credit', 75)]
      })
    );

    const model = buildBudgetRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      currentDate: '2026-06-15'
    });

    expect(model.planVsActual.plannedByCategory['archived-shopping']).toBe(100);
    expect(model.planVsActual.plannedByCategory['missing-category']).toBe(50);
    expect(model.planVsActual.trustedPlannedByCategory).toEqual({
      food: 200,
      subscriptions: 600
    });
    expect(model.summary.totalBudget).toBe(800);
    expect(model.categoryRows.find((row) => row.category.id === 'archived-shopping')).toMatchObject(
      {
        planned: 100,
        actual: 75,
        isArchived: true,
        includedInPlanTotals: false
      }
    );
    expect(model.categoryRows.find((row) => row.category.id === 'missing-category')).toMatchObject({
      planned: 50,
      isMissing: true,
      includedInPlanTotals: false
    });
    expect(model.spendingRows.find((row) => row.category.id === 'archived-shopping')).toMatchObject(
      {
        total: 75
      }
    );
  });

  it('keeps activity from retired accounts in existing ledger-derived actuals', () => {
    const workbook = makeBudgetWorkbook();
    workbook.accounts.find((account) => account.id === 'cash').isActive = false;
    const summary = buildBudgetPeriodSummaryViewModel(workbook, {
      start: '2026-06-01',
      end: '2026-06-30'
    });

    expect(summary.expense).toBe(2029);
    expect(summary.categoryTotals).toMatchObject({
      food: 250,
      transport: 80,
      shopping: 1200,
      subscriptions: 499
    });
  });

  it('does not mutate workbook input or leak mutable row and transaction references', () => {
    const workbook = makeBudgetWorkbook();
    const before = cloneFixture(workbook);
    const model = buildBudgetRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      },
      currentDate: '2026-06-15'
    });

    model.categoryRows[0].category.name = 'Mutated category';
    model.periodSummary.transactions[0].amount = 999;

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
        new URL('../../src/application/budgets/budget-route-view-model-service.js', import.meta.url)
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
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|OpenAI|provider|model)\b/);
  });
});
