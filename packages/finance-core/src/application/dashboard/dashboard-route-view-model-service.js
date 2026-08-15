import { roundMoney } from '../../domain/money.js';
import {
  getAccountBalanceSnapshotAsOf,
  getAssetLiabilityTotalsAsOf
} from '../../domain/ledger/balances.js';
import { getPeriodActivitySummary, getTransactionFlowKind } from '../../domain/ledger/summaries.js';
import { getAccountViewItems } from '../accounts/account-view-model-service.js';
import { buildBudgetRouteViewModel } from '../budgets/budget-route-view-model-service.js';
import { buildReportsCategoryBreakdownViewModel } from '../reports/reports-route-view-model-service.js';
import {
  DASHBOARD_MONTH_NAMES,
  asArray,
  asString,
  clonePlain,
  formatVisibleDateRangeLabel,
  normalizeMonthValue,
  parseISODate
} from './dashboard-view-model-helpers.js';

const DASHBOARD_SPENDING_PRESET_IDS = [
  'year_to_date',
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'full_year',
  'custom'
];

function todayDate() {
  return new Date();
}

function normalizeDateRange(range) {
  const source = range && typeof range === 'object' ? range : {};
  return {
    start: asString(source.start || source.startDate),
    end: asString(source.end || source.endDate)
  };
}

function getFilteredAccounts(workbook, groups, includeArchived) {
  return getAccountViewItems(workbook, {
    groups,
    includeArchived: includeArchived === true
  });
}

function monthValueFromParts(year, monthIndex) {
  return (
    String(Number(year) || todayDate().getFullYear()) +
    '-' +
    String((Number(monthIndex) || 0) + 1).padStart(2, '0')
  );
}

function monthValueFromDate(dateValue) {
  const date =
    dateValue instanceof Date ? dateValue : parseISODate(dateValue) || new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return monthValueFromParts(date.getFullYear(), date.getMonth());
}

function addMonthsToMonthValue(monthValue, offset) {
  const parts = asString(monthValue).split('-');
  const year = Number(parts[0]) || todayDate().getFullYear();
  const monthIndex = Math.max(0, Math.min(11, (Number(parts[1]) || 1) - 1));
  const date = new Date(year, monthIndex + (Number(offset) || 0), 1);
  return monthValueFromDate(date);
}

function getCurrentWorkbookMonthValue(workbook, currentDate) {
  const todayMonth = monthValueFromDate(currentDate || todayDate());
  const workbookYear = Number(workbook && workbook.year) || todayDate().getFullYear();
  const currentYear = Number(todayMonth.slice(0, 4)) || workbookYear;
  if (currentYear === workbookYear) {
    return todayMonth;
  }
  return monthValueFromParts(workbookYear, currentYear < workbookYear ? 0 : 11);
}

function getDashboardSpendingRange(workbook, options = {}) {
  const preset =
    DASHBOARD_SPENDING_PRESET_IDS.indexOf(options.spendingPreset) >= 0
      ? options.spendingPreset
      : 'year_to_date';
  const workbookYear = Number(workbook && workbook.year) || todayDate().getFullYear();
  const currentMonth = getCurrentWorkbookMonthValue(workbook, options.currentDate);
  let startMonth = monthValueFromParts(workbookYear, 0);
  let endMonth = currentMonth;

  if (preset === 'this_month') {
    startMonth = currentMonth;
    endMonth = currentMonth;
  } else if (preset === 'last_month') {
    startMonth = addMonthsToMonthValue(currentMonth, -1);
    endMonth = startMonth;
  } else if (preset === 'last_3_months') {
    startMonth = addMonthsToMonthValue(currentMonth, -2);
    endMonth = currentMonth;
  } else if (preset === 'last_6_months') {
    startMonth = addMonthsToMonthValue(currentMonth, -5);
    endMonth = currentMonth;
  } else if (preset === 'full_year') {
    startMonth = monthValueFromParts(workbookYear, 0);
    endMonth = monthValueFromParts(workbookYear, 11);
  } else if (preset === 'custom') {
    startMonth =
      normalizeMonthValue(options.spendingStartMonth) || monthValueFromParts(workbookYear, 0);
    endMonth = normalizeMonthValue(options.spendingEndMonth) || startMonth;
  }

  if (startMonth > endMonth) {
    const previousStart = startMonth;
    startMonth = endMonth;
    endMonth = previousStart;
  }

  return {
    preset,
    startMonth,
    endMonth
  };
}

