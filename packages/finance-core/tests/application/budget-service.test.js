import { describe, expect, it } from 'vitest';

import {
  archiveBudget,
  buildBudgetSummary,
  createBudget,
  editBudget,
  getBudgetStatus,
  getSheetBudgetMap
} from '@cavalry/finance-core/application/budgets/budget-service.js';
import {
  cloneFixture,
  makeBasicSpendingWorkbook,
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

describe('budget service', () => {
  it('calculates budget actuals and over/under status by category', () => {
    const workbook = makeBudgetWorkbook();
    const summary = buildBudgetSummary(workbook, workbook.sheets[0]);

    expect(summary.rows.find((row) => row.categoryId === 'food')).toMatchObject({
      planned: 200,
      actual: 250,
      remaining: -50,
      statusLabel: 'Overspent'
    });
    expect(summary.rows.find((row) => row.categoryId === 'subscriptions')).toMatchObject({
      planned: 600,
      actual: 499,
      remaining: 101,
      statusLabel: 'Available'
    });
    expect(summary.rows.find((row) => row.categoryId === 'transport')).toMatchObject({
      planned: 0,
      actual: 80,
      statusLabel: 'Unplanned'
    });
  });

  it('keeps archived and missing budget categories visible', () => {
    const workbook = makeBudgetWorkbook();
    const summary = buildBudgetSummary(workbook, workbook.sheets[0]);

    expect(summary.rows.find((row) => row.categoryId === 'archived-shopping').isArchived).toBe(
      true
    );
    expect(summary.rows.find((row) => row.categoryId === 'missing-category').isMissing).toBe(true);
  });

  it('captures uncategorized budget impact from committed transactions', () => {
    const workbook = makeBudgetWorkbook();
    workbook.transactions.push(
      makeTransaction({
        id: 'txn-uncategorized-budget',
        date: '2026-06-09',
        template: 'expense_paid',
        description: 'Unknown cash spend',
        categoryId: '',
        amount: 40,
        lines: [makeLine('food-expense', 'debit', 40), makeLine('cash', 'credit', 40)]
      })
    );
    const summary = buildBudgetSummary(workbook, workbook.sheets[0]);

    expect(summary.rows.find((row) => row.categoryId === '__uncategorized')).toMatchObject({
      actual: 40,
      statusLabel: 'Unplanned'
    });
  });

  it('creates, edits, and archives category budgets when supported by the sheet model', () => {
    const workbook = makeBudgetWorkbook();

    expect(
      createBudget(workbook, 'sheet-june', { categoryId: 'utilities', planned: 1800 })
    ).toEqual({
      categoryId: 'utilities',
      planned: 1800
    });
    expect(editBudget(workbook, 'sheet-june', 'utilities', { planned: 1500 })).toEqual({
      categoryId: 'utilities',
      planned: 1500
    });
    expect(archiveBudget(workbook, 'sheet-june', 'utilities')).toEqual({
      archived: true,
      type: 'category_budget',
      categoryId: 'utilities'
    });
    expect(getSheetBudgetMap(workbook, workbook.sheets[0]).utilities).toBeUndefined();
  });

  it('archives budget line items by marking them inactive', () => {
    const workbook = makeBudgetWorkbook();
    workbook.sheets[0].budgetLineItems.push({
      id: 'line-food-extra',
      categoryId: 'food',
      name: 'Extra food',
      planned: 50,
      currency: 'PHP',
      isActive: true
    });

    expect(
      archiveBudget(workbook, 'sheet-june', 'food', { lineItemId: 'line-food-extra' })
    ).toEqual({
      archived: true,
      type: 'line_item',
      id: 'line-food-extra'
    });
    expect(workbook.sheets[0].budgetLineItems[0].isActive).toBe(false);
  });

  it('deduplicates generated recurring budgets while preserving direct overrides', () => {
    const workbook = makeBudgetWorkbook();
    const sheet = workbook.sheets[0];
    workbook.recurringItems = [
      {
        id: 'rec-subscriptions',
        kind: 'subscription',
        name: 'Netflix',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 549,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-06-15',
        isActive: true
      }
    ];
    sheet.budgets = [{ categoryId: 'subscriptions', planned: 549 }];
    sheet.budgetLineItems = [
      {
        id: 'legacy-subscriptions',
        categoryId: 'subscriptions',
        name: 'Netflix',
        planned: 549,
        currency: 'PHP',
        recurringItemId: 'rec-subscriptions',
        isActive: true
      }
    ];

    expect(getSheetBudgetMap(workbook, sheet).subscriptions).toBe(549);

    sheet.budgets = [{ categoryId: 'subscriptions', planned: 700 }];
    expect(getSheetBudgetMap(workbook, sheet).subscriptions).toBe(700);
  });

  it('uses income-specific budget status semantics', () => {
    expect(getBudgetStatus({ type: 'income' }, 50000, 60000)).toEqual({
      label: 'Ahead',
      tone: 'good'
    });
    expect(getBudgetStatus({ type: 'income' }, 50000, 40000)).toEqual({
      label: 'Below plan',
      tone: 'bad'
    });
  });
});
