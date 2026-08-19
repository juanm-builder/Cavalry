import { describe, expect, it } from 'vitest';

import {
  buildTransactionRows,
  buildTransactionTableView,
  filterTransactionRows,
  validateTransactionTableViewState
} from '@cavalry/finance-core/application/transactions/transaction-table-service.js';
import { makeRefundWorkbook } from '../fixtures/core-workbook-fixtures.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

describe('transaction table filtering', () => {
  it('filters by date range, account, category, uncategorized, and type', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(
      filterTransactionRows(rows, { start: '2026-06-03', end: '2026-06-05' }).map((row) => row.id)
    ).toEqual(['txn-card', 'txn-transfer', 'txn-archived']);
    expect(filterTransactionRows(rows, { accountId: 'cash' }).map((row) => row.id)).toEqual([
      'txn-coffee',
      'txn-transfer',
      'txn-uncategorized'
    ]);
    expect(filterTransactionRows(rows, { categoryId: 'shopping' }).map((row) => row.id)).toEqual([
      'txn-card'
    ]);
    expect(filterTransactionRows(rows, { uncategorized: true }).map((row) => row.id)).toEqual([
      'txn-transfer',
      'txn-uncategorized'
    ]);
    expect(filterTransactionRows(rows, { type: 'income' }).map((row) => row.id)).toEqual([
      'txn-salary'
    ]);
    expect(filterTransactionRows(rows, { type: 'transfer' }).map((row) => row.id)).toEqual([
      'txn-transfer'
    ]);
    expect(
      filterTransactionRows(rows, { minAmount: '200', maxAmount: '1000' }).map((row) => row.id)
    ).toEqual(['txn-coffee', 'txn-transfer', 'txn-archived']);
  });

  it('surfaces archived and missing reference rows without crashing', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(filterTransactionRows(rows, { archivedReferences: true }).map((row) => row.id)).toEqual([
      'txn-archived'
    ]);
    expect(filterTransactionRows(rows, { missingReferences: true }).map((row) => row.id)).toEqual([
      'txn-missing'
    ]);
  });

  it('supports combined filters', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(
      filterTransactionRows(rows, {
        type: 'expense',
        accountId: 'credit-card',
        start: '2026-06-01',
        end: '2026-06-30'
      }).map((row) => row.id)
    ).toEqual(['txn-card']);
  });

  it('classifies and filters legacy refund aliases by their semantic contribution', () => {
    const rows = buildTransactionRows(makeRefundWorkbook());
    const refund = rows.find((row) => row.id === 'txn-refund-unclear');

    expect(refund).toMatchObject({
      type: 'refund',
      eventKind: 'merchant_refund',
      flowKind: 'expense',
      signedBaseAmount: -50,
      contributions: {
        eventKind: 'merchant_refund',
        flowKind: 'expense',
        signedBaseAmount: -50,
        resolved: true,
        metrics: {
          expense: -50,
          outflow: -50,
          categoryBudget: -50,
          cashFlow: 50
        }
      }
    });
    expect(filterTransactionRows(rows, { type: 'refund' }).map((row) => row.id)).toEqual([
      'txn-refund-unclear'
    ]);
    expect(filterTransactionRows(rows, { type: 'expense' })).toHaveLength(5);
    expect(validateTransactionTableViewState({ type: 'refund' }).type).toBe('refund');
  });

  it('normalizes invalid filter state safely in full table views', () => {
    const state = validateTransactionTableViewState({
      type: 'surprise',
      sort: { key: 'nope', direction: 'sideways' },
      page: -3,
      pageSize: 0
    });
    const view = buildTransactionTableView(makeTransactionTableWorkbook(), {
      type: 'surprise',
      pageSize: 3,
      sort: { key: 'nope', direction: 'sideways' }
    });

    expect(state).toMatchObject({
      type: 'all',
      sort: { key: 'date', direction: 'desc' },
      page: 1,
      pageSize: 12
    });
    expect(view.rows).toHaveLength(3);
    expect(view.rowCount).toBe(7);
  });
});