function monthKeyFromSheet(workbook, sheet) {
  return (
    String((workbook && workbook.year) || todayDate().getFullYear()) +
    '-' +
    String(((sheet && sheet.monthIndex) || 0) + 1).padStart(2, '0')
  );
}

function getMonthRangeFromKey(monthKey) {
  const normalized = normalizeMonthValue(monthKey);
  if (!normalized) {
    return null;
  }
  const parts = normalized.split('-');
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    start: normalized + '-01',
    end: normalized + '-' + String(lastDay).padStart(2, '0')
  };
}

function getMonthLabel(sheet) {
  const monthIndex = Math.max(0, Math.min(11, Number(sheet && sheet.monthIndex) || 0));
  return DASHBOARD_MONTH_NAMES[monthIndex];
}

function getMonthlyFlowRows(workbook, range) {
  const activeRange = range && (range.start || range.end) ? range : null;
  return asArray(workbook && workbook.sheets)
    .map((sheet) => {
      const monthKey = monthKeyFromSheet(workbook, sheet);
      const monthRange = getMonthRangeFromKey(monthKey);
      if (
        activeRange &&
        monthRange &&
        (monthRange.end < activeRange.start || monthRange.start > activeRange.end)
      ) {
        return null;
      }
      const summaryRange =
        activeRange && monthRange
          ? {
              start: monthRange.start < activeRange.start ? activeRange.start : monthRange.start,
              end: monthRange.end > activeRange.end ? activeRange.end : monthRange.end
            }
          : monthRange;
      const summary = getPeriodActivitySummary(workbook, summaryRange);
      return {
        id: sheet.id,
        monthKey,
        monthLabel: getMonthLabel(sheet),
        range: summaryRange,
        totals: {
          income: summary.income,
          expense: summary.expense,
          outflow: summary.outflow,
          actualNet: summary.net
        }
      };
    })
    .filter(Boolean);
}

function formatTimelineDateKey(date) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function addTimelineDays(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function buildTimelineSummaryRow(workbook, start, end, options = {}) {
  const range = {
    start: formatTimelineDateKey(start),
    end: formatTimelineDateKey(end)
  };
  const summary = getPeriodActivitySummary(workbook, range);
  return {
    id: options.id || `timeline-${range.start}`,
    periodKey: options.periodKey || range.start,
    monthKey: options.monthKey || '',
    monthLabel: options.label || '',
    label: options.label || '',
    shortLabel: options.shortLabel || options.label || '',
    range,
    transactions: clonePlain(summary.transactions).map((transaction) => ({
      ...transaction,
      flowKind: getTransactionFlowKind(transaction, workbook)
    })),
    totals: {
      income: summary.income,
      expense: summary.expense,
      outflow: summary.outflow,
      actualNet: summary.net
    }
  };
}

function buildDailyTimelineRows(workbook, start, dayCount, labelKind) {
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: dayCount }, (_item, index) => {
    const date = addTimelineDays(start, index);
    const monthName = DASHBOARD_MONTH_NAMES[date.getMonth()];
    const shortLabel =
      labelKind === 'weekday' ? weekdayLabels[date.getDay()] : String(date.getDate());
    return buildTimelineSummaryRow(workbook, date, date, {
      id: `timeline-day-${formatTimelineDateKey(date)}`,
      label: `${weekdayLabels[date.getDay()]}, ${monthName.slice(0, 3)} ${String(date.getDate())}`,
      shortLabel
    });
  });
}

function buildDashboardTimelineSeries(workbook, currentDate, fallbackRange) {
  const anchor =
    parseISODate(currentDate) || parseISODate(fallbackRange && fallbackRange.end) || todayDate();
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const weekStart = addTimelineDays(anchor, -mondayOffset);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthDayCount = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const year = anchor.getFullYear();
  const yearly = DASHBOARD_MONTH_NAMES.map((monthName, monthIndex) => {
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0);
    const monthKey = `${String(year)}-${String(monthIndex + 1).padStart(2, '0')}`;
    return buildTimelineSummaryRow(workbook, start, end, {
      id: `timeline-month-${monthKey}`,
      periodKey: monthKey,
      monthKey,
      label: monthName,
      shortLabel: monthName.slice(0, 3)
    });
  });
  return {
    weekly: buildDailyTimelineRows(workbook, weekStart, 7, 'weekday'),
    monthly: buildDailyTimelineRows(workbook, monthStart, monthDayCount, 'day'),
    yearly
  };
}

