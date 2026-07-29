import { describe, expect, it } from 'vitest';

import {
  buildTransactionRows,
  buildTransactionTableView,
  searchTransactionRows
} from '@cavalry/finance-core/application/transactions/transaction-table-service.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

describe('transaction table search', () => {
  it('returns all rows for empty or whitespace queries without mutating rows', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(searchTransactionRows(rows, '')).toHaveLength(rows.length);
    expect(searchTransactionRows(rows, '   ')).toHaveLength(rows.length);
    expect(searchTransactionRows(rows, '')).not.toBe(rows);
  });

  it('searches exact, partial, and case-insensitive descriptions', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(searchTransactionRows(rows, 'Coffee beans').map((row) => row.id)).toEqual([
      'txn-coffee'
    ]);
    expect(searchTransactionRows(rows, 'grocer').map((row) => row.id)).toEqual(['txn-card']);
    expect(searchTransactionRows(rows, 'SALARY').map((row) => row.id)).toEqual(['txn-salary']);
  });

  it('matches words across meaningful fields without requiring an exact phrase', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(searchTransactionRows(rows, 'morning cash food').map((row) => row.id)).toEqual([
      'txn-coffee'
    ]);
    expect(searchTransactionRows(rows, 'credit groceries shopping').map((row) => row.id)).toEqual([
      'txn-card'
    ]);
  });

  it('searches accounts, categories, notes, and formatted amounts', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(searchTransactionRows(rows, 'Credit Card').map((row) => row.id)).toEqual(['txn-card']);
    expect(searchTransactionRows(rows, 'Food').map((row) => row.id)).toEqual(['txn-coffee']);
    expect(searchTransactionRows(rows, '50000').map((row) => row.id)).toEqual(['txn-salary']);
    expect(searchTransactionRows(rows, '50,000.00').map((row) => row.id)).toEqual(['txn-salary']);
  });

  it('matches accents forgivingly and includes counterparties and every balance account', () => {
    const workbook = makeTransactionTableWorkbook();
    workbook.counterparties = [{ id: 'bean-house', name: 'Café Amélie' }];
    workbook.transactions.find((transaction) => transaction.id === 'txn-coffee').counterpartyId =
      'bean-house';
    const rows = buildTransactionRows(workbook);

    expect(searchTransactionRows(rows, 'cafe amelie').map((row) => row.id)).toEqual(['txn-coffee']);
    expect(searchTransactionRows(rows, 'Move Cash').map((row) => row.id)).toEqual(['txn-transfer']);
  });

  it('composes search with the existing transaction filters', () => {
    const workbook = makeTransactionTableWorkbook();

    expect(
      buildTransactionTableView(workbook, {
        type: 'expense',
        categoryId: 'shopping',
        search: 'card'
      }).allRows.map((row) => row.id)
    ).toEqual(['txn-card']);
    expect(
      buildTransactionTableView(workbook, {
        type: 'expense',
        categoryId: 'food',
        search: 'card'
      }).allRows
    ).toEqual([]);
  });

  it('paginates the composed result set and clamps a stale page', () => {
    const view = buildTransactionTableView(makeTransactionTableWorkbook(), {
      type: 'expense',
      categoryId: 'shopping',
      search: 'card',
      page: 4,
      pageSize: 1
    });

    expect(view.rows.map((row) => row.id)).toEqual(['txn-card']);
    expect(view).toMatchObject({
      page: 1,
      pageSize: 1,
      totalPages: 1,
      rowCount: 1
    });
  });

  it('handles no results and missing references safely', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(searchTransactionRows(rows, 'not present')).toEqual([]);
    expect(searchTransactionRows(rows, 'Missing account').map((row) => row.id)).toEqual([
      'txn-missing'
    ]);
    expect(searchTransactionRows(rows, 'Missing category').map((row) => row.id)).toEqual([
      'txn-missing'
    ]);
  });
});
