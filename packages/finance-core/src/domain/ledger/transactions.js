import { normalizeDateKey, roundMoney } from '../money.js';
import { isTransactionBalanced } from './validation.js';
import {
  getTransactionContributions,
  inferTransactionEventKind,
  normalizeTransactionEventKind
} from './transaction-contributions.js';

export const LEDGER_TRANSACTION_TEMPLATES = Object.freeze([
  'expense_paid',
  'expense_charged',
  'income_received',
  'merchant_refund',
  'transfer',
  'debt_payment',
  'liability_payment',
  'opening_balance'
]);

const LEDGER_TRANSACTION_TEMPLATE_ALIASES = Object.freeze({
  expense: 'expense_paid',
  purchase: 'expense_paid',
  spend: 'expense_paid',
  charge: 'expense_charged',
  charged: 'expense_charged',
  income: 'income_received',
  salary: 'income_received',
  refund: 'merchant_refund',
  merchant_refund: 'merchant_refund',
  chargeback: 'merchant_refund',
  reversal: 'merchant_refund',
  transfer: 'transfer',
  debt: 'debt_payment',
  payment: 'debt_payment',
  liability: 'debt_payment',
  opening: 'opening_balance',
  opening_balance: 'opening_balance'
});

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function baseCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

function createId(prefix, index, createIdFn) {
  if (typeof createIdFn === 'function') {
    return createIdFn(prefix, index);
  }
  return `${prefix}_${index}`;
}

export function normalizeLedgerTransactionTemplate(value) {
  const raw = asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const template = LEDGER_TRANSACTION_TEMPLATE_ALIASES[raw] || raw;
  return LEDGER_TRANSACTION_TEMPLATES.includes(template) ? template : '';
}

export function getLedgerTransactionTemplateConfig(template) {
  const value = String(template || 'expense_paid');
  if (value === 'income_received') {
    return {
      categoryTypes: ['income'],
      primaryLabel: 'Received Into',
      primaryGroups: ['asset'],
      primaryPlaceholder: 'Choose the receiving asset account',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: 'Received From',
      counterpartyKinds: ['employer', 'family', 'client', 'other'],
      usesCounterparty: true,
      usesCategory: true
    };
  }
  if (value === 'merchant_refund') {
    return {
      categoryTypes: ['expense'],
      primaryLabel: 'Refunded To',
      primaryGroups: ['asset', 'liability'],
      primaryPlaceholder: 'Choose the cash account or credit card receiving the refund',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: 'Refunded By',
      counterpartyKinds: ['merchant', 'biller', 'other'],
      usesCounterparty: true,
      usesCategory: true
    };
  }
  if (value === 'expense_charged') {
    return {
      categoryTypes: ['expense'],
      primaryLabel: 'Charged To',
      primaryGroups: ['liability'],
      primaryPlaceholder: 'Choose the liability account',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: 'Merchant / Payee',
      counterpartyKinds: ['merchant', 'biller', 'other'],
      usesCounterparty: true,
      usesCategory: true
    };
  }
  if (value === 'debt_payment' || value === 'liability_payment') {
    return {
      categoryTypes: ['debt'],
      primaryLabel: 'Paid From',
      primaryGroups: ['asset'],
      primaryPlaceholder: 'Choose the paying asset account',
      secondaryLabel: 'Paid To',
      secondaryGroups: ['liability'],
      secondaryPlaceholder: 'Choose the liability being reduced',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: true
    };
  }
  if (value === 'transfer') {
    return {
      categoryTypes: [],
      primaryLabel: 'From Account',
      primaryGroups: ['asset', 'liability'],
      primaryPlaceholder: 'Choose the source account',
      secondaryLabel: 'To Account',
      secondaryGroups: ['asset', 'liability'],
      secondaryPlaceholder: 'Choose the destination account',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: false
    };
  }
  if (value === 'opening_balance') {
    return {
      categoryTypes: [],
      primaryLabel: 'Account',
      primaryGroups: ['asset', 'liability'],
      primaryPlaceholder: 'Choose the account being opened',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: false
    };
  }
  if (value === 'manual_journal') {
    return {
      categoryTypes: [],
      primaryLabel: 'Account',
      primaryGroups: [],
      primaryPlaceholder: '',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: false
    };
  }
  return {
    categoryTypes: ['expense'],
    primaryLabel: 'Paid From',
    primaryGroups: ['asset'],
    primaryPlaceholder: 'Choose the paying asset account',
    secondaryLabel: '',
    secondaryGroups: [],
    secondaryPlaceholder: '',
    counterpartyLabel: 'Paid To',
    counterpartyKinds: ['merchant', 'biller', 'other'],
    usesCounterparty: true,
    usesCategory: true
  };
}

