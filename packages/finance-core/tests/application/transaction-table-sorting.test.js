import { describe, expect, it } from 'vitest';

import {
  buildTransactionRows,
  sortTransactionRows
} from '@cavalry/finance-core/application/transactions/transaction-table-service.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

describe('transaction table sorting', () => {
  it('sorts by default newest date and stable ID fallback', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(
      sortTransactionRows(rows, {})
        .map((row) => row.id)
        .slice(0, 3)
    ).toEqual(['txn-uncategorized', 'txn-missing', 'txn-archived']);
  });

  it('sorts by date asc/desc and amount asc/desc', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(
      sortTransactionRows(rows, { key: 'date', direction: 'asc' })
        .map((row) => row.id)
        .slice(0, 2)
    ).toEqual(['txn-salary', 'txn-coffee']);
    expect(
      sortTransactionRows(rows, { key: 'date', direction: 'desc' })
        .map((row) => row.id)
        .slice(0, 2)
    ).toEqual(['txn-uncategorized', 'txn-missing']);
    expect(
      sortTransactionRows(rows, { key: 'amount', direction: 'asc' })
        .map((row) => row.id)
        .slice(0, 2)
    ).toEqual(['txn-uncategorized', 'txn-missing']);
    expect(
      sortTransactionRows(rows, { key: 'amount', direction: 'desc' })
        .map((row) => row.id)
        .slice(0, 2)
    ).toEqual(['txn-salary', 'txn-card']);
  });

  it('sorts by description, account, and category labels', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(
      sortTransactionRows(rows, { key: 'description', direction: 'asc' })
        .map((row) => row.id)
        .slice(0, 2)
    ).toEqual(['txn-archived', 'txn-card']);
    expect(
      sortTransactionRows(rows, { key: 'account', direction: 'asc' })
        .map((row) => row.id)
        .slice(0, 2)
    ).toEqual(['txn-salary', 'txn-transfer']);
    expect(
      sortTransactionRows(rows, { key: 'category', direction: 'asc' })
        .map((row) => row.id)
        .slice(0, 2)
    ).toEqual(['txn-coffee', 'txn-missing']);
  });

  it('keeps stable order for equal sort values and tolerates invalid sort keys', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook())
      .slice(0, 2)
      .map((row) => ({
        ...row,
        description: 'Same'
      }));

    expect(
      sortTransactionRows(rows, { key: 'description', direction: 'asc' }).map((row) => row.id)
    ).toEqual(['txn-salary', 'txn-coffee']);
    expect(
      sortTransactionRows(rows, { key: 'missing', direction: 'asc' }).map((row) => row.id)
    ).toEqual(['txn-salary', 'txn-coffee']);
  });
});
