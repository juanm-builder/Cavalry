import { getPeriodActivitySummary } from '../../domain/ledger/summaries.js';
import {
  buildAccountBalanceSummary,
  buildCategorySpendingReport,
  buildMonthlyCashFlowReport
} from './reporting-service.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function clonePlain(value) {
  if (value == null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function getWorkbookCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

function normalizeDateRange(range) {
  const source = range && typeof range === 'object' ? range : {};
  return {
    start: asString(source.start || source.startDate),
    end: asString(source.end || source.endDate)
  };
}

function normalizeReportOptions(range, options) {
  const sourceRange = range && typeof range === 'object' ? range : {};
  return Object.assign({}, options || {}, sourceRange, {
    start: asString(sourceRange.start || sourceRange.startDate || (options && options.start)),
    end: asString(sourceRange.end || sourceRange.endDate || (options && options.end)),
    startMonth: asString(sourceRange.startMonth || (options && options.startMonth)),
    endMonth: asString(sourceRange.endMonth || (options && options.endMonth))
  });
}

function buildCategoryTotals(rows) {
  return rows.reduce((totals, row) => {
    if (row.categoryId && row.categoryId !== '__uncategorized') {
      totals[row.categoryId] = row.total;
    }
    return totals;
  }, {});
}

export function buildReportsPeriodSummaryViewModel(workbook, range, _options = {}) {
  const dateRange = normalizeDateRange(range);
  const summary = getPeriodActivitySummary(workbook, dateRange);
  return {
    currency: getWorkbookCurrency(workbook),
    range: dateRange,
    income: summary.income,
    expense: summary.expense,
    savings: summary.savings,
    debt: summary.debt,
    outflow: summary.outflow,
    net: summary.net,
    categoryTotals: clonePlain(summary.categoryTotals),
    transactionCount: summary.transactions.length,
    transactions: clonePlain(summary.transactions)
  };
}

export function buildReportsCategoryBreakdownViewModel(workbook, range, options = {}) {
  const reportOptions = normalizeReportOptions(range, options);
  const report = buildCategorySpendingReport(workbook, reportOptions);
  const rows = clonePlain(report.rows);
  return {
    currency: report.currency,
    range: normalizeDateRange(reportOptions),
    startMonth: asString(reportOptions.startMonth),
    endMonth: asString(reportOptions.endMonth),
    total: report.total,
    transactionCount: report.transactionCount,
    transferCount: report.transferCount,
    rows,
    categoryTotals: buildCategoryTotals(rows),
    limitations: clonePlain(report.limitations)
  };
}

export function buildReportsCashFlowViewModel(workbook, options = {}) {
  const reportOptions = Object.assign({}, (options && options.range) || {}, options || {});
  const report = buildMonthlyCashFlowReport(workbook, reportOptions);
  return {
    currency: report.currency,
    range: {
      start: report.start,
      end: report.end
    },
    months: clonePlain(report.months),
    summary: clonePlain(report.summary),
    limitations: clonePlain(report.limitations)
  };
}

export function buildReportsRouteViewModel(workbook, options = {}) {
  const range = options.range || {};
  return {
    currency: getWorkbookCurrency(workbook),
    range: normalizeDateRange(range),
    periodSummary: buildReportsPeriodSummaryViewModel(workbook, range, options.periodSummary),
    categoryBreakdown: buildReportsCategoryBreakdownViewModel(
      workbook,
      range,
      options.categoryBreakdown
    ),
    cashFlow: buildReportsCashFlowViewModel(workbook, Object.assign({}, options.cashFlow, range)),
    accountBalanceSummary: buildAccountBalanceSummary(workbook, options.accountBalance)
  };
}