export function findLedgerAccount(workbook, accountId) {
  const id = asString(accountId);
  return (
    (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).find(
      (account) => asString(account && account.id) === id
    ) || null
  );
}

export function findLedgerCategory(workbook, categoryId) {
  const id = asString(categoryId);
  return (
    (workbook && Array.isArray(workbook.categories) ? workbook.categories : []).find(
      (category) => asString(category && category.id) === id
    ) || null
  );
}

function getCategoryLinkedAccountId(workbook, categoryId) {
  const category = findLedgerCategory(workbook, categoryId);
  return category && category.linkedAccountId ? String(category.linkedAccountId) : '';
}

function getOpeningBalanceEquityAccount(workbook) {
  return (
    (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).find(
      (account) =>
        account.id === 'opening_balance_equity' ||
        String(account.name || '').toLowerCase() === 'opening balance equity'
    ) || null
  );
}

function getFxRateBetweenCurrencies(workbook, fromCurrency, toCurrency, fxRateOverride) {
  const from = asString(fromCurrency).toUpperCase() || baseCurrency(workbook);
  const to = asString(toCurrency).toUpperCase() || baseCurrency(workbook);
  if (from === to) {
    return 1;
  }
  const base = baseCurrency(workbook);
  const overrideRate = Number(fxRateOverride) || 0;
  if (overrideRate > 0) {
    if (from === 'USD' && to === base) return overrideRate;
    if (from === base && to === 'USD') return 1 / overrideRate;
  }
  const rates = Array.isArray(workbook && workbook.fxRates) ? workbook.fxRates : [];
  const exact = rates.find(
    (rate) => rate && rate.fromCurrency === from && rate.toCurrency === to && Number(rate.rate) > 0
  );
  if (exact) return Number(exact.rate);
  const inverse = rates.find(
    (rate) => rate && rate.fromCurrency === to && rate.toCurrency === from && Number(rate.rate) > 0
  );
  if (inverse) return 1 / Number(inverse.rate);
  const usdToBaseRate =
    Number(workbook && workbook.settings && workbook.settings.usdToBaseRate) || 0;
  if (usdToBaseRate > 0) {
    if (from === 'USD' && to === base) return usdToBaseRate;
    if (from === base && to === 'USD') return 1 / usdToBaseRate;
  }
  return 0;
}

function convertAmountBetweenCurrencies(
  workbook,
  amount,
  fromCurrency,
  toCurrency,
  fxRateOverride
) {
  const numeric = Number(amount) || 0;
  const from = asString(fromCurrency).toUpperCase() || baseCurrency(workbook);
  const to = asString(toCurrency).toUpperCase() || baseCurrency(workbook);
  if (from === to) {
    return roundMoney(numeric);
  }
  const rate = getFxRateBetweenCurrencies(workbook, from, to, fxRateOverride);
  return rate > 0 ? roundMoney(numeric * rate) : roundMoney(numeric);
}

function convertAmountToBase(workbook, amount, currency, fxRateOverride) {
  return convertAmountBetweenCurrencies(
    workbook,
    amount,
    currency,
    baseCurrency(workbook),
    fxRateOverride
  );
}

export function createLedgerLine(
  workbook,
  accountId,
  direction,
  amount,
  currency,
  note = '',
  options = {}
) {
  const account = findLedgerAccount(workbook, accountId);
  const sourceCurrency = asString(currency).toUpperCase() || baseCurrency(workbook);
  const usesAccountCurrency = !!(
    account &&
    (account.group === 'asset' || account.group === 'liability')
  );
  const postingCurrency = usesAccountCurrency
    ? asString(account.currency).toUpperCase() || sourceCurrency
    : sourceCurrency;
  const postingAmount = usesAccountCurrency
    ? convertAmountBetweenCurrencies(
        workbook,
        amount,
        sourceCurrency,
        postingCurrency,
        options.fxRateToBase
      )
    : roundMoney(Number(amount) || 0);
  // The base value belongs to the transaction amount and its FX rate. Deriving it
  // from a rounded account-currency posting can introduce a round-trip remainder
  // and make two otherwise equal ledger lines appear unbalanced.
  const baseAmount = convertAmountToBase(workbook, amount, sourceCurrency, options.fxRateToBase);
  return {
    id: createId('line', options.index || 0, options.createId),
    accountId: asString(accountId),
    direction: direction === 'credit' ? 'credit' : 'debit',
    amount: postingAmount,
    currency: postingCurrency,
    baseAmount: roundMoney(baseAmount),
    note: String(note || '')
  };
}

