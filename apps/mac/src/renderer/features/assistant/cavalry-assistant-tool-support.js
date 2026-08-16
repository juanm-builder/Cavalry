import {
  buildBudgetSummary,
  buildIncomeExpenseBreakdown,
  buildRecurringItemRows,
  buildTransactionTableView,
  deleteLedgerTransactionCommand,
  getAccountBalances,
  getAssetLiabilityTotalsAsOf,
  getAccountUsage,
  submitManualTransactionCommand,
  validateLedgerInvariants
} from '@cavalry/finance-core';

import { ACCOUNT_ACTIONS, executeAccountCommand } from '../accounts/account-controller.js';
import { buildTransactionComposerDraft } from '../transactions/transaction-model.js';
import { inferCavalryAssistantTransactionArguments } from './cavalry-assistant-transaction-inference.js';
import {
  ACCOUNT_UPDATE_PROPERTIES,
  ACCOUNT_WRITE_PROPERTIES,
  asArray,
  asObject,
  asText,
  clampInteger,
  clonePlain,
  hasOwn,
  textKey
} from './cavalry-assistant-tool-definitions.js';
import {
  accountBalanceProjection,
  safeEventList,
  summarizeAccount,
  summarizeCategory,
  summarizeCounterparty,
  summarizeRecurring,
  summarizeTransaction,
  transactionRow
} from './cavalry-assistant-tool-presenters.js';
import { createRecurringAnalysisTools } from './cavalry-assistant-recurring-analysis.js';
import {
  entitySuggestionLabel,
  fuzzyEntitySuggestions
} from './cavalry-assistant-entity-matching.js';

export { fuzzyEntitySuggestions } from './cavalry-assistant-entity-matching.js';

const EVIDENCE_RECORD_PREVIEW_LIMIT = 50;

export {
  safeEventList,
  summarizeAccount,
  summarizeCategory,
  summarizeCounterparty,
  summarizeRecurring,
  summarizeTransaction,
  transactionRow
} from './cavalry-assistant-tool-presenters.js';

export function toolCallParts(toolCall) {
  const source = asObject(toolCall);
  const functionShape = asObject(source.function);
  const name = asText(source.name || source.tool || source.toolName || functionShape.name);
  const rawArguments =
    source.arguments ??
    source.args ??
    source.input ??
    functionShape.arguments ??
    functionShape.input;
  if (typeof rawArguments === 'string') {
    try {
      const parsed = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object.');
      }
      return {
        name,
        arguments: parsed,
        toolCallId: asText(source.call_id || source.id || source.toolCallId)
      };
    } catch (error) {
      return {
        name,
        arguments: {},
        toolCallId: asText(source.call_id || source.id || source.toolCallId),
        parseError: asText(error && error.message) || 'Tool arguments must be valid JSON.'
      };
    }
  }
  return {
    name,
    arguments: asObject(rawArguments),
    toolCallId: asText(source.call_id || source.id || source.toolCallId)
  };
}

export function errorItem(code, message, field = '') {
  return { code, message, ...(field ? { field } : {}) };
}

export function envelope(toolName, toolCallId, options = {}) {
  return {
    ok: options.ok !== false,
    toolName,
    ...(toolCallId ? { toolCallId } : {}),
    status: options.status || 'completed',
    changed: options.changed === true,
    data: options.data || null,
    ...(options.referenceData ? { referenceData: options.referenceData } : {}),
    warnings: asArray(options.warnings).map(normalizeIssue),
    errors: asArray(options.errors).map(normalizeIssue),
    ...(options.confirmation ? { confirmation: options.confirmation } : {})
  };
}

export function normalizeIssue(issue) {
  const source = asObject(issue);
  const details = { ...asObject(source.details), ...source };
  const normalized = {
    code: asText(source.code) || 'unknown',
    message: asText(source.message) || asText(issue) || 'The action could not be completed.',
    ...(source.field ? { field: asText(source.field) } : {})
  };
  ['accountId', 'accountName', 'configuredCurrency', 'transactionCurrency', 'baseCurrency'].forEach(
    (field) => {
      if (asText(details[field])) normalized[field] = asText(details[field]);
    }
  );
  if (Number(details.fxRateToBase) > 0) {
    normalized.fxRateToBase = Number(details.fxRateToBase);
  }
  ['postingCurrencies', 'affectedTransactionIds'].forEach((field) => {
    if (Array.isArray(details[field])) normalized[field] = clonePlain(details[field]);
  });
  if (Array.isArray(details.accounts)) {
    normalized.accounts = details.accounts.map((account) => {
      const item = asObject(account);
      return {
        accountId: asText(item.accountId),
        accountName: asText(item.accountName),
        accountCurrency: asText(item.accountCurrency)
      };
    });
  }
  return normalized;
}

