import { describe, expect, it } from 'vitest';

import {
  buildTransactionFilterSummaryViewModel,
  buildTransactionRouteStatsViewModel,
  buildTransactionRouteViewModel
} from '@cavalry/finance-core/application/transactions/transaction-route-view-model-service.js';
import { buildTransactionTableView } from '@cavalry/finance-core/application/transactions/transaction-table-service.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

describe('transaction route view-model service', () => {
  it('delegates search, filter, sort, and totals behavior to the existing table service', () => {
    const workbook = makeTransactionTableWorkbook();
    const viewState = {
      type: 'expense',
      search: 'card',
      start: '2026-06-01',
      end: '2026-06-30',
      page: 1,
      pageSize: 2,
      sort: { key: 'date', direction: 'desc' }
    };

    const routeView = buildTransactionRouteViewModel(workbook, viewState);
    const tableView = buildTransactionTableView(workbook, viewState);

    expect(routeView.tableView.rows.map((row) => row.id)).toEqual(
      tableView.rows.map((row) => row.id)
    );
    expect(routeView.allTransactions.map((transaction) => transaction.id)).toEqual(
      tableView.allRows.map((row) => row.transaction.id)
    );
    expect(routeView.recentTransactions.map((transaction) => transaction.id)).toEqual(
      tableView.rows.map((row) => row.transaction.id)
    );
    expect(routeView.ledgerTotals).toEqual(tableView.totals);
    expect(routeView.net).toBe(tableView.totals.net);
  });

  it('counts only toolbar filters and excludes date range, sort, and pagination controls', () => {
    expect(
      buildTransactionFilterSummaryViewModel({
        type: 'all',
        start: '2026-06-01',
        end: '2026-06-30',
        page: 3,
        sort: { key: 'amount', direction: 'asc' }
      }).activeFilterCount
    ).toBe(0);

    expect(
      buildTransactionFilterSummaryViewModel({
        type: 'expense',
        accountId: 'cash',
        categoryId: 'food',
        search: 'coffee',
        start: '2026-06-01',
        end: '2026-06-30'
      }).activeFilterCount
    ).toBe(4);
  });

  it('derives stable page copy values from the clamped table view', () => {
    const routeView = buildTransactionRouteViewModel(makeTransactionTableWorkbook(), {
      page: 9,
      pageSize: 3,
      sort: { key: 'date', direction: 'desc' }
    });

    expect(routeView.currentPage).toBe(3);
    expect(routeView.totalPages).toBe(3);
    expect(routeView.pageStart).toBe(6);
    expect(routeView.pageEnd).toBe(7);
    expect(routeView.pageStartLabel).toBe(7);
    expect(routeView.pageEndLabel).toBe(7);
  });

  it('handles empty table view page copy without negative ranges', () => {
    const stats = buildTransactionRouteStatsViewModel({
      rows: [],
      allRows: [],
      page: 1,
      pageSize: 10,
      totalPages: 1,
      rowCount: 0
    });

    expect(stats).toMatchObject({
      rowCount: 0,
      visibleRowCount: 0,
      pageStart: 0,
      pageEnd: 0,
      pageStartLabel: 0,
      pageEndLabel: 0
    });
  });

  it('does not mutate the workbook', () => {
    const workbook = makeTransactionTableWorkbook();
    const before = JSON.stringify(workbook);

    buildTransactionRouteViewModel(workbook, {
      type: 'expense',
      accountId: 'cash',
      categoryId: 'food',
      search: 'coffee',
      page: 1,
      pageSize: 10
    });

    expect(JSON.stringify(workbook)).toBe(before);
  });
});
