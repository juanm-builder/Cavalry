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

function cashFlowFor(workbook, transaction, eventKind, amount) {
  const accounts = accountMap(workbook);
  const hasAssetDebit = asArray(transaction && transaction.lines).some(
    (line) =>
      line &&
      line.direction === 'debit' &&
      accounts.get(asIdentifier(line.accountId))?.group === 'asset'
  );
  const hasAssetCredit = asArray(transaction && transaction.lines).some(
    (line) =>
      line &&
      line.direction === 'credit' &&
      accounts.get(asIdentifier(line.accountId))?.group === 'asset'
  );

  if (eventKind === 'income_received' || eventKind === 'reimbursement') {
    return hasAssetDebit ? amount : 0;
  }
  if (eventKind === 'merchant_refund') {
    return hasAssetDebit ? amount : 0;
  }
  if (
    eventKind === 'purchase' ||
    eventKind === 'debt_interest_or_fee' ||
    eventKind === 'debt_principal_payment' ||
    eventKind === 'savings_contribution'
  ) {
    return hasAssetCredit ? roundMoney(-amount) : 0;
  }
  return 0;
}

export function normalizeTransactionEventKind(value) {
  const normalized = EVENT_KIND_ALIASES[normalizedToken(value)] || '';
  return TRANSACTION_EVENT_KINDS.includes(normalized) ? normalized : '';
}

export function inferTransactionEventKind(workbook, transaction) {
  const explicit = normalizeTransactionEventKind(transaction && transaction.eventKind);
  if (explicit) return explicit;

  const template = normalizedToken(transaction && transaction.template);
  const fromTemplate = normalizeTransactionEventKind(template);
  // A small set of templates carries stronger meaning than the category.
  // In particular, a refund deliberately uses the original expense category,
  // so category-first classification would incorrectly turn it back into a
  // purchase. Transfers and opening balances likewise stay outside category
  // spending even when older data happens to retain a category id.
  if (['merchant_refund', 'transfer', 'opening_balance'].includes(fromTemplate)) {
    return fromTemplate;
  }

  const category = getCategory(workbook, transaction && transaction.categoryId);
  const categoryType = normalizedToken(category && category.type);
  if (categoryType === 'income') return 'income_received';
  if (categoryType === 'expense') return 'purchase';
  if (categoryType === 'savings') return 'savings_contribution';
  if (categoryType === 'debt') return 'debt_principal_payment';

  return fromTemplate || 'adjustment';
}

function metricsFor(workbook, transaction, eventKind, amount) {
  const zero = {
    income: 0,
    expense: 0,
    savings: 0,
    debt: 0,
    outflow: 0,
    categoryBudget: 0,
    debtPrincipal: 0,
    cashFlow: 0
  };
  const cashFlow = cashFlowFor(workbook, transaction, eventKind, amount);

  if (eventKind === 'purchase' || eventKind === 'debt_interest_or_fee') {
    return {
      ...zero,
      expense: amount,
      outflow: amount,
      categoryBudget: amount,
      cashFlow
    };
  }
  if (eventKind === 'merchant_refund') {
    return {
      ...zero,
      expense: roundMoney(-amount),
      outflow: roundMoney(-amount),
      categoryBudget: roundMoney(-amount),
      cashFlow
    };
  }
  if (eventKind === 'income_received' || eventKind === 'reimbursement') {
    return {
      ...zero,
      income: amount,
      cashFlow
    };
  }
  if (eventKind === 'savings_contribution') {
    return {
      ...zero,
      savings: amount,
      outflow: amount,
      cashFlow
    };
  }
  if (eventKind === 'debt_principal_payment') {
    return {
      ...zero,
      debt: amount,
      outflow: amount,
      debtPrincipal: amount,
      cashFlow
    };
  }
  return zero;
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
  const eventKind = inferTransactionEventKind(workbook, transaction);
  const resolution = resolveBaseAmount(workbook, transaction);
  const metrics = resolution.resolved
    ? metricsFor(workbook, transaction, eventKind, resolution.amount)
    : metricsFor(workbook, transaction, eventKind, 0);
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
  if (metric === 'outflow') {
    return [
      'purchase',
      'merchant_refund',
      'savings_contribution',
      'debt_principal_payment',
      'debt_interest_or_fee'
    ].includes(eventKind);
  }
  if (metric === 'cashFlow') {
    return !['opening_balance', 'adjustment', 'transfer'].includes(eventKind);
  }
  return true;
}

export function buildTransactionCalculationReceipt(
  workbook,
  transactions,
  { metric = 'expense', range = null, categoryId = '' } = {}
) {
  const selectedCategoryId = asIdentifier(categoryId);
  const start = asString(range && (range.start || range.startDate));
  const end = asString(range && (range.end || range.endDate));
  const evaluated = asArray(transactions)
    .filter((transaction) => {
      const date = asString(transaction && transaction.date);
      if ((start || end) && !date) return false;
      return (!start || date >= start) && (!end || date <= end);
    })
    .map((transaction) => ({
      transaction,
      contribution: getTransactionContributions(workbook, transaction)
    }));
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
