import { roundMoney } from '../../domain/money.js';
import {
  buildTransactionCalculationReceipt,
  getTransactionContributions
} from '../../domain/ledger/transaction-contributions.js';
import { getPeriodActivitySummary } from '../../domain/ledger/summaries.js';
import { getBudgetRemaining, getBudgetStatus, getSheetPlanSources } from './budget-service.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clonePlain(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function formatISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) return null;
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

function todayISO() {
  return formatISODate(new Date());
}

function normalizeDateRange(range) {
  const source = range && typeof range === 'object' ? range : {};
  return {
    start: asString(source.start || source.startDate),
    end: asString(source.end || source.endDate)
  };
}

function getMonthRange(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(asString(monthKey));
  if (!match) return { start: '', end: '' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!(year > 0 && month >= 1 && month <= 12)) return { start: '', end: '' };
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
  };
}

function getSheetMonthKey(workbook, sheet) {
  const direct = asString(sheet && sheet.monthKey);
  if (/^\d{4}-\d{2}$/.test(direct)) return direct;
  const year = Number(workbook && workbook.year) || new Date().getFullYear();
  const monthIndex = Math.max(0, Math.min(11, Number(sheet && sheet.monthIndex) || 0));
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function getCategoryById(workbook, categoryId) {
  const id = asString(categoryId);
  return asArray(workbook && workbook.categories).find(
    (category) => asString(category && category.id) === id
  );
}

function getInclusiveDateDays(startDate, endDate) {
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);
  if (!start || !end) return 1;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86400000;
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) / 86400000;
  return Math.max(1, endDay - startDay + 1);
}

