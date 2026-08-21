// Keeps manual transaction submit decisions testable without owning DOM, workbook mutation, save, or render side effects.

import {
  normalizeRecurringFrequency,
  normalizeRecurringKind
} from '../recurring/recurring-analysis-service.js';
import { getAccountCurrencyIntegrity } from '../../domain/ledger/account-currency-integrity.js';
import { normalizeDateKey, roundMoney } from '../../domain/money.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asLegacyId(value) {
  return String(value == null ? '' : value);
}

function getRawValue(rawInput, key, fallback = '') {
  if (!rawInput || typeof rawInput !== 'object') {
    return fallback;
  }
  return Object.prototype.hasOwnProperty.call(rawInput, key) ? rawInput[key] : fallback;
}

function getWorkbookTransactions(workbook) {
  return workbook && Array.isArray(workbook.transactions) ? workbook.transactions : [];
}

function getWorkbookRecurringItem(workbook, recurringItemId) {
  const targetId = asString(recurringItemId);
  return targetId && workbook && Array.isArray(workbook.recurringItems)
    ? workbook.recurringItems.find((item) => asString(item && item.id) === targetId) || null
    : null;
}

function getWorkbookCategory(workbook, categoryId) {
  const targetId = asLegacyId(categoryId);
  return targetId && workbook && Array.isArray(workbook.categories)
    ? workbook.categories.find((category) => asLegacyId(category && category.id) === targetId) ||
        null
    : null;
}

function getWorkbookAccount(workbook, accountId) {
  const targetId = asLegacyId(accountId);
  return targetId && workbook && Array.isArray(workbook.accounts)
    ? workbook.accounts.find((account) => asLegacyId(account && account.id) === targetId) || null
    : null;
}

function normalizeRecurringTrackingMode(value) {
  const mode = asString(value || 'none');
  return mode === 'link' || mode === 'create' ? mode : 'none';
}

function normalizeTemplate(value) {
  const raw = asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (raw === 'expense' || raw === 'purchase' || raw === 'spend') return 'expense_paid';
  if (raw === 'charge' || raw === 'charged') return 'expense_charged';
  if (raw === 'income' || raw === 'salary') return 'income_received';
  if (['refund', 'chargeback', 'charge_reversal', 'reversal'].includes(raw))
    return 'merchant_refund';
  if (raw === 'payment' || raw === 'debt' || raw === 'liability') return 'debt_payment';
  if (raw === 'opening') return 'opening_balance';
  return raw || 'expense_paid';
}

function routeExpenseTemplateByAccount(workbook, template, primaryAccountId) {
  const normalized = normalizeTemplate(template);
  if (normalized !== 'expense_paid') return normalized;
  const primaryAccount = getWorkbookAccount(workbook, primaryAccountId);
  return primaryAccount && primaryAccount.group === 'liability' ? 'expense_charged' : normalized;
}

