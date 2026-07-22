import { getAccountBalanceSnapshotAsOf } from '../../domain/ledger/balances.js';
import { buildAccountCurrencyRepairPreview } from './account-currency-repair-service.js';
import {
  findInstitutionById,
  resolveInstitution
} from '../../domain/institutions/institution-catalog.js';
import { roundMoney } from '../../domain/money.js';
import { createLedgerLine, normalizeLedgerTransaction } from '../../domain/ledger/transactions.js';

export class AccountManagementError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AccountManagementError';
    this.code = code;
    this.details = details;
  }
}

export const ACCOUNT_GROUPS = Object.freeze(['asset', 'liability', 'income', 'expense', 'equity']);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function getWorkbookCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

function ensureAccountArray(workbook) {
  if (!Array.isArray(workbook.accounts)) {
    workbook.accounts = [];
  }
  return workbook.accounts;
}

function ensureTransactionArray(workbook) {
  if (!Array.isArray(workbook.transactions)) {
    workbook.transactions = [];
  }
  return workbook.transactions;
}

function parseNumericInput(value) {
  return (
    Number(
      String(value || '')
        .replace(/,/g, '')
        .trim()
    ) || 0
  );
}

const ACCOUNT_DETAIL_TEXT_FIELDS = Object.freeze([
  'bankAccountType',
  'accountNumber',
  'branch',
  'location',
  'mobileNumber',
  'email',
  'accountReference',
  'cardNetwork',
  'investmentType',
  'loanType',
  'assetType',
  'identifier'
]);

const ACCOUNT_DETAIL_AMOUNT_FIELDS = Object.freeze([
  'creditLimit',
  'annualFee',
  'costBasis',
  'monthlyContribution',
  'originalBalance',
  'monthlyPayment',
  'acquisitionCost'
]);

const ACCOUNT_DETAIL_DAY_FIELDS = Object.freeze(['billingDay', 'dueDay', 'paymentDueDay']);
const ACCOUNT_DETAIL_DATE_FIELDS = Object.freeze(['maturityDate', 'acquisitionDate']);
const ACCOUNT_DETAIL_NUMBER_FIELDS = Object.freeze(['interestRate']);
const ACCOUNT_DETAIL_TEXT_MAX_LENGTH = 240;
const ACCOUNT_ICON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sanitizedDetailText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }
  return String(value).trim().slice(0, ACCOUNT_DETAIL_TEXT_MAX_LENGTH);
}

function sanitizedDetailNumber(value, options = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const text = String(value).replace(/,/g, '').trim();
  if (!text) {
    return null;
  }
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return options.money === true ? roundMoney(number) : number;
}

