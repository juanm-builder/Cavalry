import { getTransactionCategoryAllocations } from './category-splits.js';
import { roundMoney } from '../money.js';

export const TRANSACTION_EVENT_KINDS = Object.freeze([
  'purchase',
  'income_received',
  'merchant_refund',
  'reimbursement',
  'transfer',
  'savings_contribution',
  'debt_principal_payment',
  'debt_interest_or_fee',
  'opening_balance',
  'adjustment'
]);

const EVENT_KIND_ALIASES = Object.freeze({
  expense: 'purchase',
  expense_paid: 'purchase',
  expense_charged: 'purchase',
  purchase: 'purchase',
  income: 'income_received',
  income_received: 'income_received',
  salary: 'income_received',
  daily_interest: 'income_received',
  refund: 'merchant_refund',
  merchant_refund: 'merchant_refund',
  chargeback: 'merchant_refund',
  charge_reversal: 'merchant_refund',
  reversal: 'merchant_refund',
  reimbursement: 'reimbursement',
  transfer: 'transfer',
  savings: 'savings_contribution',
  savings_contribution: 'savings_contribution',
  debt: 'debt_principal_payment',
  debt_payment: 'debt_principal_payment',
  liability_payment: 'debt_principal_payment',
  debt_principal_payment: 'debt_principal_payment',
  debt_interest: 'debt_interest_or_fee',
  debt_fee: 'debt_interest_or_fee',
  interest_fee: 'debt_interest_or_fee',
  debt_interest_or_fee: 'debt_interest_or_fee',
  opening: 'opening_balance',
  opening_balance: 'opening_balance',
  existing_liability: 'opening_balance',
  adjustment: 'adjustment',
  manual_journal: 'adjustment'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

// Ledger identifiers are opaque values. Do not trim or otherwise normalize them:
// silently changing an ID can make malformed data appear valid and can attach a
// transaction to the wrong account or category.
function asIdentifier(value) {
  return String(value == null ? '' : value);
}

function normalizedToken(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function baseCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

function transactionCurrency(workbook, transaction) {
  return (
    asString(transaction && (transaction.originalCurrency || transaction.currency)).toUpperCase() ||
    baseCurrency(workbook)
  );
}

function getCategory(workbook, categoryId) {
  const id = asIdentifier(categoryId);
  return asArray(workbook && workbook.categories).find(
    (category) => asIdentifier(category && category.id) === id
  );
}

function accountMap(workbook) {
  return new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asIdentifier(account && account.id),
      account
    ])
  );
}

function getStoredLineBaseAmount(transaction) {
  const debitTotal = asArray(transaction && transaction.lines)
    .filter((line) => line && line.direction === 'debit')
    .reduce((sum, line) => sum + Math.abs(Number(line.baseAmount) || 0), 0);
  return debitTotal > 0 ? roundMoney(debitTotal) : 0;
}

function resolveBaseAmount(workbook, transaction) {
  const warnings = [];
  const stored = Number(transaction && transaction.baseAmount);
  if (Number.isFinite(stored) && Math.abs(stored) > 0.0001) {
    return { amount: roundMoney(Math.abs(stored)), resolved: true, warnings };
  }

  const lineAmount = getStoredLineBaseAmount(transaction);
  if (lineAmount > 0) {
    return { amount: lineAmount, resolved: true, warnings };
  }

  const nativeAmount = Math.abs(Number(transaction && transaction.amount) || 0);
  if (!(nativeAmount > 0)) {
    return { amount: 0, resolved: true, warnings };
  }

  const sourceCurrency = transactionCurrency(workbook, transaction);
  const targetCurrency = baseCurrency(workbook);
  if (sourceCurrency === targetCurrency) {
    return { amount: roundMoney(nativeAmount), resolved: true, warnings };
  }

  const storedRate = Number(transaction && transaction.fxRateToBase);
  if (Number.isFinite(storedRate) && storedRate > 0) {
    return {
      amount: roundMoney(nativeAmount * storedRate),
      resolved: true,
      warnings
    };
  }

  warnings.push({
    code: 'transaction_missing_fx_rate',
    message: `${sourceCurrency} cannot be included in ${targetCurrency} totals until its exchange rate is recorded.`
  });
  return { amount: 0, resolved: false, warnings };
}

