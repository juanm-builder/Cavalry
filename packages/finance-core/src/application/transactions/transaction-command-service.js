// Owns immutable transaction submit/delete commands and returns domain events for the app to apply.

import { buildLegacyTransactionFromComposerFields } from './legacy-transaction-composer-adapter.js';
import { normalizeTransactionComposerInput } from './transaction-composer-form-model.js';
import { buildManualTransactionSubmitIntent } from './transaction-submit-intent-service.js';
import { getAccountCurrencyIntegrity } from '../../domain/ledger/account-currency-integrity.js';
import { getLedgerTransactionBaseAmount } from '../../domain/ledger/transactions.js';
import {
  confirmRecurringReconciliationCommand,
  getRecurringCandidateEligibility
} from '../recurring/recurring-reconciliation-service.js';
import { cloneWorkbook, commandError, commandOk } from '../types/command-result.js';

function asString(value) {
  return String(value == null ? '' : value);
}

function getTransactions(workbook) {
  if (!workbook) {
    return [];
  }
  workbook.transactions = Array.isArray(workbook.transactions) ? workbook.transactions : [];
  return workbook.transactions;
}

function getDefaultDate(rawInput, services) {
  if (rawInput && rawInput.defaultDate) {
    return asString(rawInput.defaultDate);
  }
  if (services && typeof services.defaultDate === 'function') {
    return asString(services.defaultDate());
  }
  if (services && services.defaultDate) {
    return asString(services.defaultDate);
  }
  return '';
}

function getNewTransactionIndex(workbook, services) {
  if (services && typeof services.getTransactionIndex === 'function') {
    return Number(services.getTransactionIndex(workbook)) || 0;
  }
  return getTransactions(workbook).length;
}

function readTimestamp(services) {
  const value =
    services && typeof services.now === 'function' ? services.now() : services && services.now;
  return asString(value);
}

function syncRecurringAllocationsAfterEdit(workbook, previousTransaction, transaction, services) {
  const records = Array.isArray(workbook && workbook.recurringReconciliations)
    ? workbook.recurringReconciliations
    : [];
  if (!(previousTransaction && transaction && records.length)) return;
  const transactionId = asString(transaction.id);
  const previousAmount = getLedgerTransactionBaseAmount(previousTransaction);
  const nextAmount = getLedgerTransactionBaseAmount(transaction);
  const timestamp = readTimestamp(services);
  workbook.recurringReconciliations = records.map((record) => {
    if (
      asString(record && record.transactionId) !== transactionId ||
      asString(record && record.decision).toLowerCase() !== 'matched'
    ) {
      return record;
    }
    const recurringItem = (
      Array.isArray(workbook.recurringItems) ? workbook.recurringItems : []
    ).find((item) => asString(item && item.id) === asString(record.recurringItemId));
    const occurrenceDate = asString(record.occurrenceDate);
    const method = asString(record.method).toLowerCase();
    const validationTransaction =
      method === 'explicit'
        ? {
            ...transaction,
            recurringItemId: asString(record.recurringItemId),
            recurringOccurrenceDate: occurrenceDate
          }
        : transaction;
    const eligibility = recurringItem
      ? getRecurringCandidateEligibility(
          workbook,
          {
            recurringItemId: asString(recurringItem.id),
            recurringItem,
            categoryId: asString(recurringItem.categoryId),
            accountId: asString(recurringItem.accountId),
            dueDate: occurrenceDate
          },
          validationTransaction,
          { confirmedTransactionId: transactionId }
        )
      : { eligible: false, rejectionCode: 'recurring_item_not_found' };
    if (!eligibility.eligible) {
      return {
        ...record,
        decision: 'rejected',
        allocatedBaseAmount: 0,
        invalidatedReason: eligibility.rejectionCode,
        updatedAt: timestamp || asString(record.updatedAt)
      };
    }
    const allocated = Math.max(0, Number(record.allocatedBaseAmount) || 0);
    const tracksWholeTransaction =
      asString(record.method).toLowerCase() === 'explicit' ||
      Math.abs(allocated - previousAmount) <= 0.01;
    const allocatedBaseAmount = tracksWholeTransaction
      ? nextAmount
      : Math.min(allocated, nextAmount);
    return {
      ...record,
      allocatedBaseAmount,
      updatedAt: timestamp || asString(record.updatedAt)
    };
  });
}

