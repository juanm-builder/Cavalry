import { describe, expect, it } from 'vitest';
import { buildTransactionCalculationReceipt } from '@cavalry/finance-core/domain/ledger/transaction-contributions.js';

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
  it.each(['__proto__', 'constructor', 'toString'])(
    'keeps category totals for opaque ID %s',
    (id) => {
      const workbook = {
        currency: 'PHP',
        accounts: [],
        categories: [{ id, type: 'expense', name: 'Imported category' }],
        transactions: [{ id: 'purchase', date: '2026-06-01', categoryId: id, amount: 100 }]
      };
      const summary = getPeriodActivitySummary(workbook);
      expect(summary.expense).toBe(100);
      expect(summary.categoryTotals).toEqual({ [id]: 100 });
      expect(Object.getPrototypeOf(summary.categoryTotals)).toBe(Object.prototype);
      expect(getMonthlyFlowBreakdown(workbook, '2026-06', 'expense')).toMatchObject({
        total: 100,
        rows: [{ id, type: 'expense', name: 'Imported category', total: 100 }]
      });
    }
  );

  it('preserves duplicate-reference precedence, refunds, FX warnings, and subsequent edits', () => {
    const workbook = {
      currency: 'PHP',
      accounts: [
        { id: 'cash', group: 'liability' },
        { id: 'cash', group: 'asset' }
      ],
      categories: [
        { id: 'food', name: 'Food', type: 'expense' },
        { id: 'food', name: 'Duplicate', type: 'income' }
      ],
      transactions: [
        {
          id: 'purchase',
          date: '2026-06-01',
          categoryId: 'food',
          amount: 100.25,
          lines: [{ accountId: 'cash', direction: 'credit' }]
        },
        {
          id: 'refund',
          date: '2026-06-02',
          categoryId: 'food',
          template: 'merchant_refund',
          amount: 20.125,
          lines: [{ accountId: 'cash', direction: 'debit' }]
        },
        {
          id: 'unresolved',
          date: '2026-06-03',
          categoryId: 'food',
          currency: 'USD',
          amount: 10,
          lines: [{ accountId: 'cash', direction: 'credit' }]
        },
        { id: 'opaque-id', date: '2026-06-04', categoryId: ' food ', amount: 500, lines: [] }
      ]
    };
    const before = structuredClone(workbook);
    const range = { start: '2026-06-01', end: '2026-06-30' };
    expect(getPeriodActivitySummary(workbook, range)).toMatchObject({
      income: 0,
      expense: 80.12,
      net: -80.12,
      categoryTotals: { food: 80.12 }
    });
    expect(getMonthlyFlowBreakdown(workbook, '2026-06', 'expense')).toMatchObject({
      total: 80.12,
      rows: [{ id: 'food', name: 'Food', total: 80.12 }]
    });
    const receipt = buildTransactionCalculationReceipt(workbook, workbook.transactions, {
      metric: 'cashFlow'
    });
    expect(receipt).toMatchObject({ value: -80.12, includedCount: 2, unresolvedCount: 1 });
    expect(receipt.unresolved[0]).toMatchObject({
      transactionId: 'unresolved',
      warnings: [{ code: 'transaction_missing_fx_rate' }]
    });
    expect(workbook).toEqual(before);

    // A new calculation must observe edits made in place by legacy callers.
    workbook.categories[0].type = 'income';
    workbook.accounts[1].group = 'liability';
    expect(getPeriodActivitySummary(workbook, range)).toMatchObject({
      income: 100.25,
      expense: -20.13
    });
    expect(
      buildTransactionCalculationReceipt(workbook, workbook.transactions, { metric: 'cashFlow' })
        .value
    ).toBe(0);
  });

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
