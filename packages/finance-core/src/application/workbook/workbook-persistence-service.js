import { validateLedgerInvariants } from '../../domain/ledger/invariants.js';
import { normalizeLedgerTransaction } from '../../domain/ledger/transactions.js';
import { normalizeDateKey } from '../../domain/money.js';
import {
  normalizeWorkbookAdvisorDraftGroups,
  normalizeWorkbookIdentity,
  normalizeWorkbookSettings
} from '../../domain/workbook/normalize.js';
import {
  buildPortableWorkbookHtml,
  parsePortableWorkbookText
} from '../../domain/workbook/portable.js';
import { migrateLegacyRecurringLineItems } from '../recurring/recurring-migration-service.js';

const CURRENT_WORKBOOK_VERSION = 2;

function issue(code, message, detail = '') {
  return { code, message, detail };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  try {
    return cloneJson(value);
  } catch (_error) {
    return Object.assign({}, value);
  }
}

function numericOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function createId(prefix, index, options) {
  if (typeof options.createId === 'function') {
    return asString(options.createId(prefix, index)) || `${prefix}_${index}`;
  }
  return `${prefix}_${index}`;
}

function normalizeAccountForPersistence(account, index, workbook, options) {
  const source = isPlainObject(account) ? account : {};
  const group = ['asset', 'liability', 'income', 'expense', 'equity'].includes(
    asString(source.group).toLowerCase()
  )
    ? asString(source.group).toLowerCase()
    : 'asset';
  return Object.assign({}, source, {
    id: asString(source.id) || createId('account', index, options),
    name: asString(source.name) || `Account ${index + 1}`,
    group,
    currency: asString(source.currency).toUpperCase() || workbook.currency || 'PHP',
    isActive: typeof source.isActive === 'boolean' ? source.isActive : true
  });
}

function normalizeCategoryForPersistence(category, index, workbook, options) {
  const source = isPlainObject(category) ? category : {};
  const type = ['income', 'expense', 'savings', 'debt'].includes(
    asString(source.type).toLowerCase()
  )
    ? asString(source.type).toLowerCase()
    : 'expense';
  return Object.assign({}, source, {
    id: asString(source.id) || createId('category', index, options),
    name: asString(source.name) || `Category ${index + 1}`,
    type,
    icon: asString(source.icon),
    color: asString(source.color),
    description: asString(source.description),
    currency: asString(source.currency).toUpperCase() || workbook.currency || 'PHP',
    linkedAccountId: asString(source.linkedAccountId),
    isActive: typeof source.isActive === 'boolean' ? source.isActive : true
  });
}

function normalizeCounterpartyForPersistence(counterparty, index, options) {
  const source = isPlainObject(counterparty) ? counterparty : {};
  return Object.assign({}, source, {
    id: asString(source.id) || createId('counterparty', index, options),
    name: asString(source.name) || `Counterparty ${index + 1}`,
    isActive: typeof source.isActive === 'boolean' ? source.isActive : true
  });
}

function normalizeSheetForPersistence(sheet, index, options) {
  const source = isPlainObject(sheet) ? sheet : {};
  return Object.assign({}, source, {
    id: asString(source.id) || createId('sheet', index, options),
    name: asString(source.name) || `Sheet ${index + 1}`,
    budgets: asArray(source.budgets).map(clonePlainObject),
    budgetLineItems: asArray(source.budgetLineItems).map(clonePlainObject),
    entries: asArray(source.entries).map(clonePlainObject)
  });
}

function normalizeRecurringItemForPersistence(item, index, workbook, options) {
  const source = isPlainObject(item) ? item : {};
  return Object.assign({}, source, {
    id: asString(source.id) || createId('recurring', index, options),
    name: asString(source.name) || `Recurring item ${index + 1}`,
    categoryId: asString(source.categoryId),
    accountId: asString(source.accountId),
    amount: numericOrZero(source.amount),
    currency: asString(source.currency).toUpperCase() || workbook.currency || 'PHP',
    isActive: typeof source.isActive === 'boolean' ? source.isActive : true
  });
}

