import { describe, expect, it } from 'vitest';

import {
  buildTransactionRows,
  calculateVisibleTransactionTotals,
  filterTransactionRows,
  searchTransactionRows
} from '@cavalry/finance-core/application/transactions/transaction-table-service.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

describe('transaction table visible totals', () => {
  it('calculates income, expense, net, and count for visible rows', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());
    const totals = calculateVisibleTransactionTotals(rows);

    expect(totals).toMatchObject({
      income: 50000,
      expense: 1850,
      net: 48150,
      count: 7,
      transferCount: 1,
      currency: 'base'
    });
  });

  it('updates totals after search and filters', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());
    const coffeeTotals = calculateVisibleTransactionTotals(searchTransactionRows(rows, 'coffee'));
    const filteredTotals = calculateVisibleTransactionTotals(
      filterTransactionRows(rows, { type: 'expense', end: '2026-06-03' })
    );

    expect(coffeeTotals).toMatchObject({ income: 0, expense: 250, net: -250, count: 1 });
    expect(filteredTotals).toMatchObject({ income: 0, expense: 1450, net: -1450, count: 2 });
  });

  it('excludes transfers and handles archived or missing references without crashing', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());
    const transferTotals = calculateVisibleTransactionTotals(
      filterTransactionRows(rows, { type: 'transfer' })
    );
    const archivedTotals = calculateVisibleTransactionTotals(
      filterTransactionRows(rows, { archivedReferences: true })
    );
    const missingTotals = calculateVisibleTransactionTotals(
      filterTransactionRows(rows, { missingReferences: true })
    );

    expect(transferTotals).toMatchObject({
      income: 0,
      expense: 0,
      net: 0,
      count: 1,
      transferCount: 1
    });
    expect(archivedTotals).toMatchObject({ expense: 400, net: -400, count: 1 });
    expect(missingTotals).toMatchObject({ expense: 0, count: 1 });
  });

  it('documents that totals use base amounts rather than inventing multi-currency conversion', () => {
    const workbook = makeTransactionTableWorkbook();
    workbook.transactions[1].originalCurrency = 'USD';
    workbook.transactions[1].amount = 10;
    workbook.transactions[1].baseAmount = 580;
    workbook.transactions[1].lines = workbook.transactions[1].lines.map((line) => ({
      ...line,
      amount: line.accountId === 'cash' ? 580 : 10,
      currency: line.accountId === 'cash' ? 'PHP' : 'USD',
      baseAmount: 580
    }));

    const totals = calculateVisibleTransactionTotals(buildTransactionRows(workbook));

    expect(totals.expense).toBe(2180);
    expect(totals.currency).toBe('base');
  });
});