function cashFlowFor(workbook, transaction, eventKind, amount, lookups) {
  if (eventKind === 'opening_balance' || eventKind === 'adjustment') return 0;
  const accounts = lookups ? lookups.accounts : accountMap(workbook);
  let cash = 0;
  for (const line of asArray(transaction?.lines)) {
    if (!line || accounts.get(asIdentifier(line.accountId))?.group !== 'asset') continue;
    // Older two-line entries sometimes store the converted amount only on the transaction.
    const value = Number(line.baseAmount ?? amount);
    if (!Number.isFinite(value)) continue;
    cash += line.direction === 'debit' ? value : -value;
  }
  return roundMoney(cash);
}

export function normalizeTransactionEventKind(value) {
  const normalized = EVENT_KIND_ALIASES[normalizedToken(value)] || '';
  return TRANSACTION_EVENT_KINDS.includes(normalized) ? normalized : '';
}

export function inferTransactionEventKind(workbook, transaction) {
  return inferEventKind(workbook, transaction);
}

function inferEventKind(workbook, transaction, lookups) {
  const explicit = normalizeTransactionEventKind(transaction && transaction.eventKind);

  const template = normalizedToken(transaction && transaction.template);
  const fromTemplate = normalizeTransactionEventKind(template);
  // Old edits could leave a purchase classification on refund postings (or vice versa).
  if (
    (fromTemplate === 'merchant_refund' && explicit === 'purchase') ||
    (fromTemplate === 'purchase' && explicit === 'merchant_refund')
  ) {
    const accounts = lookups?.accounts || accountMap(workbook);
    const expenseDirection = fromTemplate === 'merchant_refund' ? 'credit' : 'debit';
    if (
      asArray(transaction.lines).some(
        (line) =>
          line?.direction === expenseDirection &&
          accounts.get(asIdentifier(line.accountId))?.group === 'expense'
      )
    )
      return fromTemplate;
  }
  if (explicit) return explicit;
  // A small set of templates carries stronger meaning than the category.
  // In particular, a refund deliberately uses the original expense category,
  // so category-first classification would incorrectly turn it back into a
  // purchase. Transfers and opening balances likewise stay outside category
  // spending even when older data happens to retain a category id.
  if (['merchant_refund', 'transfer', 'opening_balance'].includes(fromTemplate)) {
    return fromTemplate;
  }

  const category = lookups
    ? lookups.categories.get(asIdentifier(transaction && transaction.categoryId))
    : getCategory(workbook, transaction && transaction.categoryId);
  const categoryType = normalizedToken(category && category.type);
  if (categoryType === 'income') return 'income_received';
  if (categoryType === 'expense') return 'purchase';
  if (categoryType === 'savings') return 'savings_contribution';
  if (categoryType === 'debt') return 'debt_principal_payment';

  return fromTemplate || 'adjustment';
}

function metricsFor(workbook, transaction, eventKind, amount, lookups) {
  const cashFlow = cashFlowFor(workbook, transaction, eventKind, amount, lookups);
  const movement = {
    income: 0,
    expense: 0,
    savings: 0,
    debt: 0,
    outflow: Math.max(0, -cashFlow),
    categoryBudget: 0,
    debtPrincipal: 0,
    cashFlow
  };

  if (eventKind === 'purchase' || eventKind === 'debt_interest_or_fee') {
    return {
      ...movement,
      expense: amount,
      categoryBudget: amount
    };
  }
  if (eventKind === 'merchant_refund') {
    return {
      ...movement,
      expense: roundMoney(-amount),
      categoryBudget: roundMoney(-amount)
    };
  }
  if (eventKind === 'income_received' || eventKind === 'reimbursement') {
    return {
      ...movement,
      income: amount
    };
  }
  if (eventKind === 'savings_contribution') {
    return {
      ...movement,
      savings: amount
    };
  }
  if (eventKind === 'debt_principal_payment') {
    return {
      ...movement,
      debt: amount,
      debtPrincipal: amount
    };
  }
  return movement;
}