export function failure(environment, status, code, message, field = '') {
  return envelope(environment.toolName, environment.toolCallId, {
    ok: false,
    status,
    errors: [errorItem(code, message, field)]
  });
}

export function confirmationRequired(environment, actionLabel) {
  return envelope(environment.toolName, environment.toolCallId, {
    ok: false,
    status: 'confirmation_required',
    errors: [
      errorItem(
        'confirmation_required',
        `Explicit user confirmation is required before Cavalry can ${actionLabel}.`,
        'confirmed'
      )
    ],
    confirmation: {
      required: true,
      field: 'confirmed',
      action: actionLabel,
      message: `Confirm that you want Cavalry to ${actionLabel}, then retry with confirmed set to true.`
    }
  });
}

export function collection(workbook, name) {
  return asArray(workbook && workbook[name]);
}

export function resolveEntity(items, reference, options = {}) {
  const ref = asText(reference);
  if (!ref) {
    return options.optional
      ? { ok: true, value: null, id: '', provided: false }
      : {
          ok: false,
          status: 'validation_failed',
          error: errorItem(
            'reference_required',
            `${options.label || 'Entity'} is required.`,
            options.field
          )
        };
  }
  const key = textKey(ref);
  const names = options.names || ['name'];
  const matches = asArray(items).filter((item) => {
    if (textKey(item && item.id) === key) return true;
    return names.some((name) => textKey(item && item[name]) === key);
  });
  if (!matches.length) {
    const suggestions = fuzzyEntitySuggestions(items, ref, names);
    return {
      ok: false,
      status: 'not_found',
      error: errorItem(
        'reference_not_found',
        `${options.label || 'Entity'} “${ref}” was not found.${
          suggestions ? ` Closest matches: ${suggestions}. Retry with the intended ID.` : ''
        }`,
        options.field
      )
    };
  }
  if (matches.length > 1) {
    const matchList = matches.slice(0, 5).map(entitySuggestionLabel).join(', ');
    return {
      ok: false,
      status: 'ambiguous_reference',
      error: errorItem(
        'ambiguous_reference',
        `${options.label || 'Entity'} “${ref}” matches more than one record: ${matchList}. Use its ID.`,
        options.field
      )
    };
  }
  return { ok: true, value: matches[0], id: asText(matches[0].id), provided: true };
}

export function firstArgument(args, keys) {
  for (const key of keys) {
    if (hasOwn(args, key)) return args[key];
  }
  return undefined;
}

export function hasAnyArgument(args, keys) {
  return keys.some((key) => hasOwn(args, key));
}

export function resolveArgument(workbook, args, options) {
  const provided = hasAnyArgument(args, options.keys);
  if (!provided && options.optional) {
    return { ok: true, value: null, id: '', provided: false };
  }
  const reference = firstArgument(args, options.keys);
  if (provided && !asText(reference) && options.allowEmpty) {
    return { ok: true, value: null, id: '', provided: true };
  }
  return resolveEntity(collection(workbook, options.collection), reference, {
    optional: options.optional,
    label: options.label,
    field: options.keys[0],
    names: options.names
  });
}

export function resolutionFailure(environment, resolution) {
  return envelope(environment.toolName, environment.toolCallId, {
    ok: false,
    status: resolution.status || 'validation_failed',
    errors: [resolution.error]
  });
}

export function currentDate(workbook, services) {
  if (typeof services.defaultDate === 'function') return asText(services.defaultDate());
  if (asText(services.defaultDate)) return asText(services.defaultDate);
  if (typeof services.today === 'function') return asText(services.today());
  if (services.clock && typeof services.clock.today === 'function') {
    return asText(services.clock.today());
  }
  return `${Number(workbook && workbook.year) || new Date().getFullYear()}-01-01`;
}

function ledgerIssueKey(issue) {
  return [issue?.code, issue?.message, issue?.detail].map(asText).join('\u0000');
}

function introducedLedgerErrors(previousWorkbook, nextWorkbook) {
  const previousErrors = new Set(
    asArray(validateLedgerInvariants(previousWorkbook).errors).map(ledgerIssueKey)
  );
  return asArray(validateLedgerInvariants(nextWorkbook).errors).filter(
    (issue) => !previousErrors.has(ledgerIssueKey(issue))
  );
}