export function normalizeLedgerTransaction(transaction, index = 0, workbook = {}, options = {}) {
  const source = transaction || {};
  const date = normalizeDateKey(source.date) || asString(source.date);
  const fxRateToBase = Number(source.fxRateToBase || 0) || 0;
  const eventKind = normalizeTransactionEventKind(source.eventKind);
  const lines = Array.isArray(source.lines)
    ? source.lines.map((line, lineIndex) => {
        const currency =
          asString(line && line.currency).toUpperCase() ||
          asString(source.originalCurrency).toUpperCase() ||
          baseCurrency(workbook);
        const amount = Number(line && line.amount) || 0;
        return {
          id: asString(line && line.id) || createId(`line_${index}`, lineIndex, options.createId),
          accountId: asString(line && line.accountId),
          direction: line && line.direction === 'credit' ? 'credit' : 'debit',
          amount,
          currency,
          baseAmount: roundMoney(
            typeof (line && line.baseAmount) === 'number'
              ? line.baseAmount
              : convertAmountToBase(workbook, amount, currency, fxRateToBase)
          ),
          note: String(line && line.note ? line.note : '')
        };
      })
    : [];
  const debitBase = roundMoney(
    lines
      .filter((line) => line.direction === 'debit')
      .reduce((sum, line) => sum + line.baseAmount, 0)
  );
  const creditBase = roundMoney(
    lines
      .filter((line) => line.direction === 'credit')
      .reduce((sum, line) => sum + line.baseAmount, 0)
  );
  return {
    id: asString(source.id) || createId('txn', index, options.createId),
    date,
    monthKey: asString(source.monthKey) || date.slice(0, 7),
    template: asString(source.template) || 'manual_journal',
    ...(eventKind ? { eventKind } : {}),
    description: asString(source.description) || 'Ledger Transaction',
    reference: String(source.reference || ''),
    categoryId: asString(source.categoryId),
    counterpartyId: asString(source.counterpartyId),
    recurringItemId: asString(source.recurringItemId),
    ...(normalizeDateKey(source.recurringOccurrenceDate)
      ? { recurringOccurrenceDate: normalizeDateKey(source.recurringOccurrenceDate) }
      : {}),
    originalCurrency:
      asString(source.originalCurrency).toUpperCase() ||
      (lines[0] && lines[0].currency) ||
      baseCurrency(workbook),
    amount: Number(source.amount || (lines[0] && lines[0].amount) || 0) || 0,
    baseAmount: roundMoney(
      typeof source.baseAmount === 'number' ? source.baseAmount : Math.max(debitBase, creditBase)
    ),
    fxRateToBase,
    note: String(source.note || ''),
    source: asString(source.source) || 'manual',
    lines
  };
}

