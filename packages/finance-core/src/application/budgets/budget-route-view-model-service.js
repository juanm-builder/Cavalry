import { roundMoney } from '../../domain/money.js';
import { getPeriodActivitySummary } from '../../domain/ledger/summaries.js';
import { getBudgetRemaining, getSheetBudgetMap } from './budget-service.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clonePlain(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function todayISO() {
  const date = new Date();
  return formatISODate(date);
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

function formatISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeDateRange(range) {
  const source = range && typeof range === 'object' ? range : {};
  return {
    start: asString(source.start || source.startDate),
    end: asString(source.end || source.endDate)
  };
}

function getSheetDateRange(workbook, sheet) {
  const year = Number(workbook && workbook.year) || new Date().getFullYear();
  const monthIndex = Math.max(0, Math.min(11, Number(sheet && sheet.monthIndex) || 0));
  const month = String(monthIndex + 1).padStart(2, '0');
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    start: String(year) + '-' + month + '-01',
    end: String(year) + '-' + month + '-' + String(lastDay).padStart(2, '0')
  };
}

function getCategoryById(workbook, categoryId) {
  return (
    asArray(workbook && workbook.categories).find((category) => {
      return category && category.id === categoryId;
    }) || null
  );
}

function getInclusiveDateDays(startDate, endDate) {
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);
  if (!start || !end) {
    return 1;
  }
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86400000;
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) / 86400000;
  return Math.max(1, endDay - startDay + 1);
}

