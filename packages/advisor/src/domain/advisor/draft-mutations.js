import { roundMoney } from '@cavalry/finance-core/domain/money.js';
import { advisorTransactionTextKey } from './transaction-drafts.js';

const CATEGORY_TYPES = ['income', 'expense', 'savings', 'debt'];
const ACCOUNT_GROUPS = ['asset', 'liability', 'income', 'expense', 'equity'];

function getCategoryById(workbook, categoryId) {
  return workbook && workbook.categories
    ? workbook.categories.find((category) => category.id === categoryId) || null
    : null;
}

function getAccountById(workbook, accountId) {
  return workbook && workbook.accounts
    ? workbook.accounts.find((account) => account.id === accountId) || null
    : null;
}

function getCounterpartyById(workbook, counterpartyId) {
  return workbook && workbook.counterparties
    ? workbook.counterparties.find((counterparty) => counterparty.id === counterpartyId) || null
    : null;
}

function findTransactionById(workbook, transactionId) {
  return (
    (workbook && workbook.transactions ? workbook.transactions : []).find(
      (transaction) => transaction.id === transactionId
    ) || null
  );
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function requireService(services, name) {
  if (typeof services[name] !== 'function') {
    throw new Error(name + ' service is not available.');
  }
  return services[name];
}

function getCategoryType(value) {
  const type = String(value || '').toLowerCase();
  return CATEGORY_TYPES.includes(type) ? type : 'expense';
}

function getAccountGroup(value) {
  const group = String(value || '').toLowerCase();
  return ACCOUNT_GROUPS.includes(group) ? group : 'asset';
}

function getAccountSubtype(value, group) {
  const subtype = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (subtype) {
    return subtype;
  }
  if (group === 'liability') {
    return 'credit_card';
  }
  if (group === 'income') {
    return 'income';
  }
  if (group === 'expense') {
    return 'expense';
  }
  if (group === 'equity') {
    return 'equity';
  }
  return 'cash';
}

function categoryHasEntityReferences(workbook, categoryId) {
  const id = String(categoryId || '').trim();
  if (!id) {
    return false;
  }
  return (
    (workbook.transactions || []).some((transaction) => transaction.categoryId === id) ||
    (workbook.recurringItems || []).some((item) => item.categoryId === id) ||
    (workbook.sheets || []).some(
      (sheet) =>
        (sheet.budgets || []).some((budget) => budget.categoryId === id) ||
        (sheet.budgetLineItems || []).some((item) => item.categoryId === id) ||
        (sheet.entries || []).some((entry) => entry.categoryId === id)
    )
  );
}

function accountHasEntityReferences(workbook, accountId) {
  const id = String(accountId || '').trim();
  if (!id) {
    return false;
  }
  return (
    (workbook.transactions || []).some(
      (transaction) =>
        transaction.primaryAccountId === id ||
        transaction.secondaryAccountId === id ||
        (transaction.lines || []).some((line) => line.accountId === id)
    ) ||
    (workbook.recurringItems || []).some((item) => item.accountId === id) ||
    (workbook.sheets || []).some(
      (sheet) =>
        (sheet.entries || []).some((entry) => entry.accountId === id) ||
        (sheet.budgetLineItems || []).some((item) => item.accountId === id)
    )
  );
}

export function applyAccountAiDraftMutation(workbook, draft, services = {}) {
  const proposed = (draft && draft.proposed) || {};
  const targetId = String((draft && draft.targetId) || proposed.id || '').trim();
  if (draft && draft.operation === 'delete') {
    const account = getAccountById(workbook, targetId);
    if (!account) throw new Error('Account not found.');
    if (account.isSystem) throw new Error('System accounts cannot be deleted.');
    if (accountHasEntityReferences(workbook, account.id)) {
      throw new Error('Account is still referenced. Archive it instead of hard delete.');
    }
    workbook.accounts = (workbook.accounts || []).filter((item) => item.id !== account.id);
    return account.id;
  }
  if (draft && draft.operation === 'archive') {
    const account = getAccountById(workbook, targetId);
    if (!account) throw new Error('Account not found.');
    if (account.isSystem) throw new Error('System accounts cannot be archived.');
    account.isActive = false;
    return account.id;
  }
  if (draft && draft.operation === 'edit') {
    const account = getAccountById(workbook, targetId);
    if (!account) throw new Error('Account not found.');
    const nextGroup = Object.prototype.hasOwnProperty.call(proposed, 'group')
      ? getAccountGroup(proposed.group)
      : account.group;
    const nextCurrency = String(proposed.currency || account.currency || workbook.currency || 'PHP')
      .trim()
      .toUpperCase();
    const nextName = String(
      Object.prototype.hasOwnProperty.call(proposed, 'name') ? proposed.name : account.name
    ).trim();
    if (!nextName) throw new Error('Account name is required.');
    if (nextGroup !== account.group && accountHasEntityReferences(workbook, account.id)) {
      throw new Error(
        'Account group cannot be changed while the account is referenced by transactions or recurring items.'
      );
    }
    if (
      typeof services.isAccountNameTaken === 'function' &&
      services.isAccountNameTaken(workbook, nextName, nextGroup, nextCurrency, account.id)
    ) {
      throw new Error('Account name is already in use for this group and currency.');
    }
    account.name = nextName;
    account.group = nextGroup;
    if (Object.prototype.hasOwnProperty.call(proposed, 'subtype'))
      account.subtype = getAccountSubtype(proposed.subtype, nextGroup);
    if (Object.prototype.hasOwnProperty.call(proposed, 'currency')) account.currency = nextCurrency;
    if (Object.prototype.hasOwnProperty.call(proposed, 'note'))
      account.note = String(proposed.note || '');
    if (Object.prototype.hasOwnProperty.call(proposed, 'openedDate'))
      account.openedDate = String(proposed.openedDate || account.openedDate || '');
    if (Object.prototype.hasOwnProperty.call(proposed, 'isActive'))
      account.isActive = proposed.isActive !== false;
    return account.id;
  }
  const name = String(proposed.name || '').trim();
  if (!name) throw new Error('Account name is required.');
  const group = getAccountGroup(proposed.group);
  const currency = String(proposed.currency || workbook.currency || 'PHP')
    .trim()
    .toUpperCase();
  if (
    typeof services.isAccountNameTaken === 'function' &&
    services.isAccountNameTaken(workbook, name, group, currency)
  ) {
    throw new Error('Account name is already in use for this group and currency.');
  }
  const normalizeAccount = requireService(services, 'normalizeAccount');
  const account = normalizeAccount(
    {
      name,
      group,
      subtype: getAccountSubtype(proposed.subtype, group),
      currency,
      note: proposed.note || '',
      openedDate: proposed.openedDate || '',
      isActive: proposed.isActive !== false
    },
    (workbook.accounts || []).length,
    workbook.currency || currency
  );
  workbook.accounts = workbook.accounts || [];
  workbook.accounts.push(account);
  return account.id;
}

export function applyCategoryAiDraftMutation(workbook, draft, services = {}) {
  const proposed = (draft && draft.proposed) || {};
  const name = String(proposed.name || '').trim();
  const type = getCategoryType(proposed.type);
  if (draft && draft.operation === 'delete') {
    const category = getCategoryById(workbook, draft.targetId || proposed.id);
    if (!category) throw new Error('Category not found.');
    workbook.categories = (workbook.categories || []).filter((item) => item.id !== category.id);
    (workbook.transactions || []).forEach((transaction) => {
      if (transaction.categoryId === category.id) transaction.categoryId = '';
    });
    (workbook.sheets || []).forEach((sheet) => {
      sheet.budgets = (sheet.budgets || []).filter((budget) => budget.categoryId !== category.id);
      sheet.budgetLineItems = (sheet.budgetLineItems || []).filter(
        (item) => item.categoryId !== category.id
      );
      (sheet.entries || []).forEach((entry) => {
        if (entry.categoryId === category.id) entry.categoryId = '';
      });
      if (typeof services.syncSheetBudgetsFromLineItems === 'function') {
        services.syncSheetBudgetsFromLineItems(workbook, sheet);
      }
    });
    workbook.recurringItems = (workbook.recurringItems || []).filter(
      (item) => item.categoryId !== category.id
    );
    return category.id;
  }
  if (draft && draft.operation === 'archive') {
    const category = getCategoryById(workbook, draft.targetId);
    if (!category) throw new Error('Category not found.');
    category.isActive = false;
    return category.id;
  }
  if (!name) throw new Error('Category name is required.');
  if (draft && draft.operation === 'edit') {
    const category = getCategoryById(workbook, draft.targetId);
    if (!category) throw new Error('Category not found.');
    category.name = name;
    if (proposed.color) category.color = String(proposed.color);
    if (typeof proposed.note !== 'undefined') category.note = String(proposed.note || '');
    return category.id;
  }
  const existing =
    (workbook.categories || []).find(
      (category) =>
        advisorTransactionTextKey(category.name) === advisorTransactionTextKey(name) &&
        category.type === type
    ) || null;
  const ensureCategoryPlannerBucket = requireService(services, 'ensureCategoryPlannerBucket');
  if (existing) {
    existing.isActive = true;
    ensureCategoryPlannerBucket(workbook, existing);
    return existing.id;
  }
  const normalizeCategory = requireService(services, 'normalizeCategory');
  const normalizeAccount = requireService(services, 'normalizeAccount');
  const isAccountNameTaken = requireService(services, 'isAccountNameTaken');
  const typeColors = services.typeColors || {};
  let accountName = name;
  let suffix = 2;
  const accountGroup = type === 'income' ? 'income' : 'expense';
  while (isAccountNameTaken(workbook, accountName, accountGroup, workbook.currency)) {
    accountName = name + ' ' + suffix;
    suffix += 1;
  }
  const category = normalizeCategory(
    {
      name,
      type,
      color: typeColors[type] || typeColors.expense,
      currency: workbook.currency,
      isActive: true
    },
    (workbook.categories || []).length,
    workbook.currency
  );
  const account = normalizeAccount(
    {
      name: accountName,
      group: accountGroup,
      subtype: type,
      currency: workbook.currency,
      note: 'Linked posting account for ' + name
    },
    (workbook.accounts || []).length,
    workbook.currency
  );
  category.linkedAccountId = account.id;
  ensureCategoryPlannerBucket(workbook, category);
  workbook.categories.push(category);
  workbook.accounts.push(account);
  return category.id;
}

export function applyCounterpartyAiDraftMutation(workbook, draft, services = {}) {
  const proposed = (draft && draft.proposed) || {};
  if (draft && draft.operation === 'delete') {
    const counterparty = getCounterpartyById(workbook, draft.targetId || proposed.id);
    if (!counterparty) throw new Error('Counterparty not found.');
    workbook.counterparties = (workbook.counterparties || []).filter(
      (item) => item.id !== counterparty.id
    );
    (workbook.transactions || []).forEach((transaction) => {
      if (transaction.counterpartyId === counterparty.id) transaction.counterpartyId = '';
    });
    (workbook.recurringItems || []).forEach((item) => {
      if (item.counterpartyId === counterparty.id) item.counterpartyId = '';
    });
    return counterparty.id;
  }
  if (draft && draft.operation === 'archive') {
    const counterparty = getCounterpartyById(workbook, draft.targetId);
    if (!counterparty) throw new Error('Counterparty not found.');
    counterparty.isActive = false;
    return counterparty.id;
  }
  if (draft && draft.operation === 'edit') {
    const counterparty = getCounterpartyById(workbook, draft.targetId);
    if (!counterparty) throw new Error('Counterparty not found.');
    if (proposed.name) counterparty.name = String(proposed.name).trim();
    if (proposed.kind) counterparty.kind = String(proposed.kind).toLowerCase();
    if (typeof proposed.note !== 'undefined') counterparty.note = String(proposed.note || '');
    return counterparty.id;
  }
  const ensureCounterparty = requireService(services, 'ensureCounterparty');
  const counterparty = ensureCounterparty(workbook, {
    name: proposed.name,
    kind: proposed.kind || 'other',
    note: proposed.note || ''
  });
  if (!counterparty) throw new Error('Counterparty name is required.');
  return counterparty.id;
}

export function applyRecurringAiDraftMutation(workbook, draft, services = {}) {
  const proposed = (draft && draft.proposed) || {};
  if (draft && draft.operation === 'delete') {
    const recurringItemId = String(draft.targetId || proposed.id || '').trim();
    const item =
      (workbook.recurringItems || []).find(
        (recurringItem) => recurringItem.id === recurringItemId
      ) || null;
    if (!item) throw new Error('Recurring item not found.');
    workbook.recurringItems = (workbook.recurringItems || []).filter(
      (recurringItem) => recurringItem.id !== item.id
    );
    (workbook.transactions || []).forEach((transaction) => {
      if (transaction.recurringItemId === item.id) transaction.recurringItemId = '';
    });
    (workbook.sheets || []).forEach((sheet) => {
      (sheet.budgetLineItems || []).forEach((lineItem) => {
        if (lineItem.recurringItemId === item.id) {
          lineItem.isActive = false;
          lineItem.recurringItemId = '';
        }
      });
      if (typeof services.syncSheetBudgetsFromLineItems === 'function') {
        services.syncSheetBudgetsFromLineItems(workbook, sheet);
      }
    });
    return item.id;
  }
  if (draft && draft.operation === 'archive') {
    const item =
      (workbook.recurringItems || []).find(
        (recurringItem) => recurringItem.id === draft.targetId
      ) || null;
    if (!item) throw new Error('Recurring item not found.');
    item.isActive = false;
    return item.id;
  }
  const normalizeRecurringItem = requireService(services, 'normalizeRecurringItem');
  const normalized = normalizeRecurringItem(
    Object.assign({}, proposed, {
      id: draft && draft.operation === 'edit' ? draft.targetId : proposed.id
    }),
    (workbook.recurringItems || []).length,
    workbook.currency
  );
  if (!(
    getCategoryById(workbook, normalized.categoryId) &&
    normalized.name &&
    normalized.amount >= 0 &&
    parseISODate(normalized.anchorDate)
  )) {
    throw new Error('Recurring item needs a valid category, name, amount, and anchor date.');
  }
  workbook.recurringItems = workbook.recurringItems || [];
  if (draft && draft.operation === 'edit') {
    const index = workbook.recurringItems.findIndex((item) => item.id === draft.targetId);
    if (index < 0) throw new Error('Recurring item not found.');
    workbook.recurringItems[index] = normalized;
    if (Array.isArray(proposed.sourceTransactionIds)) {
      proposed.sourceTransactionIds.forEach((transactionId) => {
        const transaction = findTransactionById(workbook, transactionId);
        if (transaction) {
          transaction.recurringItemId = normalized.id;
        }
      });
    }
    return normalized.id;
  }
  workbook.recurringItems.push(normalized);
  if (Array.isArray(proposed.sourceTransactionIds)) {
    proposed.sourceTransactionIds.forEach((transactionId) => {
      const transaction = findTransactionById(workbook, transactionId);
      if (transaction) {
        transaction.recurringItemId = normalized.id;
      }
    });
  }
  return normalized.id;
}

export function applyBudgetAiDraftMutation(workbook, draft) {
  const proposed = (draft && draft.proposed) || {};
  const sheetId = String(proposed.sheetId || (draft && draft.targetId) || '').trim();
  const categoryId = String(proposed.categoryId || '').trim();
  const planned = Number(proposed.planned || proposed.amount || 0) || 0;
  const sheet = (workbook.sheets || []).find((item) => item.id === sheetId) || null;
  const category = getCategoryById(workbook, categoryId);
  if (!(sheet && category)) throw new Error('Budget needs a valid month and category.');
  sheet.budgets = (sheet.budgets || []).filter((budget) => budget.categoryId !== categoryId);
  if (!(draft && (draft.operation === 'archive' || draft.operation === 'delete')) && planned > 0) {
    sheet.budgets.push({ categoryId, planned: roundMoney(planned) });
  }
  return sheet.id + ':' + category.id;
}

export function validateEntityAiDraftMutation(workbook, draft, services = {}) {
  if (!draft) {
    throw new Error('Draft not found.');
  }
  if (draft.objectType === 'category') {
    if (
      draft.operation !== 'archive' &&
      draft.operation !== 'delete' &&
      !String((draft.proposed && draft.proposed.name) || '').trim()
    )
      throw new Error('Category name is required.');
    if (draft.operation !== 'create' && !getCategoryById(workbook, draft.targetId))
      throw new Error('Category not found.');
    if (
      draft.operation === 'delete' &&
      categoryHasEntityReferences(workbook, draft.targetId || (draft.proposed && draft.proposed.id))
    ) {
      throw new Error(
        'Category is still referenced. Archive it, choose a replacement category, or uncategorize the references before hard delete.'
      );
    }
    return true;
  }
  if (draft.objectType === 'account') {
    const proposed = draft.proposed || {};
    const targetId = draft.targetId || proposed.id;
    if (draft.operation === 'create' && !String(proposed.name || '').trim())
      throw new Error('Account name is required.');
    if (draft.operation !== 'create') {
      const account = getAccountById(workbook, targetId);
      if (!account) throw new Error('Account not found.');
      if ((draft.operation === 'archive' || draft.operation === 'delete') && account.isSystem)
        throw new Error('System accounts cannot be archived or deleted.');
      if (draft.operation === 'delete' && accountHasEntityReferences(workbook, targetId)) {
        throw new Error('Account is still referenced. Archive it instead of hard delete.');
      }
      if (draft.operation === 'edit') {
        const group = Object.prototype.hasOwnProperty.call(proposed, 'group')
          ? getAccountGroup(proposed.group)
          : account.group;
        const currency = String(proposed.currency || account.currency || workbook.currency || 'PHP')
          .trim()
          .toUpperCase();
        const name = String(
          Object.prototype.hasOwnProperty.call(proposed, 'name') ? proposed.name : account.name
        ).trim();
        if (!name) throw new Error('Account name is required.');
        if (group !== account.group && accountHasEntityReferences(workbook, account.id)) {
          throw new Error(
            'Account group cannot be changed while the account is referenced by transactions or recurring items.'
          );
        }
        if (
          typeof services.isAccountNameTaken === 'function' &&
          services.isAccountNameTaken(workbook, name, group, currency, account.id)
        ) {
          throw new Error('Account name is already in use for this group and currency.');
        }
      }
    } else if (typeof services.isAccountNameTaken === 'function') {
      const group = getAccountGroup(proposed.group);
      const currency = String(proposed.currency || workbook.currency || 'PHP')
        .trim()
        .toUpperCase();
      if (services.isAccountNameTaken(workbook, proposed.name, group, currency)) {
        throw new Error('Account name is already in use for this group and currency.');
      }
    }
    return true;
  }
  if (draft.objectType === 'counterparty') {
    if (
      draft.operation !== 'archive' &&
      draft.operation !== 'delete' &&
      !String((draft.proposed && draft.proposed.name) || '').trim()
    )
      throw new Error('Counterparty name is required.');
    if (draft.operation !== 'create' && !getCounterpartyById(workbook, draft.targetId))
      throw new Error('Counterparty not found.');
    return true;
  }
  if (draft.objectType === 'recurringItem' || draft.objectType === 'billSubscription') {
    if (draft.operation === 'archive' || draft.operation === 'delete') {
      if (!(workbook.recurringItems || []).some((item) => item.id === draft.targetId))
        throw new Error('Recurring item not found.');
      return true;
    }
    const normalizeRecurringItem = requireService(services, 'normalizeRecurringItem');
    const normalized = normalizeRecurringItem(
      draft.proposed || {},
      (workbook.recurringItems || []).length,
      workbook.currency
    );
    if (!(
      getCategoryById(workbook, normalized.categoryId) &&
      normalized.name &&
      normalized.amount >= 0 &&
      parseISODate(normalized.anchorDate)
    )) {
      throw new Error('Recurring item needs a valid category, name, amount, and anchor date.');
    }
    return true;
  }
  if (draft.objectType === 'budget') {
    const proposed = draft.proposed || {};
    if (
      !(workbook.sheets || []).some(
        (sheet) => sheet.id === String(proposed.sheetId || draft.targetId || '')
      )
    )
      throw new Error('Budget month not found.');
    if (!getCategoryById(workbook, proposed.categoryId))
      throw new Error('Budget category not found.');
    return true;
  }
  throw new Error('Unsupported AI draft object type.');
}