export function buildManualLedgerTransaction(
  workbook,
  fields = {},
  existingTransaction = null,
  index = 0,
  sourceOptions = {}
) {
  const template = normalizeLedgerTransactionTemplate(fields.template) || 'expense_paid';
  const amount = Number(fields.amount || 0) || 0;
  const currency = asString(fields.currency).toUpperCase() || baseCurrency(workbook);
  const date = normalizeDateKey(fields.date) || '';
  const description = asString(fields.description);
  const categoryId = asString(fields.categoryId);
  const primaryAccountId = asString(fields.primaryAccountId);
  const secondaryAccountId = asString(fields.secondaryAccountId);
  const note = asString(fields.note);
  const fxRateToBase = Number(fields.fxRateToBase || fields.usdExpenseRate || 0) || 0;
  const isUsdExpense =
    currency === 'USD' &&
    baseCurrency(workbook) === 'PHP' &&
    (template === 'expense_paid' || template === 'expense_charged');
  const transactionFxRateToBase =
    fxRateToBase > 0
      ? fxRateToBase
      : isUsdExpense
        ? Number(workbook && workbook.settings && workbook.settings.usdToBaseRate) || 0
        : 0;
  const makeLineOptions = (lineIndex, fxRate = transactionFxRateToBase) => {
    const options = { index: lineIndex };
    if (fxRate) options.fxRateToBase = fxRate;
    if (typeof sourceOptions.createId === 'function') options.createId = sourceOptions.createId;
    return options;
  };

  if (!(amount > 0)) throw new Error('Enter a valid amount.');
  if (!date) throw new Error('Enter a valid transaction date.');
  if (isUsdExpense && !(transactionFxRateToBase > 0))
    throw new Error('Enter the USD rate used on that expense date.');

  const category = categoryId ? findLedgerCategory(workbook, categoryId) : null;
  const primaryAccount = primaryAccountId ? findLedgerAccount(workbook, primaryAccountId) : null;
  const secondaryAccount = secondaryAccountId
    ? findLedgerAccount(workbook, secondaryAccountId)
    : null;
  const lines = [];
  let finalCategoryId = categoryId;
  let resolvedDescription = description;

  if (template === 'income_received') {
    if (!(category && category.type === 'income')) throw new Error('Pick an income category.');
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      throw new Error('Choose an asset account to receive the income.');
    lines.push(
      createLedgerLine(
        workbook,
        primaryAccount.id,
        'debit',
        amount,
        currency,
        'Income received',
        makeLineOptions(0)
      )
    );
    lines.push(
      createLedgerLine(
        workbook,
        getCategoryLinkedAccountId(workbook, category.id),
        'credit',
        amount,
        currency,
        'Income category',
        makeLineOptions(1)
      )
    );
    resolvedDescription = resolvedDescription || `${category.name} received`;
  } else if (template === 'expense_paid') {
    if (!(category && category.type === 'expense')) throw new Error('Pick an expense category.');
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      throw new Error('Choose an asset account to fund the payment.');
    lines.push(
      createLedgerLine(
        workbook,
        getCategoryLinkedAccountId(workbook, category.id),
        'debit',
        amount,
        currency,
        'Category debit',
        makeLineOptions(0)
      )
    );
    lines.push(
      createLedgerLine(
        workbook,
        primaryAccount.id,
        'credit',
        amount,
        currency,
        'Asset funding',
        makeLineOptions(1)
      )
    );
    resolvedDescription = resolvedDescription || `${category.name} paid`;
  } else if (template === 'expense_charged') {
    if (!(category && category.type === 'expense')) throw new Error('Pick an expense category.');
    if (!(primaryAccount && primaryAccount.group === 'liability'))
      throw new Error('Choose a liability account such as a credit card.');
    lines.push(
      createLedgerLine(
        workbook,
        getCategoryLinkedAccountId(workbook, category.id),
        'debit',
        amount,
        currency,
        'Category debit',
        makeLineOptions(0)
      )
    );
    lines.push(
      createLedgerLine(
        workbook,
        primaryAccount.id,
        'credit',
        amount,
        currency,
        'Liability funding',
        makeLineOptions(1)
      )
    );
    resolvedDescription =
      resolvedDescription || `${category.name} charged to ${primaryAccount.name}`;
  } else if (template === 'merchant_refund') {
    if (!(category && category.type === 'expense'))
      throw new Error('Pick the original expense category.');
    if (!(primaryAccount && ['asset', 'liability'].includes(primaryAccount.group))) {
      throw new Error('Choose the cash account or credit card receiving the refund.');
    }
    lines.push(
      createLedgerLine(
        workbook,
        primaryAccount.id,
        'debit',
        amount,
        currency,
        primaryAccount.group === 'liability' ? 'Liability refund' : 'Refund received',
        makeLineOptions(0)
      )
    );
    lines.push(
      createLedgerLine(
        workbook,
        getCategoryLinkedAccountId(workbook, category.id),
        'credit',
        amount,
        currency,
        'Expense reversal',
        makeLineOptions(1)
      )
    );
    resolvedDescription = resolvedDescription || `${category.name} refund`;
  } else if (template === 'transfer') {
    if (!(primaryAccount && secondaryAccount && primaryAccount.id !== secondaryAccount.id))
      throw new Error('Choose two different accounts for the transfer.');
    lines.push(
      createLedgerLine(
        workbook,
        secondaryAccount.id,
        'debit',
        amount,
        currency,
        'Transfer destination',
        makeLineOptions(0)
      )
    );
    lines.push(
      createLedgerLine(
        workbook,
        primaryAccount.id,
        'credit',
        amount,
        currency,
        'Transfer source',
        makeLineOptions(1)
      )
    );
    finalCategoryId = '';
    resolvedDescription =
      resolvedDescription || `Transfer: ${primaryAccount.name} to ${secondaryAccount.name}`;
  } else if (template === 'debt_payment' || template === 'liability_payment') {
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      throw new Error('Choose an asset account to make the payment from.');
    if (!(secondaryAccount && secondaryAccount.group === 'liability'))
      throw new Error('Choose the liability account being settled.');
    if (!(category && category.type === 'debt')) throw new Error('Pick a debt category.');
    lines.push(
      createLedgerLine(
        workbook,
        secondaryAccount.id,
        'debit',
        amount,
        currency,
        'Liability reduction',
        makeLineOptions(0)
      )
    );
    lines.push(
      createLedgerLine(
        workbook,
        primaryAccount.id,
        'credit',
        amount,
        currency,
        'Asset payment',
        makeLineOptions(1)
      )
    );
    resolvedDescription =
      resolvedDescription || `${secondaryAccount.name} payment from ${primaryAccount.name}`;
  } else if (template === 'opening_balance') {
    const equityAccount = getOpeningBalanceEquityAccount(workbook);
    if (!equityAccount) throw new Error('Opening Balance Equity is missing.');
    if (!(
      primaryAccount &&
      (primaryAccount.group === 'asset' || primaryAccount.group === 'liability')
    ))
      throw new Error('Choose an asset or liability account for the opening balance.');
    if (primaryAccount.group === 'liability') {
      lines.push(
        createLedgerLine(
          workbook,
          equityAccount.id,
          'debit',
          amount,
          currency,
          'Opening balance equity',
          makeLineOptions(0)
        )
      );
      lines.push(
        createLedgerLine(
          workbook,
          primaryAccount.id,
          'credit',
          amount,
          currency,
          'Opening liability',
          makeLineOptions(1)
        )
      );
    } else {
      lines.push(
        createLedgerLine(
          workbook,
          primaryAccount.id,
          'debit',
          amount,
          currency,
          'Opening asset',
          makeLineOptions(0)
        )
      );
      lines.push(
        createLedgerLine(
          workbook,
          equityAccount.id,
          'credit',
          amount,
          currency,
          'Opening balance equity',
          makeLineOptions(1)
        )
      );
    }
    finalCategoryId = '';
    resolvedDescription = resolvedDescription || `Opening balance: ${primaryAccount.name}`;
  }

  const transaction = normalizeLedgerTransaction(
    {
      id: existingTransaction ? existingTransaction.id : undefined,
      date,
      template,
      eventKind:
        normalizeTransactionEventKind(fields.eventKind) ||
        normalizeTransactionEventKind(existingTransaction && existingTransaction.eventKind) ||
        inferTransactionEventKind(workbook, { template, categoryId: finalCategoryId }),
      description: resolvedDescription,
      categoryId: finalCategoryId,
      counterpartyId: existingTransaction
        ? existingTransaction.counterpartyId
        : asString(fields.counterpartyId),
      recurringItemId: existingTransaction
        ? existingTransaction.recurringItemId
        : asString(fields.recurringItemId),
      originalCurrency: currency,
      amount,
      fxRateToBase: transactionFxRateToBase,
      note,
      reference: existingTransaction
        ? existingTransaction.reference
        : String(sourceOptions.reference || ''),
      source: existingTransaction
        ? existingTransaction.source
        : String(sourceOptions.source || 'manual'),
      lines
    },
    index,
    workbook,
    {
      createId: sourceOptions.createId
    }
  );
  if (!isTransactionBalanced(transaction)) {
    throw new Error('Transaction is not balanced after rebuild.');
  }
  return transaction;
}

