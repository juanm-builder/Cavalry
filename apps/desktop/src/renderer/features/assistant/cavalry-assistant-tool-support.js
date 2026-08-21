import {
  buildBudgetSummary,
  buildIncomeExpenseBreakdown,
  buildRecurringItemRows,
  buildTransactionTableView,
  deleteLedgerTransactionCommand,
  getAccountBalances,
  getAssetLiabilityTotalsAsOf,
  getAccountUsage,
  replaceLedgerTransactionCommand,
  submitManualTransactionCommand
} from '@cavalry/finance-core';

import { ACCOUNT_ACTIONS, executeAccountCommand } from '../accounts/account-controller.js';
import { buildTransactionComposerDraft } from '../transactions/transaction-model.js';
import {
  collection,
  commitCommand,
  confirmationRequired,
  envelope,
  errorItem,
  failure,
  normalizeIssue,
  toolCallParts
} from './cavalry-assistant-command-result-support.js';
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
import {
  cavalryAssistantAccountResolutionError,
  resolveCavalryAssistantTransactionAccount
} from './cavalry-assistant-entity-resolution.js';

export { fuzzyEntitySuggestions } from './cavalry-assistant-entity-matching.js';

export {
  collection,
  commitCommand,
  confirmationRequired,
  envelope,
  errorItem,
  failure,
  normalizeIssue,
  toolCallParts
};

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

