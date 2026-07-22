// Owns immutable recurring tracker commands and returns domain events for the app to apply.

import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import {
  normalizeRecurringFrequency,
  normalizeRecurringKind
} from './recurring-analysis-service.js';
import { cloneWorkbook, commandError, commandOk } from '../types/command-result.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getCategories(workbook) {
  return asArray(workbook && workbook.categories);
}

function getAccounts(workbook) {
  return asArray(workbook && workbook.accounts);
}

function getCounterparties(workbook) {
  return asArray(workbook && workbook.counterparties);
}

function getTransactions(workbook) {
  if (!workbook) {
    return [];
  }
  workbook.transactions = Array.isArray(workbook.transactions) ? workbook.transactions : [];
  return workbook.transactions;
}

function getRecurringItems(workbook) {
  if (!workbook) {
    return [];
  }
  workbook.recurringItems = Array.isArray(workbook.recurringItems) ? workbook.recurringItems : [];
  return workbook.recurringItems;
}

function findById(items, id) {
  const targetId = asString(id);
  return targetId
    ? asArray(items).find((item) => asString(item && item.id) === targetId) || null
    : null;
}

function getDefaultDate(services) {
  if (services && typeof services.defaultDate === 'function') {
    return asString(services.defaultDate());
  }
  if (services && services.defaultDate) {
    return asString(services.defaultDate);
  }
  return '';
}

function createRecurringId(workbook, services) {
  if (services && typeof services.createId === 'function') {
    return asString(services.createId('recurring'));
  }
  return `recurring_${String(getRecurringItems(workbook).length)}`;
}

function getTransactionPrimaryAccount(workbook, transaction) {
  const accountsById = new Map(
    getAccounts(workbook).map((account) => [asString(account && account.id), account])
  );
  return (
    asArray(transaction && transaction.lines)
      .map((line) => accountsById.get(asString(line && line.accountId)))
      .find((account) => {
        return account && (account.group === 'asset' || account.group === 'liability');
      }) || null
  );
}

function getTransactionBaseAmount(transaction) {
  return roundMoney(
    Number(transaction && transaction.baseAmount ? transaction.baseAmount : 0) || 0
  );
}

function getRecurringNameFromTransaction(workbook, transaction) {
  const counterparty = findById(
    getCounterparties(workbook),
    transaction && transaction.counterpartyId
  );
  const category = findById(getCategories(workbook), transaction && transaction.categoryId);
  return asString(
    (counterparty && counterparty.name) ||
      (transaction && transaction.description) ||
      (category && category.name) ||
      'Recurring item'
  );
}

function inferBillKind(category, name) {
  const source = `${asString(category && category.name)} ${asString(name)}`.toLowerCase();
  return /subscription|subscript|netflix|spotify|prime|icloud|membership|dues/.test(source)
    ? 'subscription'
    : 'bill';
}

export function normalizeRecurringItemForCommand(
  item,
  index = 0,
  baseCurrency = 'PHP',
  services = {}
) {
  const anchorDate =
    normalizeDateKey(item && item.anchorDate) ||
    normalizeDateKey(item && item.dueDate) ||
    normalizeDateKey(getDefaultDate(services)) ||
    '1970-01-01';
  const amount =
    Number(item && typeof item.amount !== 'undefined' ? item.amount : item && item.planned) || 0;
  return {
    id:
      asString(item && item.id) ||
      createRecurringId({ recurringItems: new Array(index).fill(null) }, services),
    kind: normalizeRecurringKind(item && item.kind),
    name: asString(item && item.name) || 'Recurring item',
    categoryId: asString(item && item.categoryId),
    counterpartyId: asString(item && item.counterpartyId),
    accountId: asString(item && item.accountId),
    amount,
    currency: asString(item && item.currency ? item.currency : baseCurrency || 'PHP').toUpperCase(),
    frequency: normalizeRecurringFrequency(item && item.frequency),
    anchorDate,
    autoRenew: item && item.autoRenew === true ? true : false,
    isActive: item && item.isActive === false ? false : true,
    note: String(item && item.note ? item.note : ''),
    createdFromTransactionId: asString(item && item.createdFromTransactionId)
  };
}

export function createRecurringItemFromTransactionCommand(
  workbook,
  transactionId,
  options = {},
  services = {}
) {
  const transaction =
    typeof transactionId === 'object' && transactionId
      ? transactionId
      : findById(getTransactions(workbook), transactionId);
  if (!workbook || !transaction) {
    return commandError(workbook, {
      code: 'recurring.transaction_not_found',
      message: 'Transaction not found.'
    });
  }
  const category = findById(getCategories(workbook), transaction.categoryId);
  if (!(category && category.type === 'expense')) {
    return commandError(
      workbook,
      {
        code: 'recurring.expense_category_required',
        message: 'Choose an expense transaction to track as a bill or subscription.'
      },
      { transaction }
    );
  }

  const nextWorkbook = cloneWorkbook(workbook);
  const nextTransaction = findById(getTransactions(nextWorkbook), transaction.id);
  const nextCategory = findById(getCategories(nextWorkbook), transaction.categoryId);
  const recurringItems = getRecurringItems(nextWorkbook);
  const account = getTransactionPrimaryAccount(nextWorkbook, nextTransaction);
  const kind = normalizeRecurringKind(
    options.kind || inferBillKind(category, transaction.description)
  );
  const frequency = normalizeRecurringFrequency(options.frequency || 'Monthly');
  const recurringItem = normalizeRecurringItemForCommand(
    {
      id: createRecurringId(nextWorkbook, services),
      kind,
      name: getRecurringNameFromTransaction(nextWorkbook, nextTransaction),
      categoryId: nextCategory.id,
      counterpartyId: nextTransaction.counterpartyId || '',
      accountId: account ? account.id : '',
      amount: Number(nextTransaction.amount) || getTransactionBaseAmount(nextTransaction),
      currency: nextTransaction.originalCurrency || nextWorkbook.currency,
      frequency,
      anchorDate: nextTransaction.date,
      autoRenew: kind === 'subscription',
      isActive: true,
      note: nextTransaction.note || '',
      createdFromTransactionId: nextTransaction.id
    },
    recurringItems.length,
    nextWorkbook.currency,
    services
  );

  recurringItems.push(recurringItem);
  nextTransaction.recurringItemId = recurringItem.id;

  return commandOk(nextWorkbook, {
    events: [{ type: 'close-modal' }, { type: 'schedule-save' }, { type: 'render' }],
    recurringItem,
    transaction: nextTransaction
  });
}

export function linkTransactionToRecurringItemCommand(workbook, transactionId, recurringItemId) {
  const transaction = findById(getTransactions(workbook), transactionId);
  const recurringItem = findById(getRecurringItems(workbook), recurringItemId);
  if (!(transaction && recurringItem)) {
    return commandError(
      workbook,
      {
        code: 'recurring.link_target_not_found',
        message: 'Choose a valid transaction and recurring tracker.'
      },
      { transaction, recurringItem }
    );
  }
  const nextWorkbook = cloneWorkbook(workbook);
  const nextTransaction = findById(getTransactions(nextWorkbook), transaction.id);
  const nextRecurringItem = findById(getRecurringItems(nextWorkbook), recurringItem.id);
  nextTransaction.recurringItemId = nextRecurringItem.id;
  return commandOk(nextWorkbook, {
    events: [{ type: 'close-modal' }, { type: 'schedule-save' }, { type: 'render' }],
    recurringItem: nextRecurringItem,
    transaction: nextTransaction
  });
}
