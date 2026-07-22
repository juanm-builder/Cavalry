import {
  buildManualLedgerTransaction,
  findLedgerAccount,
  findLedgerCategory,
  normalizeLedgerTransactionTemplate
} from '../../domain/ledger/transactions.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asLegacyId(value) {
  return String(value == null ? '' : value);
}

function getWorkbookCounterparty(workbook, counterpartyId) {
  const id = asLegacyId(counterpartyId);
  return (
    (workbook && Array.isArray(workbook.counterparties) ? workbook.counterparties : []).find(
      (counterparty) => asLegacyId(counterparty && counterparty.id) === id
    ) || null
  );
}

function getWorkbookRecurringItem(workbook, recurringItemId) {
  const id = asLegacyId(recurringItemId);
  return (
    (workbook && Array.isArray(workbook.recurringItems) ? workbook.recurringItems : []).find(
      (item) => asLegacyId(item && item.id) === id
    ) || null
  );
}

function normalizeTemplate(value, services = {}) {
  if (typeof services.normalizeTransactionTemplate === 'function') {
    return asString(services.normalizeTransactionTemplate(value));
  }
  return normalizeLedgerTransactionTemplate(value);
}

function resolveCounterparty(workbook, fields, services = {}) {
  const counterpartyName = asString(fields.counterpartyName);
  const counterpartyKind = asString(fields.counterpartyKind || 'other').toLowerCase() || 'other';
  if (counterpartyName) {
    if (typeof services.ensureCounterparty === 'function') {
      return (
        services.ensureCounterparty(workbook, {
          name: counterpartyName,
          kind: counterpartyKind
        }) || null
      );
    }
    return {
      id: counterpartyName,
      name: counterpartyName,
      kind: counterpartyKind
    };
  }
  const counterpartyId = asLegacyId(fields.counterpartyId);
  if (!counterpartyId) {
    return null;
  }
  if (typeof services.getCounterpartyById === 'function') {
    return services.getCounterpartyById(workbook, counterpartyId) || null;
  }
  return getWorkbookCounterparty(workbook, counterpartyId);
}

function resolveRecurringItem(workbook, recurringItemId, services = {}) {
  const id = asLegacyId(recurringItemId);
  if (!id) {
    return null;
  }
  if (typeof services.getRecurringItemById === 'function') {
    return services.getRecurringItemById(workbook, id) || null;
  }
  return getWorkbookRecurringItem(workbook, id);
}

function findCategory(workbook, categoryId, services = {}) {
  if (typeof services.getCategoryById === 'function') {
    return services.getCategoryById(workbook, categoryId) || null;
  }
  return findLedgerCategory(workbook, categoryId);
}

function findAccount(workbook, accountId, services = {}) {
  if (typeof services.getAccountById === 'function') {
    return services.getAccountById(workbook, accountId) || null;
  }
  return findLedgerAccount(workbook, accountId);
}

function assertLegacyResolution(template, category, primaryAccount, secondaryAccount) {
  if (template === 'income_received') {
    if (!(category && category.type === 'income')) throw new Error('Pick an income category.');
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      throw new Error('Choose an asset account to receive the income.');
  } else if (template === 'expense_paid') {
    if (!(category && category.type === 'expense')) throw new Error('Pick an expense category.');
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      throw new Error('Choose an asset account to fund the payment.');
  } else if (template === 'expense_charged') {
    if (!(category && category.type === 'expense')) throw new Error('Pick an expense category.');
    if (!(primaryAccount && primaryAccount.group === 'liability'))
      throw new Error('Choose a liability account such as a credit card.');
  } else if (template === 'transfer') {
    if (!(primaryAccount && secondaryAccount && primaryAccount.id !== secondaryAccount.id))
      throw new Error('Choose two different accounts for the transfer.');
  } else if (template === 'debt_payment' || template === 'liability_payment') {
    if (!(primaryAccount && primaryAccount.group === 'asset'))
      throw new Error('Choose an asset account to make the payment from.');
    if (!(secondaryAccount && secondaryAccount.group === 'liability'))
      throw new Error('Choose the liability account being settled.');
    if (!(category && category.type === 'debt')) throw new Error('Pick a debt category.');
  } else if (template === 'opening_balance') {
    if (!(
      primaryAccount &&
      (primaryAccount.group === 'asset' || primaryAccount.group === 'liability')
    ))
      throw new Error('Choose an asset or liability account for the opening balance.');
  }
}