function buildAssignmentIssue(workbook, composerInput) {
  const template = normalizeTemplate(composerInput.template);
  const category = composerInput.categoryId
    ? getWorkbookCategory(workbook, composerInput.categoryId)
    : null;
  const primaryAccount = composerInput.primaryAccountId
    ? getWorkbookAccount(workbook, composerInput.primaryAccountId)
    : null;
  const secondaryAccount = composerInput.secondaryAccountId
    ? getWorkbookAccount(workbook, composerInput.secondaryAccountId)
    : null;
  if (template === 'income_received') {
    if (!(category && category.type === 'income'))
      return {
        code: 'invalid_income_category',
        field: 'categoryId',
        message: 'Pick an income category.'
      };
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      return {
        code: 'invalid_income_account',
        field: 'primaryAccountId',
        message: 'Choose an asset account to receive the income.'
      };
  } else if (template === 'merchant_refund') {
    if (!(category && category.type === 'expense'))
      return {
        code: 'invalid_refund_category',
        field: 'categoryId',
        message: 'Pick the original expense category.'
      };
    if (!(primaryAccount && ['asset', 'liability'].includes(primaryAccount.group)))
      return {
        code: 'invalid_refund_account',
        field: 'primaryAccountId',
        message: 'Choose the cash account or credit card receiving the refund.'
      };
  } else if (template === 'expense_paid') {
    if (!(category && category.type === 'expense'))
      return {
        code: 'invalid_expense_category',
        field: 'categoryId',
        message: 'Pick an expense category.'
      };
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      return {
        code: 'invalid_expense_account',
        field: 'primaryAccountId',
        message: 'Choose an asset account to fund the payment.'
      };
  } else if (template === 'expense_charged') {
    if (!(category && category.type === 'expense'))
      return {
        code: 'invalid_charged_expense_category',
        field: 'categoryId',
        message: 'Pick an expense category.'
      };
    if (!(primaryAccount && primaryAccount.group === 'liability'))
      return {
        code: 'invalid_charged_expense_account',
        field: 'primaryAccountId',
        message: 'Choose a liability account such as a credit card.'
      };
  } else if (template === 'transfer') {
    if (!(primaryAccount && secondaryAccount && primaryAccount.id !== secondaryAccount.id))
      return {
        code: 'invalid_transfer_accounts',
        field: 'secondaryAccountId',
        message: 'Choose two different accounts for the transfer.'
      };
  } else if (template === 'debt_payment' || template === 'liability_payment') {
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      return {
        code: 'invalid_debt_payment_account',
        field: 'primaryAccountId',
        message: 'Choose an asset account to make the payment from.'
      };
    if (!(secondaryAccount && secondaryAccount.group === 'liability'))
      return {
        code: 'invalid_debt_payment_liability',
        field: 'secondaryAccountId',
        message: 'Choose the liability account being settled.'
      };
    if (!(category && category.type === 'debt'))
      return {
        code: 'invalid_debt_category',
        field: 'categoryId',
        message: 'Pick a debt category.'
      };
  } else if (template === 'opening_balance') {
    if (!(
      primaryAccount &&
      (primaryAccount.group === 'asset' || primaryAccount.group === 'liability')
    ))
      return {
        code: 'invalid_opening_balance_account',
        field: 'primaryAccountId',
        message: 'Choose an asset or liability account for the opening balance.'
      };
  }
  return null;
}

function isBalanceAccount(account) {
  return !!(account && (account.group === 'asset' || account.group === 'liability'));
}

function selectedBalanceAccounts(workbook, composerInput) {
  const ids = [composerInput.primaryAccountId, composerInput.secondaryAccountId];
  const seen = new Set();
  return ids
    .map((accountId) => getWorkbookAccount(workbook, accountId))
    .filter((account) => {
      if (!isBalanceAccount(account) || seen.has(account.id)) return false;
      seen.add(account.id);
      return true;
    });
}

function findTransactionLineAccount(workbook, transaction, group, direction) {
  return (
    (transaction && Array.isArray(transaction.lines) ? transaction.lines : []).find((line) => {
      if (direction && line && line.direction !== direction) return false;
      const account = getWorkbookAccount(workbook, line && line.accountId);
      return account && account.group === group;
    }) || null
  );
}

function existingTransactionAssignments(workbook, transaction) {
  const template = normalizeTemplate(transaction && transaction.template);
  const lines = transaction && Array.isArray(transaction.lines) ? transaction.lines : [];
  const balanceLine = (direction) =>
    lines.find((line) => {
      if (direction && line && line.direction !== direction) return false;
      return isBalanceAccount(getWorkbookAccount(workbook, line && line.accountId));
    }) || null;
  let primaryAccountId = '';
  let secondaryAccountId = '';
  if (template === 'income_received') {
    primaryAccountId = asLegacyId(
      findTransactionLineAccount(workbook, transaction, 'asset', 'debit')?.accountId
    );
  } else if (template === 'merchant_refund') {
    primaryAccountId = asLegacyId(balanceLine('debit')?.accountId);
  } else if (template === 'expense_paid') {
    primaryAccountId = asLegacyId(
      findTransactionLineAccount(workbook, transaction, 'asset', 'credit')?.accountId
    );
  } else if (template === 'expense_charged') {
    primaryAccountId = asLegacyId(
      findTransactionLineAccount(workbook, transaction, 'liability', 'credit')?.accountId
    );
  } else if (template === 'transfer') {
    primaryAccountId = asLegacyId(balanceLine('credit')?.accountId);
    secondaryAccountId = asLegacyId(balanceLine('debit')?.accountId);
  } else if (template === 'debt_payment' || template === 'liability_payment') {
    primaryAccountId = asLegacyId(
      findTransactionLineAccount(workbook, transaction, 'asset', 'credit')?.accountId
    );
    secondaryAccountId = asLegacyId(
      findTransactionLineAccount(workbook, transaction, 'liability', 'debit')?.accountId
    );
  } else if (template === 'opening_balance') {
    primaryAccountId = asLegacyId(balanceLine('')?.accountId);
  }
  return { primaryAccountId, secondaryAccountId };
}