function flowKindFor(eventKind) {
  if (eventKind === 'purchase' || eventKind === 'merchant_refund') return 'expense';
  if (eventKind === 'debt_interest_or_fee') return 'expense';
  if (eventKind === 'income_received' || eventKind === 'reimbursement') return 'inflow';
  if (eventKind === 'savings_contribution') return 'savings';
  if (eventKind === 'debt_principal_payment') return 'debt';
  if (eventKind === 'opening_balance') return 'opening';
  return 'transfer';
}

export function getTransactionContributions(workbook, transaction) {
  return evaluateTransactionContributions(workbook, transaction);
}

// Reuse reference indexes within a synchronous report/table calculation. Create
// a new reader for each pass so edits to a workbook never reuse stale indexes.
export function createTransactionContributionReader(workbook) {
  const categories = new Map();
  asArray(workbook && workbook.categories).forEach((category) => {
    const id = asIdentifier(category && category.id);
    // Category lookup uses the first match; account lookup uses the last.
    if (!categories.has(id)) categories.set(id, category);
  });
  const lookups = { accounts: accountMap(workbook), categories };
  return (transaction) => evaluateTransactionContributions(workbook, transaction, lookups);
}

function evaluateTransactionContributions(workbook, transaction, lookups) {
  const eventKind = inferEventKind(workbook, transaction, lookups);
  const resolution = resolveBaseAmount(workbook, transaction);
  const metrics = metricsFor(
    workbook,
    transaction,
    eventKind,
    resolution.resolved ? resolution.amount : 0,
    lookups
  );
  const flowKind = flowKindFor(eventKind);
  const warnings = [...resolution.warnings];

  if (
    Number(transaction && transaction.baseAmount) < 0 ||
    Number(transaction && transaction.amount) < 0
  ) {
    warnings.push({
      code: 'transaction_negative_amount_normalized',
      message: 'A negative stored amount was interpreted by its event type and absolute magnitude.'
    });
  }
  if (eventKind === 'merchant_refund' && !asString(transaction && transaction.categoryId)) {
    warnings.push({
      code: 'refund_category_missing',
      message: 'This refund cannot reduce a category budget until an expense category is assigned.'
    });
  }
  if (eventKind === 'reimbursement') {
    warnings.push({
      code: 'reimbursement_treated_as_income',
      message: 'Reimbursements are treated as income unless recorded as merchant refunds.'
    });
  }

  const signedBaseAmount =
    flowKind === 'inflow'
      ? metrics.income
      : flowKind === 'expense'
        ? metrics.expense
        : flowKind === 'savings'
          ? metrics.savings
          : flowKind === 'debt'
            ? metrics.debt
            : 0;

  return {
    transactionId: asIdentifier(transaction && transaction.id),
    categoryId: asIdentifier(transaction && transaction.categoryId) || '__uncategorized',
    eventKind,
    flowKind,
    nativeAmount: Math.abs(Number(transaction && transaction.amount) || 0),
    nativeCurrency: transactionCurrency(workbook, transaction),
    baseCurrency: baseCurrency(workbook),
    baseAmount: resolution.amount,
    signedBaseAmount: roundMoney(signedBaseAmount),
    metrics,
    resolved: resolution.resolved,
    warnings
  };
}

export function addCashMovement(totals, contribution) {
  if (!contribution.resolved) return;
  const amount = contribution.metrics.cashFlow;
  totals.inflow = roundMoney(totals.inflow + Math.max(0, amount));
  totals.outflow = roundMoney(totals.outflow + Math.max(0, -amount));
  totals.net = roundMoney(totals.inflow - totals.outflow);
}

export function getTransactionSignedFlowAmount(workbook, transaction) {
  return getTransactionContributions(workbook, transaction).signedBaseAmount;
}

