import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import { isNaturalDebitGroup } from '../../domain/ledger/balances.js';
import { getLedgerTransactionBaseAmount } from '../../domain/ledger/transactions.js';
import {
  getFlowBreakdown,
  getFlowTransactions,
  getTransactionFlowKind
} from '../../domain/ledger/summaries.js';
import {
  asArray,
  asString,
  clonePlain,
  formatMonthValue,
  formatVisibleDateRangeLabel,
  getTemplateLabel,
  normalizeMonthValue,
  titleCaseLabel
} from './dashboard-view-model-helpers.js';

const VALID_FLOW_TYPES = ['inflow', 'income', 'expense', 'outflow', 'debt', 'savings', 'both'];

function normalizeFlowType(value) {
  const requested = asString(value || 'outflow');
  return VALID_FLOW_TYPES.indexOf(requested) >= 0 ? requested : 'outflow';
}

function getFlowTitle(flowType) {
  if (flowType === 'both') {
    return 'Net Flow';
  }
  if (flowType === 'inflow' || flowType === 'income') {
    return 'Inflows';
  }
  if (flowType === 'expense') {
    return 'Expenses';
  }
  if (flowType === 'debt') {
    return 'Debt Payments';
  }
  if (flowType === 'savings') {
    return 'Savings Movement';
  }
  return 'Outflows';
}

function getFlowTone(flowType) {
  if (flowType === 'inflow' || flowType === 'income') {
    return 'good';
  }
  if (flowType === 'both') {
    return 'info';
  }
  return 'bad';
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

function normalizeDateRange(range) {
  const source = range && typeof range === 'object' ? range : {};
  return {
    start: asString(source.start || source.startDate),
    end: asString(source.end || source.endDate)
  };
}

function normalizeFlowRange(options = {}) {
  const rangeStart = asString(options.rangeStart || options.start || options.startDate);
  const rangeEnd = asString(options.rangeEnd || options.end || options.endDate);
  const dateStart = normalizeDateKey(rangeStart);
  const dateEnd = normalizeDateKey(rangeEnd);
  if (dateStart && dateEnd) {
    const range = {
      start: dateStart,
      end: dateEnd
    };
    return {
      kind: 'date',
      range,
      monthKey: '',
      rangeLabel: formatVisibleDateRangeLabel(range)
    };
  }

  const monthKey = normalizeMonthValue(options.monthKey);
  if (monthKey) {
    const range = getMonthRangeFromKey(monthKey);
    return {
      kind: 'monthKey',
      range,
      monthKey,
      rangeLabel: formatMonthValue(monthKey)
    };
  }

  const startMonth = normalizeMonthValue(rangeStart);
  const endMonth = normalizeMonthValue(rangeEnd);
  if (startMonth && endMonth) {
    const endRange = getMonthRangeFromKey(endMonth);
    const range = {
      start: startMonth + '-01',
      end: (endRange && endRange.end) || endMonth + '-31'
    };
    return {
      kind: 'monthRange',
      range,
      monthKey: '',
      rangeLabel: formatVisibleDateRangeLabel(range)
    };
  }

  const fallbackRange = normalizeDateRange(options.range || options.defaultRange);
  return {
    kind: fallbackRange.start || fallbackRange.end ? 'default' : 'all',
    range: fallbackRange,
    monthKey: '',
    rangeLabel: formatVisibleDateRangeLabel(fallbackRange)
  };
}

function getCategoryById(workbook, categoryId) {
  const id = asString(categoryId);
  return (
    asArray(workbook && workbook.categories).find((category) => {
      return asString(category && category.id) === id;
    }) || null
  );
}

function getAccountById(workbook, accountId) {
  const id = asString(accountId);
  return (
    asArray(workbook && workbook.accounts).find((account) => {
      return asString(account && account.id) === id;
    }) || null
  );
}

function getTransactionImpact(workbook, transaction) {
  const category =
    transaction && transaction.categoryId
      ? getCategoryById(workbook, transaction.categoryId)
      : null;
  const template = asString(transaction && transaction.template);
  let assetDelta = 0;
  let positiveAssetDelta = 0;
  let liabilityDelta = 0;
  asArray(transaction && transaction.lines).forEach((line) => {
    const account = getAccountById(workbook, line.accountId);
    if (!account) {
      return;
    }
    const sign = isNaturalDebitGroup(account.group)
      ? line.direction === 'debit'
        ? 1
        : -1
      : line.direction === 'credit'
        ? 1
        : -1;
    const delta = roundMoney(sign * (Number(line.baseAmount) || 0));
    if (account.group === 'asset') {
      assetDelta = roundMoney(assetDelta + delta);
      if (delta > 0) {
        positiveAssetDelta = roundMoney(positiveAssetDelta + delta);
      }
    }
    if (account.group === 'liability') {
      liabilityDelta = roundMoney(liabilityDelta + delta);
    }
  });
  const netWorthDelta = roundMoney(assetDelta - liabilityDelta);
  const isDebtLike =
    template === 'existing_liability' ||
    template === 'expense_paid' ||
    template === 'expense_charged' ||
    template === 'debt_payment' ||
    template === 'liability_payment' ||
    (category && (category.type === 'expense' || category.type === 'debt'));
  const isHelpful =
    template === 'income_received' ||
    template === 'daily_interest' ||
    template === 'time_deposit_redeemed' ||
    (category && category.type === 'income') ||
    netWorthDelta > 0.01 ||
    positiveAssetDelta > 0.01;
  let tone = 'info';
  if (liabilityDelta > 0.01 || isDebtLike || netWorthDelta < -0.01) {
    tone = 'bad';
  } else if (isHelpful) {
    tone = 'good';
  }
  return {
    tone,
    assetDelta,
    positiveAssetDelta,
    liabilityDelta,
    netWorthDelta,
    categoryType: category ? category.type : ''
  };
}

function sortTransactionsNewestFirst(transactions) {
  return transactions.slice().sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });
}

