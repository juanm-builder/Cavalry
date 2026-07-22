import { describe, expect, it } from 'vitest';

import {
  buildTransactionTableView,
  searchTransactionRows
} from '@cavalry/finance-core/application/transactions/transaction-table-service.js';
import { makeMinimalWorkbook } from '../fixtures/core-workbook-fixtures.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

describe('transaction table empty states', () => {
  it('returns an empty-state label when there are no transactions', () => {
    const workbook = makeMinimalWorkbook();
    const view = buildTransactionTableView(workbook);

    expect(view.rows).toEqual([]);
    expect(view.rowCount).toBe(0);
    expect(view.emptyState).toBe('No transactions match this view.');
    expect(view.totals).toMatchObject({ income: 0, expense: 0, net: 0, count: 0 });
  });

  it('returns an empty-state label when filters/search produce no results', () => {
    const view = buildTransactionTableView(makeTransactionTableWorkbook(), {
      search: 'zzzzzz'
    });

    expect(view.rows).toEqual([]);
    expect(view.rowCount).toBe(0);
    expect(view.emptyState).toBe('No transactions match this view.');
  });

  it('keeps search no-result behavior as an empty array for lower-level callers', () => {
    expect(searchTransactionRows([], 'coffee')).toEqual([]);
  });
});