function buildTransaction(
  workbook,
  composerFields,
  existingTransaction,
  index,
  sourceOptions,
  services
) {
  if (services && typeof services.buildTransaction === 'function') {
    return services.buildTransaction(
      workbook,
      composerFields,
      existingTransaction,
      index,
      sourceOptions
    );
  }
  return buildLegacyTransactionFromComposerFields(
    workbook,
    composerFields,
    existingTransaction,
    index,
    sourceOptions,
    (services && services.transactionBuilderServices) || {}
  );
}

function balanceAccountIdsForTransaction(workbook, transaction) {
  const accounts = Array.isArray(workbook && workbook.accounts) ? workbook.accounts : [];
  const balanceAccountIds = new Set(
    accounts
      .filter((account) => account && (account.group === 'asset' || account.group === 'liability'))
      .map((account) => asString(account.id))
  );
  return new Set(
    (transaction && Array.isArray(transaction.lines) ? transaction.lines : [])
      .map((line) => asString(line && line.accountId))
      .filter((accountId) => balanceAccountIds.has(accountId))
  );
}

function preserveExistingPostingValues(candidate, existingTransaction) {
  return Object.assign({}, candidate, {
    template: existingTransaction.template,
    categoryId: existingTransaction.categoryId,
    originalCurrency: existingTransaction.originalCurrency,
    amount: existingTransaction.amount,
    baseAmount: existingTransaction.baseAmount,
    fxRateToBase: existingTransaction.fxRateToBase,
    lines: (existingTransaction.lines || []).map((line) => ({ ...line }))
  });
}