function getBudgetPeriodProgress(range, currentDate) {
  const start = parseISODate(range && range.start);
  const end = parseISODate(range && range.end);
  const today = parseISODate(currentDate || todayISO());
  if (!start || !end || !today || start > end) {
    return { periodDays: 1, daysElapsed: 0, remainingDays: 0, currentDate: '', isActive: false };
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

function metricForCategoryType(type) {
  if (type === 'income') return 'income';
  if (type === 'savings') return 'savings';
  if (type === 'debt') return 'debt';
  return 'expense';
}

function getTransactionsInRange(workbook, range) {
  return asArray(workbook && workbook.transactions).filter((transaction) => {
    const date = asString(transaction && transaction.date);
    return date && (!range.start || date >= range.start) && (!range.end || date <= range.end);
  });
}

function makeCategoryModel(categoryId, category, fallbackType = 'expense') {
  if (category) return clonePlain(category);
  return {
    id: categoryId,
    name: categoryId === '__uncategorized' ? 'Uncategorized' : 'Missing category',
    type: fallbackType,
    icon: '',
    color: '',
    isActive: false
  };
}

function planSheetRelationship(visibleRange, sheetRange) {
  if (!sheetRange.start || !visibleRange.start || !visibleRange.end) return 'outside';
  if (sheetRange.end < visibleRange.start || sheetRange.start > visibleRange.end) return 'outside';
  if (sheetRange.start >= visibleRange.start && sheetRange.end <= visibleRange.end)
    return 'included';
  return 'partial';
}

function buildPlanData(workbook, visibleRange) {
  const plannedByCategory = {};
  const commitmentsByCategory = {};
  const sourcesByCategory = {};
  const commitmentRowsByCategory = {};
  const unresolvedCommitmentsByCategory = {};
  const attention = [];
  const includedMonthKeys = [];
  const partialMonthKeys = [];

  asArray(workbook && workbook.sheets).forEach((sheet) => {
    const monthKey = getSheetMonthKey(workbook, sheet);
    const sheetRange = getMonthRange(monthKey);
    const relationship = planSheetRelationship(visibleRange, sheetRange);
    if (relationship === 'outside') return;
    if (relationship === 'partial') {
      partialMonthKeys.push(monthKey);
      attention.push({
        code: 'partial_month_plan_excluded',
        monthKey,
        message: `${monthKey} is only partly inside this date range, so its full-month plan is not included.`
      });
      return;
    }

    includedMonthKeys.push(monthKey);
    const plan = getSheetPlanSources(workbook, sheet);
    Object.entries(plan.manualByCategory).forEach(([categoryId, amount]) => {
      plannedByCategory[categoryId] = roundMoney((plannedByCategory[categoryId] || 0) + amount);
      sourcesByCategory[categoryId] = (sourcesByCategory[categoryId] || []).concat(
        asArray(plan.manualSourcesByCategory[categoryId]).map((source) => ({ ...source, monthKey }))
      );
    });
    Object.entries(plan.commitmentsByCategory).forEach(([categoryId, amount]) => {
      commitmentsByCategory[categoryId] = roundMoney(
        (commitmentsByCategory[categoryId] || 0) + amount
      );
    });
    asArray(plan.commitmentRows).forEach((row) => {
      if (!commitmentRowsByCategory[row.categoryId]) commitmentRowsByCategory[row.categoryId] = [];
      commitmentRowsByCategory[row.categoryId].push(clonePlain(row));
    });
    Object.entries(plan.unresolvedCommitmentsByCategory).forEach(([categoryId, rows]) => {
      unresolvedCommitmentsByCategory[categoryId] = (
        unresolvedCommitmentsByCategory[categoryId] || []
      ).concat(clonePlain(rows));
    });
    asArray(plan.unresolvedManualItems).forEach((item) => {
      attention.push({
        code: 'manual_plan_fx_unresolved',
        monthKey,
        categoryId: item.categoryId,
        item,
        message: item.warning
      });
    });
  });

  return {
    plannedByCategory,
    commitmentsByCategory,
    sourcesByCategory,
    commitmentRowsByCategory,
    unresolvedCommitmentsByCategory,
    includedMonthKeys,
    partialMonthKeys,
    attention
  };
}

function buildCategoryRows(workbook, visibleRange, actual, planData) {
  const categoryIds = new Set([
    ...Object.keys(planData.plannedByCategory),
    ...Object.keys(planData.commitmentsByCategory),
    ...Object.keys(actual.categoryTotals || {})
  ]);
  const transactions = getTransactionsInRange(workbook, visibleRange);

  return Array.from(categoryIds)
    .map((categoryId) => {
      const category =
        categoryId === '__uncategorized' ? null : getCategoryById(workbook, categoryId);
      const categoryType = asString(category && category.type) || 'expense';
      const planned = roundMoney(planData.plannedByCategory[categoryId] || 0);
      const committed = roundMoney(planData.commitmentsByCategory[categoryId] || 0);
      const actualAmount = roundMoney(
        (actual.categoryTotals && actual.categoryTotals[categoryId]) || 0
      );
      const isMissing = categoryId !== '__uncategorized' && !category;
      const isArchived = !!(category && category.isActive === false);
      const includedInPlanTotals = !isMissing && !isArchived;
      const trustedPlanned = includedInPlanTotals ? planned : 0;
      const remaining = getBudgetRemaining(category, trustedPlanned, actualAmount);
      const status = getBudgetStatus(category, trustedPlanned, actualAmount);
      const rawPercent =
        trustedPlanned > 0
          ? Math.round((actualAmount / trustedPlanned) * 100)
          : actualAmount > 0
            ? 100
            : 0;
      const metric = metricForCategoryType(categoryType);
      const receipt = buildTransactionCalculationReceipt(workbook, transactions, {
        metric,
        range: visibleRange,
        categoryId
      });
      return {
        category: makeCategoryModel(categoryId, category, categoryType),
        categoryId,
        categoryType,
        planned,
        trustedPlanned,
        committed,
        actual: actualAmount,
        remaining,
        percent: Math.min(999, rawPercent),
        progressPercent: Math.max(0, Math.min(100, rawPercent)),
        statusLabel: isMissing
          ? 'Needs category repair'
          : isArchived
            ? 'Archived category'
            : status.label,
        statusTone: isMissing || isArchived ? 'warning' : status.tone,
        isMissing,
        isArchived,
        isUncategorized: categoryId === '__uncategorized',
        includedInPlanTotals,
        sources: clonePlain(planData.sourcesByCategory[categoryId] || []),
        commitmentRows: clonePlain(planData.commitmentRowsByCategory[categoryId] || []),
        unresolvedCommitments: clonePlain(
          planData.unresolvedCommitmentsByCategory[categoryId] || []
        ),
        receipt,
        transactions: receipt.contributions.map((item) => ({
          id: item.transactionId,
          transactionId: item.transactionId,
          description: item.description,
          date: item.date,
          eventKind: item.eventKind,
          signedBaseAmount: item.signedBaseAmount,
          amount: item.signedBaseAmount,
          baseAmount: item.baseAmount,
          nativeAmount: item.nativeAmount,
          nativeCurrency: item.nativeCurrency,
          currency: receipt.baseCurrency,
          warnings: item.warnings
        }))
      };
    })
    .filter(
      (row) =>
        Math.abs(row.planned) > 0.0001 ||
        Math.abs(row.committed) > 0.0001 ||
        Math.abs(row.actual) > 0.0001 ||
        row.unresolvedCommitments.length > 0
    )
    .sort((a, b) => {
      if (a.isMissing !== b.isMissing) return a.isMissing ? -1 : 1;
      if (a.isArchived !== b.isArchived) return a.isArchived ? -1 : 1;
      if (a.remaining < 0 !== b.remaining < 0) return a.remaining < 0 ? -1 : 1;
      return (
        Math.max(Math.abs(b.actual), Math.abs(b.planned), Math.abs(b.committed)) -
          Math.max(Math.abs(a.actual), Math.abs(a.planned), Math.abs(a.committed)) ||
        asString(a.category && a.category.name).localeCompare(
          asString(b.category && b.category.name)
        )
      );
    });
}

function sumRows(rows, field) {
  return roundMoney(asArray(rows).reduce((sum, row) => sum + (Number(row && row[field]) || 0), 0));
}

function buildSpendingRows(rows, limit = 6) {
  return asArray(rows)
    .filter((row) => row.categoryType === 'expense' && Math.abs(row.actual) > 0.0001)
    .slice()
    .sort((a, b) => Math.abs(b.actual) - Math.abs(a.actual))
    .slice(0, limit)
    .map((row) => ({ category: clonePlain(row.category), total: row.actual }));
}

export function buildBudgetPeriodSummaryViewModel(workbook, range, _options = {}) {
  return clonePlain(getPeriodActivitySummary(workbook, normalizeDateRange(range)));
}

export function buildBudgetPlanVsActualViewModel(workbook, range, _options = {}) {
  const visibleRange = normalizeDateRange(range);
  const actual = buildBudgetPeriodSummaryViewModel(workbook, visibleRange);
  const planData = buildPlanData(workbook, visibleRange);
  const plannedByType = { income: 0, expense: 0, savings: 0, debt: 0 };
  const trustedPlannedByCategory = {};

  Object.entries(planData.plannedByCategory).forEach(([categoryId, amount]) => {
    const category = getCategoryById(workbook, categoryId);
    if (!category || category.isActive === false) return;
    const type = asString(category.type) || 'expense';
    plannedByType[type] = roundMoney((plannedByType[type] || 0) + amount);
    trustedPlannedByCategory[categoryId] = amount;
  });

  const committedExpense = roundMoney(
    Object.entries(planData.commitmentsByCategory).reduce((sum, [categoryId, amount]) => {
      const category = getCategoryById(workbook, categoryId);
      return category && category.isActive !== false && category.type === 'expense'
        ? sum + amount
        : sum;
    }, 0)
  );
  const plannedOutflow = roundMoney(
    plannedByType.expense + plannedByType.savings + plannedByType.debt
  );
  const plannedNet = roundMoney(plannedByType.income - plannedOutflow);

  return {
    range: visibleRange,
    actual,
    plannedByType,
    plannedByCategory: clonePlain(planData.plannedByCategory),
    trustedPlannedByCategory,
    commitmentsByCategory: clonePlain(planData.commitmentsByCategory),
    committedExpense,
    plannedOutflow,
    plannedNet,
    actualNet: actual.net,
    variance: roundMoney(actual.net - plannedNet),
    planScope: {
      includedMonthKeys: planData.includedMonthKeys,
      excludedPartialMonthKeys: planData.partialMonthKeys
    },
    attention: clonePlain(planData.attention),
    _planData: planData
  };
}

export function buildBudgetCategoryRowsViewModel(workbook, range, options = {}) {
  const planVsActual = options.planVsActual || buildBudgetPlanVsActualViewModel(workbook, range);
  const planData = planVsActual._planData || buildPlanData(workbook, normalizeDateRange(range));
  return buildCategoryRows(workbook, normalizeDateRange(range), planVsActual.actual, planData);
}

export function buildBudgetRouteViewModel(workbook, options = {}) {
  const range = normalizeDateRange(options.range);
  const planVsActual = buildBudgetPlanVsActualViewModel(workbook, range);
  const categoryRows = buildBudgetCategoryRowsViewModel(workbook, range, { planVsActual });
  const incomeRows = categoryRows.filter((row) => row.categoryType === 'income');
  const expenseRows = categoryRows.filter((row) => row.categoryType === 'expense');
  const savingsRows = categoryRows.filter((row) => row.categoryType === 'savings');
  const debtRows = categoryRows.filter((row) => row.categoryType === 'debt');
  const attentionRows = categoryRows.filter(
    (row) => row.isMissing || row.isArchived || row.unresolvedCommitments.length > 0
  );

  const totalBudget = sumRows(
    expenseRows.filter((row) => row.includedInPlanTotals),
    'planned'
  );
  const committedSpending = roundMoney(planVsActual.committedExpense || 0);
  const uncoveredCommitments = roundMoney(
    expenseRows
      .filter((row) => row.includedInPlanTotals)
      .reduce(
        (sum, row) => sum + Math.max(0, (Number(row.committed) || 0) - (Number(row.planned) || 0)),
        0
      )
  );
  const coveredCommitments = roundMoney(Math.max(0, committedSpending - uncoveredCommitments));
  const spent = roundMoney(planVsActual.actual.expense || 0);
  const leftToSpend = roundMoney(totalBudget - spent);
  const plannedSavings = sumRows(
    savingsRows.filter((row) => row.includedInPlanTotals),
    'planned'
  );
  const plannedDebt = sumRows(
    debtRows.filter((row) => row.includedInPlanTotals),
    'planned'
  );
  const plannedOutflow = roundMoney(totalBudget + plannedSavings + plannedDebt);
  const plannedIncome = sumRows(
    incomeRows.filter((row) => row.includedInPlanTotals),
    'planned'
  );
  const income = roundMoney(planVsActual.actual.income || 0);
  const incomePlanBasis = plannedIncome > 0 ? plannedIncome : income;
  const incomePlanBasisSource = plannedIncome > 0 ? 'planned' : income > 0 ? 'actual' : 'none';
  const minimumPlannedOutflow = roundMoney(plannedOutflow + uncoveredCommitments);
  const unallocated = roundMoney(incomePlanBasis - minimumPlannedOutflow);
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

  const summary = {
    totalBudget,
    plannedSpending: totalBudget,
    committedSpending,
    coveredCommitments,
    uncoveredCommitments,
    spent,
    leftToSpend,
    spentPercent,
    plannedSavings,
    saved: roundMoney(planVsActual.actual.savings || 0),
    plannedDebt,
    debtPaid: roundMoney(planVsActual.actual.debt || 0),
    plannedOutflow,
    minimumPlannedOutflow,
    plannedIncome,
    income,
    incomePlanBasis,
    incomePlanBasisSource,
    unallocated,
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
  };

  const cleanPlanVsActual = { ...planVsActual };
  delete cleanPlanVsActual._planData;

  return {
    range,
    planVsActual: cleanPlanVsActual,
    periodSummary: planVsActual.actual,
    categoryRows,
    sections: {
      spending: expenseRows,
      savings: savingsRows,
      debt: debtRows,
      income: incomeRows,
      needsAttention: attentionRows
    },
    spendingRows: buildSpendingRows(expenseRows, 6),
    summary,
    trust: {
      explanation:
        'Manual category plans, recurring commitments, savings targets, and debt targets are kept separate. Every actual total has a transaction receipt.',
      unresolvedCount:
        attentionRows.reduce((sum, row) => sum + row.unresolvedCommitments.length, 0) +
        planVsActual.attention.length +
        attentionRows.filter((row) => row.isMissing || row.isArchived).length +
        categoryRows.reduce((sum, row) => sum + (Number(row.receipt?.unresolvedCount) || 0), 0),
      warnings: clonePlain(
        planVsActual.attention.concat(
          categoryRows.flatMap((row) =>
            asArray(row.receipt && row.receipt.unresolved).map((item) => ({
              code: 'transaction_contribution_unresolved',
              categoryId: row.categoryId,
              transactionId: item.transactionId,
              message:
                asArray(item.warnings)[0]?.message ||
                `${item.description || 'A transaction'} was excluded from trusted totals.`
            }))
          )
        )
      ),
      headlineReconcilesToVisibleRows:
        roundMoney(
          expenseRows
            .filter((row) => row.includedInPlanTotals)
            .reduce((sum, row) => sum + row.planned, 0)
        ) === totalBudget
    }
  };
}
