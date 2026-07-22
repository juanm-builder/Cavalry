import { normalizeDateKey, roundMoney } from '../../domain/money.js';
import {
  buildManualLedgerTransaction,
  getLedgerTransactionBaseAmount,
  normalizeLedgerTransactionTemplate
} from '../../domain/ledger/transactions.js';

const DEFAULT_PAGE_SIZE = 12;
const EDITABLE_INLINE_FIELDS = Object.freeze([
  'date',
  'description',
  'amount',
  'categoryId',
  'primaryAccountId',
  'template'
]);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function lower(value) {
  return asString(value).toLowerCase();
}

function byId(items) {
  const map = new Map();
  asArray(items).forEach((item) => {
    const id = asString(item && item.id);
    if (id) {
      map.set(id, item);
    }
  });
  return map;
}

function templateLabel(template) {
  const source = asString(template).replace(/[_-]+/g, ' ');
  return source
    ? source
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
    : 'Transaction';
}

function isBalanceAccount(account) {
  return account && (account.group === 'asset' || account.group === 'liability');
}

function getPrimaryAccount(lines, accountById) {
  for (const line of lines) {
    const account = accountById.get(asString(line && line.accountId));
    if (isBalanceAccount(account)) {
      return account;
    }
  }
  return null;
}

export function getTransactionTableType(workbook, transaction) {
  const template = asString(transaction && transaction.template);
  const categoryById = byId(workbook && workbook.categories);
  const category =
    transaction && transaction.categoryId
      ? categoryById.get(asString(transaction.categoryId))
      : null;
  if (template === 'transfer') return 'transfer';
  if (template === 'opening_balance' || template === 'existing_liability') return 'opening';
  if (category && category.type === 'income') return 'income';
  if (category && ['expense', 'debt', 'savings'].includes(category.type)) return 'expense';
  if (template === 'income_received' || template === 'daily_interest') return 'income';
  if (['expense_paid', 'expense_charged', 'debt_payment', 'liability_payment'].includes(template))
    return 'expense';
  return 'other';
}

export function resolveTransactionRowReferences(workbook, transaction, options = {}) {
  const accountById = options.accountById || byId(workbook && workbook.accounts);
  const categoryById = options.categoryById || byId(workbook && workbook.categories);
  const counterpartyById = options.counterpartyById || byId(workbook && workbook.counterparties);
  const lines = asArray(transaction && transaction.lines);
  const categoryId = asString(transaction && transaction.categoryId);
  const category = categoryId ? categoryById.get(categoryId) || null : null;
  const counterpartyId = asString(transaction && transaction.counterpartyId);
  const counterparty = counterpartyId ? counterpartyById.get(counterpartyId) || null : null;
  const accounts = lines.map((line) => {
    const accountId = asString(line && line.accountId);
    return {
      line,
      accountId,
      account: accountId ? accountById.get(accountId) || null : null
    };
  });
  const missingAccountIds = accounts
    .filter((item) => item.accountId && !item.account)
    .map((item) => item.accountId);
  const archivedAccountIds = accounts
    .filter((item) => item.account && item.account.isActive === false)
    .map((item) => item.account.id);
  const primaryAccount = getPrimaryAccount(lines, accountById);
  return {
    category,
    categoryId,
    categoryLabel: category ? category.name : categoryId ? 'Missing category' : 'Uncategorized',
    categoryType: category ? asString(category.type) : '',
    categoryMissing: !!(categoryId && !category),
    categoryArchived: !!(category && category.isActive === false),
    counterparty,
    counterpartyLabel: counterparty ? counterparty.name : '',
    primaryAccount,
    primaryAccountId: primaryAccount ? primaryAccount.id : '',
    accountLabel: primaryAccount
      ? primaryAccount.name
      : missingAccountIds.length
        ? 'Missing account'
        : 'Workbook',
    accounts,
    missingAccountIds,
    archivedAccountIds,
    hasMissingReference: !!(categoryId && !category) || missingAccountIds.length > 0,
    hasArchivedReference:
      !!(category && category.isActive === false) || archivedAccountIds.length > 0
  };
}

