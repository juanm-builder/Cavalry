// Locks down browser-safe, read-only report route preparation before renderer wire-in.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildReportsCashFlowViewModel,
  buildReportsCategoryBreakdownViewModel,
  buildReportsPeriodSummaryViewModel,
  buildReportsRouteViewModel
} from '@cavalry/finance-core/application/reports/reports-route-view-model-service.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeRefundWorkbook
} from '../fixtures/core-workbook-fixtures.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

function categoryIds(viewModel) {
  return viewModel.rows.map((row) => row.categoryId);
}

describe('reports route view-model service', () => {
  it('builds empty report route data for missing workbooks', () => {
    const model = buildReportsRouteViewModel(null, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

    expect(model.currency).toBe('PHP');
    expect(model.periodSummary).toMatchObject({
      income: 0,
      expense: 0,
      savings: 0,
      debt: 0,
      outflow: 0,
      net: 0,
      transactionCount: 0,
      categoryTotals: {}
    });
    expect(model.categoryBreakdown.rows).toEqual([]);
    expect(model.cashFlow.months).toEqual([]);
    expect(model.accountBalanceSummary.accounts).toEqual([]);
  });

  it('summarizes income, expenses, and net flow for a date range', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const summary = buildReportsPeriodSummaryViewModel(workbook, {
      start: '2026-06-01',
      end: '2026-06-30'
    });

    expect(summary).toMatchObject({
      currency: 'PHP',
      income: 50000,
      expense: 2029,
      savings: 0,
      debt: 0,
      outflow: 2029,
      net: 47971,
      transactionCount: 5
    });
    expect(summary.categoryTotals).toMatchObject({
      salary: 50000,
      food: 250,
      transport: 80,
      shopping: 1200,
      subscriptions: 499
    });
  });

  it('preserves existing date-range filtering behavior', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const summary = buildReportsPeriodSummaryViewModel(workbook, {
      start: '2026-06-02',
      end: '2026-06-03'
    });

    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(1280);
    expect(summary.net).toBe(-1280);
    expect(summary.transactions.map((transaction) => transaction.id)).toEqual([
      'txn-transport-cash',
      'txn-card-shopping'
    ]);
  });

  it('builds category breakdown rows using existing report ordering', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const breakdown = buildReportsCategoryBreakdownViewModel(workbook, {
      startMonth: '2026-06',
      endMonth: '2026-06'
    });

    expect(breakdown.total).toBe(2029);
    expect(categoryIds(breakdown)).toEqual(['shopping', 'subscriptions', 'food', 'transport']);
    expect(breakdown.categoryTotals).toMatchObject({
      shopping: 1200,
      subscriptions: 499,
      food: 250,
      transport: 80
    });
  });

  it('builds monthly cash-flow rows through the existing reporting helper', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const cashFlow = buildReportsCashFlowViewModel(workbook, {
      start: '2026-06-01',
      end: '2026-06-30'
    });

    expect(cashFlow.summary).toMatchObject({
      income: 50000,
      expense: 2029,
      outflow: 2029,
      net: 47971
    });
    expect(cashFlow.months).toHaveLength(1);
    expect(cashFlow.months[0]).toMatchObject({
      monthKey: '2026-06',
      income: 50000,
      expense: 2029,
      net: 47971
    });
  });

  it('carries net refund spending through report route view models', () => {
    const model = buildReportsRouteViewModel(makeRefundWorkbook(), {
      range: { start: '2026-06-01', end: '2026-06-30' }
    });

    expect(model.periodSummary).toMatchObject({ expense: 1979, outflow: 1979, net: -1979 });
    expect(model.categoryBreakdown).toMatchObject({ total: 1979, transactionCount: 5 });
    expect(model.categoryBreakdown.categoryTotals.food).toBe(200);
    expect(model.cashFlow.summary).toMatchObject({ expense: 1979, outflow: 1979, net: -1979 });
    expect(model.cashFlow.limitations).not.toContain('refunds_are_not_separately_modeled');
  });

  it('keeps archived and missing report references visible where existing helpers do', () => {
    const workbook = makeTransactionTableWorkbook();
    const model = buildReportsRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

    expect(
      model.categoryBreakdown.rows.find((row) => row.categoryId === 'archived-shopping')
    ).toMatchObject({ isArchived: true });
    expect(
      model.categoryBreakdown.rows.find((row) => row.categoryId === 'missing-category')
    ).toMatchObject({ isMissing: true });
    expect(model.categoryBreakdown.limitations).toContain('missing_category_references');
    expect(
      model.accountBalanceSummary.accounts.find((account) => account.accountId === 'wallet-usd')
    ).toMatchObject({ isArchived: true });
    expect(model.accountBalanceSummary.missingAccountIds).toEqual(['missing-account']);
  });

  it('does not mutate workbook input or leak mutable transaction references', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const before = cloneFixture(workbook);
    const model = buildReportsRouteViewModel(workbook, {
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

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
        new URL(
          '../../src/application/reports/reports-route-view-model-service.js',
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
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|OpenAI|provider|model)\b/);
  });
});
