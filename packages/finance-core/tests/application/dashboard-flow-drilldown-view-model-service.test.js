// Locks down browser-safe, read-only dashboard flow modal preparation before renderer wire-in.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildDashboardFlowDrilldownRows,
  buildDashboardFlowDrilldownSummary,
  buildDashboardFlowDrilldownViewModel
} from '@cavalry/finance-core/application/dashboard/dashboard-flow-drilldown-view-model-service.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeLine,
  makeMinimalWorkbook,
  makeTransaction
} from '../fixtures/core-workbook-fixtures.js';

function makeFlowWorkbook() {
  return cloneFixture(makeIncomeAndExpenseWorkbook());
}

function addTransaction(workbook, overrides) {
  const transaction = makeTransaction(overrides);
  workbook.transactions.push(transaction);
  return transaction;
}

function addSavingsCategory(workbook) {
  workbook.accounts.push({
    id: 'emergency-fund-asset',
    name: 'Emergency Fund',
    group: 'asset',
    currency: 'PHP',
    isActive: true
  });
  workbook.categories.push({
    id: 'emergency-fund',
    name: 'Emergency Fund',
    type: 'savings',
    currency: 'PHP',
    linkedAccountId: 'emergency-fund-asset',
    isActive: true
  });
}

describe('dashboard flow drilldown view-model service', () => {
  it('defaults missing or unknown flow types to the existing outflow modal behavior', () => {
    const model = buildDashboardFlowDrilldownViewModel(makeFlowWorkbook(), {
      flowType: 'unknown-flow',
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

    expect(model).toMatchObject({
      flowType: 'outflow',
      title: 'Outflows',
      tone: 'bad',
      rangeLabel: 'June 1 - 30, 2026'
    });
    expect(model.summary).toMatchObject({
      total: 2029,
      totalInflow: 0,
      totalOutflow: 2029,
      transactionCount: 4,
      categoryCount: 4
    });
  });

  it('builds empty flow drilldown data for an empty workbook', () => {
    const model = buildDashboardFlowDrilldownViewModel(makeMinimalWorkbook(), {
      flowType: 'expense',
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

    expect(model.rows).toEqual([]);
    expect(model.tableRows).toEqual([]);
    expect(model.categoryRows).toEqual([]);
    expect(model.summary).toMatchObject({
      total: 0,
      transactionCount: 0,
      categoryCount: 0
    });
  });

  it('returns no activity for supported flows with no selected-period rows', () => {
    const model = buildDashboardFlowDrilldownViewModel(makeFlowWorkbook(), {
      flowType: 'debt',
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

    expect(model).toMatchObject({
      flowType: 'debt',
      title: 'Debt Payments',
      tone: 'bad'
    });
    expect(model.rows).toEqual([]);
    expect(model.summary.total).toBe(0);
  });

  it('builds income flow rows, category bars, total, label, and row tone', () => {
    const model = buildDashboardFlowDrilldownViewModel(makeFlowWorkbook(), {
      flowType: 'inflow',
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

    expect(model).toMatchObject({
      flowType: 'inflow',
      title: 'Inflows',
      tone: 'good',
      rangeLabel: 'June 1 - 30, 2026'
    });
    expect(model.summary).toMatchObject({
      total: 50000,
      totalInflow: 50000,
      totalOutflow: 0,
      transactionCount: 1,
      categoryCount: 1
    });
    expect(model.rows[0]).toMatchObject({
      transactionId: 'txn-salary',
      categoryName: 'Salary',
      templateLabel: 'Income Received',
      amount: 50000,
      baseAmount: 50000,
      flowKind: 'inflow',
      tone: 'good'
    });
    expect(model.categoryRows[0]).toMatchObject({
      id: 'salary',
      name: 'Salary',
      type: 'income',
      typeLabel: 'Income',
      total: 50000,
      width: 100,
      tone: 'good'
    });
  });

  it('builds expense flow rows with existing row ordering and category ordering', () => {
    const model = buildDashboardFlowDrilldownViewModel(makeFlowWorkbook(), {
      flowType: 'expense',
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });

    expect(model.summary).toMatchObject({
      total: 2029,
      totalOutflow: 2029,
      transactionCount: 4
    });
    expect(model.rows.map((row) => row.transactionId)).toEqual([
      'txn-subscription',
      'txn-card-shopping',
      'txn-transport-cash',
      'txn-food-cash'
    ]);
    expect(model.categoryRows.map((row) => row.id)).toEqual([
      'shopping',
      'subscriptions',
      'food',
      'transport'
    ]);
    expect(model.rows[0]).toMatchObject({
      categoryName: 'Subscriptions',
      templateLabel: 'Expense Paid',
      flowKind: 'expense',
      tone: 'bad'
    });
  });

  it('supports savings and debt flows while transfers remain excluded from flow totals', () => {
    const workbook = makeFlowWorkbook();
    addSavingsCategory(workbook);
    addTransaction(workbook, {
      id: 'txn-emergency-savings',
      date: '2026-06-05',
      template: 'expense_paid',
      description: 'Move to emergency fund',
      categoryId: 'emergency-fund',
      amount: 1000,
      lines: [makeLine('emergency-fund-asset', 'debit', 1000), makeLine('bank', 'credit', 1000)]
    });
    addTransaction(workbook, {
      id: 'txn-debt-payment',
      date: '2026-06-06',
      template: 'debt_payment',
      description: 'Credit card payment',
      categoryId: 'credit-card-payment',
      amount: 300,
      lines: [makeLine('credit-card', 'debit', 300), makeLine('bank', 'credit', 300)]
    });
    addTransaction(workbook, {
      id: 'txn-transfer-bank-cash',
      date: '2026-06-07',
      template: 'transfer',
      description: 'Cash transfer',
      amount: 700,
      lines: [makeLine('cash', 'debit', 700), makeLine('bank', 'credit', 700)]
    });

    const savings = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'savings',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });
    const debt = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'debt',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });
    const net = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'both',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });

    expect(savings).toMatchObject({
      title: 'Savings Movement',
      tone: 'bad'
    });
    expect(savings.summary.total).toBe(1000);
    expect(debt.summary.total).toBe(300);
    expect(debt.categoryRows[0]).toMatchObject({
      id: 'credit-card-payment',
      type: 'debt',
      tone: 'bad'
    });
    expect(net.rows.map((row) => row.transactionId)).not.toContain('txn-transfer-bank-cash');
    expect(net.summary).toMatchObject({
      totalInflow: 50000,
      totalOutflow: 3329,
      total: 46671
    });
  });

  it('preserves explicit date filtering, month-key labels, and month-range fallback labels', () => {
    const workbook = makeFlowWorkbook();
    const dateRows = buildDashboardFlowDrilldownRows(workbook, {
      flowType: 'expense',
      rangeStart: '2026-06-02',
      rangeEnd: '2026-06-03'
    });
    const monthKeyModel = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'expense',
      monthKey: '2026-06'
    });
    const monthRangeModel = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'expense',
      rangeStart: '2026-06',
      rangeEnd: '2026-06'
    });

    expect(dateRows.map((row) => row.transactionId)).toEqual([
      'txn-card-shopping',
      'txn-transport-cash'
    ]);
    expect(monthKeyModel).toMatchObject({
      rangeKind: 'monthKey',
      rangeLabel: 'June 2026',
      range: {
        start: '2026-06-01',
        end: '2026-06-30'
      }
    });
    expect(monthRangeModel).toMatchObject({
      rangeKind: 'monthRange',
      rangeLabel: 'June 1 - 30, 2026'
    });
  });

  it('sorts multiple transactions in the same flow newest first and breaks same-day ties by id descending', () => {
    const workbook = makeFlowWorkbook();
    addTransaction(workbook, {
      id: 'txn-food-a',
      date: '2026-06-05',
      template: 'expense_paid',
      description: 'Food A',
      categoryId: 'food',
      amount: 75,
      lines: [makeLine('food-expense', 'debit', 75), makeLine('cash', 'credit', 75)]
    });
    addTransaction(workbook, {
      id: 'txn-food-z',
      date: '2026-06-05',
      template: 'expense_paid',
      description: 'Food Z',
      categoryId: 'food',
      amount: 125,
      lines: [makeLine('food-expense', 'debit', 125), makeLine('cash', 'credit', 125)]
    });

    const model = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'expense',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });

    expect(model.rows.slice(0, 3).map((row) => row.transactionId)).toEqual([
      'txn-food-z',
      'txn-food-a',
      'txn-subscription'
    ]);
    expect(model.summary.total).toBe(2229);
  });

  it('preserves missing category, archived category, retired account, and uncategorized behavior', () => {
    const workbook = makeFlowWorkbook();
    workbook.accounts.find((account) => account.id === 'cash').isActive = false;
    addTransaction(workbook, {
      id: 'txn-missing-category-reference',
      date: '2026-06-05',
      template: 'expense_paid',
      description: 'Missing category spend',
      categoryId: 'missing-category',
      amount: 30,
      lines: [makeLine('shopping-expense', 'debit', 30), makeLine('cash', 'credit', 30)]
    });
    addTransaction(workbook, {
      id: 'txn-archived-shopping',
      date: '2026-06-06',
      template: 'expense_paid',
      description: 'Archived category spend',
      categoryId: 'archived-shopping',
      amount: 90,
      lines: [makeLine('shopping-expense', 'debit', 90), makeLine('cash', 'credit', 90)]
    });
    addTransaction(workbook, {
      id: 'txn-uncategorized-flow',
      date: '2026-06-07',
      template: 'expense_paid',
      description: 'Uncategorized spend',
      categoryId: '',
      amount: 40,
      lines: [makeLine('food-expense', 'debit', 40), makeLine('cash', 'credit', 40)]
    });

    const model = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'expense',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });

    expect(model.summary.total).toBe(2189);
    expect(
      model.rows.find((row) => row.transactionId === 'txn-missing-category-reference')
    ).toMatchObject({ categoryName: 'Uncategorized', tone: 'bad' });
    expect(model.rows.find((row) => row.transactionId === 'txn-uncategorized-flow')).toMatchObject({
      categoryId: '',
      categoryName: 'Uncategorized'
    });
    expect(model.categoryRows.find((row) => row.id === 'missing-category')).toMatchObject({
      name: 'Uncategorized',
      type: 'other',
      tone: 'info'
    });
    expect(model.categoryRows.find((row) => row.id === 'archived-shopping')).toMatchObject({
      name: 'Old Shopping',
      type: 'expense',
      tone: 'bad'
    });
    expect(model.rows.map((row) => row.transactionId)).toContain('txn-food-cash');
  });

  it('keeps the net-flow summary total as inflows minus outflows', () => {
    const model = buildDashboardFlowDrilldownViewModel(makeFlowWorkbook(), {
      flowType: 'both',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });
    const summary = buildDashboardFlowDrilldownSummary(makeFlowWorkbook(), {
      flowType: 'both',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });

    expect(model.summary).toMatchObject({
      totalInflow: 50000,
      totalOutflow: 2029,
      total: 47971
    });
    expect(summary.total).toBe(47971);
  });

  it('does not mutate workbook input or leak mutable transaction references', () => {
    const workbook = makeFlowWorkbook();
    const before = cloneFixture(workbook);
    const model = buildDashboardFlowDrilldownViewModel(workbook, {
      flowType: 'expense',
      range: { start: '2026-06-01', end: '2026-06-30' }
    });

    model.rows[0].transaction.amount = 999;
    model.transactions[0].description = 'Mutated transaction';
    model.categoryRows[0].name = 'Mutated category';

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
          '../../src/application/dashboard/dashboard-flow-drilldown-view-model-service.js',
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