export function buildTransactionRows(workbook, options = {}) {
  const accountById = byId(workbook && workbook.accounts);
  const categoryById = byId(workbook && workbook.categories);
  const counterpartyById = byId(workbook && workbook.counterparties);
  return asArray(workbook && workbook.transactions).map((transaction, index) => {
    const references = resolveTransactionRowReferences(workbook, transaction, {
      accountById,
      categoryById,
      counterpartyById
    });
    const type = getTransactionTableType(workbook, transaction);
    const amount = Number(transaction && transaction.amount) || 0;
    const baseAmount = getLedgerTransactionBaseAmount(transaction);
    const row = {
      id: asString(transaction && transaction.id) || `transaction_${index}`,
      transaction,
      originalIndex: index,
      date:
        normalizeDateKey(transaction && transaction.date) ||
        asString(transaction && transaction.date),
      monthKey: asString(transaction && transaction.monthKey),
      description: asString(transaction && transaction.description),
      note: String((transaction && transaction.note) || ''),
      template: asString(transaction && transaction.template),
      templateLabel: templateLabel(transaction && transaction.template),
      type,
      amount,
      baseAmount,
      currency:
        asString(
          transaction && (transaction.originalCurrency || transaction.currency)
        ).toUpperCase() ||
        asString(workbook && workbook.currency).toUpperCase() ||
        'PHP',
      categoryId: references.categoryId,
      category: references.category,
      categoryLabel: references.categoryLabel,
      categoryType: references.categoryType,
      accountId: references.primaryAccountId,
      account: references.primaryAccount,
      accountLabel: references.accountLabel,
      counterparty: references.counterparty,
      counterpartyLabel: references.counterpartyLabel,
      missingAccountIds: references.missingAccountIds,
      archivedAccountIds: references.archivedAccountIds,
      categoryMissing: references.categoryMissing,
      categoryArchived: references.categoryArchived,
      hasMissingReference: references.hasMissingReference,
      hasArchivedReference: references.hasArchivedReference,
      isUncategorized: !references.categoryId,
      inlineEditable: isTransactionInlineEditable(workbook, transaction)
    };
    row.searchText = buildRowSearchText(row);
    return row;
  });
}

function buildRowSearchText(row) {
  return [
    row.id,
    row.date,
    row.description,
    row.note,
    row.template,
    row.templateLabel,
    row.categoryLabel,
    row.accountLabel,
    row.counterpartyLabel,
    row.currency,
    String(row.amount),
    String(row.baseAmount)
  ]
    .join(' ')
    .toLowerCase();
}

function reverseSearchText(value) {
  return String(value || '')
    .split('')
    .reverse()
    .join('');
}

function getSearchTextVariants(query) {
  const search = lower(query);
  if (!search) {
    return [];
  }
  const reversed = reverseSearchText(search);
  return reversed && reversed !== search ? [search, reversed] : [search];
}

export function searchTransactionRows(rows, query) {
  const searchVariants = getSearchTextVariants(query);
  if (!searchVariants.length) {
    return asArray(rows).slice();
  }
  return asArray(rows).filter((row) => {
    const searchText = String((row && row.searchText) || buildRowSearchText(row || {}));
    return searchVariants.some((search) => searchText.includes(search));
  });
}

function normalizeDateRange(filters = {}) {
  const range = filters.dateRange || filters.range || {};
  return {
    start: normalizeDateKey(filters.startDate || filters.start || range.start || range.startDate),
    end: normalizeDateKey(filters.endDate || filters.end || range.end || range.endDate)
  };
}

function rowInDateRange(row, range) {
  const date = normalizeDateKey(row && row.date);
  if (range.start && date && date < range.start) return false;
  if (range.end && date && date > range.end) return false;
  return true;
}

export function filterTransactionRows(rows, filters = {}) {
  const range = normalizeDateRange(filters);
  const type = lower(filters.type || filters.direction || 'all') || 'all';
  const accountId = asString(filters.accountId);
  const categoryId = asString(filters.categoryId);
  const minAmount = Number(filters.minAmount);
  const maxAmount = Number(filters.maxAmount);
  const includeUncategorized = filters.uncategorized === true || type === 'uncategorized';
  const includeMissing = filters.missingReferences === true;
  const includeArchived = filters.archivedReferences === true;
  return asArray(rows).filter((row) => {
    if (!rowInDateRange(row, range)) return false;
    const amount = Math.abs(Number(row && row.baseAmount) || 0);
    if (Number.isFinite(minAmount) && asString(filters.minAmount) && amount < minAmount)
      return false;
    if (Number.isFinite(maxAmount) && asString(filters.maxAmount) && amount > maxAmount)
      return false;
    if (type !== 'all' && type !== 'uncategorized' && row.type !== type) return false;
    if (includeUncategorized && !row.isUncategorized) return false;
    if (
      accountId &&
      !asArray(row.transaction && row.transaction.lines).some(
        (line) => asString(line && line.accountId) === accountId
      )
    )
      return false;
    if (categoryId && row.categoryId !== categoryId) return false;
    if (includeMissing && !row.hasMissingReference) return false;
    if (includeArchived && !row.hasArchivedReference) return false;
    return true;
  });
}

function compareValues(a, b) {
  if (typeof a === 'number' || typeof b === 'number') {
    const left = Number(a) || 0;
    const right = Number(b) || 0;
    return left === right ? 0 : left < right ? -1 : 1;
  }
  return asString(a).localeCompare(asString(b), undefined, { sensitivity: 'base' });
}

