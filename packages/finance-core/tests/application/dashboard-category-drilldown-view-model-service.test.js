// Locks down browser-safe, read-only dashboard category modal preparation before renderer wire-in.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildDashboardCategoryDrilldownRows,
  buildDashboardCategoryDrilldownSummary,
  buildDashboardCategoryDrilldownViewModel
} from '@cavalry/finance-core/application/dashboard/dashboard-category-drilldown-view-model-service.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeLine,
  makeMinimalWorkbook,
  makeTransaction
} from '../fixtures/core-workbook-fixtures.js';

function makeDashboardWorkbook() {
  return cloneFixture(makeIncomeAndExpenseWorkbook());
}

function addTransaction(workbook, overrides) {
  const transaction = makeTransaction(overrides);
  workbook.transactions.push(transaction);
  return transaction;
}

describe('dashboard category drilldown view-model service', () => {
  it('returns an unknown-category model for missing or unknown categories', () => {
    const workbook = makeDashboardWorkbook();
    addTransaction(workbook, {
      id: 'txn-missing-category-reference',
      date: '2026-06-06',
      template: 'expense_paid',
      description: 'Missing category spend',
      categoryId: 'missing-category',
      amount: 30,
      lines: [makeLine('shopping-expense', 'debit', 30), makeLine('cash', 'credit', 30)]
    });

    const model = buildDashboardCategoryDrilldownViewModel(workbook, {
      categoryId: 'missing-category',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(model).toMatchObject({
      category: null,
      categoryId: 'missing-category',
      isKnownCategory: false,
      rows: [],
      rangeLabel: 'June 1 - 30, 2026'
    });
    expect(model.summary).toMatchObject({
      total: 0,
      transactionCount: 0,
      postingAccountName: 'Missing'
    });
  });

  it('builds empty drilldown data for an empty workbook', () => {
    const model = buildDashboardCategoryDrilldownViewModel(makeMinimalWorkbook(), {
      categoryId: 'salary',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(model.isKnownCategory).toBe(false);
    expect(model.rows).toEqual([]);
    expect(model.summary.total).toBe(0);
  });

  it('returns an empty activity state for a known category with no selected-period rows', () => {
    const model = buildDashboardCategoryDrilldownViewModel(makeDashboardWorkbook(), {
      categoryId: 'food',
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31'
    });

    expect(model.isKnownCategory).toBe(true);
    expect(model.rangeKind).toBe('date');
    expect(model.rangeLabel).toBe('July 1 - 31, 2026');
    expect(model.rows).toEqual([]);
    expect(model.summary).toMatchObject({
      total: 0,
      transactionCount: 0,
      type: 'expense',
      postingAccountName: 'Food Expense',
      tone: 'bad'
    });
  });

  it('builds expense category rows and summary totals from existing transaction base amounts', () => {
    const model = buildDashboardCategoryDrilldownViewModel(makeDashboardWorkbook(), {
      categoryId: 'food',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(model.summary).toMatchObject({
      total: 250,
      transactionCount: 1,
      type: 'expense',
      postingAccountName: 'Food Expense',
      tone: 'bad'
    });
    expect(model.rows[0]).toMatchObject({
      transactionId: 'txn-food-cash',
      date: '2026-06-01',
      description: 'Lunch',
      templateLabel: 'Expense Paid',
      flowLabel: 'From Cash • Food',
      amount: 250,
      baseAmount: 250,
      tone: 'bad'
    });
  });

  it('supports income categories with existing modal labels and positive tone', () => {
    const model = buildDashboardCategoryDrilldownViewModel(makeDashboardWorkbook(), {
      categoryId: 'salary',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(model.summary).toMatchObject({
      total: 50000,
      transactionCount: 1,
      type: 'income',
      postingAccountName: 'Salary Income',
      tone: 'good'
    });
    expect(model.rows[0]).toMatchObject({
      transactionId: 'txn-salary',
      templateLabel: 'Income Received',
      flowLabel: 'Into Bank',
      tone: 'good'
    });
  });

  it('preserves explicit date filtering and month filtering behavior', () => {
    const workbook = makeDashboardWorkbook();
    addTransaction(workbook, {
      id: 'txn-food-with-month-key-only',
      date: '',
      monthKey: '',
      template: 'expense_paid',
      description: 'Undated food adjustment',
      categoryId: 'food',
      amount: 12,
      baseAmount: 12,
      lines: [makeLine('food-expense', 'debit', 12), makeLine('cash', 'credit', 12)]
    });

    const dateRows = buildDashboardCategoryDrilldownRows(workbook, {
      categoryId: 'food',
      rangeStart: '2026-06-02',
      rangeEnd: '2026-06-30'
    });
    const monthRows = buildDashboardCategoryDrilldownRows(workbook, {
      categoryId: 'food',
      rangeStart: '2026-06',
      rangeEnd: '2026-06'
    });

    expect(dateRows.map((row) => row.transactionId)).toEqual([]);
    expect(monthRows.map((row) => row.transactionId)).toEqual([
      'txn-food-with-month-key-only',
      'txn-food-cash'
    ]);
  });

  it('sorts multiple transactions newest first and breaks same-day ties by id descending', () => {
    const workbook = makeDashboardWorkbook();
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

    const model = buildDashboardCategoryDrilldownViewModel(workbook, {
      categoryId: 'food',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(model.rows.map((row) => row.transactionId)).toEqual([
      'txn-food-z',
      'txn-food-a',
      'txn-food-cash'
    ]);
    expect(model.summary.total).toBe(450);
  });

  it('keeps archived category activity visible when the modal targets that category', () => {
    const workbook = makeDashboardWorkbook();
    addTransaction(workbook, {
      id: 'txn-archived-shopping',
      date: '2026-06-07',
      template: 'expense_paid',
      description: 'Archived category spend',
      categoryId: 'archived-shopping',
      amount: 90,
      lines: [makeLine('shopping-expense', 'debit', 90), makeLine('cash', 'credit', 90)]
    });

    const model = buildDashboardCategoryDrilldownViewModel(workbook, {
      categoryId: 'archived-shopping',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(model.category).toMatchObject({
      id: 'archived-shopping',
      isActive: false
    });
    expect(model.rows.map((row) => row.transactionId)).toEqual(['txn-archived-shopping']);
    expect(model.summary.total).toBe(90);
  });

  it('includes retired-account activity because the existing modal filters by category only', () => {
    const workbook = makeDashboardWorkbook();
    workbook.accounts.find((account) => account.id === 'cash').isActive = false;

    const summary = buildDashboardCategoryDrilldownSummary(workbook, {
      categoryId: 'food',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(summary).toMatchObject({
      total: 250,
      transactionCount: 1,
      postingAccountName: 'Food Expense'
    });
  });

  it('preserves current unsupported uncategorized drilldown behavior', () => {
    const workbook = makeDashboardWorkbook();
    addTransaction(workbook, {
      id: 'txn-uncategorized-dashboard',
      date: '2026-06-08',
      template: 'expense_paid',
      description: 'Uncategorized cash spend',
      categoryId: '',
      amount: 40,
      lines: [makeLine('food-expense', 'debit', 40), makeLine('cash', 'credit', 40)]
    });

    const model = buildDashboardCategoryDrilldownViewModel(workbook, {
      categoryId: '__uncategorized',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    expect(model.isKnownCategory).toBe(false);
    expect(model.rows).toEqual([]);
    expect(model.summary.total).toBe(0);
  });

  it('does not mutate workbook input or leak mutable category and transaction references', () => {
    const workbook = makeDashboardWorkbook();
    const before = cloneFixture(workbook);
    const model = buildDashboardCategoryDrilldownViewModel(workbook, {
      categoryId: 'food',
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30'
    });

    model.category.name = 'Mutated category';
    model.rows[0].transaction.amount = 999;
    model.transactions[0].description = 'Mutated transaction';

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
          '../../src/application/dashboard/dashboard-category-drilldown-view-model-service.js',
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
