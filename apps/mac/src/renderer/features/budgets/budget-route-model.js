import { buildBudgetRouteViewModel, formatVisibleDateRangeLabel } from '@cavalry/finance-core';

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
    throw new TypeError('Budget route models require an injected ISO currentDate or clock.');
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

function getMonthRange(year, monthIndex) {
  const normalizedMonthIndex = Math.max(0, Math.min(11, Math.trunc(Number(monthIndex)) || 0));
  const month = normalizedMonthIndex + 1;
  const yearKey = String(year).padStart(4, '0');
  const monthKey = String(month).padStart(2, '0');
  return {
    start: `${yearKey}-${monthKey}-01`,
    end: `${yearKey}-${monthKey}-${String(getDaysInMonth(year, month)).padStart(2, '0')}`
  };
}

function getCurrentWorkbookMonthIndex(workbook, currentDate) {
  const workbookYear = getWorkbookYear(workbook, currentDate);
  const currentYear = Number(currentDate.slice(0, 4));
  if (currentYear < workbookYear) {
    return 0;
  }
  if (currentYear > workbookYear) {
    return 11;
  }
  return Number(currentDate.slice(5, 7)) - 1;
}

function selectSheet(workbook, viewState, currentDate) {
  const sheets = asArray(workbook && workbook.sheets);
  const requestedId = asString(viewState.sheetId || viewState.activeSheetId);
  if (requestedId) {
    const requested = sheets.find((sheet) => asString(sheet && sheet.id) === requestedId);
    if (requested) {
      return requested;
    }
  }

  const requestedRange = normalizeRange(viewState.range);
  if (requestedRange) {
    const rangeYear = Number(requestedRange.start.slice(0, 4));
    const rangeMonthIndex = Number(requestedRange.start.slice(5, 7)) - 1;
    if (rangeYear === getWorkbookYear(workbook, currentDate)) {
      const rangeSheet = sheets.find(
        (sheet) => Number(sheet && sheet.monthIndex) === rangeMonthIndex
      );
      if (rangeSheet) return rangeSheet;
    }
    return null;
  }

  const workbookYear = getWorkbookYear(workbook, currentDate);
  const currentYear = Number(currentDate.slice(0, 4));
  if (workbookYear === currentYear) {
    const currentMonthIndex = Number(currentDate.slice(5, 7)) - 1;
    const currentMonthSheet = sheets.find(
      (sheet) => Number(sheet && sheet.monthIndex) === currentMonthIndex
    );
    if (currentMonthSheet) {
      return currentMonthSheet;
    }
  }
  return sheets[0] || null;
}

function toSheetModel(sheet) {
  if (!sheet) {
    return null;
  }
  return {
    id: asString(sheet.id),
    name: asString(sheet.name),
    monthIndex: Math.max(0, Math.min(11, Math.trunc(Number(sheet.monthIndex)) || 0))
  };
}

function sheetHasBudgetValues(sheet) {
  const budgets = sheet && sheet.budgets;
  if (Array.isArray(budgets)) {
    return budgets.some((budget) => Number(budget && (budget.planned ?? budget.amount)) !== 0);
  }
  if (budgets && typeof budgets === 'object') {
    return Object.keys(budgets).some((key) => Number(budgets[key]) !== 0);
  }
  return false;
}

function getEmptyState(workbook, sheet, coreModel) {
  const hasSheets = asArray(workbook && workbook.sheets).length > 0;
  const hasTransactions = asArray(workbook && workbook.transactions).length > 0;
  const hasCategoryBudgets =
    asArray(coreModel && coreModel.categoryRows).length > 0 || sheetHasBudgetValues(sheet);
  return {
    isEmpty: !hasSheets && !hasTransactions && !hasCategoryBudgets,
    hasSheets,
    hasTransactions,
    hasCategoryBudgets
  };
}

function buildCategoryOptions(workbook, sheet) {
  const budgetMap = new Map(
    asArray(sheet && sheet.budgets).map((budget) => [
      asString(budget && budget.categoryId),
      Number(budget && budget.planned) || 0
    ])
  );
  const createdAtMap = new Map(
    asArray(sheet && sheet.budgets).map((budget) => [
      asString(budget && budget.categoryId),
      asString(budget && budget.createdAt)
    ])
  );
  const deletableCategoryIds = new Set([
    ...asArray(sheet && sheet.budgets)
      .filter((budget) => Number(budget && budget.planned) > 0)
      .map((budget) => asString(budget && budget.categoryId)),
    ...asArray(sheet && sheet.budgetLineItems)
      .filter((item) => item && item.isActive !== false && !asString(item.recurringItemId))
      .map((item) => asString(item.categoryId))
  ]);
  return asArray(workbook && workbook.categories)
    .filter((category) => category && category.isActive !== false)
    .filter((category) => category.type !== 'income')
    .map((category) => ({
      id: asString(category.id),
      name: asString(category.name),
      type: asString(category.type),
      icon: asString(category.icon),
      color: asString(category.color),
      planned: budgetMap.get(asString(category.id)) || 0,
      createdAt: createdAtMap.get(asString(category.id)) || '',
      canDelete: deletableCategoryIds.has(asString(category.id))
    }))
    .filter((category) => category.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function attachCategoryTransactions(workbook, rows, range) {
  return asArray(rows).map((row) => ({
    ...row,
    transactions: asArray(workbook && workbook.transactions)
      .filter((transaction) => {
        const date = normalizeDateKey(transaction && transaction.date);
        return (
          asString(transaction && transaction.categoryId) ===
            asString(row.category && row.category.id) &&
          date &&
          date >= range.start &&
          date <= range.end
        );
      })
      .map((transaction) => ({
        id: asString(transaction.id),
        description: asString(transaction.description) || 'Untitled transaction',
        date: normalizeDateKey(transaction.date),
        amount: Math.abs(Number(transaction.amount) || 0),
        currency: asString(
          transaction.originalCurrency || transaction.currency || workbook.currency
        )
      }))
      .sort((left, right) => right.date.localeCompare(left.date))
  }));
}

export function buildBudgetRouteModel(workbook, viewState = {}, dependencies = {}) {
  if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
    throw new TypeError('Budget route models require a hydrated workbook.');
  }

  const sourceViewState = asObject(viewState);
  const currentDate = readCurrentDate(dependencies);
  const workbookYear = getWorkbookYear(workbook, currentDate);
  const selectedSheet = selectSheet(workbook, sourceViewState, currentDate);
  const range =
    normalizeRange(sourceViewState.range) ||
    (selectedSheet
      ? getMonthRange(workbookYear, selectedSheet.monthIndex)
      : getMonthRange(workbookYear, getCurrentWorkbookMonthIndex(workbook, currentDate)));
  const sheet = toSheetModel(selectedSheet);
  const coreModel = buildBudgetRouteViewModel(workbook, { range, currentDate });
  const categoryOptions = buildCategoryOptions(workbook, selectedSheet);
  const resolvedViewState = {
    sheetId: sheet ? sheet.id : '',
    range
  };

  return cloneSerializable({
    ...coreModel,
    categoryRows: attachCategoryTransactions(workbook, coreModel.categoryRows, range),
    currency: asString(workbook.currency).toUpperCase() || 'PHP',
    currentDate,
    periodLabel: formatVisibleDateRangeLabel(range),
    sheet,
    categoryOptions,
    canAddBudget: categoryOptions.length > 0,
    viewState: resolvedViewState,
    emptyState: getEmptyState(workbook, selectedSheet, coreModel)
  });
}