function numericFxRate(value) {
  return (
    Number(
      String(value == null ? '' : value)
        .replace(/,/g, '')
        .trim()
    ) || 0
  );
}

function hasUnchangedPostingShape(workbook, existingTransaction, composerInput) {
  if (!existingTransaction) return false;
  const assignments = existingTransactionAssignments(workbook, existingTransaction);
  return !!(
    normalizeTemplate(composerInput.template) === normalizeTemplate(existingTransaction.template) &&
    roundMoney(Number(composerInput.amount) || 0) ===
      roundMoney(Number(existingTransaction.amount) || 0) &&
    asString(composerInput.currency).toUpperCase() ===
      asString(
        existingTransaction.originalCurrency ||
          existingTransaction.currency ||
          (workbook && workbook.currency)
      ).toUpperCase() &&
    numericFxRate(composerInput.fxRateToBase || composerInput.usdExpenseRate) ===
      (Number(existingTransaction.fxRateToBase) || 0) &&
    asLegacyId(composerInput.categoryId) === asLegacyId(existingTransaction.categoryId) &&
    asLegacyId(composerInput.primaryAccountId) === assignments.primaryAccountId &&
    asLegacyId(composerInput.secondaryAccountId) === assignments.secondaryAccountId
  );
}

function buildAccountCurrencyIntegrityIssue(workbook, accounts) {
  const inconsistent = accounts
    .map((account) => getAccountCurrencyIntegrity(workbook, account.id))
    .find((integrity) => integrity.mismatched || integrity.mixed);
  if (!inconsistent) return null;
  return {
    code: 'account_currency_repair_required',
    field: 'primaryAccountId',
    message: 'Repair this account currency before posting another transaction to it.',
    accountId: inconsistent.accountId,
    accountName: inconsistent.accountName,
    configuredCurrency: inconsistent.configuredCurrency,
    postingCurrencies: inconsistent.postingCurrencies,
    affectedTransactionIds: inconsistent.transactionIds
  };
}

function buildCurrencyConversionWarning(workbook, composerInput, accounts) {
  const transactionCurrency =
    asString(composerInput.currency).toUpperCase() ||
    asString(workbook && workbook.currency).toUpperCase() ||
    'PHP';
  const conversions = accounts
    .filter((account) => {
      const configuredCurrency =
        asString(account && account.currency).toUpperCase() ||
        asString(workbook && workbook.currency).toUpperCase() ||
        'PHP';
      return configuredCurrency !== transactionCurrency;
    })
    .map((account) => ({
      accountId: asLegacyId(account.id),
      accountName: asString(account.name),
      accountCurrency:
        asString(account.currency).toUpperCase() ||
        asString(workbook && workbook.currency).toUpperCase() ||
        'PHP'
    }));
  if (conversions.length === 0) return null;
  const baseCurrency = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const fxRateToBase = numericFxRate(composerInput.fxRateToBase || composerInput.usdExpenseRate);
  const foreignCurrencies = Array.from(
    new Set(
      [transactionCurrency, ...conversions.map((conversion) => conversion.accountCurrency)].filter(
        (currency) => currency && currency !== baseCurrency
      )
    )
  );
  const rateDisclosure =
    fxRateToBase > 0 && foreignCurrencies.length === 1
      ? `1 ${foreignCurrencies[0]} = ${baseCurrency} ${fxRateToBase}`
      : fxRateToBase > 0
        ? `entered base-currency rate ${fxRateToBase}`
        : 'no exchange rate entered';
  const accountDisclosure = conversions
    .map((conversion) => `${conversion.accountName} (configured ${conversion.accountCurrency})`)
    .join(', ');
  return {
    code: 'account_currency_conversion_confirmation_required',
    message: `Transaction currency: ${transactionCurrency}. Affected account: ${accountDisclosure}. Exchange rate: ${rateDisclosure}.`,
    confirmMessage: `Post this ${transactionCurrency} transaction to ${accountDisclosure} using ${rateDisclosure}?`,
    transactionCurrency,
    baseCurrency,
    fxRateToBase,
    rateDisclosure,
    accounts: conversions
  };
}