function buildSpendingRows(workbook, totals, type, limit) {
  const categoryTotals =
    totals && totals.categoryTotals
      ? totals.categoryTotals
      : totals && totals.actualByCategory
        ? totals.actualByCategory
        : {};
  return asArray(workbook && workbook.categories)
    .filter((category) => {
      return !type || category.type === type;
    })
    .map((category) => {
      return {
        category: clonePlain(category),
        total: roundMoney(categoryTotals[category.id] || 0),
        transactions: clonePlain(
          asArray(totals && totals.transactions).filter(
            (transaction) => transaction && transaction.categoryId === category.id
          )
        )
      };
    })
    .filter((row) => {
      return Math.abs(row.total) > 0.0001;
    })
    .sort((a, b) => {
      return Math.abs(b.total) - Math.abs(a.total);
    })
    .slice(0, limit || 8);
}

function getRecentTransactions(summary, limit) {
  return clonePlain(
    asArray(summary && summary.transactions)
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) {
          return a.date < b.date ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      })
      .slice(0, limit || 8)
  );
}

function getDashboardBalanceAccounts(
  workbook,
  balances,
  displayCurrencies = {},
  currencyIntegrityAccountIds = [],
  mixedCurrencyAccountIds = []
) {
  const currencyIntegrityIds = new Set(asArray(currencyIntegrityAccountIds).map(asString));
  const mixedCurrencyIds = new Set(asArray(mixedCurrencyAccountIds).map(asString));
  return getFilteredAccounts(workbook, ['asset', 'liability'], false)
    .filter((account) => {
      return !account.isSystem;
    })
    .sort((a, b) => {
      return Math.abs(balances[b.id] || 0) - Math.abs(balances[a.id] || 0);
    })
    .map((account) => {
      const row = clonePlain(account);
      const configuredCurrency = asString(account.currency).toUpperCase();
      const balanceCurrency = displayCurrencies[account.id] || configuredCurrency;
      return {
        ...row,
        currency: configuredCurrency,
        balanceCurrency,
        configuredCurrency,
        hasMixedCurrencies: mixedCurrencyIds.has(asString(account.id)),
        hasCurrencyMismatch: !!(
          currencyIntegrityIds.has(asString(account.id)) ||
          (configuredCurrency && balanceCurrency && configuredCurrency !== balanceCurrency)
        )
      };
    });
}