function normalizeRecurringReconciliationForPersistence(reconciliation, index, options) {
  const source = clonePlainObject(reconciliation);
  const rawDecision = asString(source.decision).toLowerCase();
  const rawMethod = asString(source.method).toLowerCase();
  const allocatedBaseAmount = Number(source.allocatedBaseAmount);
  const confidence = Number(source.confidence);
  const createdAt = asString(source.createdAt || source.updatedAt);
  const updatedAt = asString(source.updatedAt || source.createdAt);
  return Object.assign({}, source, {
    id: asString(source.id) || createId('recurring_reconciliation', index, options),
    recurringItemId: asString(source.recurringItemId),
    occurrenceDate: normalizeDateKey(source.occurrenceDate),
    transactionId: asString(source.transactionId),
    decision: rawDecision === 'matched' ? 'matched' : 'rejected',
    method: ['explicit', 'automatic', 'manual', 'legacy'].includes(rawMethod)
      ? rawMethod
      : 'legacy',
    allocatedBaseAmount: Number.isFinite(allocatedBaseAmount)
      ? Math.max(0, allocatedBaseAmount)
      : 0,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    createdAt,
    updatedAt
  });
}

function normalizeTransactionForPersistence(transaction, index, workbook, options) {
  return normalizeLedgerTransaction(transaction, index, workbook, {
    createId: options.createId
  });
}

function versionIssues(rawWorkbook) {
  const warnings = [];
  const source = isPlainObject(rawWorkbook) ? rawWorkbook : {};
  if (typeof source.version === 'undefined') {
    warnings.push(
      issue(
        'workbook_missing_version',
        'Workbook has no schema version; loaded through compatibility normalization.'
      )
    );
    return warnings;
  }
  const version = Number(source.version);
  if (!Number.isFinite(version)) {
    warnings.push(
      issue(
        'workbook_invalid_version',
        'Workbook version is not numeric; loaded through compatibility normalization.',
        String(source.version)
      )
    );
  } else if (version < CURRENT_WORKBOOK_VERSION) {
    warnings.push(
      issue(
        'workbook_legacy_version',
        'Workbook is older than the current schema; loaded through compatibility normalization.',
        String(source.version)
      )
    );
  } else if (version > CURRENT_WORKBOOK_VERSION) {
    warnings.push(
      issue(
        'workbook_future_version',
        'Workbook version is newer than this app; verify data before saving.',
        String(source.version)
      )
    );
  }
  return warnings;
}

export class WorkbookPersistenceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'WorkbookPersistenceError';
    this.code = options.code || 'workbook_persistence_error';
    this.validation = options.validation || null;
  }
}

export function normalizeLoadedWorkbook(rawWorkbook, options = {}) {
  if (typeof options.normalizeWorkbook === 'function') {
    return options.normalizeWorkbook(rawWorkbook);
  }
  const source = isPlainObject(rawWorkbook) ? clonePlainObject(rawWorkbook) : {};
  const identity = normalizeWorkbookIdentity(source, {
    uid: (prefix, index) => createId(prefix || 'workbook', index || 0, options),
    now: options.now
  });
  const workbook = Object.assign({}, source, identity);
  const sourceSettings = isPlainObject(source.settings) ? clonePlainObject(source.settings) : {};
  workbook.settings = Object.assign(
    {},
    sourceSettings,
    normalizeWorkbookSettings(source, {
      dashboardLayout: sourceSettings.dashboardLayout,
      subscriptionReviewDecisions: sourceSettings.subscriptionReviewDecisions
    })
  );
  workbook.accounts = asArray(source.accounts).map((account, index) =>
    normalizeAccountForPersistence(account, index, workbook, options)
  );
  workbook.categories = asArray(source.categories).map((category, index) =>
    normalizeCategoryForPersistence(category, index, workbook, options)
  );
  workbook.counterparties = asArray(source.counterparties).map((counterparty, index) =>
    normalizeCounterpartyForPersistence(counterparty, index, options)
  );
  workbook.transactions = asArray(source.transactions).map((transaction, index) =>
    normalizeTransactionForPersistence(transaction, index, workbook, options)
  );
  workbook.sheets = asArray(source.sheets).map((sheet, index) =>
    normalizeSheetForPersistence(sheet, index, options)
  );
  workbook.recurringItems = asArray(source.recurringItems).map((item, index) =>
    normalizeRecurringItemForPersistence(item, index, workbook, options)
  );
  workbook.recurringReconciliations = asArray(source.recurringReconciliations)
    .filter(isPlainObject)
    .map((reconciliation, index) =>
      normalizeRecurringReconciliationForPersistence(reconciliation, index, options)
    );
  migrateLegacyRecurringLineItems(workbook, {
    createId: options.createId,
    today:
      options.today ||
      (typeof options.now === 'function'
        ? () => options.now().toISOString().slice(0, 10)
        : undefined)
  });
  workbook.fxRates = asArray(source.fxRates).map(clonePlainObject);
  workbook.assets = asArray(source.assets).map(clonePlainObject);
  workbook.aiDrafts = asArray(source.aiDrafts).map(clonePlainObject);
  workbook.externalDraftGroups = asArray(source.externalDraftGroups).map(clonePlainObject);
  workbook.advisorDraftGroups = normalizeWorkbookAdvisorDraftGroups(source, {
    createId: options.createId
  });
  workbook.checkpoints = asArray(source.checkpoints).map(clonePlainObject);
  workbook.migrationNotes = asArray(source.migrationNotes).map(String).filter(Boolean);
  return workbook;
}