function normalizeDuplicateDescription(value) {
  return asString(value).replace(/\s+/g, ' ').toLowerCase();
}

function transactionHasAccount(transaction, accountId) {
  const targetId = asLegacyId(accountId);
  return !!(
    targetId &&
    transaction &&
    Array.isArray(transaction.lines) &&
    transaction.lines.some((line) => asLegacyId(line && line.accountId) === targetId)
  );
}

function getDuplicateCandidate(workbook, composerInput, existingIndex) {
  if (existingIndex >= 0) {
    return null;
  }
  const date = normalizeDateKey(composerInput.date);
  const amount = roundMoney(Number(composerInput.amount) || 0);
  const description = normalizeDuplicateDescription(composerInput.description);
  const categoryId = asLegacyId(composerInput.categoryId);
  const primaryAccountId = asLegacyId(composerInput.primaryAccountId);
  if (!(date && amount > 0 && description && categoryId && primaryAccountId)) {
    return null;
  }
  return (
    getWorkbookTransactions(workbook).find(
      (transaction) =>
        normalizeDateKey(transaction && transaction.date) === date &&
        roundMoney(Number(transaction && transaction.amount) || 0) === amount &&
        asLegacyId(transaction && transaction.categoryId) === categoryId &&
        normalizeDuplicateDescription(transaction && transaction.description) === description &&
        transactionHasAccount(transaction, primaryAccountId)
    ) || null
  );
}

