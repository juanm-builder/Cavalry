import { buildDashboardRouteViewModel, formatVisibleDateRangeLabel } from '@cavalry/finance-core';

const DASHBOARD_MODULE_IDS = ['command', 'flows', 'money_shape'];

const DASHBOARD_SPENDING_PRESETS = new Set([
  'year_to_date',
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'full_year',
  'custom'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year, month) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function normalizeDateKey(value) {
  let rawValue = value;
  if (rawValue && typeof rawValue.toISOString === 'function') {
    try {
      rawValue = rawValue.toISOString();
    } catch (_error) {
      return '';
    }
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(asString(rawValue));
  if (!match) {
    return '';
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > getDaysInMonth(year, month)) {
    return '';
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeMonthKey(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(asString(value));
  const month = match ? Number(match[2]) : 0;
  return match && month >= 1 && month <= 12 ? match[0] : '';
}

function readCurrentDate(dependencies) {
  const source = asObject(dependencies);
  let value = source.currentDate;
  if (!value && typeof source.clock === 'function') {
    value = source.clock();
  } else if (!value && source.clock && typeof source.clock.today === 'function') {
    value = source.clock.today();
  } else if (!value && source.clock && typeof source.clock.now === 'function') {
    value = source.clock.now();
  }
  const currentDate = normalizeDateKey(value);
  if (!currentDate) {
    throw new TypeError('Dashboard route models require an injected ISO currentDate or clock.');
  }
  return currentDate;
}

function getWorkbookYear(workbook, currentDate) {
  const candidate = Math.trunc(Number(workbook && workbook.year));
  return candidate >= 1000 && candidate <= 9999 ? candidate : Number(currentDate.slice(0, 4));
}

function normalizeRange(value) {
  const source = asObject(value);
  const start = normalizeDateKey(source.start || source.startDate);
  const end = normalizeDateKey(source.end || source.endDate);
  return start && end && start <= end ? { start, end } : null;
}

function getDefaultRange(workbook, currentDate) {
  const workbookYear = getWorkbookYear(workbook, currentDate);
  const currentYear = Number(currentDate.slice(0, 4));
  const start = `${String(workbookYear).padStart(4, '0')}-01-01`;
  if (currentYear < workbookYear) {
    return { start, end: start };
  }
  if (currentYear > workbookYear) {
    return { start, end: `${String(workbookYear).padStart(4, '0')}-12-31` };
  }
  return { start, end: currentDate };
}

function normalizeLayout(rawLayout) {
  const rawItems = Array.isArray(rawLayout)
    ? rawLayout
    : asObject(rawLayout) === rawLayout
      ? Object.keys(rawLayout).map((id) => ({ id, visible: rawLayout[id] !== false }))
      : [];
  const normalized = [];

  rawItems.forEach((item) => {
    const source = asObject(item);
    const id = asString(source.id || item);
    if (!DASHBOARD_MODULE_IDS.includes(id) || normalized.some((entry) => entry.id === id)) {
      return;
    }
    normalized.push({
      id,
      visible: typeof source.visible === 'boolean' ? source.visible : true
    });
  });

  DASHBOARD_MODULE_IDS.forEach((id) => {
    if (!normalized.some((entry) => entry.id === id)) {
      normalized.push({ id, visible: true });
    }
  });
  return normalized;
}

function buildCategoryLookup(workbook) {
  return asArray(workbook && workbook.categories).reduce((lookup, category) => {
    const id = asString(category && category.id);
    if (id) {
      lookup[id] = {
        id,
        name: asString(category && category.name),
        type: asString(category && category.type)
      };
    }
    return lookup;
  }, {});
}

function getDashboardViewState(workbook, viewState, currentDate) {
  const source = asObject(viewState);
  const range = normalizeRange(source.range) || getDefaultRange(workbook, currentDate);
  const asOfDate = normalizeDateKey(source.asOfDate) || range.end;
  const rawLayout = Object.prototype.hasOwnProperty.call(source, 'layout')
    ? source.layout
    : workbook && workbook.settings && workbook.settings.dashboardLayout;
  const spendingPreset = DASHBOARD_SPENDING_PRESETS.has(source.spendingPreset)
    ? source.spendingPreset
    : 'year_to_date';
  return {
    range,
    asOfDate,
    spendingPreset,
    spendingStartMonth: normalizeMonthKey(source.spendingStartMonth),
    spendingEndMonth: normalizeMonthKey(source.spendingEndMonth),
    layout: normalizeLayout(rawLayout)
  };
}

function getEmptyState(workbook) {
  const hasAccounts = asArray(workbook && workbook.accounts).length > 0;
  const hasCategories = asArray(workbook && workbook.categories).length > 0;
  const hasTransactions = asArray(workbook && workbook.transactions).length > 0;
  const hasBudgetSheets = asArray(workbook && workbook.sheets).length > 0;
  return {
    isEmpty: !hasAccounts && !hasCategories && !hasTransactions && !hasBudgetSheets,
    hasAccounts,
    hasCategories,
    hasTransactions,
    hasBudgetSheets
  };
}

export function buildDashboardRouteContext(workbook, viewState = {}, dependencies = {}) {
  if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
    throw new TypeError('Dashboard route context requires a hydrated workbook.');
  }

  const currentDate = readCurrentDate(dependencies);
  const resolvedViewState = getDashboardViewState(workbook, viewState, currentDate);
  return {
    currentDate,
    periodLabel: formatVisibleDateRangeLabel(resolvedViewState.range),
    range: { ...resolvedViewState.range },
    asOfDate: resolvedViewState.asOfDate
  };
}

export function buildDashboardRouteModel(workbook, viewState = {}, dependencies = {}) {
  if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
    throw new TypeError('Dashboard route models require a hydrated workbook.');
  }

  const currentDate = readCurrentDate(dependencies);
  const resolvedViewState = getDashboardViewState(workbook, viewState, currentDate);
  const coreModel = buildDashboardRouteViewModel(workbook, {
    range: resolvedViewState.range,
    asOfDate: resolvedViewState.asOfDate,
    currentDate,
    spendingPreset: resolvedViewState.spendingPreset,
    spendingStartMonth: resolvedViewState.spendingStartMonth,
    spendingEndMonth: resolvedViewState.spendingEndMonth
  });

  return cloneSerializable({
    ...coreModel,
    currency: asString(workbook.currency).toUpperCase() || 'PHP',
    currentDate,
    periodLabel: formatVisibleDateRangeLabel(resolvedViewState.range),
    layout: resolvedViewState.layout,
    categoryLookup: buildCategoryLookup(workbook),
    viewState: resolvedViewState,
    emptyState: getEmptyState(workbook)
  });
}
