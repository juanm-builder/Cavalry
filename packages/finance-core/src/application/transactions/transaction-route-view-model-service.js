import { buildTransactionTableView } from './transaction-table-service.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function buildTransactionFilterSummaryViewModel(viewState = {}) {
  const type = asString(viewState.type || viewState.direction || 'all') || 'all';
  return {
    type,
    accountId: asString(viewState.accountId),
    categoryId: asString(viewState.categoryId),
    search: asString(viewState.search),
    minAmount: asString(viewState.minAmount),
    maxAmount: asString(viewState.maxAmount),
    activeFilterCount: [
      type !== 'all',
      !!asString(viewState.accountId),
      !!asString(viewState.categoryId),
      !!asString(viewState.search),
      !!asString(viewState.minAmount),
      !!asString(viewState.maxAmount)
    ].filter(Boolean).length
  };
}

export function buildTransactionRouteStatsViewModel(tableView = {}) {
  const rows = Array.isArray(tableView.rows) ? tableView.rows : [];
  const allRows = Array.isArray(tableView.allRows) ? tableView.allRows : [];
  const page = Math.max(1, Math.round(Number(tableView.page || 1) || 1));
  const pageSize = Math.max(1, Math.round(Number(tableView.pageSize || rows.length || 1) || 1));
  const rowCount = Math.max(
    0,
    Math.round(Number(tableView.rowCount != null ? tableView.rowCount : allRows.length) || 0)
  );
  const pageStart = rowCount ? (page - 1) * pageSize : 0;
  const pageEnd = rowCount ? Math.min(pageStart + rows.length, rowCount) : 0;
  return {
    currentPage: page,
    pageSize,
    totalPages: Math.max(1, Math.round(Number(tableView.totalPages || 1) || 1)),
    rowCount,
    visibleRowCount: rows.length,
    pageStart,
    pageEnd,
    pageStartLabel: rowCount ? pageStart + 1 : 0,
    pageEndLabel: pageEnd
  };
}

export function buildTransactionRouteViewModel(workbook, viewState = {}) {
  const tableView = buildTransactionTableView(workbook, viewState);
  const filterSummary = buildTransactionFilterSummaryViewModel(viewState);
  const stats = buildTransactionRouteStatsViewModel(tableView);
  const allTransactions = tableView.allRows.map((row) => row.transaction);
  const recentTransactions = tableView.rows.map((row) => row.transaction);
  const ledgerTotals = tableView.totals || {
    income: 0,
    expense: 0,
    net: 0,
    count: 0,
    transferCount: 0,
    currency: 'base'
  };
  return {
    tableView,
    allTransactions,
    recentTransactions,
    ledgerTotals,
    net: ledgerTotals.net,
    emptyState: tableView.emptyState || '',
    activeFilterCount: filterSummary.activeFilterCount,
    filterSummary,
    stats,
    currentPage: stats.currentPage,
    totalPages: stats.totalPages,
    pageStart: stats.pageStart,
    pageEnd: stats.pageEnd,
    pageStartLabel: stats.pageStartLabel,
    pageEndLabel: stats.pageEndLabel
  };
}