export function buildManualTransactionSubmitIntent(workbook, rawInput = {}) {
  const transactionId = asLegacyId(getRawValue(rawInput, 'transactionId', ''));
  const transactions = getWorkbookTransactions(workbook);
  const existingIndex = transactionId
    ? transactions.findIndex(
        (transaction) => asLegacyId(transaction && transaction.id) === transactionId
      )
    : -1;
  const isEdit = existingIndex >= 0;

  const advisorThreadId = asString(getRawValue(rawInput, 'advisorThreadId', ''));
  const advisorMessageId = asString(getRawValue(rawInput, 'advisorMessageId', ''));
  const advisorActionId = asString(getRawValue(rawInput, 'advisorActionId', ''));
  const advisorReference = asString(getRawValue(rawInput, 'advisorReference', ''));
  const sourceRoute = asString(getRawValue(rawInput, 'sourceRoute', ''));
  const recurringTrackingMode = normalizeRecurringTrackingMode(
    getRawValue(rawInput, 'recurringTrackingMode', 'none')
  );
  const selectedRecurringItemId = asString(getRawValue(rawInput, 'recurringItemId', ''));
  const recurringOccurrenceDate = normalizeDateKey(
    getRawValue(rawInput, 'recurringOccurrenceDate', '')
  );
  const linkedRecurringItem =
    recurringTrackingMode === 'link' && selectedRecurringItemId
      ? getWorkbookRecurringItem(workbook, selectedRecurringItemId)
      : null;
  const linkedRecurringItemId = linkedRecurringItem ? asString(linkedRecurringItem.id) : '';
  const recurringKind = normalizeRecurringKind(getRawValue(rawInput, 'recurringKind', 'bill'));
  const recurringFrequency = normalizeRecurringFrequency(
    getRawValue(rawInput, 'recurringFrequency', 'Monthly')
  );
  const recurringError =
    recurringTrackingMode === 'link' && selectedRecurringItemId && !linkedRecurringItem
      ? {
          code: 'missing_recurring_item',
          message: 'Choose a valid bill or subscription tracker.'
        }
      : null;
  const rawFxRateToBase = getRawValue(
    rawInput,
    'fxRateToBase',
    getRawValue(rawInput, 'usdExpenseRate', '')
  );
  const primaryAccountId = asLegacyId(getRawValue(rawInput, 'primaryAccountId', ''));
  const composerInput = {
    template: routeExpenseTemplateByAccount(
      workbook,
      getRawValue(rawInput, 'template', 'expense_paid'),
      primaryAccountId
    ),
    amount: getRawValue(rawInput, 'amount', ''),
    currency: getRawValue(rawInput, 'currency', ''),
    date: getRawValue(rawInput, 'date', ''),
    fxRateToBase: rawFxRateToBase,
    usdExpenseRate: getRawValue(rawInput, 'usdExpenseRate', rawFxRateToBase),
    description: asString(getRawValue(rawInput, 'description', '')),
    categoryId: asLegacyId(getRawValue(rawInput, 'categoryId', '')),
    primaryAccountId,
    secondaryAccountId: asLegacyId(getRawValue(rawInput, 'secondaryAccountId', '')),
    counterpartyId: asLegacyId(getRawValue(rawInput, 'counterpartyId', '')),
    counterpartyName: asString(getRawValue(rawInput, 'counterpartyName', '')),
    counterpartyKind: asString(getRawValue(rawInput, 'counterpartyKind', 'other')).toLowerCase(),
    note: asString(getRawValue(rawInput, 'note', '')),
    recurringItemId:
      linkedRecurringItemId ||
      (isEdit
        ? asString(transactions[existingIndex] && transactions[existingIndex].recurringItemId)
        : '')
  };
  const assignmentIssue = buildAssignmentIssue(workbook, composerInput);
  const existingTransaction = existingIndex >= 0 ? transactions[existingIndex] : null;
  const preserveExistingPostings = hasUnchangedPostingShape(
    workbook,
    existingTransaction,
    composerInput
  );
  const balanceAccounts = selectedBalanceAccounts(workbook, composerInput);
  const accountCurrencyIssue =
    !isEdit || !preserveExistingPostings
      ? buildAccountCurrencyIntegrityIssue(workbook, balanceAccounts)
      : null;
  const currencyConversionWarning = preserveExistingPostings
    ? null
    : buildCurrencyConversionWarning(workbook, composerInput, balanceAccounts);
  const currencyConversionRateIssue =
    currencyConversionWarning && !(currencyConversionWarning.fxRateToBase > 0)
      ? {
          code: 'account_currency_conversion_rate_required',
          field: 'fxRateToBase',
          message: 'Enter the exchange rate used for this cross-currency transaction.',
          transactionCurrency: currencyConversionWarning.transactionCurrency,
          accounts: currencyConversionWarning.accounts
        }
      : null;
  const duplicateCandidate = getDuplicateCandidate(workbook, composerInput, existingIndex);

  return {
    transactionId,
    existingIndex,
    isEdit,
    preserveExistingPostings,
    nextRoute: sourceRoute === 'bills' ? 'bills' : 'ledger',
    composerInput,
    sourceOptions: {
      reference: advisorActionId
        ? advisorReference ||
          'advisor:' + advisorThreadId + ':' + advisorMessageId + ':' + advisorActionId
        : '',
      source: advisorActionId ? 'advisor' : sourceRoute === 'notes' ? 'notes' : 'manual'
    },
    advisor: {
      threadId: advisorThreadId,
      messageId: advisorMessageId,
      actionId: advisorActionId,
      reference: advisorReference,
      shouldMarkPosted: !isEdit && !!(advisorThreadId && advisorMessageId && advisorActionId)
    },
    recurringTracking: {
      mode: recurringTrackingMode,
      kind: recurringKind,
      frequency: recurringFrequency,
      selectedRecurringItemId,
      linkedRecurringItemId,
      occurrenceDate: recurringOccurrenceDate,
      shouldCreate: !isEdit && recurringTrackingMode === 'create',
      shouldLink: !isEdit && recurringTrackingMode === 'link' && !!linkedRecurringItemId
    },
    duplicateWarning: duplicateCandidate
      ? {
          code: 'possible_duplicate_transaction',
          message:
            'Possible duplicate transaction: same date, amount, category, account, and description.',
          transactionId: duplicateCandidate.id || '',
          confirmMessage:
            'Possible duplicate transaction: same date, amount, category, account, and description. Post anyway?'
        }
      : null,
    currencyConversionWarning,
    error: recurringError || assignmentIssue || accountCurrencyIssue || currencyConversionRateIssue
  };
}