function eventCanContributeToMetric(eventKind, metric) {
  if (metric === 'income') {
    return eventKind === 'income_received' || eventKind === 'reimbursement';
  }
  if (metric === 'expense' || metric === 'categoryBudget') {
    return (
      eventKind === 'purchase' ||
      eventKind === 'merchant_refund' ||
      eventKind === 'debt_interest_or_fee'
    );
  }
  if (metric === 'savings') return eventKind === 'savings_contribution';
  if (metric === 'debt' || metric === 'debtPrincipal') {
    return eventKind === 'debt_principal_payment';
  }
  if (metric === 'outflow' || metric === 'cashFlow') {
    return !['opening_balance', 'adjustment'].includes(eventKind);
  }
  return true;
}

export function getCategoryContribution(transaction, contribution, categoryId) {
  if (!categoryId || !transaction?.categorySplits?.length) return contribution;
  const allocation = getTransactionCategoryAllocations(transaction, contribution.baseAmount).find(
    (part) => part.categoryId === categoryId
  );
  if (!allocation) return null;
  const metrics = Object.fromEntries(
    Object.entries(contribution.metrics).map(([name, value]) => [
      name,
      Math.sign(value) * allocation.baseAmount
    ])
  );
  return {
    ...contribution,
    categoryId,
    nativeAmount: allocation.amount,
    baseAmount: allocation.baseAmount,
    signedBaseAmount: Math.sign(contribution.signedBaseAmount) * allocation.baseAmount,
    metrics
  };
}

export function buildTransactionCalculationReceipt(
  workbook,
  transactions,
  { metric = 'expense', range = null, categoryId = '' } = {}
) {
  const selectedCategoryId = asIdentifier(categoryId);
  const start = asString(range && (range.start || range.startDate));
  const end = asString(range && (range.end || range.endDate));
  const readContribution = createTransactionContributionReader(workbook);
  const evaluated = asArray(transactions)
    .filter((transaction) => {
      const date = asString(transaction && transaction.date);
      if ((start || end) && !date) return false;
      return (!start || date >= start) && (!end || date <= end);
    })
    .map((transaction) => {
      const contribution = getCategoryContribution(
        transaction,
        readContribution(transaction),
        selectedCategoryId
      );
      return { transaction, contribution };
    })
    .filter(({ contribution }) => contribution);
  const contributions = evaluated
    .filter(({ contribution }) => {
      if (!contribution.resolved) return false;
      if (selectedCategoryId && contribution.categoryId !== selectedCategoryId) return false;
      return Number(contribution.metrics[metric]) !== 0;
    })
    .map(({ transaction, contribution }) => ({
      transactionId: contribution.transactionId,
      date: asString(transaction && transaction.date),
      description: asString(transaction && transaction.description) || 'Untitled transaction',
      eventKind: contribution.eventKind,
      flowKind: contribution.flowKind,
      categoryId: contribution.categoryId,
      nativeAmount: contribution.nativeAmount,
      nativeCurrency: contribution.nativeCurrency,
      baseAmount: contribution.baseAmount,
      baseCurrency: contribution.baseCurrency,
      signedBaseAmount: roundMoney(Number(contribution.metrics[metric]) || 0),
      warnings: contribution.warnings
    }));
  const unresolved = evaluated
    .filter(({ contribution }) => {
      if (contribution.resolved) return false;
      if (!eventCanContributeToMetric(contribution.eventKind, metric)) return false;
      return !selectedCategoryId || contribution.categoryId === selectedCategoryId;
    })
    .map(({ transaction, contribution }) => ({
      transactionId: contribution.transactionId,
      date: asString(transaction && transaction.date),
      description: asString(transaction && transaction.description) || 'Untitled transaction',
      categoryId: contribution.categoryId,
      nativeAmount: contribution.nativeAmount,
      nativeCurrency: contribution.nativeCurrency,
      warnings: contribution.warnings
    }));

  return {
    metric,
    range,
    baseCurrency: baseCurrency(workbook),
    value: roundMoney(
      contributions.reduce((sum, contribution) => sum + contribution.signedBaseAmount, 0)
    ),
    includedCount: contributions.length,
    unresolvedCount: unresolved.length,
    contributions,
    unresolved,
    formula: `sum(contributions.${metric})`
  };
}