function getBudgetPeriodProgress(range, currentDate) {
  const start = parseISODate(range && range.start);
  const end = parseISODate(range && range.end);
  const today = parseISODate(currentDate || todayISO());
  if (!start || !end || !today || start > end) {
    return {
      periodDays: 1,
      daysElapsed: 0,
      remainingDays: 0,
      currentDate: '',
      isActive: false
    };
  }

  const periodDays = getInclusiveDateDays(formatISODate(start), formatISODate(end));
  if (today < start) {
    return {
      periodDays,
      daysElapsed: 0,
      remainingDays: periodDays,
      currentDate: formatISODate(today),
      isActive: false
    };
  }
  if (today > end) {
    return {
      periodDays,
      daysElapsed: periodDays,
      remainingDays: 0,
      currentDate: formatISODate(today),
      isActive: false
    };
  }
  return {
    periodDays,
    daysElapsed: getInclusiveDateDays(formatISODate(start), formatISODate(today)),
    remainingDays: getInclusiveDateDays(formatISODate(today), formatISODate(end)),
    currentDate: formatISODate(today),
    isActive: true
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
        total: roundMoney(categoryTotals[category.id] || 0)
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

export function buildBudgetPeriodSummaryViewModel(workbook, range, _options = {}) {
  const dateRange = normalizeDateRange(range);
  return clonePlain(getPeriodActivitySummary(workbook, dateRange));
}

export function buildBudgetPlanVsActualViewModel(workbook, range, _options = {}) {
  const visibleRange = normalizeDateRange(range);
  const actual = buildBudgetPeriodSummaryViewModel(workbook, visibleRange);
  const plannedByType = { income: 0, expense: 0, savings: 0, debt: 0 };
  const plannedByCategory = {};

  asArray(workbook && workbook.sheets).forEach((sheet) => {
    const sheetRange = getSheetDateRange(workbook, sheet);
    if (sheetRange.end < visibleRange.start || sheetRange.start > visibleRange.end) {
      return;
    }
    const budgetMap = getSheetBudgetMap(workbook, sheet);
    Object.keys(budgetMap).forEach((categoryId) => {
      const category = getCategoryById(workbook, categoryId);
      if (!category) {
        return;
      }
      const amount = roundMoney(budgetMap[categoryId] || 0);
      plannedByType[category.type] = roundMoney((plannedByType[category.type] || 0) + amount);
      plannedByCategory[categoryId] = roundMoney((plannedByCategory[categoryId] || 0) + amount);
    });
  });

  const plannedOutflow = roundMoney(
    plannedByType.expense + plannedByType.savings + plannedByType.debt
  );
  const plannedNet = roundMoney(plannedByType.income - plannedOutflow);
  return {
    range: visibleRange,
    actual,
    plannedByType,
    plannedByCategory,
    plannedOutflow,
    plannedNet,
    actualNet: actual.net,
    variance: roundMoney(actual.net - plannedNet)
  };
}

export function buildBudgetCategoryRowsViewModel(workbook, range, options = {}) {
  const planVsActual =
    options.planVsActual || buildBudgetPlanVsActualViewModel(workbook, range, options);
  const actualCategoryTotals =
    planVsActual && planVsActual.actual && planVsActual.actual.categoryTotals
      ? planVsActual.actual.categoryTotals
      : {};
  const plannedByCategory =
    planVsActual && planVsActual.plannedByCategory ? planVsActual.plannedByCategory : {};

  return asArray(workbook && workbook.categories)
    .filter((category) => {
      return category.type === 'expense' && category.isActive !== false;
    })
    .map((category) => {
      const planned = roundMoney(plannedByCategory[category.id] || 0);
      const actual = roundMoney(actualCategoryTotals[category.id] || 0);
      const remaining = getBudgetRemaining(category, planned, actual);
      const rawPercent = planned > 0 ? Math.round((actual / planned) * 100) : actual > 0 ? 100 : 0;
      return {
        category: clonePlain(category),
        planned,
        actual,
        remaining,
        percent: Math.min(999, rawPercent),
        progressPercent: Math.max(0, Math.min(100, rawPercent))
      };
    })
    .filter((row) => {
      return row.planned > 0 || row.actual > 0;
    })
    .sort((a, b) => {
      if (a.remaining < 0 !== b.remaining < 0) {
        return a.remaining < 0 ? -1 : 1;
      }
      return Math.max(b.actual, b.planned) - Math.max(a.actual, a.planned);
    });
}

export function buildBudgetRouteViewModel(workbook, options = {}) {
  const range = normalizeDateRange(options.range);
  const planVsActual = buildBudgetPlanVsActualViewModel(workbook, range, options.planVsActual);
  const categoryRows = buildBudgetCategoryRowsViewModel(
    workbook,
    range,
    Object.assign({}, options.categoryRows, { planVsActual })
  );
  const totalBudget = roundMoney(planVsActual.plannedByType.expense || 0);
  const spent = roundMoney(planVsActual.actual.expense || 0);
  const leftToSpend = roundMoney(totalBudget - spent);
  const spentPercent =
    totalBudget > 0 ? Math.min(999, Math.round((spent / totalBudget) * 100)) : spent > 0 ? 100 : 0;
  const periodProgress = getBudgetPeriodProgress(range, options.currentDate);
  const dailyAverage = roundMoney(spent / Math.max(1, periodProgress.daysElapsed));
  const dailyBudget = roundMoney(totalBudget / periodProgress.periodDays);
  const todaySpent = periodProgress.isActive
    ? roundMoney(
        getPeriodActivitySummary(workbook, {
          start: periodProgress.currentDate,
          end: periodProgress.currentDate
        }).expense || 0
      )
    : 0;
  const remainingToday = periodProgress.isActive ? roundMoney(dailyBudget - todaySpent) : 0;
  const safeToSpendToday =
    periodProgress.isActive && periodProgress.remainingDays > 0
      ? roundMoney(Math.max(0, leftToSpend) / periodProgress.remainingDays)
      : 0;

  return {
    range,
    planVsActual,
    periodSummary: planVsActual.actual,
    categoryRows,
    spendingRows: buildSpendingRows(workbook, planVsActual.actual, 'expense', 6),
    summary: {
      totalBudget,
      spent,
      leftToSpend,
      spentPercent,
      dailyAverage,
      periodDays: periodProgress.periodDays,
      daysElapsed: periodProgress.daysElapsed,
      remainingDays: periodProgress.remainingDays,
      dailyBudget,
      todaySpent,
      remainingToday,
      safeToSpendToday,
      leftTone: leftToSpend >= 0 ? 'good' : 'bad',
      leftCopy: leftToSpend >= 0 ? 'You are under budget' : 'You are over budget'
    }
  };
}