export function transactionArguments(workbook, args, base = {}, options = {}) {
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

  const template = asText(payload.template) || 'expense_paid';
  for (const descriptor of [
    {
      output: 'primaryAccountId',
      keys: ['primaryAccountId', 'primaryAccount'],
      label: 'Primary account',
      secondary: false
    },
    {
      output: 'secondaryAccountId',
      keys: ['secondaryAccountId', 'secondaryAccount'],
      label: 'Secondary account',
      secondary: true
    }
  ]) {
    const provided = hasAnyArgument(args, descriptor.keys);
    const reference = provided ? firstArgument(args, descriptor.keys) : '';
    const resolution = resolveCavalryAssistantTransactionAccount(workbook, {
      template,
      secondary: descriptor.secondary,
      reference,
      prompt: asText(options.question),
      assignment: options.assignment === true && provided
    });
    if (resolution.status === 'ambiguous' || resolution.status === 'not_found') {
      return {
        ok: false,
        resolution: cavalryAssistantAccountResolutionError(
          resolution,
          descriptor.keys[0],
          descriptor.label
        )
      };
    }
    if (resolution.status === 'resolved') payload[descriptor.output] = resolution.id;
    else if (provided && !asText(reference)) payload[descriptor.output] = '';
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
  const prepared = transactionArguments(workbook, inferred.arguments, defaults, {
    question: inferred.localQuestion
  });
  if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);
  const result = submitManualTransactionCommand(workbook, prepared.payload, environment.services);
  return commitCommand(environment, result, 'assistant_transaction_created', (next, command) => ({
    transaction: summarizeTransaction(command.transaction, next),
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
  const prepared = transactionArguments(environment.workbook, environment.arguments, defaults, {
    question: asText(environment.context && environment.context.question),
    assignment: true
  });
  if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);
  prepared.payload.transactionId = resolved.id;
  const result = submitManualTransactionCommand(
    environment.workbook,
    prepared.payload,
    environment.services
  );
  return commitCommand(environment, result, 'assistant_transaction_updated', (next, command) => ({
    transaction: summarizeTransaction(command.transaction, next),
    events: safeEventList(command.events)
  }));
}

export async function replaceTransaction(environment) {
  const normalizedOperationKey = (value) => asText(value).replace(/\s+/g, '_').slice(0, 120);
  const toolOperationKey = normalizedOperationKey(environment.toolCallId);
  const argumentOperationKey = normalizedOperationKey(environment.arguments.operationKey);
  const expectedReplacementFingerprint = asText(environment.arguments.proposalFingerprint);
  const expectedTargetFingerprint = asText(environment.arguments.targetFingerprint);
  const canonicalReplay = !!(
    argumentOperationKey &&
    expectedReplacementFingerprint &&
    expectedTargetFingerprint
  );
  if (
    argumentOperationKey &&
    toolOperationKey &&
    argumentOperationKey !== toolOperationKey &&
    !canonicalReplay
  ) {
    return failure(
      environment,
      'validation_failed',
      'transaction_operation_key_conflict',
      'The replacement operation key does not match this tool call.',
      'operationKey'
    );
  }
  if (
    [argumentOperationKey, expectedReplacementFingerprint, expectedTargetFingerprint].some(
      Boolean
    ) &&
    !canonicalReplay
  ) {
    return failure(
      environment,
      'validation_failed',
      'transaction_replacement_proposal_incomplete',
      'The replacement approval is missing part of its canonical proposal contract.',
      'operationKey'
    );
  }
  const operationKey = argumentOperationKey || toolOperationKey;
  const priorOperationPrefix = operationKey ? `advisor:companion:${operationKey}:replace:` : '';
  if (
    priorOperationPrefix &&
    collection(environment.workbook, 'transactions').some((transaction) =>
      asText(transaction?.reference).startsWith(priorOperationPrefix)
    )
  ) {
    const replay = replaceLedgerTransactionCommand(
      environment.workbook,
      asText(firstArgument(environment.arguments, ['transactionId', 'transaction'])),
      asArray(environment.arguments.replacements),
      {
        ...asObject(environment.services),
        operationKey,
        ...(expectedReplacementFingerprint ? { expectedReplacementFingerprint } : {}),
        ...(expectedTargetFingerprint ? { expectedTargetFingerprint } : {})
      }
    );
    return commitCommand(
      environment,
      replay,
      'assistant_transaction_replaced',
      (next, command) => ({
        replacedTransaction: summarizeTransaction(
          command.originalTransaction,
          environment.workbook
        ),
        replacements: asArray(command.createdTransactions).map((transaction) =>
          summarizeTransaction(transaction, next)
        ),
        operationKey: asText(command.operationKey),
        operationReference: asText(command.operationReference),
        fingerprint: asText(command.fingerprint),
        targetFingerprint: asText(command.targetFingerprint),
        receipt: clonePlain(command.receipt),
        idempotent: command.idempotent === true,
        atomic: command.atomic === true,
        events: safeEventList(command.events)
      })
    );
  }
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'transactions',
    keys: ['transactionId', 'transaction'],
    label: 'Transaction',
    names: ['description']
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  const replacements = asArray(environment.arguments.replacements);
  if (!replacements.length) {
    return failure(
      environment,
      'validation_failed',
      'transaction_replacements_required',
      'Provide at least one replacement transaction.',
      'replacements'
    );
  }

  const preparedReplacements = [];
  const inferredFields = [];
  for (const replacement of replacements) {
    const date = currentDate(environment.workbook, environment.services);
    const inferred = inferCavalryAssistantTransactionArguments(
      environment.workbook,
      asObject(replacement),
      {
        currentDate: date,
        question: canonicalReplay ? '' : asText(environment.context && environment.context.question)
      }
    );
    const defaults = buildTransactionComposerDraft(environment.workbook, '', {
      defaultDate: date
    });
    const prepared = transactionArguments(environment.workbook, inferred.arguments, defaults, {
      question: inferred.localQuestion
    });
    if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);
    preparedReplacements.push({
      ...prepared.payload,
      allowDuplicate: environment.arguments.allowDuplicate === true,
      allowCurrencyConversion: environment.arguments.allowCurrencyConversion === true
    });
    inferredFields.push(clonePlain(inferred.inferredFields));
  }

  const result = replaceLedgerTransactionCommand(
    environment.workbook,
    resolved.id,
    preparedReplacements,
    {
      ...asObject(environment.services),
      ...(operationKey ? { operationKey } : {}),
      ...(expectedReplacementFingerprint ? { expectedReplacementFingerprint } : {}),
      ...(expectedTargetFingerprint ? { expectedTargetFingerprint } : {})
    }
  );
  if (!(result && result.ok)) {
    return commitCommand(environment, result, 'assistant_transaction_replaced');
  }
  if (result.confirmationPending === true) {
    return commitCommand(environment, result, 'assistant_transaction_replaced');
  }
  if (result.idempotent !== true && environment.arguments.confirmed !== true) {
    const proposal = {
      operationKey: asText(result.operationKey),
      operationReference: asText(result.operationReference),
      fingerprint: asText(result.fingerprint),
      targetFingerprint: asText(result.targetFingerprint),
      targetTransactionId: resolved.id,
      replacements: clonePlain(preparedReplacements),
      arguments: {
        transactionId: resolved.id,
        replacements: clonePlain(preparedReplacements),
        operationKey: asText(result.operationKey),
        proposalFingerprint: asText(result.fingerprint),
        targetFingerprint: asText(result.targetFingerprint),
        ...(environment.arguments.allowDuplicate === true ? { allowDuplicate: true } : {}),
        ...(environment.arguments.allowCurrencyConversion === true
          ? { allowCurrencyConversion: true }
          : {})
      }
    };
    return confirmationRequired(environment, `atomically replace “${resolved.value.description}”`, {
      proposal,
      warnings: result.warnings,
      data: {
        proposal,
        preview: {
          replacedTransaction: summarizeTransaction(
            result.originalTransaction,
            environment.workbook
          ),
          replacements: asArray(result.createdTransactions).map((transaction) =>
            summarizeTransaction(transaction, result.workbook)
          ),
          atomic: result.atomic === true
        }
      }
    });
  }
  return commitCommand(environment, result, 'assistant_transaction_replaced', (next, command) => ({
    replacedTransaction: summarizeTransaction(command.originalTransaction, environment.workbook),
    replacements: asArray(command.createdTransactions).map((transaction) =>
      summarizeTransaction(transaction, next)
    ),
    inferredFields,
    operationKey: asText(command.operationKey),
    operationReference: asText(command.operationReference),
    fingerprint: asText(command.fingerprint),
    targetFingerprint: asText(command.targetFingerprint),
    receipt: clonePlain(command.receipt),
    idempotent: command.idempotent === true,
    atomic: command.atomic === true,
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
    deletedTransaction: summarizeTransaction(command.transaction, environment.workbook),
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