export function getLedgerTransactionBaseAmount(transaction) {
  return roundMoney(Number(transaction && transaction.baseAmount) || 0);
}

export function getLedgerTransactionFlowKind(workbook, transaction) {
  return getTransactionContributions(workbook, transaction).flowKind;
}

export function summarizeLedgerActivity(workbook, options = {}) {
  const start = normalizeDateKey(options.start);
  const end = normalizeDateKey(options.end);
  const summary = {
    income: 0,
    expense: 0,
    savings: 0,
    debt: 0,
    outflow: 0,
    net: 0,
    categoryTotals: {},
    transactionCount: 0
  };
  (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []).forEach(
    (transaction) => {
      const date = normalizeDateKey(transaction && transaction.date);
      if ((start && date && date < start) || (end && date && date > end)) {
        return;
      }
      const contribution = getTransactionContributions(workbook, transaction);
      if (!contribution.resolved) return;
      const kind = contribution.flowKind;
      const amount = contribution.signedBaseAmount;
      if (kind === 'inflow') summary.income = roundMoney(summary.income + amount);
      if (kind === 'expense') summary.expense = roundMoney(summary.expense + amount);
      if (kind === 'savings') summary.savings = roundMoney(summary.savings + amount);
      if (kind === 'debt') summary.debt = roundMoney(summary.debt + amount);
      if (['inflow', 'expense', 'savings', 'debt'].includes(kind)) {
        const categoryId = contribution.categoryId;
        summary.categoryTotals[categoryId] = roundMoney(
          (summary.categoryTotals[categoryId] || 0) + amount
        );
        summary.transactionCount += 1;
      }
    }
  );
  summary.outflow = roundMoney(summary.expense + summary.savings + summary.debt);
  summary.net = roundMoney(summary.income - summary.outflow);
  return summary;
}