export function submitManualTransactionCommand(workbook, rawInput = {}, services = {}) {
  const intent = buildManualTransactionSubmitIntent(workbook, rawInput);
  if (intent.error) {
    return commandError(workbook, intent.error, { intent });
  }
  if (intent.duplicateWarning && !(rawInput.allowDuplicate || services.allowDuplicate)) {
    return commandOk(workbook, {
      events: [
        {
          type: 'confirm-duplicate-transaction',
          warning: intent.duplicateWarning
        }
      ],
      warnings: [intent.duplicateWarning],
      intent
    });
  }
  if (
    intent.currencyConversionWarning &&
    !(rawInput.allowCurrencyConversion === true || services.allowCurrencyConversion === true)
  ) {
    return commandOk(workbook, {
      events: [
        {
          type: 'confirm-currency-conversion',
          warning: intent.currencyConversionWarning
        }
      ],
      warnings: [intent.currencyConversionWarning],
      intent
    });
  }

  const nextWorkbook = cloneWorkbook(workbook);
  const transactions = getTransactions(nextWorkbook);
  const existingIndex = intent.existingIndex;
  const existingTransaction = existingIndex >= 0 ? transactions[existingIndex] : null;
  const transactionIndex =
    existingIndex >= 0 ? existingIndex : getNewTransactionIndex(workbook, services);
  let transaction = null;
  try {
    const composerFields = normalizeTransactionComposerInput(intent.composerInput, nextWorkbook, {
      defaultDate: getDefaultDate(rawInput, services)
    });
    transaction = buildTransaction(
      nextWorkbook,
      composerFields,
      existingTransaction,
      transactionIndex,
      intent.sourceOptions,
      services
    );
    if (existingTransaction && intent.preserveExistingPostings) {
      transaction = preserveExistingPostingValues(transaction, existingTransaction);
    }
    if (intent.recurringTracking.shouldLink && intent.recurringTracking.occurrenceDate) {
      transaction.recurringOccurrenceDate = intent.recurringTracking.occurrenceDate;
    } else if (existingTransaction && existingTransaction.recurringOccurrenceDate) {
      transaction.recurringOccurrenceDate = existingTransaction.recurringOccurrenceDate;
    }
  } catch (error) {
    return commandError(
      workbook,
      {
        code: 'transaction.submit_failed',
        message: String(error && error.message ? error.message : error)
      },
      { intent }
    );
  }

  if (existingIndex >= 0) {
    transactions[existingIndex] = transaction;
    syncRecurringAllocationsAfterEdit(nextWorkbook, existingTransaction, transaction, services);
  } else {
    transactions.push(transaction);
  }

  if (!intent.preserveExistingPostings) {
    const affectedBalanceAccountIds = new Set([
      ...balanceAccountIdsForTransaction(nextWorkbook, existingTransaction),
      ...balanceAccountIdsForTransaction(nextWorkbook, transaction)
    ]);
    const inconsistent = Array.from(affectedBalanceAccountIds)
      .map((accountId) => getAccountCurrencyIntegrity(nextWorkbook, accountId))
      .find((integrity) => integrity.mismatched || integrity.mixed);
    if (inconsistent) {
      return commandError(
        workbook,
        {
          code: 'account_currency_repair_required',
          message: 'The transaction would leave an account with inconsistent currency history.',
          accountId: inconsistent.accountId,
          accountName: inconsistent.accountName,
          configuredCurrency: inconsistent.configuredCurrency,
          postingCurrencies: inconsistent.postingCurrencies,
          affectedTransactionIds: inconsistent.transactionIds
        },
        { intent }
      );
    }
  }

  let committedWorkbook = nextWorkbook;
  if (
    !existingTransaction &&
    intent.recurringTracking.shouldLink &&
    intent.recurringTracking.occurrenceDate
  ) {
    const reconciliation = confirmRecurringReconciliationCommand(
      nextWorkbook,
      {
        recurringItemId: intent.recurringTracking.linkedRecurringItemId,
        occurrenceDate: intent.recurringTracking.occurrenceDate,
        transactionId: transaction.id,
        method: 'explicit',
        confidence: 100
      },
      services
    );
    if (!reconciliation.ok) {
      return commandError(workbook, reconciliation.error, { intent });
    }
    committedWorkbook = reconciliation.workbook;
  }

  const events = [];
  if (existingTransaction) {
    events.push({
      type: 'refresh-generated-daily-interest',
      transaction: existingTransaction,
      transactionId: existingTransaction.id || ''
    });
  }
  events.push({
    type: 'refresh-generated-daily-interest',
    transaction,
    transactionId: transaction.id || ''
  });
  if (intent.advisor.shouldMarkPosted) {
    events.push({
      type: 'mark-advisor-transaction-posted',
      threadId: intent.advisor.threadId,
      messageId: intent.advisor.messageId,
      actionId: intent.advisor.actionId,
      transactionId: transaction.id || ''
    });
  }
  events.push({ type: 'set-ledger-page', page: 1 });
  events.push({ type: 'navigate', route: intent.nextRoute });
  events.push({ type: 'schedule-save' });
  events.push({ type: 'render' });
  if (!existingTransaction) {
    events.push({ type: 'reset-form' });
  }

  return commandOk(committedWorkbook, {
    events,
    intent,
    transaction,
    previousTransaction: existingTransaction,
    isEdit: existingIndex >= 0
  });
}

export function deleteLedgerTransactionCommand(workbook, transactionId) {
  const transactions = getTransactions(workbook);
  const targetId = asString(transactionId);
  const removedTransaction =
    transactions.find((item) => asString(item && item.id) === targetId) || null;
  if (!removedTransaction) {
    return commandError(workbook, {
      code: 'transaction.not_found',
      message: 'Transaction not found.'
    });
  }
  const nextWorkbook = cloneWorkbook(workbook);
  const nextTransactions = getTransactions(nextWorkbook);
  const removedFromNext = nextTransactions.find((item) => asString(item && item.id) === targetId);
  nextWorkbook.transactions = nextTransactions.filter(
    (item) => asString(item && item.id) !== targetId
  );
  nextWorkbook.recurringReconciliations = (
    Array.isArray(nextWorkbook.recurringReconciliations)
      ? nextWorkbook.recurringReconciliations
      : []
  ).filter((item) => asString(item && item.transactionId) !== targetId);
  return commandOk(nextWorkbook, {
    events: [
      {
        type: 'refresh-generated-daily-interest',
        transaction: removedFromNext,
        transactionId: removedFromNext.id || ''
      },
      { type: 'close-modal' },
      { type: 'schedule-save' },
      { type: 'render' }
    ],
    transaction: removedFromNext
  });
}
