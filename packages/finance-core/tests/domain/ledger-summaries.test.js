import { describe, expect, it } from 'vitest';

import {
  getMonthlyFlowBreakdown,
  getPeriodActivitySummary,
  getTransactionFlowKind
} from '@cavalry/finance-core/domain/ledger/summaries.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeLine,
  makeTransaction,
  makeTransferWorkbook
} from '../fixtures/core-workbook-fixtures.js';

function addSummarySpecificTransactions(workbook) {
  workbook.categories.push(
    {
      id: 'emergency-fund',
      name: 'Emergency Fund',
      type: 'savings',
      linkedAccountId: 'bank',
      isActive: true
    },
    {
      id: 'card-payment',
      name: 'Card Payment',
      type: 'debt',
      linkedAccountId: 'credit-card',
      isActive: true
    }
  );
  workbook.transactions.push(
    makeTransaction({
      id: 'txn-savings',
      date: '2026-06-12',
      template: 'expense_paid',
      description: 'Move to savings',
      categoryId: 'emergency-fund',
      amount: 3000,
      lines: [makeLine('bank', 'debit', 3000), makeLine('cash', 'credit', 3000)]
    }),
    makeTransaction({
      id: 'txn-debt',
      date: '2026-06-13',
      template: 'debt_payment',
      description: 'Credit card payment',
      categoryId: 'card-payment',
      amount: 1200,
      lines: [makeLine('credit-card', 'debit', 1200), makeLine('bank', 'credit', 1200)]
    }),
    makeTransaction({
      id: 'txn-opening',
      date: '2026-06-01',
      template: 'opening_balance',
      description: 'Opening balance',
      amount: 500,
      lines: [makeLine('cash', 'debit', 500), makeLine('opening_balance_equity', 'credit', 500)]
    })
  );
  return workbook;
}

function findTransaction(workbook, transactionId) {
  return workbook.transactions.find((transaction) => transaction.id === transactionId);
}

describe('ledger summaries', () => {
  it('classifies transaction flow kinds with established workbook semantics', () => {
    const workbook = addSummarySpecificTransactions(makeIncomeAndExpenseWorkbook());
    const transferWorkbook = makeTransferWorkbook();

    expect(getTransactionFlowKind(findTransaction(workbook, 'txn-salary'), workbook)).toBe(
      'inflow'
    );
    expect(getTransactionFlowKind(findTransaction(workbook, 'txn-food-cash'), workbook)).toBe(
      'expense'
    );
    expect(getTransactionFlowKind(findTransaction(workbook, 'txn-savings'), workbook)).toBe(
      'savings'
    );
    expect(getTransactionFlowKind(findTransaction(workbook, 'txn-debt'), workbook)).toBe('debt');
    expect(getTransactionFlowKind(findTransaction(workbook, 'txn-opening'), workbook)).toBe(
      'opening'
    );
    expect(getTransactionFlowKind(transferWorkbook.transactions[0], transferWorkbook)).toBe(
      'transfer'
    );
  });

  it('summarizes period activity while excluding transfers and opening balances from activity totals', () => {
    const workbook = addSummarySpecificTransactions(makeIncomeAndExpenseWorkbook());
    workbook.transactions.push(makeTransferWorkbook().transactions[0]);

    const summary = getPeriodActivitySummary(workbook, {
      start: '2026-06-01',
      end: '2026-06-30'
    });

    expect(summary.income).toBe(50000);
    expect(summary.expense).toBe(2029);
    expect(summary.savings).toBe(3000);
    expect(summary.debt).toBe(1200);
    expect(summary.outflow).toBe(6229);
    expect(summary.net).toBe(43771);
    expect(summary.categoryTotals).toMatchObject({
      salary: 50000,
      food: 250,
      transport: 80,
      shopping: 1200,
      subscriptions: 499,
      'emergency-fund': 3000,
      'card-payment': 1200
    });
    expect(summary.categoryTotals).not.toHaveProperty('__uncategorized');
  });

  it('filters summaries by date range', () => {
    const workbook = addSummarySpecificTransactions(makeIncomeAndExpenseWorkbook());
    const summary = getPeriodActivitySummary(workbook, {
      start: '2026-06-02',
      end: '2026-06-04'
    });

    expect(summary.transactions.map((transaction) => transaction.id)).toEqual([
      'txn-transport-cash',
      'txn-card-shopping',
      'txn-subscription'
    ]);
    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(1779);
    expect(summary.net).toBe(-1779);
  });

  it('builds monthly flow breakdowns sorted by absolute category total', () => {
    const workbook = addSummarySpecificTransactions(makeIncomeAndExpenseWorkbook());
    const breakdown = getMonthlyFlowBreakdown(workbook, '2026-06', 'outflow');

    expect(breakdown.total).toBe(6229);
    expect(breakdown.transactions.map((transaction) => transaction.id)).toEqual([
      'txn-food-cash',
      'txn-transport-cash',
      'txn-card-shopping',
      'txn-subscription',
      'txn-savings',
      'txn-debt'
    ]);
    expect(breakdown.rows.map((row) => row.id)).toEqual([
      'emergency-fund',
      'shopping',
      'card-payment',
      'subscriptions',
      'food',
      'transport'
    ]);
  });

  it('keeps category id matching exact for report compatibility', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = cloneFixture(
      workbook.transactions.find((item) => item.id === 'txn-food-cash')
    );
    transaction.categoryId = ' food ';

    expect(getTransactionFlowKind(transaction, workbook)).toBe('expense');
    transaction.template = 'custom_template';
    expect(getTransactionFlowKind(transaction, workbook)).toBe('transfer');
  });

  it('returns empty summaries for missing or empty workbooks', () => {
    expect(
      getPeriodActivitySummary(null, { start: '2026-06-01', end: '2026-06-30' })
    ).toMatchObject({
      income: 0,
      expense: 0,
      savings: 0,
      debt: 0,
      outflow: 0,
      net: 0,
      categoryTotals: {},
      transactions: []
    });
    expect(getMonthlyFlowBreakdown({ transactions: [] }, '2026-06', 'both')).toEqual({
      transactions: [],
      rows: [],
      total: 0
    });
  });
});