function legacyFallbackDescription(
  template,
  description,
  category,
  primaryAccount,
  secondaryAccount,
  counterparty
) {
  if (description) {
    return description;
  }
  if (template === 'income_received' && category) {
    return category.name + (counterparty ? ' from ' + counterparty.name : ' received');
  }
  if (template === 'expense_paid' && category) {
    return category.name + (counterparty ? ' paid to ' + counterparty.name : ' paid');
  }
  if (template === 'expense_charged' && category && primaryAccount) {
    return (
      category.name +
      ' charged to ' +
      primaryAccount.name +
      (counterparty ? ' at ' + counterparty.name : '')
    );
  }
  if (template === 'transfer' && primaryAccount && secondaryAccount) {
    return 'Transfer: ' + primaryAccount.name + ' \u2192 ' + secondaryAccount.name;
  }
  if (
    (template === 'debt_payment' || template === 'liability_payment') &&
    primaryAccount &&
    secondaryAccount
  ) {
    return secondaryAccount.name + ' payment from ' + primaryAccount.name;
  }
  if (template === 'opening_balance' && primaryAccount) {
    return 'Opening balance: ' + primaryAccount.name;
  }
  return description;
}

function makeLegacyIdFactory(services = {}) {
  return function createLegacyId(prefix, index) {
    if (typeof services.createId === 'function') {
      if (prefix === 'txn') {
        return services.createId('txn_' + String(index));
      }
      if (prefix === 'line') {
        return services.createId('line');
      }
      return services.createId(prefix);
    }
    if (prefix === 'txn') {
      return 'txn_' + String(index);
    }
    if (prefix === 'line') {
      return 'line_' + String(index);
    }
    return prefix + '_' + String(index);
  };
}

export function buildLegacyTransactionFromComposerFields(
  workbook,
  fields = {},
  existingTransaction = null,
  index = 0,
  sourceOptions = {},
  services = {}
) {
  const clean = Object.assign({}, fields || {});
  const template = normalizeTemplate(clean.template, services) || 'expense_paid';
  const amount = Number(clean.amount || 0) || 0;
  const currency = asString(clean.currency || (workbook && workbook.currency)).toUpperCase();
  const categoryId = asLegacyId(clean.categoryId);
  const primaryAccountId = asLegacyId(clean.primaryAccountId);
  const secondaryAccountId = asLegacyId(clean.secondaryAccountId);
  const counterparty = resolveCounterparty(workbook, clean, services);
  const recurringItem = existingTransaction
    ? null
    : resolveRecurringItem(workbook, clean.recurringItemId, services);
  const category = categoryId ? findCategory(workbook, categoryId, services) : null;
  const primaryAccount = primaryAccountId
    ? findAccount(workbook, primaryAccountId, services)
    : null;
  const secondaryAccount = secondaryAccountId
    ? findAccount(workbook, secondaryAccountId, services)
    : null;
  assertLegacyResolution(template, category, primaryAccount, secondaryAccount);
  const createId = makeLegacyIdFactory(services);
  const transaction = buildManualLedgerTransaction(
    workbook,
    Object.assign({}, clean, {
      template,
      amount,
      currency,
      categoryId,
      primaryAccountId,
      secondaryAccountId,
      counterpartyId: counterparty ? counterparty.id : '',
      recurringItemId: existingTransaction
        ? asString(existingTransaction.recurringItemId)
        : recurringItem
          ? recurringItem.id
          : '',
      description: legacyFallbackDescription(
        template,
        asString(clean.description),
        category,
        primaryAccount,
        secondaryAccount,
        counterparty
      ),
      note: asString(clean.note)
    }),
    existingTransaction,
    index,
    Object.assign({}, sourceOptions, { createId })
  );

  return Object.assign({}, transaction, {
    counterpartyId: counterparty ? counterparty.id : ''
  });
}