function getDashboardRangeDayCount(range) {
  const start = parseISODate(range && range.start);
  const end = parseISODate(range && range.end);
  if (!start || !end || end < start) {
    return 1;
  }
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function getDashboardTimelineAverages(periodSummary, range) {
  const dayCount = getDashboardRangeDayCount(range);
  const weekCount = Math.max(1, dayCount / 7);
  const monthCount = Math.max(1, dayCount / 30.4375);
  const yearCount = Math.max(1, dayCount / 365.25);
  const income = Number(periodSummary && periodSummary.income) || 0;
  const outflow = Number(periodSummary && periodSummary.outflow) || 0;
  const spending = Number(periodSummary && periodSummary.expense) || 0;
  const net = Number(periodSummary && periodSummary.net) || 0;
  return {
    weekly: {
      income: roundMoney(income / weekCount),
      outflow: roundMoney(outflow / weekCount),
      spending: roundMoney(spending / weekCount),
      net: roundMoney(net / weekCount)
    },
    monthly: {
      income: roundMoney(income / monthCount),
      outflow: roundMoney(outflow / monthCount),
      spending: roundMoney(spending / monthCount),
      net: roundMoney(net / monthCount)
    },
    yearly: {
      income: roundMoney(income / yearCount),
      outflow: roundMoney(outflow / yearCount),
      spending: roundMoney(spending / yearCount),
      net: roundMoney(net / yearCount)
    }
  };
}

export function buildDashboardBudgetSummaryViewModel(workbook, options = {}) {
  const budgetRoute = buildBudgetRouteViewModel(workbook, {
    range: normalizeDateRange(options.range),
    currentDate: options.currentDate
  });
  return {
    range: budgetRoute.range,
    summary: clonePlain(budgetRoute.summary),
    rows: clonePlain(budgetRoute.categoryRows.filter((row) => row && row.includedInPlanTotals)),
    planVsActual: clonePlain(budgetRoute.planVsActual)
  };
}

export function buildDashboardSpendingSummaryViewModel(workbook, options = {}) {
  const range = normalizeDateRange(options.range);
  const periodSummary = options.periodSummary
    ? clonePlain(options.periodSummary)
    : clonePlain(getPeriodActivitySummary(workbook, range));
  const monthRange = getDashboardSpendingRange(workbook, options);
  const monthReport = buildReportsCategoryBreakdownViewModel(
    workbook,
    {
      startMonth: monthRange.startMonth,
      endMonth: monthRange.endMonth
    },
    {
      includeMissingCategories: false
    }
  );

  return {
    range,
    rows: buildSpendingRows(workbook, periodSummary, 'expense', options.limit || 6),
    total: roundMoney(periodSummary.expense || 0),
    transactionCount: asArray(periodSummary.transactions).length,
    categoryTotals: clonePlain(periodSummary.categoryTotals || {}),
    monthRange,
    monthReport: {
      range: clonePlain(monthRange),
      categoryTotals: clonePlain(monthReport.categoryTotals),
      total: monthReport.total,
      transactionCount: monthReport.transactionCount,
      rows: clonePlain(monthReport.rows)
    }
  };
}

export function buildDashboardStatCardsViewModel(workbook, options = {}) {
  const range = normalizeDateRange(options.range);
  const asOfDate = asString(options.asOfDate || range.end);
  const periodSummary = getPeriodActivitySummary(workbook, range);
  const totals = getAssetLiabilityTotalsAsOf(workbook, asOfDate);
  const totalAssets = totals.assets;
  const totalLiabilities = totals.liabilities;
  const netWorth = totals.netWorth;
  return {
    range,
    asOfDate,
    period: {
      income: periodSummary.income,
      expense: periodSummary.expense,
      outflow: periodSummary.outflow,
      net: periodSummary.net
    },
    money: {
      totalAssets,
      totalLiabilities,
      netWorth
    },
    cards: [
      {
        id: 'net_worth',
        label: 'Net Worth',
        value: netWorth,
        tone: netWorth >= 0 ? 'good' : 'bad',
        icon: 'account_balance_wallet',
        action: 'open-dashboard-account-group',
        attrs: { 'data-account-group': 'net-worth' }
      },
      {
        id: 'total_inflows',
        label: 'Total Inflows',
        value: periodSummary.income,
        tone: 'good',
        icon: 'trending_up',
        action: 'open-dashboard-flow',
        attrs: { 'data-flow-type': 'inflow' }
      },
      {
        id: 'total_outflows',
        label: 'Total Outflows',
        value: periodSummary.outflow,
        tone: 'bad',
        icon: 'trending_down',
        action: 'open-dashboard-flow',
        attrs: { 'data-flow-type': 'outflow' }
      },
      {
        id: 'net_flow',
        label: 'Net Flow',
        value: periodSummary.net,
        tone: periodSummary.net >= 0 ? 'good' : 'bad',
        icon: 'savings',
        action: 'open-dashboard-flow',
        attrs: { 'data-flow-type': 'both' }
      }
    ]
  };
}

function getDashboardTimeframeRanges(currentDate, fallbackRange) {
  const anchor =
    parseISODate(currentDate) || parseISODate(fallbackRange && fallbackRange.end) || todayDate();
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const weekStart = addTimelineDays(anchor, -mondayOffset);
  const weekEnd = addTimelineDays(weekStart, 6);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const yearStart = new Date(anchor.getFullYear(), 0, 1);
  const yearEnd = new Date(anchor.getFullYear(), 11, 31);
  return {
    weekly: {
      start: formatTimelineDateKey(weekStart),
      end: formatTimelineDateKey(weekEnd)
    },
    monthly: {
      start: formatTimelineDateKey(monthStart),
      end: formatTimelineDateKey(monthEnd)
    },
    yearly: {
      start: formatTimelineDateKey(yearStart),
      end: formatTimelineDateKey(yearEnd)
    }
  };
}

function buildDashboardTimeframeView(workbook, range, asOfDate, currentDate) {
  const periodSummary = clonePlain(getPeriodActivitySummary(workbook, range));
  const effectiveAsOfDate = asString(asOfDate || currentDate || range.end);
  return {
    range: clonePlain(range),
    asOfDate: effectiveAsOfDate,
    periodLabel: formatVisibleDateRangeLabel(range),
    periodSummary,
    stats: buildDashboardStatCardsViewModel(workbook, { range, asOfDate: effectiveAsOfDate }),
    period: {
      income: periodSummary.income,
      expense: periodSummary.outflow,
      net: periodSummary.net
    },
    spendingSummary: buildDashboardSpendingSummaryViewModel(workbook, {
      range,
      periodSummary,
      currentDate
    }),
    timelineAverages: getDashboardTimelineAverages(periodSummary, range),
    recentTransactions: getRecentTransactions(periodSummary, 8)
  };
}

export function buildDashboardRouteViewModel(workbook, options = {}) {
  const range = normalizeDateRange(options.range);
  const asOfDate = asString(options.asOfDate || range.end);
  const periodSummary = clonePlain(getPeriodActivitySummary(workbook, range));
  const balanceSnapshot = getAccountBalanceSnapshotAsOf(workbook, asOfDate);
  const balances = balanceSnapshot.trustedBase;
  const totals = getAssetLiabilityTotalsAsOf(workbook, asOfDate);
  const totalAssets = totals.assets;
  const totalLiabilities = totals.liabilities;
  const netWorth = totals.netWorth;
  const balanceAccounts = getDashboardBalanceAccounts(
    workbook,
    balances,
    balanceSnapshot.displayCurrency,
    balanceSnapshot.currencyIntegrityAccountIds,
    balanceSnapshot.mixedCurrencyAccountIds
  );
  const monthRows = getMonthlyFlowRows(workbook, range).slice(0, 12);
  const maxFlowAmount = Math.max.apply(
    null,
    monthRows
      .map((item) => {
        return Math.max(Math.abs(item.totals.income), Math.abs(item.totals.outflow));
      })
      .concat([1])
  );
  const spendingSummary = buildDashboardSpendingSummaryViewModel(
    workbook,
    Object.assign({}, options, {
      range,
      periodSummary
    })
  );
  const timelineSeries = buildDashboardTimelineSeries(workbook, options.currentDate, range);
  const timeframeRanges = getDashboardTimeframeRanges(options.currentDate, range);
  const timeframes = Object.keys(timeframeRanges).reduce((views, timeframe) => {
    views[timeframe] = buildDashboardTimeframeView(
      workbook,
      timeframeRanges[timeframe],
      asOfDate,
      options.currentDate
    );
    return views;
  }, {});

  return {
    range,
    asOfDate,
    periodSummary,
    stats: buildDashboardStatCardsViewModel(workbook, { range, asOfDate }),
    period: {
      income: periodSummary.income,
      expense: periodSummary.outflow,
      net: periodSummary.net
    },
    money: {
      balances: clonePlain(balances),
      totalAssets,
      totalLiabilities,
      netWorth,
      balanceAccounts,
      assetAccountRows: balanceAccounts.filter((account) => account.group === 'asset').slice(0, 6),
      liabilityAccountRows: balanceAccounts
        .filter((account) => account.group === 'liability')
        .slice(0, 6)
    },
    monthlyFlow: {
      rows: clonePlain(monthRows),
      maxFlowAmount
    },
    timeline: {
      rows: clonePlain(monthRows),
      maxFlowAmount,
      averages: getDashboardTimelineAverages(periodSummary, range),
      series: clonePlain(timelineSeries)
    },
    timeframes: clonePlain(timeframes),
    recentTransactions: getRecentTransactions(periodSummary, 8),
    spendingSummary,
    budgetSummary: buildDashboardBudgetSummaryViewModel(workbook, {
      range,
      currentDate: options.currentDate
    })
  };
}