function sanitizedDetailDay(value) {
  const day = sanitizedDetailNumber(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function sanitizedDetailDate(value) {
  const text = sanitizedDetailText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return '';
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? text
    : '';
}

function sanitizedAccountIcon(value) {
  const icon = asString(value).toLowerCase();
  return ACCOUNT_ICON_PATTERN.test(icon) ? icon : '';
}

function normalizedAccountLogoMode(value, institutionId = '', icon = '') {
  const mode = asString(value).toLowerCase();
  if (mode === 'institution' || mode === 'icon') return mode;
  if (asString(institutionId)) return 'institution';
  return sanitizedAccountIcon(icon) ? 'icon' : 'institution';
}

function sanitizeAccountDetails(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const details = {};

  ACCOUNT_DETAIL_TEXT_FIELDS.forEach((field) => {
    if (!hasOwn(source, field)) return;
    const text = sanitizedDetailText(source[field]);
    if (text) details[field] = text;
  });
  ACCOUNT_DETAIL_AMOUNT_FIELDS.forEach((field) => {
    if (!hasOwn(source, field)) return;
    const amount = sanitizedDetailNumber(source[field], { money: true });
    if (amount !== null) details[field] = amount;
  });
  ACCOUNT_DETAIL_DAY_FIELDS.forEach((field) => {
    if (!hasOwn(source, field)) return;
    const day = sanitizedDetailDay(source[field]);
    if (day !== null) details[field] = day;
  });
  ACCOUNT_DETAIL_DATE_FIELDS.forEach((field) => {
    if (!hasOwn(source, field)) return;
    const date = sanitizedDetailDate(source[field]);
    if (date) details[field] = date;
  });
  ACCOUNT_DETAIL_NUMBER_FIELDS.forEach((field) => {
    if (!hasOwn(source, field)) return;
    const number = sanitizedDetailNumber(source[field]);
    if (number !== null) details[field] = number;
  });

  return details;
}

function todayISO() {
  const date = new Date();
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}

function normalizeGroup(value) {
  const group = asString(value).toLowerCase();
  return ACCOUNT_GROUPS.includes(group) ? group : 'asset';
}

function resolveInstitutionFields(institutionIdInput, institutionInput) {
  const institution = asString(institutionInput);
  const catalogEntry =
    findInstitutionById(asString(institutionIdInput)) || resolveInstitution(institution);
  return {
    institution:
      catalogEntry && asString(institutionIdInput)
        ? catalogEntry.shortName
        : institution || (catalogEntry ? catalogEntry.shortName : ''),
    institutionId: catalogEntry ? catalogEntry.id : ''
  };
}

export function isTimeDepositSubtype(value) {
  const normalized = asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return (
    normalized === 'time_deposit' ||
    normalized === 'timedeposit' ||
    normalized === 'short_term_investment' ||
    normalized === 'short_term_investments'
  );
}

export function normalizeAccount(account = {}, index = 0, baseCurrency = 'PHP', options = {}) {
  const group = normalizeGroup(account.group);
  const createId = typeof options.createId === 'function' ? options.createId : null;
  const today = typeof options.today === 'function' ? options.today : todayISO;
  const institutionFields = resolveInstitutionFields(account.institutionId, account.institution);
  return {
    id:
      asString(account.id) ||
      (createId ? createId('account_' + index) : 'account_' + String(index + 1)),
    name: asString(account.name) || 'Account ' + String(index + 1),
    group,
    subtype: asString(account.subtype),
    currency: asString(account.currency || baseCurrency).toUpperCase() || 'PHP',
    institution: institutionFields.institution,
    institutionId: institutionFields.institutionId,
    icon: sanitizedAccountIcon(account.icon),
    logoMode: normalizedAccountLogoMode(
      account.logoMode,
      institutionFields.institutionId,
      account.icon
    ),
    note: String(account.note || ''),
    details: sanitizeAccountDetails(account.details),
    openedDate: asString(account.openedDate) || today(),
    placementDate: asString(account.placementDate),
    maturityDate: asString(account.maturityDate),
    interestRate: Number(account.interestRate) || 0,
    withholdingTaxRate:
      Number(typeof account.withholdingTaxRate !== 'undefined' ? account.withholdingTaxRate : 20) ||
      0,
    interestPostingStartDate: asString(account.interestPostingStartDate),
    estimatedMaturityAmount: Number(account.estimatedMaturityAmount) || 0,
    isSystem: !!account.isSystem && group !== 'liability',
    isActive: typeof account.isActive === 'boolean' ? account.isActive : true
  };
}

function normalizeViaService(workbook, input, services = {}) {
  if (typeof services.normalizeAccount === 'function') {
    return services.normalizeAccount(
      input,
      (workbook.accounts || []).length,
      getWorkbookCurrency(workbook)
    );
  }
  return normalizeAccount(
    input,
    (workbook.accounts || []).length,
    getWorkbookCurrency(workbook),
    services
  );
}

export function findAccountById(workbook, accountId) {
  const id = asString(accountId);
  return (
    (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).find(
      (account) => asString(account && account.id) === id
    ) || null
  );
}

export function findAccountsByName(workbook, name, options = {}) {
  const targetName = asString(name).toLowerCase();
  const group = options.group ? asString(options.group).toLowerCase() : '';
  const currency = options.currency ? asString(options.currency).toUpperCase() : '';
  const includeArchived = options.includeArchived === true;
  return (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).filter(
    (account) => {
      if (!includeArchived && account.isActive === false) {
        return false;
      }
      if (group && account.group !== group) {
        return false;
      }
      if (currency && asString(account.currency).toUpperCase() !== currency) {
        return false;
      }
      return asString(account.name).toLowerCase() === targetName;
    }
  );
}

export function resolveAccountHint(workbook, hint, options = {}) {
  const value = asString(hint);
  if (!value) {
    return null;
  }
  const byId = findAccountById(workbook, value);
  if (byId) {
    return byId;
  }
  const matches = findAccountsByName(workbook, value, options);
  return matches.length === 1 ? matches[0] : null;
}

export function isAccountNameTaken(workbook, name, group, currency, excludeId = '') {
  const targetName = asString(name).toLowerCase();
  const targetGroup = asString(group).toLowerCase();
  const targetCurrency = asString(currency).toUpperCase();
  return (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).some((account) => {
    if (excludeId && account.id === excludeId) {
      return false;
    }
    if (account.isActive === false) {
      return false;
    }
    return (
      account.group === targetGroup &&
      asString(account.currency).toUpperCase() === targetCurrency &&
      asString(account.name).toLowerCase() === targetName
    );
  });
}

export function listSelectableAccounts(workbook, options = {}) {
  const groups = Array.isArray(options.groups)
    ? options.groups
    : options.groups
      ? [options.groups]
      : ACCOUNT_GROUPS;
  const includeArchived = options.includeArchived === true;
  const includeSystem = options.includeSystem === true;
  return (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : [])
    .filter((account) => groups.includes(account.group))
    .filter((account) => includeArchived || account.isActive !== false)
    .filter((account) => includeSystem || account.isSystem !== true)
    .slice()
    .sort((a, b) => {
      if ((a.isActive === false) !== (b.isActive === false)) {
        return a.isActive === false ? 1 : -1;
      }
      if (!!a.isSystem !== !!b.isSystem) {
        return a.isSystem ? 1 : -1;
      }
      return asString(a.name).localeCompare(asString(b.name));
    });
}

export function getAccountUsage(workbook, accountId) {
  const id = asString(accountId);
  const relatedTransactions = (
    workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []
  ).filter((transaction) => {
    return (
      transaction.primaryAccountId === id ||
      transaction.secondaryAccountId === id ||
      (transaction.lines || []).some((line) => line.accountId === id)
    );
  });
  const recurringItemCount = (
    workbook && Array.isArray(workbook.recurringItems) ? workbook.recurringItems : []
  ).filter((item) => item.accountId === id).length;
  let budgetLineItemCount = 0;
  let sheetEntryCount = 0;
  (workbook && Array.isArray(workbook.sheets) ? workbook.sheets : []).forEach((sheet) => {
    budgetLineItemCount += (sheet.budgetLineItems || []).filter(
      (item) => item.accountId === id
    ).length;
    sheetEntryCount += (sheet.entries || []).filter((entry) => entry.accountId === id).length;
  });
  const openingOnly =
    relatedTransactions.length > 0 &&
    relatedTransactions.every((transaction) => transaction.template === 'opening_balance');
  const totalReferences =
    relatedTransactions.length + recurringItemCount + budgetLineItemCount + sheetEntryCount;
  return {
    accountId: id,
    relatedTransactions,
    transactionCount: relatedTransactions.length,
    recurringItemCount,
    budgetLineItemCount,
    sheetEntryCount,
    totalReferences,
    hasHistory: relatedTransactions.length > 0,
    openingOnly,
    hasReferences: totalReferences > 0,
    hasNonOpeningReferences:
      recurringItemCount + budgetLineItemCount + sheetEntryCount > 0 ||
      (relatedTransactions.length > 0 && !openingOnly)
  };
}

export function getAccountBalances(workbook, options = {}) {
  const asOfDate = asString(options.asOfDate);
  return getAccountBalanceSnapshotAsOf(workbook, asOfDate);
}

function getOpeningBalanceEquityAccount(workbook) {
  return (
    (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).find((account) => {
      return account.group === 'equity' && account.subtype === 'opening_balance';
    }) || null
  );
}

function getUsdToBaseRate(workbook, services = {}) {
  if (typeof services.getUsdToBaseRate === 'function') {
    return Number(services.getUsdToBaseRate(workbook)) || 0;
  }
  return Number(workbook && workbook.settings && workbook.settings.usdToBaseRate) || 0;
}

function createOpeningBalanceTransaction(workbook, account, input, services = {}) {
  const openingBalance = parseNumericInput(input.openingBalance);
  if (!(openingBalance > 0)) {
    return null;
  }
  const openingEquity =
    typeof services.getOpeningBalanceEquityAccount === 'function'
      ? services.getOpeningBalanceEquityAccount(workbook)
      : getOpeningBalanceEquityAccount(workbook);
  if (!openingEquity) {
    return null;
  }
  let openingLineIndex = 0;
  const createLine =
    typeof services.createLine === 'function'
      ? services.createLine
      : (sourceWorkbook, accountId, direction, amount, currency, note) =>
          createLedgerLine(sourceWorkbook, accountId, direction, amount, currency, note, {
            createId: services.createId,
            index: openingLineIndex++
          });
  const normalizeTransaction =
    typeof services.normalizeTransaction === 'function'
      ? services.normalizeTransaction
      : (transaction, index, sourceWorkbook) =>
          normalizeLedgerTransaction(transaction, index, sourceWorkbook, {
            createId: services.createId
          });
  const currency = asString(account.currency || getWorkbookCurrency(workbook)).toUpperCase();
  const lines =
    account.group === 'asset'
      ? [
          createLine(workbook, account.id, 'debit', openingBalance, currency, 'Opening balance'),
          createLine(
            workbook,
            openingEquity.id,
            'credit',
            openingBalance,
            currency,
            'Opening balance offset'
          )
        ]
      : [
          createLine(
            workbook,
            openingEquity.id,
            'debit',
            openingBalance,
            currency,
            'Opening balance offset'
          ),
          createLine(workbook, account.id, 'credit', openingBalance, currency, 'Opening liability')
        ];
  return normalizeTransaction(
    {
      date: asString(input.openedDate),
      template: 'opening_balance',
      description: account.name + ' opening balance',
      originalCurrency: currency,
      amount: openingBalance,
      source: 'manual',
      lines
    },
    typeof services.getLedgerTransactionCount === 'function'
      ? services.getLedgerTransactionCount(workbook)
      : (workbook.transactions || []).length,
    workbook
  );
}

function buildCreateInput(input = {}) {
  const groupValue = asString(input.group || input.groupValue || 'asset').toLowerCase();
  const isShortTermAsset = groupValue === 'short_term_asset';
  const group = groupValue === 'liability' ? 'liability' : 'asset';
  const rawSubtype = asString(input.subtype);
  return {
    name: asString(input.name),
    groupValue,
    isShortTermAsset,
    group,
    subtype: isShortTermAsset
      ? 'time_deposit'
      : rawSubtype || (group === 'asset' ? 'cash' : 'credit_card'),
    currency: asString(input.currency).toUpperCase(),
    institution: asString(input.institution),
    institutionId: asString(input.institutionId),
    icon: sanitizedAccountIcon(input.icon),
    logoMode: normalizedAccountLogoMode(input.logoMode, input.institutionId, input.icon),
    openedDate: asString(input.openedDate),
    openingBalance: input.openingBalance,
    note: asString(input.note),
    details: sanitizeAccountDetails(input.details),
    placementDate: isShortTermAsset
      ? asString(input.placementDate) || asString(input.openedDate)
      : '',
    maturityDate: isShortTermAsset ? asString(input.maturityDate) : '',
    interestRate: isShortTermAsset ? parseNumericInput(input.interestRate) : 0,
    estimatedMaturityAmount: isShortTermAsset ? parseNumericInput(input.estimatedMaturityAmount) : 0
  };
}

export function createAccount(workbook, input = {}, services = {}) {
  ensureAccountArray(workbook);
  ensureTransactionArray(workbook);
  const clean = buildCreateInput(input);
  const currency = clean.currency || getWorkbookCurrency(workbook);

  if (!clean.name) {
    throw new AccountManagementError('account_name_required', 'Account name is required.');
  }
  if (!clean.openedDate) {
    throw new AccountManagementError('account_date_required', 'Account date is required.');
  }
  if (
    currency === 'USD' &&
    getWorkbookCurrency(workbook) === 'PHP' &&
    !getUsdToBaseRate(workbook, services)
  ) {
    throw new AccountManagementError(
      'usd_rate_required',
      'Set a USD to PHP rate before creating USD accounts.'
    );
  }

  const account = normalizeViaService(
    workbook,
    {
      name: clean.name,
      group: clean.group,
      subtype: clean.subtype,
      currency,
      institution: clean.institution,
      institutionId: clean.institutionId,
      icon: clean.icon,
      logoMode: clean.logoMode,
      note: clean.note,
      details: clean.details,
      openedDate: clean.openedDate,
      placementDate: clean.placementDate,
      maturityDate: clean.maturityDate,
      interestRate: clean.interestRate,
      estimatedMaturityAmount: clean.estimatedMaturityAmount
    },
    services
  );
  account.details = sanitizeAccountDetails(clean.details);
  account.icon = clean.icon;
  account.logoMode = normalizedAccountLogoMode(clean.logoMode, account.institutionId, clean.icon);
  workbook.accounts.push(account);
  if (clean.isShortTermAsset && typeof services.ensureShortTermInvestmentsCategory === 'function') {
    services.ensureShortTermInvestmentsCategory(workbook);
  }
  const openingTransaction = createOpeningBalanceTransaction(
    workbook,
    account,
    Object.assign({}, clean, { openedDate: clean.openedDate }),
    services
  );
  if (openingTransaction) {
    workbook.transactions.push(openingTransaction);
  }
  return {
    changed: true,
    account,
    openingTransaction,
    selectedAccountId: account.id
  };
}

export function updateAccount(workbook, accountId, input = {}, services = {}) {
  const account = findAccountById(workbook, accountId);
  if (!account) {
    return { changed: false, account: null };
  }
  const name = asString(input.name);
  const subtypeInput = hasOwn(input, 'subtype')
    ? asString(input.subtype)
    : asString(account.subtype);
  const currency = asString(
    input.currency || account.currency || getWorkbookCurrency(workbook)
  ).toUpperCase();
  const currentCurrency = asString(account.currency || getWorkbookCurrency(workbook)).toUpperCase();
  const isShortTermAsset = isTimeDepositSubtype(subtypeInput);
  const hasOpenedDate = hasOwn(input, 'openedDate');
  const openedDate = hasOpenedDate ? sanitizedDetailDate(input.openedDate) : account.openedDate;

  if (!name) {
    throw new AccountManagementError('account_name_required', 'Account name is required.');
  }
  if (hasOpenedDate && !openedDate) {
    throw new AccountManagementError(
      'account_date_invalid',
      'Enter a valid account date in YYYY-MM-DD format.'
    );
  }
  if (
    currency === 'USD' &&
    getWorkbookCurrency(workbook) === 'PHP' &&
    !getUsdToBaseRate(workbook, services)
  ) {
    throw new AccountManagementError(
      'usd_rate_required',
      'Set a USD to PHP rate before using USD accounts.'
    );
  }
  if (currency !== currentCurrency && getAccountUsage(workbook, account.id).hasHistory) {
    const repairPreview = buildAccountCurrencyRepairPreview(workbook, {
      accountId: account.id,
      targetCurrency: currency
    });
    if (repairPreview.ok) {
      throw new AccountManagementError(
        'account_currency_repair_required',
        'Review and confirm an account currency repair before changing a currency with transaction history.',
        {
          accountId: account.id,
          currentCurrency,
          requestedCurrency: currency,
          postingCurrencies: repairPreview.postingCurrencies,
          repairKind: repairPreview.repairKind,
          repairFingerprint: repairPreview.fingerprint,
          changedLineCount: repairPreview.changedLineCount,
          affectedTransactionIds: repairPreview.affectedTransactionIds
        }
      );
    }
    throw new AccountManagementError(
      'account_currency_conversion_required',
      'Accounts with transaction history need an explicit currency conversion; changing the label alone would reinterpret prior balances.',
      {
        accountId: account.id,
        currentCurrency,
        requestedCurrency: currency,
        postingCurrencies: repairPreview.postingCurrencies,
        blockers: repairPreview.blockers
      }
    );
  }

  account.name = name;
  account.subtype = isShortTermAsset ? 'time_deposit' : subtypeInput;
  account.currency = currency;
  const hasInstitution = Object.prototype.hasOwnProperty.call(input, 'institution');
  const hasInstitutionId = Object.prototype.hasOwnProperty.call(input, 'institutionId');
  const institutionFields =
    hasInstitution || hasInstitutionId
      ? resolveInstitutionFields(
          hasInstitutionId ? input.institutionId : '',
          hasInstitution ? input.institution : ''
        )
      : {
          institution: asString(account.institution),
          institutionId: asString(account.institutionId)
        };
  account.institution = institutionFields.institution;
  account.institutionId = institutionFields.institutionId;
  if (hasOwn(input, 'icon')) {
    account.icon = sanitizedAccountIcon(input.icon);
  }
  if (hasOwn(input, 'logoMode')) {
    account.logoMode = normalizedAccountLogoMode(
      input.logoMode,
      account.institutionId,
      hasOwn(input, 'icon') ? input.icon : account.icon
    );
  }
  if (hasOpenedDate) {
    account.openedDate = openedDate;
  }
  account.note = asString(input.note);
  if (hasOwn(input, 'details')) {
    account.details = sanitizeAccountDetails(input.details);
  }
  account.placementDate = isShortTermAsset ? asString(input.placementDate) : '';
  account.maturityDate = isShortTermAsset ? asString(input.maturityDate) : '';
  account.interestRate = isShortTermAsset
    ? parseNumericInput(input.interestRate)
    : Number(account.interestRate) || 0;
  account.estimatedMaturityAmount = isShortTermAsset
    ? parseNumericInput(input.estimatedMaturityAmount)
    : 0;
  if (isShortTermAsset && typeof services.ensureShortTermInvestmentsCategory === 'function') {
    services.ensureShortTermInvestmentsCategory(workbook);
  }
  return { changed: true, account };
}

export function setAccountActive(workbook, accountId, isActive) {
  const account = findAccountById(workbook, accountId);
  if (!account || account.isSystem) {
    return { changed: false, account: account || null };
  }
  account.isActive = !!isActive;
  return { changed: true, account };
}

export function archiveAccount(workbook, accountId) {
  return setAccountActive(workbook, accountId, false);
}

export function restoreAccount(workbook, accountId) {
  return setAccountActive(workbook, accountId, true);
}

export function retireAccount(workbook, accountId) {
  const account = findAccountById(workbook, accountId);
  if (!(account && account.group === 'liability') || account.isSystem) {
    return { changed: false, account: account || null };
  }
  account.isActive = false;
  return { changed: true, account, archived: true };
}

export function deleteAccount(workbook, accountId) {
  const account = findAccountById(workbook, accountId);
  if (!account || account.isSystem) {
    return {
      changed: false,
      account: account || null,
      usage: getAccountUsage(workbook, accountId)
    };
  }
  const usage = getAccountUsage(workbook, accountId);
  if (usage.hasNonOpeningReferences) {
    account.isActive = false;
    return {
      changed: true,
      account,
      usage,
      archived: true,
      deleted: false,
      removedTransactionIds: []
    };
  }
  const removableIds = new Set(usage.relatedTransactions.map((transaction) => transaction.id));
  workbook.transactions = (workbook.transactions || []).filter(
    (transaction) => !removableIds.has(transaction.id)
  );
  workbook.accounts = (workbook.accounts || []).filter((item) => item.id !== account.id);
  return {
    changed: true,
    account,
    usage,
    archived: false,
    deleted: true,
    removedTransactionIds: Array.from(removableIds)
  };
}

function makeIssue(code, message, detail = '') {
  return { code, message, detail };
}

export function validateAccountInvariants(workbook) {
  const errors = [];
  const warnings = [];
  const accounts = workbook && Array.isArray(workbook.accounts) ? workbook.accounts : [];
  const accountIds = new Set();
  const activeNameKeys = new Set();
  const allNameKeys = new Set();
  const postingCurrenciesByAccount = new Map();

  accounts.forEach((account, index) => {
    const id = asString(account && account.id);
    const name = asString(account && account.name);
    const group = normalizeGroup(account && account.group);
    const currency = asString(account && account.currency).toUpperCase();
    if (!id) {
      errors.push(
        makeIssue('account_missing_id', 'Account is missing a stable ID.', String(index))
      );
    } else if (accountIds.has(id)) {
      errors.push(makeIssue('account_duplicate_id', 'Account IDs must be unique.', id));
    } else {
      accountIds.add(id);
    }
    if (!name) {
      errors.push(
        makeIssue('account_missing_name', 'Account display name is required.', id || String(index))
      );
    }
    if (!ACCOUNT_GROUPS.includes(asString(account && account.group).toLowerCase())) {
      warnings.push(
        makeIssue(
          'account_invalid_group_normalizes',
          'Account group will normalize to asset if repaired.',
          id || String(index)
        )
      );
    }
    if (!currency) {
      warnings.push(
        makeIssue(
          'account_missing_currency',
          'Account currency will default to workbook currency.',
          id || String(index)
        )
      );
    }
    if (typeof (account && account.isActive) !== 'boolean') {
      warnings.push(
        makeIssue(
          'account_archived_flag_missing',
          'Account active/archive flag will default to active.',
          id || String(index)
        )
      );
    }
    const nameKey = [group, currency || getWorkbookCurrency(workbook), name.toLowerCase()].join(
      ':'
    );
    if (name && allNameKeys.has(nameKey)) {
      warnings.push(
        makeIssue(
          'account_duplicate_name',
          'Duplicate account display name exists for the same group and currency.',
          name
        )
      );
    }
    if (name) {
      allNameKeys.add(nameKey);
    }
    if (name && account && account.isActive !== false) {
      if (activeNameKeys.has(nameKey)) {
        warnings.push(
          makeIssue(
            'account_duplicate_active_name',
            'Active account display names should be unique within group and currency.',
            name
          )
        );
      }
      activeNameKeys.add(nameKey);
    }
  });

  (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []).forEach(
    (transaction, transactionIndex) => {
      (transaction.lines || []).forEach((line, lineIndex) => {
        const account = findAccountById(workbook, line.accountId);
        const detail = `${transaction.id || transactionIndex}:${lineIndex}`;
        if (!account) {
          errors.push(
            makeIssue(
              'line_missing_account',
              'Transaction line references a missing account.',
              detail
            )
          );
        } else if (account.isActive === false) {
          warnings.push(
            makeIssue(
              'line_archived_account',
              'Transaction line references an archived account.',
              `${transaction.id || transactionIndex}:${account.id}`
            )
          );
        }
        if (account && ['asset', 'liability'].includes(account.group)) {
          const lineCurrency = asString(line && line.currency).toUpperCase();
          if (lineCurrency) {
            const currencies = postingCurrenciesByAccount.get(account.id) || new Set();
            currencies.add(lineCurrency);
            postingCurrenciesByAccount.set(account.id, currencies);
          }
        }
      });
    }
  );

  accounts.forEach((account) => {
    if (!(account && ['asset', 'liability'].includes(account.group))) {
      return;
    }
    const configuredCurrency = asString(
      account.currency || getWorkbookCurrency(workbook)
    ).toUpperCase();
    const postingCurrencies = Array.from(postingCurrenciesByAccount.get(account.id) || []).sort();
    if (postingCurrencies.some((currency) => currency !== configuredCurrency)) {
      warnings.push(
        makeIssue(
          'account_posting_currency_mismatch',
          'Account currency metadata does not match its ledger posting currency.',
          `${account.id}: configured ${configuredCurrency}; postings ${postingCurrencies.join(', ')}`
        )
      );
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      accountCount: accounts.length,
      activeAccountCount: accounts.filter((account) => account.isActive !== false).length,
      balances: getAccountBalances(workbook).historical
    }
  };
}
