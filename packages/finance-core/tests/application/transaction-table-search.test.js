import { describe, expect, it } from 'vitest';

import {
  buildTransactionRows,
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

  it('handles reversed search text from the live filter input', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(searchTransactionRows(rows, 'snaeb eeffoC').map((row) => row.id)).toEqual([
      'txn-coffee'
    ]);
  });

  it('searches account display, category display, and amount-like text', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(searchTransactionRows(rows, 'Credit Card').map((row) => row.id)).toEqual(['txn-card']);
    expect(searchTransactionRows(rows, 'Food').map((row) => row.id)).toEqual(['txn-coffee']);
    expect(searchTransactionRows(rows, '50000').map((row) => row.id)).toEqual(['txn-salary']);
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