const CURRENCY_CONVERSION_CONFIRMATION_CODES = new Set([
  'currency_conversion_confirmation_required',
  'account_currency_conversion_required',
  'account_currency_conversion_confirmation_required'
]);

function currencyConversionDisclosure(warning) {
  const source = asObject(warning);
  const transactionCurrency = asText(source.transactionCurrency).toUpperCase();
  const accountCopy = asArray(source.accounts)
    .map((account) => {
      const item = asObject(account);
      const name = asText(item.accountName) || asText(item.accountId) || 'account';
      const currency = asText(item.accountCurrency).toUpperCase();
      return currency ? `${name} (${currency})` : name;
    })
    .filter(Boolean)
    .join(', ');
  const rate = Number(source.fxRateToBase) || 0;
  return [
    asText(source.message) || 'This transaction would convert money between currencies.',
    transactionCurrency ? `Transaction currency: ${transactionCurrency}.` : '',
    accountCopy
      ? `Affected account${asArray(source.accounts).length === 1 ? '' : 's'}: ${accountCopy}.`
      : '',
    rate > 0 ? `Exchange rate: ${rate}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

export async function commitCommand(environment, result, reason, dataFactory) {
  if (!(result && result.ok)) {
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'validation_failed',
      errors: asArray(result && result.errors),
      warnings: asArray(result && result.warnings)
    });
  }
  const changed = !!(result.workbook && result.workbook !== environment.workbook);
  const conversionWarning = asArray(result.warnings).find((warning) =>
    CURRENCY_CONVERSION_CONFIRMATION_CODES.has(asText(warning && warning.code))
  );
  if (conversionWarning && asObject(environment.arguments).allowCurrencyConversion !== true) {
    const warningMessage = currencyConversionDisclosure(conversionWarning);
    const confirmationMessage =
      asText(conversionWarning.confirmMessage) || 'Confirm this currency conversion to continue.';
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'confirmation_required',
      changed: false,
      errors: [
        errorItem(
          asText(conversionWarning.code) || 'currency_conversion_confirmation_required',
          warningMessage,
          'allowCurrencyConversion'
        )
      ],
      warnings: [conversionWarning],
      confirmation: {
        required: true,
        field: 'allowCurrencyConversion',
        action: 'post this transaction with the disclosed currency conversion',
        message: `${warningMessage} ${confirmationMessage}`
      }
    });
  }
  const duplicateWarning = asArray(result.warnings).find(
    (warning) => asText(warning && warning.code) === 'possible_duplicate_transaction'
  );
  if (!changed && duplicateWarning) {
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'confirmation_required',
      errors: [
        errorItem(
          'possible_duplicate_transaction',
          asText(duplicateWarning.message) || 'Confirm the possible duplicate before posting.',
          'allowDuplicate'
        )
      ],
      warnings: [duplicateWarning],
      confirmation: {
        required: true,
        field: 'allowDuplicate',
        action: 'post a possible duplicate transaction',
        message: 'Confirm the duplicate, then retry with allowDuplicate set to true.'
      }
    });
  }
  if (changed) {
    const previousTransactionIds = new Set(
      collection(environment.workbook, 'transactions').map((transaction) => asText(transaction?.id))
    );
    const originId = (asText(environment.toolCallId) || asText(environment.toolName) || 'action')
      .replace(/\s+/g, '_')
      .slice(0, 120);
    collection(result.workbook, 'transactions').forEach((transaction) => {
      if (!previousTransactionIds.has(asText(transaction?.id))) {
        transaction.source = 'advisor';
        transaction.reference = `advisor:companion:${originId}`;
      }
    });
  }
  if (changed) {
    const integrityErrors = introducedLedgerErrors(environment.workbook, result.workbook);
    if (integrityErrors.length) {
      return envelope(environment.toolName, environment.toolCallId, {
        ok: false,
        status: 'verification_failed',
        changed: false,
        errors: integrityErrors.map((issue) =>
          errorItem(
            asText(issue?.code) || 'ledger_integrity_failed',
            `Cavalry stopped this change because it would make the ledger inconsistent: ${
              asText(issue?.message) || 'ledger validation failed.'
            }`
          )
        ),
        warnings: asArray(result.warnings)
      });
    }
  }
  if (changed) {
    if (typeof environment.context.commitCommandResult !== 'function') {
      return failure(
        environment,
        'context_error',
        'commit_unavailable',
        'The assistant command-result commit adapter is unavailable.'
      );
    }
    try {
      await environment.context.commitCommandResult(result, { reason });
    } catch (error) {
      return failure(
        environment,
        'commit_failed',
        'commit_failed',
        asText(error && error.message) || 'The workbook change could not be committed.'
      );
    }
  }
  let data = null;
  if (typeof dataFactory === 'function') {
    data = dataFactory(result.workbook || environment.workbook, result);
  } else if (dataFactory) {
    data = dataFactory;
  }
  return envelope(environment.toolName, environment.toolCallId, {
    changed,
    data: data || { events: safeEventList(result.events) },
    warnings: asArray(result.warnings)
  });
}

export function transactionArguments(workbook, args, base = {}) {
  const payload = { ...base };
  const fields = [
    'template',
    'amount',
    'currency',
    'date',
    'fxRateToBase',
    'description',
    'counterpartyName',
    'counterpartyKind',
    'note',
    'allowDuplicate',
    'allowCurrencyConversion'
  ];
  fields.forEach((field) => {
    if (hasOwn(args, field)) payload[field] = args[field];
  });
  const resolutions = [
    {
      output: 'categoryId',
      options: {
        collection: 'categories',
        keys: ['categoryId', 'category'],
        label: 'Category',
        optional: true,
        allowEmpty: true
      }
    },
    {
      output: 'primaryAccountId',
      options: {
        collection: 'accounts',
        keys: ['primaryAccountId', 'primaryAccount'],
        label: 'Primary account',
        optional: true,
        allowEmpty: true
      }
    },
    {
      output: 'secondaryAccountId',
      options: {
        collection: 'accounts',
        keys: ['secondaryAccountId', 'secondaryAccount'],
        label: 'Secondary account',
        optional: true,
        allowEmpty: true
      }
    },
    {
      output: 'counterpartyId',
      options: {
        collection: 'counterparties',
        keys: ['counterpartyId', 'counterparty'],
        label: 'Counterparty',
        optional: true,
        allowEmpty: true
      }
    }
  ];
  for (const descriptor of resolutions) {
    const resolution = resolveArgument(workbook, args, descriptor.options);
    if (!resolution.ok) return { ok: false, resolution };
    if (resolution.provided) payload[descriptor.output] = resolution.id;
  }
  return { ok: true, payload };
}

export function accountFormDefaults(account, workbook) {
  return {
    accountId: asText(account.id),
    name: asText(account.name),
    group:
      account.subtype === 'time_deposit'
        ? 'short_term_asset'
        : account.group === 'liability'
          ? 'liability'
          : 'asset',
    subtype: asText(account.subtype),
    currency: asText(account.currency || workbook.currency),
    institution: asText(account.institution),
    institutionId: asText(account.institutionId),
    openedDate: asText(account.openedDate),
    openingBalance: '',
    note: asText(account.note),
    placementDate: asText(account.placementDate),
    maturityDate: asText(account.maturityDate),
    interestRate: Number(account.interestRate) || 0,
    estimatedMaturityAmount: Number(account.estimatedMaturityAmount) || 0
  };
}

export function billFormDefaults(item, workbook) {
  return {
    recurringItemId: asText(item.id),
    kind: asText(item.kind) || 'bill',
    name: asText(item.name),
    categoryId: asText(item.categoryId),
    counterpartyId: asText(item.counterpartyId),
    accountId: asText(item.accountId),
    amount: Number(item.amount) || 0,
    currency: asText(item.currency || workbook.currency),
    frequency: asText(item.frequency) || 'Monthly',
    dueDate: asText(item.anchorDate || item.dueDate),
    autoRenew: item.autoRenew === true,
    isActive: item.isActive !== false,
    note: asText(item.note)
  };
}

export function mergeKnown(base, args, fields) {
  const payload = { ...base };
  fields.forEach((field) => {
    if (hasOwn(args, field)) payload[field] = args[field];
  });
  return payload;
}

export function transactionPagination(view) {
  return {
    page: Number(view.page) || 1,
    pageSize: Number(view.pageSize) || 0,
    total: Number(view.rowCount) || 0,
    totalPages: Number(view.totalPages) || 1,
    returned: asArray(view.rows).length,
    hasMore: Number(view.page) < Number(view.totalPages),
    nextPage: Number(view.page) < Number(view.totalPages) ? Number(view.page) + 1 : null
  };
}

export function counterpartiesWithUsage(workbook, includeArchived) {
  return collection(workbook, 'counterparties')
    .filter((counterparty) => includeArchived || counterparty.isActive !== false)
    .map((counterparty) => ({
      ...summarizeCounterparty(counterparty),
      transactionCount: collection(workbook, 'transactions').filter(
        (transaction) => asText(transaction.counterpartyId) === asText(counterparty.id)
      ).length,
      recurringItemCount: collection(workbook, 'recurringItems').filter(
        (item) => asText(item.counterpartyId) === asText(counterparty.id)
      ).length
    }));
}

export function recurringItemsWithLabels(workbook, includeArchived, asOfDate = '') {
  const rowById = new Map(
    buildRecurringItemRows(workbook, { asOfDate }).map((row) => [asText(row.id), clonePlain(row)])
  );
  return collection(workbook, 'recurringItems')
    .filter((item) => includeArchived || item.isActive !== false)
    .map((item) => ({ ...rowById.get(asText(item.id)), ...summarizeRecurring(item) }));
}

export async function createTransaction(environment) {
  const workbook = environment.workbook;
  const date = currentDate(workbook, environment.services);
  const forcedTemplate = asText(environment.context?.forcedTransactionTemplate);
  const inferred = inferCavalryAssistantTransactionArguments(workbook, environment.arguments, {
    currentDate: date,
    question: asText(environment.context && environment.context.question),
    forcedTemplate
  });
  const defaults = buildTransactionComposerDraft(workbook, '', {
    defaultDate: date
  });
  const prepared = transactionArguments(workbook, inferred.arguments, defaults);
  if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);
  const result = submitManualTransactionCommand(workbook, prepared.payload, environment.services);
  return commitCommand(environment, result, 'assistant_transaction_created', (_next, command) => ({
    transaction: summarizeTransaction(command.transaction),
    inferredFields: clonePlain(inferred.inferredFields),
    events: safeEventList(command.events)
  }));
}

export async function updateTransaction(environment) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'transactions',
    keys: ['transactionId', 'transaction'],
    label: 'Transaction',
    names: ['description']
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  const defaults = buildTransactionComposerDraft(environment.workbook, resolved.id, {
    defaultDate: currentDate(environment.workbook, environment.services)
  });
  const prepared = transactionArguments(environment.workbook, environment.arguments, defaults);
  if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);
  prepared.payload.transactionId = resolved.id;
  const result = submitManualTransactionCommand(
    environment.workbook,
    prepared.payload,
    environment.services
  );
  return commitCommand(environment, result, 'assistant_transaction_updated', (_next, command) => ({
    transaction: summarizeTransaction(command.transaction),
    events: safeEventList(command.events)
  }));
}

export async function deleteTransaction(environment) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'transactions',
    keys: ['transactionId', 'transaction'],
    label: 'Transaction',
    names: ['description']
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  if (environment.arguments.confirmed !== true) {
    return confirmationRequired(environment, `permanently delete “${resolved.value.description}”`);
  }
  const result = deleteLedgerTransactionCommand(environment.workbook, resolved.id);
  return commitCommand(environment, result, 'assistant_transaction_deleted', (_next, command) => ({
    deletedTransaction: summarizeTransaction(command.transaction),
    events: safeEventList(command.events)
  }));
}

export async function createAccountTool(environment) {
  const workbook = environment.workbook;
  const payload = mergeKnown(
    {
      group: 'asset',
      subtype: 'cash',
      currency: asText(workbook.currency) || 'PHP',
      openedDate: currentDate(workbook, environment.services),
      openingBalance: '',
      note: ''
    },
    environment.arguments,
    Object.keys(ACCOUNT_WRITE_PROPERTIES)
  );
  const result = executeAccountCommand(
    workbook,
    { type: ACCOUNT_ACTIONS.CREATE, payload },
    environment.services
  );
  return commitCommand(environment, result, 'assistant_account_created', (next, command) => {
    const id = asText(command.events.find((event) => event.type === 'account.created')?.accountId);
    return {
      account: summarizeAccount(
        collection(next, 'accounts').find((item) => item.id === id),
        next
      )
    };
  });
}

export async function updateAccountTool(environment) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'accounts',
    keys: ['accountId', 'account'],
    label: 'Account'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  const payload = mergeKnown(
    accountFormDefaults(resolved.value, environment.workbook),
    environment.arguments,
    Object.keys(ACCOUNT_UPDATE_PROPERTIES)
  );
  payload.accountId = resolved.id;
  const result = executeAccountCommand(
    environment.workbook,
    { type: ACCOUNT_ACTIONS.UPDATE, payload },
    environment.services
  );
  return commitCommand(environment, result, 'assistant_account_updated', (next) => ({
    account: summarizeAccount(
      collection(next, 'accounts').find((item) => item.id === resolved.id),
      next
    )
  }));
}

export async function accountStateCommand(environment, actionType, reason, actionLabel, confirmed) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'accounts',
    keys: ['accountId', 'account'],
    label: 'Account'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  if (confirmed && environment.arguments.confirmed !== true) {
    return confirmationRequired(environment, `${actionLabel} “${resolved.value.name}”`);
  }
  const result = executeAccountCommand(
    environment.workbook,
    { type: actionType, payload: { accountId: resolved.id } },
    environment.services
  );
  return commitCommand(environment, result, reason, (next) => ({
    account: summarizeAccount(
      collection(next, 'accounts').find((item) => item.id === resolved.id),
      next
    ),
    events: safeEventList(result.events)
  }));
}

export async function readWorkspaceContext(environment) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  const includeArchived = args.includeArchived === true;
  const transactionView = buildTransactionTableView(workbook, {
    type: 'all',
    page: clampInteger(args.transactionPage, 1, 100000, 1),
    pageSize: clampInteger(args.transactionLimit, 1, 500, 100),
    sort: {
      key: 'date',
      direction: asText(args.transactionSortDirection) === 'asc' ? 'asc' : 'desc'
    }
  });
  const accounts = collection(workbook, 'accounts')
    .filter((account) => includeArchived || account.isActive !== false)
    .map((account) => summarizeAccount(account, workbook));
  const categories = collection(workbook, 'categories')
    .filter((category) => includeArchived || category.isActive !== false)
    .map((category) => summarizeCategory(category, workbook));
  const recurringItems = recurringItemsWithLabels(
    workbook,
    includeArchived,
    currentDate(workbook, environment.services)
  );
  const counterparties = counterpartiesWithUsage(workbook, includeArchived);
  const budgets = collection(workbook, 'sheets').map((sheet) => summarizeBudget(workbook, sheet));
  return envelope(environment.toolName, environment.toolCallId, {
    data: {
      workbook: {
        id: asText(workbook.id),
        name: asText(workbook.name),
        year: Number(workbook.year) || 0,
        currency: asText(workbook.currency)
      },
      safeSettings: {
        usdToBaseRate: Number(workbook.settings?.usdToBaseRate) || 0
      },
      counts: {
        transactions: collection(workbook, 'transactions').length,
        accounts: collection(workbook, 'accounts').length,
        categories: collection(workbook, 'categories').length,
        recurringItems: collection(workbook, 'recurringItems').length,
        counterparties: collection(workbook, 'counterparties').length,
        budgetSheets: collection(workbook, 'sheets').length
      },
      accounts,
      categories,
      budgets,
      recurringItems,
      counterparties,
      plannerBuckets: collection(workbook, 'plannerBuckets').map((bucket) => ({
        id: asText(bucket.id),
        name: asText(bucket.name)
      })),
      transactions: transactionView.rows.map((row) => transactionRow(row, workbook)),
      transactionPagination: transactionPagination(transactionView)
    }
  });
}

export async function readWorkspaceSummary(environment) {
  const args = environment.arguments;
  const workbook = environment.workbook;
  const flow = buildIncomeExpenseBreakdown(workbook, { start: args.start, end: args.end });
  const position = getAssetLiabilityTotalsAsOf(workbook, asText(args.end));
  const range = { start: asText(args.start), end: asText(args.end) };
  const cashFlowView = buildTransactionTableView(workbook, {
    type: 'all',
    start: range.start,
    end: range.end,
    page: 1,
    pageSize: EVIDENCE_RECORD_PREVIEW_LIMIT
  });
  const cashFlowRecords = cashFlowView.rows.map((row) => transactionRow(row, workbook));
  const cashFlowSourceRefs = cashFlowView.allRows.map(
    (row) => `transaction:${encodeURIComponent(asText(row.id))}`
  );
  const positionAccounts = collection(workbook, 'accounts').filter((account) =>
    ['asset', 'short_term_asset', 'liability'].includes(asText(account.group))
  );
  const positionRecords = positionAccounts
    .slice(0, EVIDENCE_RECORD_PREVIEW_LIMIT)
    .map((account) => summarizeAccount(account, workbook, { asOfDate: range.end }));
  const positionSourceRefs = positionAccounts.map(
    (account) => `account:${encodeURIComponent(asText(account.id))}`
  );
  const evidenceSuffix = asText(environment.toolCallId) || 'result';
  const cashFlowEvidenceSetId = `cash-flow-${evidenceSuffix}`;
  const positionEvidenceSetId = `financial-position-${evidenceSuffix}`;
  const evidenceSets = [
    {
      id: cashFlowEvidenceSetId,
      label: 'Cash-flow calculation records',
      kind: 'transaction',
      calculation: {
        operation: 'cash_flow_summary',
        range,
        totals: clonePlain(flow),
        transactionCount: cashFlowSourceRefs.length,
        recordPreviewCount: cashFlowRecords.length,
        recordPreviewOmitted: Math.max(0, cashFlowSourceRefs.length - cashFlowRecords.length)
      }
    },
    {
      id: positionEvidenceSetId,
      label: 'Financial-position calculation records',
      kind: 'account',
      calculation: {
        operation: 'asset_liability_summary',
        asOfDate: range.end,
        accountCount: positionSourceRefs.length,
        recordPreviewCount: positionRecords.length,
        recordPreviewOmitted: Math.max(0, positionSourceRefs.length - positionRecords.length),
        totals: {
          assets: position.assets,
          liabilities: position.liabilities,
          netWorth: position.netWorth,
          currency: asText(workbook.currency)
        }
      }
    }
  ];
  return envelope(environment.toolName, environment.toolCallId, {
    data: {
      workbook: {
        id: asText(workbook.id),
        name: asText(workbook.name),
        year: Number(workbook.year) || 0,
        currency: asText(workbook.currency)
      },
      safeSettings: { usdToBaseRate: Number(workbook.settings?.usdToBaseRate) || 0 },
      range,
      cashFlow: flow,
      position: {
        assets: position.assets,
        liabilities: position.liabilities,
        netWorth: position.netWorth,
        currency: asText(workbook.currency)
      },
      counts: {
        transactions: collection(workbook, 'transactions').length,
        accounts: collection(workbook, 'accounts').length,
        categories: collection(workbook, 'categories').length,
        recurringItems: collection(workbook, 'recurringItems').length,
        counterparties: collection(workbook, 'counterparties').length,
        sheets: collection(workbook, 'sheets').length
      },
      evidenceSetIds: {
        cashFlow: cashFlowEvidenceSetId,
        position: positionEvidenceSetId
      },
      evidenceSets
    },
    referenceData: {
      evidenceSets: [
        {
          id: cashFlowEvidenceSetId,
          kind: 'transaction',
          source_refs: cashFlowSourceRefs,
          records: cashFlowRecords
        },
        {
          id: positionEvidenceSetId,
          kind: 'account',
          source_refs: positionSourceRefs,
          records: positionRecords
        }
      ]
    }
  });
}

export async function searchTransactions(environment) {
  const args = environment.arguments;
  const workbook = environment.workbook;
  const account = resolveArgument(workbook, args, {
    collection: 'accounts',
    keys: ['accountId', 'account'],
    label: 'Account',
    optional: true
  });
  if (!account.ok) return resolutionFailure(environment, account);
  const category = resolveArgument(workbook, args, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category',
    optional: true
  });
  if (!category.ok) return resolutionFailure(environment, category);
  const view = buildTransactionTableView(workbook, {
    search: asText(args.query),
    type: asText(args.type) || 'all',
    accountId: account.id,
    categoryId: category.id,
    start: asText(args.start),
    end: asText(args.end),
    minAmount: hasOwn(args, 'minAmount') ? String(args.minAmount) : '',
    maxAmount: hasOwn(args, 'maxAmount') ? String(args.maxAmount) : '',
    page: clampInteger(args.page, 1, 100000, 1),
    pageSize: clampInteger(args.limit, 1, 500, 25),
    sort: {
      key: asText(args.sortKey) || 'date',
      direction: asText(args.sortDirection) === 'asc' ? 'asc' : 'desc'
    }
  });
  const filters = {
    query: asText(args.query),
    type: asText(args.type) || 'all',
    accountId: account.id,
    categoryId: category.id,
    start: asText(args.start),
    end: asText(args.end),
    minAmount: hasOwn(args, 'minAmount') ? Number(args.minAmount) : null,
    maxAmount: hasOwn(args, 'maxAmount') ? Number(args.maxAmount) : null
  };
  const evidenceSourceRefs = view.allRows.map(
    (row) => `transaction:${encodeURIComponent(asText(row.id))}`
  );
  const evidenceSetId = `transaction-search-${asText(environment.toolCallId) || 'result'}`;
  const evidenceSet = {
    id: evidenceSetId,
    label: filters.query ? `${filters.query} transactions` : 'Filtered transaction results',
    kind: 'transaction',
    calculation: {
      operation: 'filtered_transaction_totals',
      totals: clonePlain(view.totals),
      filters: clonePlain(filters),
      transactionCount: evidenceSourceRefs.length,
      recordPreviewCount: view.rows.length,
      recordPreviewOmitted: Math.max(0, evidenceSourceRefs.length - view.rows.length)
    }
  };
  return envelope(environment.toolName, environment.toolCallId, {
    data: {
      transactions: view.rows.map((row) => transactionRow(row, workbook)),
      ...transactionPagination(view),
      totals: view.totals,
      filters,
      evidenceSetId,
      evidenceSets: [evidenceSet]
    },
    referenceData: {
      evidenceSets: [
        {
          id: evidenceSetId,
          kind: 'transaction',
          source_refs: evidenceSourceRefs
        }
      ]
    }
  });
}

export async function listAccounts(environment) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  const balances = getAccountBalances(workbook, { asOfDate: asText(args.asOfDate) });
  const accounts = collection(workbook, 'accounts')
    .filter((account) => args.includeArchived === true || account.isActive !== false)
    .map((account) => {
      const usage = getAccountUsage(workbook, account.id);
      const projection = accountBalanceProjection(account, workbook, balances);
      return {
        id: asText(account.id),
        name: asText(account.name),
        group: asText(account.group),
        subtype: asText(account.subtype),
        currency: projection.currency,
        configuredCurrency: projection.configuredCurrency,
        isActive: account.isActive !== false,
        isSystem: account.isSystem === true,
        balance: projection.balance,
        baseBalance: projection.baseBalance,
        baseCurrency: projection.baseCurrency,
        postingCurrencies: projection.postingCurrencies,
        currencyIntegrityIssue: projection.currencyIntegrityIssue,
        currencyMismatch: projection.currencyMismatch,
        mixedCurrency: projection.mixedCurrency,
        transactionCount: Number(usage.transactionCount) || 0,
        hasReferences: usage.hasReferences === true
      };
    });
  return envelope(environment.toolName, environment.toolCallId, {
    data: { accounts, count: accounts.length, asOfDate: asText(args.asOfDate) }
  });
}

export async function listCategories(environment) {
  const workbook = environment.workbook;
  const categories = collection(workbook, 'categories')
    .filter(
      (category) => environment.arguments.includeHidden === true || category.isActive !== false
    )
    .map((category) => summarizeCategory(category, workbook));
  return envelope(environment.toolName, environment.toolCallId, {
    data: { categories, count: categories.length }
  });
}

export function summarizeBudget(workbook, sheet) {
  const summary = buildBudgetSummary(workbook, sheet);
  return {
    sheet: { id: asText(sheet.id), name: asText(sheet.name), monthIndex: Number(sheet.monthIndex) },
    currency: asText(summary.currency),
    monthKey: asText(summary.monthKey),
    rows: asArray(summary.rows).map((row) => ({
      categoryId: asText(row.categoryId),
      categoryName: asText(row.categoryName),
      categoryType: asText(row.categoryType),
      isMissing: row.isMissing === true,
      planned: Number(row.planned) || 0,
      actual: Number(row.actual) || 0,
      remaining: Number(row.remaining) || 0
    })),
    totals: clonePlain(summary.totals)
  };
}

export async function readBudgets(environment) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  let sheets = collection(workbook, 'sheets');
  if (hasAnyArgument(args, ['sheetId', 'sheet'])) {
    const resolved = resolveArgument(workbook, args, {
      collection: 'sheets',
      keys: ['sheetId', 'sheet'],
      label: 'Budget sheet'
    });
    if (!resolved.ok) return resolutionFailure(environment, resolved);
    sheets = [resolved.value];
  }
  return envelope(environment.toolName, environment.toolCallId, {
    data: { budgets: sheets.map((sheet) => summarizeBudget(workbook, sheet)), count: sheets.length }
  });
}

export const { analyzeRecurringExpenses, listRecurringBills } = createRecurringAnalysisTools({
  currentDate,
  envelope,
  recurringItemsWithLabels
});

export async function listCounterparties(environment) {
  const counterparties = counterpartiesWithUsage(
    environment.workbook,
    environment.arguments.includeArchived === true
  );
  return envelope(environment.toolName, environment.toolCallId, {
    data: { counterparties, count: counterparties.length }
  });
}