function sortValue(row, key) {
  if (key === 'date') return row.date;
  if (key === 'amount') return row.baseAmount;
  if (key === 'description') return row.description;
  if (key === 'account') return row.accountLabel;
  if (key === 'category') return row.categoryLabel;
  if (key === 'type') return row.type;
  return row.date;
}

export function sortTransactionRows(rows, sort = {}) {
  const key = ['date', 'amount', 'description', 'account', 'category', 'type'].includes(
    asString(sort.key || sort.sortKey)
  )
    ? asString(sort.key || sort.sortKey)
    : 'date';
  const direction = lower(sort.direction || sort.order) === 'asc' ? 'asc' : 'desc';
  return asArray(rows)
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let result = compareValues(sortValue(left.row, key), sortValue(right.row, key));
      if (result === 0 && key === 'date') {
        result = compareValues(left.row.id, right.row.id);
      }
      if (result === 0) {
        result = left.index - right.index;
      }
      return direction === 'asc' ? result : -result;
    })
    .map((item) => item.row);
}

export function calculateVisibleTransactionTotals(rows) {
  return asArray(rows).reduce(
    (totals, row) => {
      if (row.type === 'income') {
        totals.income = roundMoney(totals.income + row.baseAmount);
      } else if (row.categoryType === 'expense') {
        totals.expense = roundMoney(totals.expense + row.baseAmount);
      } else if (row.type === 'transfer') {
        totals.transferCount += 1;
      }
      totals.count += 1;
      totals.net = roundMoney(totals.income - totals.expense);
      return totals;
    },
    {
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
      transferCount: 0,
      currency: 'base'
    }
  );
}

export function validateTransactionTableViewState(viewState = {}) {
  const type = lower(viewState.type || viewState.direction || 'all') || 'all';
  const sort = viewState.sort || {};
  return {
    type: ['all', 'income', 'expense', 'transfer', 'opening', 'other', 'uncategorized'].includes(
      type
    )
      ? type
      : 'all',
    accountId: asString(viewState.accountId),
    categoryId: asString(viewState.categoryId),
    search: asString(viewState.search),
    minAmount: normalizeAmountFilter(viewState.minAmount),
    maxAmount: normalizeAmountFilter(viewState.maxAmount),
    dateRange: normalizeDateRange(viewState),
    sort: {
      key: ['date', 'amount', 'description', 'account', 'category', 'type'].includes(
        asString(sort.key || viewState.sortKey)
      )
        ? asString(sort.key || viewState.sortKey)
        : 'date',
      direction: lower(sort.direction || viewState.sortDirection) === 'asc' ? 'asc' : 'desc'
    },
    page: Math.max(1, Math.round(Number(viewState.page || 1) || 1)),
    pageSize: Math.max(
      1,
      Math.round(Number(viewState.pageSize || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE)
    ),
    uncategorized: viewState.uncategorized === true
  };
}

function normalizeAmountFilter(value) {
  const raw = asString(value);
  if (!raw) return '';
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? String(amount) : '';
}

export function buildTransactionTableView(workbook, viewState = {}) {
  const state = validateTransactionTableViewState(viewState);
  const builtRows = buildTransactionRows(workbook);
  const filteredRows = filterTransactionRows(searchTransactionRows(builtRows, state.search), state);
  const sortedRows = sortTransactionRows(filteredRows, state.sort);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / state.pageSize));
  const page = Math.min(state.page, totalPages);
  const pageStart = (page - 1) * state.pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + state.pageSize);
  return {
    rows: pageRows,
    allRows: sortedRows,
    unfilteredRows: builtRows,
    totals: calculateVisibleTransactionTotals(sortedRows),
    emptyState: sortedRows.length ? '' : 'No transactions match this view.',
    page,
    pageSize: state.pageSize,
    totalPages,
    rowCount: sortedRows.length,
    activeFilterCount: [
      state.type !== 'all',
      !!state.accountId,
      !!state.categoryId,
      !!state.search,
      !!state.dateRange.start,
      !!state.dateRange.end,
      !!state.minAmount,
      !!state.maxAmount,
      !!state.uncategorized
    ].filter(Boolean).length,
    state
  };
}

function getAccountById(workbook, accountId) {
  return (
    asArray(workbook && workbook.accounts).find(
      (account) => asString(account && account.id) === asString(accountId)
    ) || null
  );
}