function buildTransactionRow(workbook, transaction) {
  const category = getCategoryById(workbook, transaction && transaction.categoryId);
  return {
    transaction: clonePlain(transaction),
    transactionId: asString(transaction && transaction.id),
    date: asString(transaction && transaction.date),
    description: asString(transaction && transaction.description),
    categoryId: asString(transaction && transaction.categoryId),
    categoryName: category ? asString(category.name) : 'Uncategorized',
    template: asString(transaction && transaction.template),
    templateLabel: getTemplateLabel(transaction && transaction.template),
    amount: Number(transaction && transaction.amount) || 0,
    originalCurrency: asString(transaction && transaction.originalCurrency),
    baseAmount: getLedgerTransactionBaseAmount(transaction),
    flowKind: getTransactionFlowKind(transaction, workbook),
    tone: getTransactionImpact(workbook, transaction).tone
  };
}

function getCategoryRowTone(row) {
  return row.type === 'income' ? 'good' : row.type === 'other' ? 'info' : 'bad';
}

function buildCategoryRows(workbook, transactions) {
  const rows = getFlowBreakdown(workbook, transactions);
  const maxTotal = Math.max.apply(null, rows.map((row) => Math.abs(row.total)).concat([1]));
  return rows.map((row) => {
    const width = Math.max(4, Math.round((Math.abs(row.total) / maxTotal) * 100));
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      typeLabel: titleCaseLabel(row.type, 'Flow'),
      total: row.total,
      width,
      tone: getCategoryRowTone(row)
    };
  });
}

function getTotalInflow(workbook, transactions) {
  return roundMoney(
    transactions
      .filter((transaction) => {
        return getTransactionFlowKind(transaction, workbook) === 'inflow';
      })
      .reduce((sum, transaction) => {
        return sum + getLedgerTransactionBaseAmount(transaction);
      }, 0)
  );
}

function getTotalOutflow(workbook, transactions) {
  return roundMoney(
    transactions
      .filter((transaction) => {
        const kind = getTransactionFlowKind(transaction, workbook);
        return kind === 'expense' || kind === 'savings' || kind === 'debt';
      })
      .reduce((sum, transaction) => {
        return sum + getLedgerTransactionBaseAmount(transaction);
      }, 0)
  );
}

export function buildDashboardFlowDrilldownRows(workbook, options = {}) {
  const flowType = normalizeFlowType(options.flowType || options.type);
  const rangeModel = normalizeFlowRange(options);
  return sortTransactionsNewestFirst(getFlowTransactions(workbook, rangeModel.range, flowType)).map(
    (transaction) => buildTransactionRow(workbook, transaction)
  );
}

export function buildDashboardFlowDrilldownSummary(workbook, options = {}) {
  const flowType = normalizeFlowType(options.flowType || options.type);
  const transactionRows = options.rows || buildDashboardFlowDrilldownRows(workbook, options);
  const transactions = transactionRows.map((row) => row.transaction).filter(Boolean);
  const totalInflow = getTotalInflow(workbook, transactions);
  const totalOutflow = getTotalOutflow(workbook, transactions);
  const total =
    flowType === 'both'
      ? roundMoney(totalInflow - totalOutflow)
      : roundMoney(
          transactionRows.reduce((sum, row) => sum + (Number(row && row.baseAmount) || 0), 0)
        );
  const categoryRows = options.categoryRows || buildCategoryRows(workbook, transactions);
  return {
    flowType,
    title: getFlowTitle(flowType),
    tone: getFlowTone(flowType),
    total,
    totalInflow,
    totalOutflow,
    transactionCount: transactionRows.length,
    categoryCount: categoryRows.length
  };
}

export function buildDashboardFlowDrilldownViewModel(workbook, options = {}) {
  const flowType = normalizeFlowType(options.flowType || options.type);
  const rangeModel = normalizeFlowRange(options);
  const transactions = sortTransactionsNewestFirst(
    getFlowTransactions(workbook, rangeModel.range, flowType)
  );
  const rows = transactions.map((transaction) => buildTransactionRow(workbook, transaction));
  const categoryRows = buildCategoryRows(workbook, transactions);
  const summary = buildDashboardFlowDrilldownSummary(workbook, {
    flowType,
    rows,
    categoryRows
  });
  return {
    flowType,
    title: summary.title,
    tone: summary.tone,
    rangeKind: rangeModel.kind,
    range: clonePlain(rangeModel.range),
    monthKey: rangeModel.monthKey,
    rangeLabel: rangeModel.rangeLabel,
    rows,
    tableRows: rows.slice(0, 30),
    transactions: rows.map((row) => clonePlain(row.transaction)),
    categoryRows,
    summary
  };
}
