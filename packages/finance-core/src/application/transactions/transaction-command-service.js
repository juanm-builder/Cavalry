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
  const transactions = getTransactions(workbook);
  const ids = new Set(transactions.map((transaction) => asString(transaction && transaction.id)));
  let index = transactions.length;
  while (ids.has(`txn_${index}`)) index += 1;
  return index;
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

function replacementFailure(workbook, index, result) {
  const cause = Array.isArray(result && result.errors) ? result.errors[0] : null;
  return commandError(
    workbook,
    {
      ...(cause || {}),
      code: asString(cause && cause.code) || 'transaction.replacement_failed',
      message:
        asString(cause && cause.message) ||
        `Replacement transaction ${index + 1} could not be prepared.`,
      replacementIndex: index
    },
    { replacementIndex: index }
  );
}

function stableReplacementValue(value) {
  if (Array.isArray(value)) return value.map(stableReplacementValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableReplacementValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function replacementHash(value) {
  const source = asString(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function replacementFingerprint(targetId, replacementInputs) {
  return replacementHash(
    JSON.stringify(stableReplacementValue({ targetId, replacements: replacementInputs }))
  );
}

function normalizedReplacementOperationKey(services, targetId, replacementInputs) {
  const supplied = asString(services && services.operationKey).trim();
  if (supplied) return supplied.replace(/\s+/g, '_').slice(0, 120);
  return `replace_${replacementFingerprint(targetId, replacementInputs)}`;
}

function replacementOperationReference(operationKey, targetId, fingerprint, targetFingerprint) {
  return `advisor:companion:${operationKey}:replace:${encodeURIComponent(
    asString(targetId)
  )}:fingerprint:${asString(fingerprint)}:target:${asString(targetFingerprint)}`;
}

function replacementOperationPrefix(operationKey) {
  return `advisor:companion:${operationKey}:replace:`;
}

function replacementTargetFromReference(reference, operationKey) {
  const source = asString(reference);
  const prefix = replacementOperationPrefix(operationKey);
  if (!source.startsWith(prefix)) return '';
  try {
    return decodeURIComponent(source.slice(prefix.length).split(':fingerprint:')[0]);
  } catch (_error) {
    return '';
  }
}

function replacementFingerprintFromReference(reference) {
  return (asString(reference).split(':fingerprint:')[1] || '').split(':target:')[0];
}

function replacementTargetFingerprintFromReference(reference) {
  return asString(reference).split(':target:')[1] || '';
}

export function getLedgerTransactionReplacementPrecondition(
  workbook,
  transactionId,
  replacementInputs = []
) {
  const targetId = asString(transactionId);
  const transaction = getTransactions(workbook).find(
    (candidate) => asString(candidate && candidate.id) === targetId
  );
  if (!transaction) return null;
  const accountIds = new Set(
    (Array.isArray(transaction.lines) ? transaction.lines : []).map((line) =>
      asString(line && line.accountId)
    )
  );
  replacementInputs.forEach((input) => {
    const primaryId = asString(input && input.primaryAccountId);
    const secondaryId = asString(input && input.secondaryAccountId);
    if (primaryId) accountIds.add(primaryId);
    if (secondaryId) accountIds.add(secondaryId);
  });
  const categoryIds = new Set([asString(transaction && transaction.categoryId)]);
  replacementInputs.forEach((input) => {
    const categoryId = asString(input && input.categoryId);
    if (categoryId) categoryIds.add(categoryId);
  });
  const relatedCategories = (
    Array.isArray(workbook && workbook.categories) ? workbook.categories : []
  ).filter((candidate) => categoryIds.has(asString(candidate && candidate.id)));
  relatedCategories.forEach((category) => {
    const linkedAccountId = asString(category && category.linkedAccountId);
    if (linkedAccountId) accountIds.add(linkedAccountId);
  });
  const relatedAccounts = (
    Array.isArray(workbook && workbook.accounts) ? workbook.accounts : []
  ).filter((account) => accountIds.has(asString(account && account.id)));
  const counterpartyIds = new Set([asString(transaction && transaction.counterpartyId)]);
  replacementInputs.forEach((input) => {
    const counterpartyId = asString(input && input.counterpartyId);
    if (counterpartyId) counterpartyIds.add(counterpartyId);
  });
  const relatedCounterparties = (
    Array.isArray(workbook && workbook.counterparties) ? workbook.counterparties : []
  ).filter((candidate) => counterpartyIds.has(asString(candidate && candidate.id)));
  const reconciliations = (
    Array.isArray(workbook && workbook.recurringReconciliations)
      ? workbook.recurringReconciliations
      : []
  ).filter((record) => asString(record && record.transactionId) === targetId);
  return {
    targetTransactionId: targetId,
    targetFingerprint: replacementHash(
      JSON.stringify(
        stableReplacementValue({
          transaction,
          workbook: {
            id: asString(workbook && workbook.id),
            version: workbook && workbook.version,
            year: workbook && workbook.year,
            currency: asString(workbook && workbook.currency),
            settings: (workbook && workbook.settings) || null
          },
          relatedAccounts,
          relatedCategories,
          relatedCounterparties,
          reconciliations
        })
      )
    )
  };
}

function replacementEntityIds(workbook) {
  const ids = new Set();
  getTransactions(workbook).forEach((transaction) => {
    const transactionId = asString(transaction && transaction.id);
    if (transactionId) ids.add(transactionId);
    (Array.isArray(transaction && transaction.lines) ? transaction.lines : []).forEach((line) => {
      const lineId = asString(line && line.id);
      if (lineId) ids.add(lineId);
    });
  });
  return ids;
}

function replacementIdServices(services, operationKey, replacementIndex, reservedIds) {
  const counts = new Map();
  const operationHash = replacementHash(operationKey);
  const createId = (prefix = 'id') => {
    const safePrefix =
      asString(prefix)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'id';
    let count = counts.get(safePrefix) || 0;
    let candidate = '';
    do {
      count += 1;
      candidate = `advisor_replace_${operationHash}_${replacementIndex + 1}_${safePrefix}_${count}`;
    } while (reservedIds.has(candidate));
    counts.set(safePrefix, count);
    reservedIds.add(candidate);
    return candidate;
  };
  return {
    ...(services || {}),
    transactionBuilderServices: {
      ...((services && services.transactionBuilderServices) || {}),
      createId
    }
  };
}

function replacementIdsAreUnique(transaction, reservedBefore) {
  const ids = [
    asString(transaction && transaction.id),
    ...(Array.isArray(transaction && transaction.lines) ? transaction.lines : []).map((line) =>
      asString(line && line.id)
    )
  ];
  const nonBlank = ids.filter(Boolean);
  return (
    nonBlank.length === ids.length &&
    new Set(nonBlank).size === nonBlank.length &&
    nonBlank.every((id) => !reservedBefore.has(id))
  );
}

function originalReplacementGuard(workbook, original) {
  if (asString(original && original.eventKind).toLowerCase() === 'reimbursement') {
    return {
      code: 'transaction.reimbursement_replacement_unsupported',
      message:
        'Reimbursement transactions cannot be structurally replaced because their contribution semantics must remain unchanged.'
    };
  }
  const targetId = asString(original && original.id);
  const hasRecurringReconciliation = (
    Array.isArray(workbook && workbook.recurringReconciliations)
      ? workbook.recurringReconciliations
      : []
  ).some((record) => asString(record && record.transactionId) === targetId);
  if (
    asString(original && original.recurringItemId) ||
    asString(original && original.recurringOccurrenceDate) ||
    hasRecurringReconciliation
  ) {
    return {
      code: 'transaction.recurring_replacement_unsupported',
      message:
        'A recurring-linked transaction cannot be structurally replaced without an explicit reconciliation mapping.'
    };
  }
  return null;
}

/**
 * Replaces one ledger transaction with one or more validated transactions as a
 * single immutable command. No intermediate workbook is returned when any
 * replacement fails or needs confirmation.
 */
export function replaceLedgerTransactionCommand(
  workbook,
  transactionId,
  replacementInputs = [],
  services = {}
) {
  const targetId = asString(transactionId);
  if (!Array.isArray(replacementInputs) || replacementInputs.length === 0) {
    return commandError(workbook, {
      code: 'transaction.replacements_required',
      message: 'Provide at least one replacement transaction.'
    });
  }
  const operationKey = normalizedReplacementOperationKey(services, targetId, replacementInputs);
  const fingerprint = replacementFingerprint(targetId, replacementInputs);
  const priorReplacements = getTransactions(workbook).filter((transaction) =>
    asString(transaction && transaction.reference).startsWith(
      replacementOperationPrefix(operationKey)
    )
  );
  if (priorReplacements.length) {
    const priorOperationReference = asString(
      priorReplacements[0] && priorReplacements[0].reference
    );
    const receiptTargetId =
      replacementTargetFromReference(priorOperationReference, operationKey) || targetId;
    const receiptFingerprint =
      replacementFingerprintFromReference(priorOperationReference) || fingerprint;
    const receiptTargetFingerprint =
      replacementTargetFingerprintFromReference(priorOperationReference);
    if (receiptTargetId !== targetId || receiptFingerprint !== fingerprint) {
      return commandError(workbook, {
        code: 'transaction.operation_key_conflict',
        message:
          'This replacement operation key was already used for a different target or replacement proposal.',
        operationKey,
        targetTransactionId: receiptTargetId
      });
    }
    return commandOk(workbook, {
      events: [],
      warnings: [],
      transaction: null,
      originalTransaction: { id: receiptTargetId },
      createdTransactions: priorReplacements,
      replacements: priorReplacements,
      atomic: true,
      idempotent: true,
      operationKey,
      operationReference: priorOperationReference,
      fingerprint: receiptFingerprint,
      targetFingerprint: receiptTargetFingerprint,
      receipt: {
        operationKey,
        operationReference: priorOperationReference,
        fingerprint: receiptFingerprint,
        targetFingerprint: receiptTargetFingerprint,
        targetTransactionId: receiptTargetId,
        replacementTransactionIds: priorReplacements.map((transaction) =>
          asString(transaction && transaction.id)
        )
      }
    });
  }
  const original = getTransactions(workbook).find(
    (transaction) => asString(transaction && transaction.id) === targetId
  );
  if (!original) {
    return commandError(workbook, {
      code: 'transaction.not_found',
      message: 'Transaction not found.'
    });
  }
  const precondition = getLedgerTransactionReplacementPrecondition(
    workbook,
    targetId,
    replacementInputs
  );
  const targetFingerprint = asString(precondition && precondition.targetFingerprint);
  const expectedReplacementFingerprint = asString(
    services && services.expectedReplacementFingerprint
  );
  if (expectedReplacementFingerprint && expectedReplacementFingerprint !== fingerprint) {
    return commandError(workbook, {
      code: 'transaction.replacement_proposal_conflict',
      message: 'The approved replacement proposal no longer matches its prepared transaction set.'
    });
  }
  const expectedTargetFingerprint = asString(services && services.expectedTargetFingerprint);
  if (expectedTargetFingerprint && expectedTargetFingerprint !== targetFingerprint) {
    return commandError(workbook, {
      code: 'transaction.replacement_precondition_failed',
      message:
        'The transaction or its referenced ledger records changed after this replacement was prepared. Review the refreshed proposal before confirming.'
    });
  }
  const guard = originalReplacementGuard(workbook, original);
  if (guard) return commandError(workbook, guard);
  const operationReference = replacementOperationReference(
    operationKey,
    targetId,
    fingerprint,
    targetFingerprint
  );

  const removed = deleteLedgerTransactionCommand(workbook, targetId);
  if (!removed.ok) return removed;

  let nextWorkbook = removed.workbook;
  const createdTransactions = [];
  const warnings = [];
  const reservedIds = replacementEntityIds(workbook);
  for (let index = 0; index < replacementInputs.length; index += 1) {
    const reservedBefore = new Set(reservedIds);
    const replacementServices = replacementIdServices(services, operationKey, index, reservedIds);
    const submitted = submitManualTransactionCommand(
      nextWorkbook,
      {
        ...replacementInputs[index],
        advisorActionId: operationKey,
        advisorReference: operationReference
      },
      replacementServices
    );
    if (!submitted.ok) return replacementFailure(workbook, index, submitted);
    if (submitted.workbook === nextWorkbook) {
      return commandOk(workbook, {
        events: submitted.events,
        warnings: submitted.warnings,
        confirmationPending: true,
        replacementIndex: index,
        originalTransaction: original,
        operationKey,
        operationReference,
        fingerprint,
        targetFingerprint
      });
    }
    if (!replacementIdsAreUnique(submitted.transaction, reservedBefore)) {
      return commandError(
        workbook,
        {
          code: 'transaction.replacement_id_collision',
          message: `Replacement transaction ${index + 1} did not produce unique record IDs.`,
          replacementIndex: index
        },
        { replacementIndex: index }
      );
    }
    reservedIds.add(asString(submitted.transaction && submitted.transaction.id));
    (Array.isArray(submitted.transaction && submitted.transaction.lines)
      ? submitted.transaction.lines
      : []
    ).forEach((line) => reservedIds.add(asString(line && line.id)));
    nextWorkbook = submitted.workbook;
    createdTransactions.push(submitted.transaction);
    warnings.push(...(Array.isArray(submitted.warnings) ? submitted.warnings : []));
  }

  return commandOk(nextWorkbook, {
    events: [
      {
        type: 'refresh-generated-daily-interest',
        transaction: original,
        transactionId: original.id || ''
      },
      ...createdTransactions.map((transaction) => ({
        type: 'refresh-generated-daily-interest',
        transaction,
        transactionId: transaction.id || ''
      })),
      { type: 'set-ledger-page', page: 1 },
      { type: 'navigate', route: 'ledger' },
      { type: 'schedule-save' },
      { type: 'render' }
    ],
    warnings,
    transaction: original,
    originalTransaction: original,
    createdTransactions,
    replacements: createdTransactions,
    atomic: true,
    idempotent: false,
    operationKey,
    operationReference,
    fingerprint,
    targetFingerprint,
    receipt: {
      operationKey,
      operationReference,
      fingerprint,
      targetFingerprint,
      targetTransactionId: targetId,
      replacementTransactionIds: createdTransactions.map((transaction) =>
        asString(transaction && transaction.id)
      )
    }
  });
}