function getTransactionEditDraft(workbook, transaction) {
  const template = asString(transaction && transaction.template) || 'expense_paid';
  const lines = asArray(transaction && transaction.lines);
  const debitLines = lines.filter((line) => line.direction === 'debit');
  const creditLines = lines.filter((line) => line.direction === 'credit');
  const findLine = (group, direction) =>
    (direction === 'credit' ? creditLines : debitLines).find((line) => {
      const account = getAccountById(workbook, line.accountId);
      return account && account.group === group;
    }) || null;
  let primaryAccountId = '';
  let secondaryAccountId = '';
  if (template === 'income_received') {
    const assetDebit = findLine('asset', 'debit');
    primaryAccountId = assetDebit ? assetDebit.accountId : '';
  } else if (template === 'expense_paid') {
    const assetCredit = findLine('asset', 'credit');
    primaryAccountId = assetCredit ? assetCredit.accountId : '';
  } else if (template === 'expense_charged') {
    const liabilityCredit = findLine('liability', 'credit');
    primaryAccountId = liabilityCredit ? liabilityCredit.accountId : '';
  } else if (template === 'transfer') {
    const sourceLine =
      creditLines.find((line) => isBalanceAccount(getAccountById(workbook, line.accountId))) ||
      null;
    const destinationLine =
      debitLines.find((line) => isBalanceAccount(getAccountById(workbook, line.accountId))) || null;
    primaryAccountId = sourceLine ? sourceLine.accountId : '';
    secondaryAccountId = destinationLine ? destinationLine.accountId : '';
  } else if (template === 'debt_payment' || template === 'liability_payment') {
    const assetCredit = findLine('asset', 'credit');
    const liabilityDebit = findLine('liability', 'debit');
    primaryAccountId = assetCredit ? assetCredit.accountId : '';
    secondaryAccountId = liabilityDebit ? liabilityDebit.accountId : '';
  } else if (template === 'opening_balance' || template === 'existing_liability') {
    const accountLine =
      lines.find((line) => isBalanceAccount(getAccountById(workbook, line.accountId))) || null;
    primaryAccountId = accountLine ? accountLine.accountId : '';
  }
  return {
    template,
    date:
      normalizeDateKey(transaction && transaction.date) ||
      asString(transaction && transaction.date),
    description: asString(transaction && transaction.description),
    amount: Number(transaction && transaction.amount) || 0,
    currency:
      asString(
        transaction && (transaction.originalCurrency || transaction.currency)
      ).toUpperCase() ||
      asString(workbook && workbook.currency).toUpperCase() ||
      'PHP',
    fxRateToBase: Number(transaction && transaction.fxRateToBase) || 0,
    categoryId: asString(transaction && transaction.categoryId),
    counterpartyId: asString(transaction && transaction.counterpartyId),
    primaryAccountId: primaryAccountId || asString(transaction && transaction.primaryAccountId),
    secondaryAccountId:
      secondaryAccountId || asString(transaction && transaction.secondaryAccountId),
    note: String((transaction && transaction.note) || ''),
    recurringItemId: asString(transaction && transaction.recurringItemId),
    isManualOnly:
      [
        'income_received',
        'expense_paid',
        'expense_charged',
        'debt_payment',
        'liability_payment',
        'transfer',
        'opening_balance'
      ].indexOf(template) < 0
  };
}

export function isTransactionInlineEditable(workbook, transaction) {
  const draft = transaction ? getTransactionEditDraft(workbook, transaction) : null;
  return !!(draft && !draft.isManualOnly);
}

export function previewTransactionTableInlineEdit(
  workbook,
  transactionId,
  patch = {},
  options = {}
) {
  const transactions = asArray(workbook && workbook.transactions);
  const index = transactions.findIndex(
    (transaction) => asString(transaction && transaction.id) === asString(transactionId)
  );
  const transaction = index >= 0 ? transactions[index] : null;
  const draft = transaction ? getTransactionEditDraft(workbook, transaction) : null;
  if (!(transaction && draft && !draft.isManualOnly)) {
    return { ok: false, error: 'This transaction cannot be edited inline.' };
  }
  const field = asString(patch.field);
  if (field && !EDITABLE_INLINE_FIELDS.includes(field)) {
    return { ok: false, error: 'This transaction field cannot be edited inline.' };
  }
  const nextFields = Object.assign({}, draft);
  const values =
    patch.values && typeof patch.values === 'object' ? patch.values : { [field]: patch.value };
  Object.keys(values).forEach((key) => {
    if (!EDITABLE_INLINE_FIELDS.includes(key)) return;
    if (key === 'amount') {
      nextFields.amount = Number(values[key]) || 0;
    } else if (key === 'template') {
      nextFields.template = normalizeLedgerTransactionTemplate(values[key]) || draft.template;
    } else {
      nextFields[key] = asString(values[key]);
    }
  });
  try {
    const rebuilt = buildManualLedgerTransaction(workbook, nextFields, transaction, index, {
      reference: transaction.reference || '',
      source: transaction.source || 'manual',
      createId: options.createId
    });
    return {
      ok: true,
      transaction: rebuilt,
      fields: nextFields
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error && error.message ? error.message : error)
    };
  }
}
