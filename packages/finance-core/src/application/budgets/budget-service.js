import { roundMoney } from '../../domain/money.js';
import {
  getLedgerTransactionBaseAmount,
  getLedgerTransactionFlowKind
} from '../../domain/ledger/transactions.js';
import { getRecurringProjectionTotalsByCategory } from '../recurring/recurring-analysis-service.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function baseCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

function getCategoryById(workbook, categoryId) {
  const id = asString(categoryId);
  return (
    asArray(workbook && workbook.categories).find(
      (category) => asString(category && category.id) === id
    ) || null
  );
}

function getSheetById(workbook, sheetId) {
  const id = asString(sheetId);
  return (
    asArray(workbook && workbook.sheets).find((sheet) => asString(sheet && sheet.id) === id) || null
  );
}

function monthKeyFromSheet(workbook, sheet) {
  if (sheet && sheet.monthKey) {
    return asString(sheet.monthKey);
  }
  const year = Number(workbook && workbook.year) || new Date().getFullYear();
  const monthIndex = Number(sheet && sheet.monthIndex) || 0;
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function transactionMonthKey(transaction) {
  const date = asString(transaction && transaction.date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date.slice(0, 7)
    : asString(transaction && transaction.monthKey);
}

function convertAmountToBase(workbook, amount, currency) {
  const source = asString(currency).toUpperCase() || baseCurrency(workbook);
  const numeric = Number(amount) || 0;
  if (source === baseCurrency(workbook)) {
    return roundMoney(numeric);
  }
  const usdToBaseRate =
    Number(workbook && workbook.settings && workbook.settings.usdToBaseRate) || 0;
  if (source === 'USD' && baseCurrency(workbook) === 'PHP' && usdToBaseRate > 0) {
    return roundMoney(numeric * usdToBaseRate);
  }
  return roundMoney(numeric);
}

export function normalizeBudget(budget) {
  return {
    categoryId: asString(budget && budget.categoryId),
    planned: roundMoney(Number(budget && budget.planned) || 0)
  };
}

export function normalizeBudgetLineItem(item, index = 0, workbook = {}) {
  return {
    id: asString(item && item.id) || `budget_line_${String(index)}`,
    categoryId: asString(item && item.categoryId),
    name: asString(item && item.name) || 'Budget item',
    planned: roundMoney(Number(item && item.planned) || 0),
    currency: asString(item && item.currency).toUpperCase() || baseCurrency(workbook),
    dueDate: asString(item && item.dueDate),
    note: asString(item && item.note),
    kind: asString(item && item.kind) || 'bill',
    frequency: asString(item && item.frequency) || 'Monthly',
    paymentMethod: asString(item && item.paymentMethod),
    accountId: asString(item && item.accountId),
    recurringItemId: asString(item && item.recurringItemId),
    autoRenew: item && item.autoRenew === true,
    isRecurringBill: item && item.isRecurringBill === true,
    isActive: item && item.isActive === false ? false : true
  };
}

export function syncSheetBudgetsFromLineItems(workbook, sheet) {
  if (!sheet) {
    return [];
  }
  const budgetMap = {};
  asArray(sheet.budgetLineItems).forEach((item) => {
    if (!item.categoryId || item.isActive === false || item.recurringItemId) {
      return;
    }
    budgetMap[item.categoryId] = roundMoney(
      (budgetMap[item.categoryId] || 0) +
        convertAmountToBase(workbook, item.planned, item.currency || baseCurrency(workbook))
    );
  });
  const directBudgets = [];
  const directCategoryIds = new Set();
  asArray(sheet.budgets).forEach((budget) => {
    const normalized = normalizeBudget(budget);
    if (!normalized.categoryId || !(Math.abs(normalized.planned) > 0.0001)) {
      return;
    }
    directCategoryIds.add(normalized.categoryId);
    directBudgets.push(normalized);
  });
  sheet.budgets = directBudgets
    .concat(
      Object.keys(budgetMap)
        .filter((categoryId) => !directCategoryIds.has(categoryId))
        .map((categoryId) => ({
          categoryId,
          planned: roundMoney(budgetMap[categoryId])
        }))
    )
    .filter((budget) => budget.categoryId && Math.abs(budget.planned) > 0.0001);
  return sheet.budgets;
}

export function getSheetBudgetMap(workbook, sheet) {
  const budgetMap = {};
  const directCategoryIds = new Set();
  const recurringTotals = getRecurringProjectionTotalsByCategory(workbook, sheet);
  const linkedLegacyTotals = {};
  asArray(sheet && sheet.budgetLineItems).forEach((item) => {
    if (!item.categoryId || item.isActive === false || !item.recurringItemId) {
      return;
    }
    linkedLegacyTotals[item.categoryId] = roundMoney(
      (linkedLegacyTotals[item.categoryId] || 0) +
        convertAmountToBase(workbook, item.planned, item.currency || baseCurrency(workbook))
    );
  });
  asArray(sheet && sheet.budgets).forEach((budget) => {
    const normalized = normalizeBudget(budget);
    if (!normalized.categoryId) {
      return;
    }
    const category = getCategoryById(workbook, normalized.categoryId);
    const budgetAmount = convertAmountToBase(
      workbook,
      normalized.planned,
      (category && category.currency) || baseCurrency(workbook)
    );
    const generatedAmount = roundMoney(
      recurringTotals[normalized.categoryId] || 0 || linkedLegacyTotals[normalized.categoryId] || 0
    );
    if (generatedAmount > 0 && Math.abs(budgetAmount - generatedAmount) < 0.01) {
      return;
    }
    budgetMap[normalized.categoryId] = roundMoney(
      (budgetMap[normalized.categoryId] || 0) + budgetAmount
    );
    if (Math.abs(budgetAmount) > 0.0001) {
      directCategoryIds.add(normalized.categoryId);
    }
  });
  Object.keys(recurringTotals).forEach((categoryId) => {
    if (!directCategoryIds.has(categoryId)) {
      budgetMap[categoryId] = roundMoney(
        (budgetMap[categoryId] || 0) + recurringTotals[categoryId]
      );
    }
  });
  asArray(sheet && sheet.budgetLineItems).forEach((item) => {
    if (
      !item.categoryId ||
      item.isActive === false ||
      item.recurringItemId ||
      directCategoryIds.has(item.categoryId)
    ) {
      return;
    }
    budgetMap[item.categoryId] = roundMoney(
      (budgetMap[item.categoryId] || 0) +
        convertAmountToBase(workbook, item.planned, item.currency || baseCurrency(workbook))
    );
  });
  return budgetMap;
}

export function getBudgetRemaining(category, planned, actual) {
  const nextPlanned = Number(planned) || 0;
  const nextActual = Number(actual) || 0;
  return category && category.type === 'income'
    ? roundMoney(nextActual - nextPlanned)
    : roundMoney(nextPlanned - nextActual);
}

export function getBudgetStatus(category, planned, actual) {
  const nextPlanned = Number(planned) || 0;
  const nextActual = Number(actual) || 0;
  const remaining = getBudgetRemaining(category, nextPlanned, nextActual);
  if (category && category.type === 'income') {
    if (!(nextPlanned > 0) && nextActual > 0) return { label: 'Unplanned income', tone: 'good' };
    if (remaining >= 0.01) return { label: 'Ahead', tone: 'good' };
    if (remaining <= -0.01) return { label: 'Below plan', tone: 'bad' };
    return { label: 'On plan', tone: 'info' };
  }
  if (!(nextPlanned > 0) && nextActual > 0) return { label: 'Unplanned', tone: 'bad' };
  if (remaining < -0.01) return { label: 'Overspent', tone: 'bad' };
  if (nextPlanned > 0 && nextActual === 0) return { label: 'Funded', tone: 'info' };
  if (remaining > 0.01) return { label: 'Available', tone: 'good' };
  return { label: 'On plan', tone: 'info' };
}

export function getSheetActualByCategory(workbook, sheet) {
  const monthKey = monthKeyFromSheet(workbook, sheet);
  const totals = {};
  asArray(workbook && workbook.transactions).forEach((transaction) => {
    if (transactionMonthKey(transaction) !== monthKey) {
      return;
    }
    const flow = getLedgerTransactionFlowKind(workbook, transaction);
    if (!['inflow', 'expense', 'savings', 'debt'].includes(flow)) {
      return;
    }
    const categoryId = asString(transaction && transaction.categoryId) || '__uncategorized';
    totals[categoryId] = roundMoney(
      (totals[categoryId] || 0) + getLedgerTransactionBaseAmount(transaction)
    );
  });
  return totals;
}

export function buildBudgetSummary(workbook, sheet) {
  const budgetMap = getSheetBudgetMap(workbook, sheet);
  const actualByCategory = getSheetActualByCategory(workbook, sheet);
  const categoryIds = Array.from(
    new Set(Object.keys(budgetMap).concat(Object.keys(actualByCategory)))
  ).sort();
  const rows = categoryIds.map((categoryId) => {
    const category =
      categoryId === '__uncategorized' ? null : getCategoryById(workbook, categoryId);
    const planned = roundMoney(budgetMap[categoryId] || 0);
    const actual = roundMoney(actualByCategory[categoryId] || 0);
    const remaining = getBudgetRemaining(category, planned, actual);
    const status = getBudgetStatus(category, planned, actual);
    return {
      categoryId,
      categoryName: category
        ? category.name
        : categoryId === '__uncategorized'
          ? 'Uncategorized'
          : 'Missing category',
      categoryType: category ? category.type : 'expense',
      isArchived: category ? category.isActive === false : false,
      isMissing: categoryId !== '__uncategorized' && !category,
      planned,
      actual,
      remaining,
      statusLabel: status.label,
      statusTone: status.tone
    };
  });
  const totals = rows.reduce(
    (summary, row) => {
      const type = row.categoryType || 'expense';
      summary.plannedByType[type] = roundMoney((summary.plannedByType[type] || 0) + row.planned);
      summary.actualByType[type] = roundMoney((summary.actualByType[type] || 0) + row.actual);
      return summary;
    },
    {
      plannedByType: { income: 0, expense: 0, savings: 0, debt: 0 },
      actualByType: { income: 0, expense: 0, savings: 0, debt: 0 }
    }
  );
  totals.plannedNet = roundMoney(
    totals.plannedByType.income -
      totals.plannedByType.expense -
      totals.plannedByType.savings -
      totals.plannedByType.debt
  );
  totals.actualNet = roundMoney(
    totals.actualByType.income -
      totals.actualByType.expense -
      totals.actualByType.savings -
      totals.actualByType.debt
  );
  return {
    currency: baseCurrency(workbook),
    sheetId: asString(sheet && sheet.id),
    monthKey: monthKeyFromSheet(workbook, sheet),
    rows: rows.sort(
      (a, b) =>
        Math.abs(b.actual || b.planned) - Math.abs(a.actual || a.planned) ||
        a.categoryName.localeCompare(b.categoryName)
    ),
    totals
  };
}

export function createBudget(workbook, sheetId, input = {}) {
  const sheet = getSheetById(workbook, sheetId);
  if (!sheet) throw new Error('Budget sheet not found.');
  const category = getCategoryById(workbook, input.categoryId);
  if (!category) throw new Error('Budget category not found.');
  const planned = roundMoney(Number(input.planned) || 0);
  if (!(Math.abs(planned) > 0.0001)) throw new Error('Enter a planned budget amount.');
  sheet.budgets = asArray(sheet.budgets).filter(
    (budget) => asString(budget && budget.categoryId) !== category.id
  );
  const budget = { categoryId: category.id, planned };
  sheet.budgets.push(budget);
  return budget;
}

export function editBudget(workbook, sheetId, categoryId, input = {}) {
  const sheet = getSheetById(workbook, sheetId);
  if (!sheet) throw new Error('Budget sheet not found.');
  const targetId = asString(categoryId);
  const budget = asArray(sheet.budgets).find(
    (item) => asString(item && item.categoryId) === targetId
  );
  if (!budget) throw new Error('Budget not found.');
  budget.planned = roundMoney(Number(input.planned) || 0);
  if (!(Math.abs(budget.planned) > 0.0001)) {
    sheet.budgets = asArray(sheet.budgets).filter((item) => item !== budget);
    return null;
  }
  return normalizeBudget(budget);
}

export function archiveBudget(workbook, sheetId, categoryId, options = {}) {
  const sheet = getSheetById(workbook, sheetId);
  if (!sheet) throw new Error('Budget sheet not found.');
  const lineItemId = asString(options.lineItemId);
  if (lineItemId) {
    const item = asArray(sheet.budgetLineItems).find(
      (lineItem) => asString(lineItem && lineItem.id) === lineItemId
    );
    if (!item) throw new Error('Budget line item not found.');
    item.isActive = false;
    syncSheetBudgetsFromLineItems(workbook, sheet);
    return { archived: true, type: 'line_item', id: lineItemId };
  }
  const targetId = asString(categoryId);
  const before = asArray(sheet.budgets).length;
  sheet.budgets = asArray(sheet.budgets).filter(
    (budget) => asString(budget && budget.categoryId) !== targetId
  );
  return {
    archived: before !== sheet.budgets.length,
    type: 'category_budget',
    categoryId: targetId
  };
}