export function validateWorkbookBeforeSave(workbook, options = {}) {
  return validateWorkbookAfterLoad(workbook, Object.assign({}, options, { phase: 'before_save' }));
}

export function validateWorkbookAfterLoad(workbook, options = {}) {
  const errors = [];
  const warnings = [];
  const source = isPlainObject(workbook) ? workbook : {};
  const phase = String(options.phase || 'after_load');

  if (!isPlainObject(workbook)) {
    errors.push(issue('workbook_not_object', 'Workbook payload must be an object.'));
  }
  ['id', 'name', 'currency'].forEach((field) => {
    if (!asString(source[field])) {
      errors.push(issue(`workbook_missing_${field}`, `Workbook is missing ${field}.`));
    }
  });
  if (!Number.isFinite(Number(source.year))) {
    warnings.push(issue('workbook_missing_year', 'Workbook year is missing or not numeric.'));
  }
  ['accounts', 'categories', 'transactions', 'sheets'].forEach((field) => {
    if (!Array.isArray(source[field])) {
      errors.push(issue(`workbook_${field}_not_array`, `Workbook ${field} must be an array.`));
    }
  });
  warnings.push(...versionIssues(options.rawWorkbook || workbook));

  const invariants = validateLedgerInvariants(source);
  const invariantIssues = invariants.errors.map((item) =>
    issue(item.code, item.message, item.detail)
  );
  const invariantWarnings = invariants.warnings.map((item) =>
    issue(item.code, item.message, item.detail)
  );
  errors.push(...invariantIssues);
  warnings.push(...invariantWarnings);

  return {
    ok: errors.length === 0,
    phase,
    errors,
    warnings,
    invariants
  };
}

export function serializeWorkbookForSave(workbook, options = {}) {
  const validation = validateWorkbookBeforeSave(workbook, options);
  if (!validation.ok && options.rejectInvalid) {
    throw new WorkbookPersistenceError('Workbook failed validation before save.', {
      code: 'workbook_invalid_before_save',
      validation
    });
  }
  return {
    html: buildPortableWorkbookHtml(workbook),
    validation
  };
}

export function deserializeWorkbookFromFile(rawText, options = {}) {
  const rawWorkbook = parsePortableWorkbookText(rawText);
  const workbook = normalizeLoadedWorkbook(rawWorkbook, options);
  const validation = validateWorkbookAfterLoad(workbook, {
    rawWorkbook,
    phase: 'after_load'
  });
  if (!validation.ok && options.rejectInvalid) {
    throw new WorkbookPersistenceError('Workbook failed validation after load.', {
      code: 'workbook_invalid_after_load',
      validation
    });
  }
  return {
    workbook,
    rawWorkbook,
    validation
  };
}
