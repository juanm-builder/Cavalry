import { ACCOUNT_ACTIONS } from '../accounts/account-controller.js';
import {
  autoAssignCategoryIcons,
  categoryCommand,
  createCategoryTool
} from '../categories/cavalry-assistant-category-actions.js';
import { CATEGORY_ACTIONS } from '../categories/category-controller.js';
import { BILLS_ACTIONS, createBillsController } from '../recurring/bills-controller.js';
import { SETTINGS_ACTIONS, createSettingsController } from '../settings/settings-controller.js';

import { defineCavalryAssistantCapability } from '../assistant/cavalry-assistant-capability-registry.js';
import {
  ACCOUNT_UPDATE_PROPERTIES,
  ACCOUNT_WRITE_PROPERTIES,
  APP_ROUTES,
  BILL_WRITE_PROPERTIES,
  CATEGORY_CUSTOMIZATION_PROPERTIES,
  DATE_RANGE_PROPERTIES,
  asText,
  assistantBooleanProperty,
  assistantNumberProperty,
  assistantStringProperty,
  defineCavalryAssistantTool
} from '../assistant/cavalry-assistant-tool-definitions.js';
import {
  accountStateCommand,
  analyzeRecurringExpenses,
  billFormDefaults,
  collection,
  commitCommand,
  confirmationRequired,
  createAccountTool,
  currentDate,
  envelope,
  failure,
  listAccounts,
  listCategories,
  listCounterparties,
  listRecurringBills,
  mergeKnown,
  readWorkspaceContext,
  readWorkspaceSummary,
  resolutionFailure,
  resolveArgument,
  summarizeCounterparty,
  summarizeRecurring,
  updateAccountTool
} from '../assistant/cavalry-assistant-tool-support.js';
import { payBill } from '../assistant/cavalry-assistant-pay-bill.js';
import { summarizeSpending } from '../assistant/cavalry-assistant-spending-tool.js';

function resolveBillReferences(workbook, args, payload) {
  const category = resolveArgument(workbook, args, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category',
    optional: true,
    allowEmpty: true
  });
  if (!category.ok) return { ok: false, resolution: category };
  if (category.provided) payload.categoryId = category.id;
  const account = resolveArgument(workbook, args, {
    collection: 'accounts',
    keys: ['accountId', 'account'],
    label: 'Payment account',
    optional: true,
    allowEmpty: true
  });
  if (!account.ok) return { ok: false, resolution: account };
  if (account.provided) payload.accountId = account.id;
  return { ok: true, payload };
}

async function createBill(environment) {
  const workbook = environment.workbook;
  const base = {
    kind: 'bill',
    name: '',
    categoryId: '',
    accountId: '',
    amount: 0,
    currency: asText(workbook.currency) || 'PHP',
    frequency: 'Monthly',
    dueDate: currentDate(workbook, environment.services),
    autoRenew: false,
    isActive: true,
    note: ''
  };
  const payload = mergeKnown(base, environment.arguments, Object.keys(BILL_WRITE_PROPERTIES));
  const prepared = resolveBillReferences(workbook, environment.arguments, payload);
  if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);
  const controller = createBillsController(environment.services);
  const result = controller.handleAction(workbook, {
    type: BILLS_ACTIONS.saveRecurring,
    payload: prepared.payload
  });
  return commitCommand(environment, result, 'assistant_bill_created', (next, command) => {
    const event = command.events.find((item) => item.type === 'recurring/item-created');
    const id = asText(event && event.payload && event.payload.recurringItemId);
    return {
      recurringItem: summarizeRecurring(
        collection(next, 'recurringItems').find((item) => item.id === id)
      )
    };
  });
}

async function updateBill(environment) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'recurringItems',
    keys: ['recurringItemId', 'bill'],
    label: 'Bill or subscription'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  if (
    resolved.value.isActive !== false &&
    environment.arguments.isActive === false &&
    environment.arguments.confirmed !== true
  ) {
    return confirmationRequired(environment, `deactivate “${resolved.value.name}”`);
  }
  const payload = mergeKnown(
    billFormDefaults(resolved.value, environment.workbook),
    environment.arguments,
    Object.keys(BILL_WRITE_PROPERTIES)
  );
  const prepared = resolveBillReferences(environment.workbook, environment.arguments, payload);
  if (!prepared.ok) return resolutionFailure(environment, prepared.resolution);
  const controller = createBillsController(environment.services);
  const result = controller.handleAction(environment.workbook, {
    type: BILLS_ACTIONS.saveRecurring,
    payload: prepared.payload
  });
  return commitCommand(environment, result, 'assistant_bill_updated', (next) => ({
    recurringItem: summarizeRecurring(
      collection(next, 'recurringItems').find((item) => item.id === resolved.id)
    )
  }));
}

async function archiveBill(environment) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'recurringItems',
    keys: ['recurringItemId', 'bill'],
    label: 'Bill or subscription'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  if (environment.arguments.confirmed !== true) {
    return confirmationRequired(environment, `archive “${resolved.value.name}”`);
  }
  const controller = createBillsController(environment.services);
  const result = controller.handleAction(environment.workbook, {
    type: BILLS_ACTIONS.archiveRecurring,
    payload: { recurringItemId: resolved.id }
  });
  return commitCommand(environment, result, 'assistant_bill_archived', (next) => ({
    recurringItem: summarizeRecurring(
      collection(next, 'recurringItems').find((item) => item.id === resolved.id)
    )
  }));
}

async function createCounterparty(environment) {
  const controller = createSettingsController({
    createId: environment.services.createId,
    ids: environment.services.ids
  });
  const result = controller.handleAction(environment.workbook, {
    type: SETTINGS_ACTIONS.addCounterparty,
    payload: {
      name: asText(environment.arguments.name),
      kind: asText(environment.arguments.kind) || 'other',
      note: asText(environment.arguments.note)
    }
  });
  return commitCommand(environment, result, 'assistant_counterparty_created', (next, command) => {
    const event = command.events.find((item) => item.type === 'settings/counterparty-created');
    const id = asText(event && event.payload && event.payload.counterpartyId);
    return {
      counterparty: summarizeCounterparty(
        collection(next, 'counterparties').find((item) => item.id === id)
      )
    };
  });
}

async function archiveCounterparty(environment) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'counterparties',
    keys: ['counterpartyId', 'counterparty'],
    label: 'Counterparty'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  if (environment.arguments.confirmed !== true) {
    return confirmationRequired(environment, `archive “${resolved.value.name}”`);
  }
  const controller = createSettingsController({
    createId: environment.services.createId,
    ids: environment.services.ids
  });
  const result = controller.handleAction(environment.workbook, {
    type: SETTINGS_ACTIONS.archiveCounterparty,
    payload: { counterpartyId: resolved.id }
  });
  return commitCommand(environment, result, 'assistant_counterparty_archived', (next) => ({
    counterparty: summarizeCounterparty(
      collection(next, 'counterparties').find((item) => item.id === resolved.id)
    )
  }));
}

async function setExchangeRate(environment) {
  const controller = createSettingsController({
    createId: environment.services.createId,
    ids: environment.services.ids
  });
  const result = controller.handleAction(environment.workbook, {
    type: SETTINGS_ACTIONS.updateRate,
    payload: { usdRate: environment.arguments.usdRate }
  });
  return commitCommand(environment, result, 'assistant_exchange_rate_updated', (next) => ({
    exchangeRate: { usdToBaseRate: Number(next.settings && next.settings.usdToBaseRate) || 0 }
  }));
}

async function navigateApp(environment) {
  const routeId = asText(environment.arguments.routeId);
  if (!APP_ROUTES.includes(routeId)) {
    return failure(
      environment,
      'validation_failed',
      'route_invalid',
      `Cavalry route “${routeId}” is not available.`,
      'routeId'
    );
  }
  if (typeof environment.context.navigate !== 'function') {
    return failure(
      environment,
      'context_error',
      'navigation_unavailable',
      'The assistant navigation adapter is unavailable.'
    );
  }
  await environment.context.navigate(routeId);
  return envelope(environment.toolName, environment.toolCallId, {
    data: { routeId }
  });
}

async function saveWorkbookTool(environment) {
  if (typeof environment.context.saveWorkbook !== 'function') {
    return failure(
      environment,
      'context_error',
      'save_unavailable',
      'The assistant save adapter is unavailable.'
    );
  }
  try {
    const result = await environment.context.saveWorkbook(environment.workbook);
    if (result && result.ok === false) {
      return failure(
        environment,
        'save_failed',
        'save_failed',
        asText(result.error) || 'The workbook could not be saved.'
      );
    }
    return envelope(environment.toolName, environment.toolCallId, {
      data: {
        saved: true,
        savedAt: asText(result && result.savedAt),
        cached: result && result.cached === true
      }
    });
  } catch (error) {
    return failure(
      environment,
      'save_failed',
      'save_failed',
      asText(error && error.message) || 'The workbook could not be saved.'
    );
  }
}

const HOST_CONFIRMATION_PROPERTY = assistantBooleanProperty(
  'Host-controlled approval flag. Cavalry supplies it only after explicit user confirmation.'
);

function coreTool(name, description, properties, required, execute, metadata = {}) {
  return Object.freeze({
    definition: () =>
      defineCavalryAssistantTool(name, description, properties || {}, required || []),
    execute,
    access: metadata.access || 'write',
    actionVerb: metadata.actionVerb || '',
    approvalFields: metadata.approvalFields || [],
    confirmation: metadata.confirmation || { mode: 'none' },
    entityRequirements: metadata.entityRequirements || [],
    requiresWorkbook: metadata.requiresWorkbook,
    atomicity: metadata.atomicity,
    idempotency: metadata.idempotency
  });
}

export default defineCavalryAssistantCapability({
  id: 'cavalry.core',
  title: 'Cavalry workspace',
  description:
    'Read and safely operate the core Cavalry workspace, accounts, categories, recurring items, and settings features.',
  version: '2.1.0',
  compatibility: { minimumAppVersion: '2.1.0', workbookSchema: '2' },
  inputValidation: 'structure',
  instructions:
    'Use stable IDs when available. Names must resolve to exactly one active compatible entity; ask one focused question when a name is ambiguous. Completion claims must follow the returned application receipt.',
  tools: [
    coreTool(
      'read_workspace_context',
      'Read a safe, complete Cavalry workspace manifest plus a paginated transaction slice. Use subsequent pages until hasMore is false when the user asks about every transaction.',
      {
        includeArchived: assistantBooleanProperty(
          'Include hidden categories and inactive accounts, bills, and counterparties.'
        ),
        transactionPage: assistantNumberProperty('Transaction page number, starting at 1.'),
        transactionLimit: assistantNumberProperty('Transactions per page, from 1 to 500.'),
        transactionSortDirection: assistantStringProperty('Transaction date order.', {
          enum: ['asc', 'desc']
        })
      },
      [],
      readWorkspaceContext,
      { access: 'read' }
    ),
    coreTool(
      'read_workspace_summary',
      'Read workbook counts, cash-flow totals, and asset/liability/net-worth totals valued in the workbook base currency.',
      DATE_RANGE_PROPERTIES,
      [],
      readWorkspaceSummary,
      { access: 'read' }
    ),
    coreTool(
      'summarize_spending',
      'Aggregate the full filtered transaction set into base-currency totals grouped by category, counterparty, account, or month, with counts, shares, and a citable evidence set.',
      {
        groupBy: assistantStringProperty('How to group the aggregation.', {
          enum: ['category', 'counterparty', 'account', 'month']
        }),
        type: assistantStringProperty('Transaction flow filter. Defaults to expense.', {
          enum: ['all', 'income', 'expense', 'refund', 'transfer', 'opening', 'other']
        }),
        account: assistantStringProperty('Optional account ID or exact name filter.'),
        accountId: assistantStringProperty('Optional account ID or exact name filter.'),
        category: assistantStringProperty('Optional category ID or exact name filter.'),
        categoryId: assistantStringProperty('Optional category ID or exact name filter.'),
        ...DATE_RANGE_PROPERTIES,
        limit: assistantNumberProperty('Maximum number of groups to return, from 1 to 50.')
      },
      ['groupBy'],
      summarizeSpending,
      { access: 'read' }
    ),
    coreTool(
      'list_accounts',
      'List accounts with native balance/currency, baseBalance/baseCurrency valuation, status, and usage counts.',
      {
        includeArchived: assistantBooleanProperty('Include archived accounts.'),
        asOfDate: assistantStringProperty('Optional balance date in YYYY-MM-DD format.')
      },
      [],
      listAccounts,
      { access: 'read' }
    ),
    coreTool(
      'list_categories',
      'List categories, linked accounts, status, and usage counts.',
      { includeHidden: assistantBooleanProperty('Include hidden categories.') },
      [],
      listCategories,
      { access: 'read' }
    ),
    coreTool(
      'list_recurring_bills',
      'List bills and subscriptions with linked category/account details.',
      { includeArchived: assistantBooleanProperty('Include inactive recurring items.') },
      [],
      listRecurringBills,
      { access: 'read' }
    ),
    coreTool(
      'analyze_recurring_expenses',
      'Analyze tracked recurring items and dated expense patterns without changing the workbook. Tracker status remains separate from recent or stale charge evidence.',
      {
        includeIgnored: assistantBooleanProperty(
          'Include candidates the user previously marked ignored or not a subscription.'
        )
      },
      [],
      analyzeRecurringExpenses,
      { access: 'read' }
    ),
    coreTool(
      'list_counterparties',
      'List counterparties with status and usage counts.',
      { includeArchived: assistantBooleanProperty('Include inactive counterparties.') },
      [],
      listCounterparties,
      { access: 'read' }
    ),
    coreTool(
      'create_account',
      'Create a validated account and, when supplied, its opening-balance transaction.',
      ACCOUNT_WRITE_PROPERTIES,
      ['name'],
      createAccountTool,
      { actionVerb: 'Created', entityRequirements: [{ type: 'account', role: 'new' }] }
    ),
    coreTool(
      'update_account',
      'Partially update an account, preserving fields not supplied.',
      {
        account: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        accountId: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        ...ACCOUNT_UPDATE_PROPERTIES
      },
      [],
      updateAccountTool,
      {
        actionVerb: 'Updated',
        entityRequirements: [{ type: 'account', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'archive_account',
      'Archive an account. Confirmation is required.',
      {
        account: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        accountId: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      (environment) =>
        accountStateCommand(
          environment,
          ACCOUNT_ACTIONS.ARCHIVE,
          'assistant_account_archived',
          'archive',
          true
        ),
      {
        actionVerb: 'Archived',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'always' },
        entityRequirements: [{ type: 'account', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'restore_account',
      'Restore an archived account.',
      {
        account: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        accountId: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        )
      },
      [],
      (environment) =>
        accountStateCommand(
          environment,
          ACCOUNT_ACTIONS.RESTORE,
          'assistant_account_restored',
          'restore',
          false
        ),
      {
        actionVerb: 'Restored',
        entityRequirements: [{ type: 'account', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'retire_account',
      'Retire a liability account. Confirmation is required.',
      {
        account: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        accountId: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      (environment) =>
        accountStateCommand(
          environment,
          ACCOUNT_ACTIONS.RETIRE,
          'assistant_account_retired',
          'retire',
          true
        ),
      {
        actionVerb: 'Retired',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'always' },
        entityRequirements: [{ type: 'account', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'delete_account',
      'Delete an unused account or archive a referenced one. Confirmation is required.',
      {
        account: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        accountId: assistantStringProperty(
          'Account ID or exact account name, matched case-insensitively.'
        ),
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      (environment) =>
        accountStateCommand(
          environment,
          ACCOUNT_ACTIONS.DELETE,
          'assistant_account_deleted',
          'delete or archive',
          true
        ),
      {
        actionVerb: 'Deleted',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'always' },
        entityRequirements: [{ type: 'account', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'create_category',
      'Create a category and its linked posting account.',
      {
        name: assistantStringProperty('Category name.'),
        type: assistantStringProperty('Category type.', {
          enum: ['expense', 'income', 'debt', 'savings']
        }),
        postingAccountName: assistantStringProperty('Optional linked posting-account name.'),
        ...CATEGORY_CUSTOMIZATION_PROPERTIES
      },
      ['name'],
      createCategoryTool,
      { actionVerb: 'Created', entityRequirements: [{ type: 'category', role: 'new' }] }
    ),
    coreTool(
      'update_category',
      'Update one category. For a general semantic icon request, use auto_assign_category_icons instead of guessing an icon.',
      {
        category: assistantStringProperty('Category ID or exact name, matched case-insensitively.'),
        categoryId: assistantStringProperty(
          'Category ID or exact name, matched case-insensitively.'
        ),
        ...CATEGORY_CUSTOMIZATION_PROPERTIES
      },
      [],
      (environment) =>
        categoryCommand(environment, CATEGORY_ACTIONS.UPDATE, 'assistant_category_updated'),
      {
        actionVerb: 'Updated',
        entityRequirements: [{ type: 'category', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'auto_assign_category_icons',
      'Atomically fix semantic icon mismatches by category name and type. Existing custom icons are replaced.',
      {
        scope: assistantStringProperty(
          'Whether to update active categories only or every category.',
          {
            enum: ['active', 'all']
          }
        ),
        includeSystem: assistantBooleanProperty(
          'Whether appearance-only updates may include system categories. Defaults to true.'
        )
      },
      [],
      autoAssignCategoryIcons,
      { actionVerb: 'Updated' }
    ),
    coreTool(
      'rename_category',
      'Rename a category.',
      {
        category: assistantStringProperty('Category ID or exact name, matched case-insensitively.'),
        categoryId: assistantStringProperty(
          'Category ID or exact name, matched case-insensitively.'
        ),
        name: assistantStringProperty('New category name.')
      },
      [],
      (environment) =>
        categoryCommand(environment, CATEGORY_ACTIONS.RENAME, 'assistant_category_renamed'),
      {
        actionVerb: 'Renamed',
        entityRequirements: [{ type: 'category', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'update_category_linked_account',
      'Rename or create the category linked posting account.',
      {
        category: assistantStringProperty('Category ID or exact name, matched case-insensitively.'),
        categoryId: assistantStringProperty(
          'Category ID or exact name, matched case-insensitively.'
        ),
        linkedAccountName: assistantStringProperty('Linked posting-account name.')
      },
      [],
      (environment) =>
        categoryCommand(environment, CATEGORY_ACTIONS.LINK, 'assistant_category_link_updated'),
      {
        actionVerb: 'Updated',
        entityRequirements: [{ type: 'category', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'archive_category',
      'Hide a category from new entries. Confirmation is required.',
      {
        category: assistantStringProperty('Category ID or exact name, matched case-insensitively.'),
        categoryId: assistantStringProperty(
          'Category ID or exact name, matched case-insensitively.'
        ),
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      (environment) =>
        categoryCommand(environment, CATEGORY_ACTIONS.HIDE, 'assistant_category_archived', {
          confirmed: true,
          actionLabel: 'hide'
        }),
      {
        actionVerb: 'Archived',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'always' },
        entityRequirements: [{ type: 'category', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'restore_category',
      'Restore a hidden category.',
      {
        category: assistantStringProperty('Category ID or exact name, matched case-insensitively.'),
        categoryId: assistantStringProperty(
          'Category ID or exact name, matched case-insensitively.'
        )
      },
      [],
      (environment) =>
        categoryCommand(environment, CATEGORY_ACTIONS.RESTORE, 'assistant_category_restored'),
      {
        actionVerb: 'Restored',
        entityRequirements: [{ type: 'category', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'delete_category',
      'Delete an unreferenced category. Confirmation is required.',
      {
        category: assistantStringProperty('Category ID or exact name, matched case-insensitively.'),
        categoryId: assistantStringProperty(
          'Category ID or exact name, matched case-insensitively.'
        ),
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      (environment) =>
        categoryCommand(environment, CATEGORY_ACTIONS.DELETE, 'assistant_category_deleted', {
          confirmed: true,
          actionLabel: 'delete'
        }),
      {
        actionVerb: 'Deleted',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'always' },
        entityRequirements: [{ type: 'category', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'create_bill',
      'Create a validated bill or subscription tracker. An active expense category is required.',
      BILL_WRITE_PROPERTIES,
      ['name', 'category', 'dueDate'],
      createBill,
      {
        actionVerb: 'Created',
        entityRequirements: [
          { type: 'category', role: 'expense', ambiguity: 'clarify' },
          { type: 'account', role: 'payment', required: false, ambiguity: 'clarify' }
        ]
      }
    ),
    coreTool(
      'update_bill',
      'Partially update a bill or subscription, preserving fields not supplied. Deactivation requires confirmation.',
      {
        bill: assistantStringProperty(
          'Recurring item ID or exact name, matched case-insensitively.'
        ),
        recurringItemId: assistantStringProperty(
          'Recurring item ID or exact name, matched case-insensitively.'
        ),
        ...BILL_WRITE_PROPERTIES,
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      updateBill,
      {
        actionVerb: 'Updated',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'conditional' },
        entityRequirements: [{ type: 'recurring_item', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'pay_bill',
      'Record a bill or subscription payment as a validated linked Cavalry transaction. This records ledger activity; it does not send money.',
      {
        bill: assistantStringProperty(
          'Recurring item ID or exact name, matched case-insensitively.'
        ),
        recurringItemId: assistantStringProperty(
          'Recurring item ID or exact name, matched case-insensitively.'
        ),
        date: assistantStringProperty('Payment posting date in YYYY-MM-DD format.'),
        amount: assistantNumberProperty('Optional positive amount.'),
        currency: assistantStringProperty('Optional ISO currency code.'),
        account: assistantStringProperty('Optional payment account ID or exact name.'),
        accountId: assistantStringProperty('Optional payment account ID or exact name.'),
        category: assistantStringProperty('Optional expense category ID or exact name.'),
        categoryId: assistantStringProperty('Optional expense category ID or exact name.'),
        description: assistantStringProperty('Optional transaction description.'),
        note: assistantStringProperty('Optional transaction note.'),
        fxRateToBase: assistantNumberProperty('Optional exchange rate to the workbook base.'),
        allowDuplicate: HOST_CONFIRMATION_PROPERTY
      },
      [],
      payBill,
      {
        actionVerb: 'Recorded payment for',
        approvalFields: ['allowDuplicate'],
        confirmation: { mode: 'conditional' },
        entityRequirements: [
          { type: 'recurring_item', role: 'target', ambiguity: 'clarify' },
          { type: 'account', role: 'payment', required: false, ambiguity: 'clarify' }
        ],
        idempotency: 'ledger-match-or-confirmation'
      }
    ),
    coreTool(
      'archive_bill',
      'Archive a bill or subscription. Confirmation is required.',
      {
        bill: assistantStringProperty(
          'Recurring item ID or exact name, matched case-insensitively.'
        ),
        recurringItemId: assistantStringProperty(
          'Recurring item ID or exact name, matched case-insensitively.'
        ),
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      archiveBill,
      {
        actionVerb: 'Archived',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'always' },
        entityRequirements: [{ type: 'recurring_item', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'create_counterparty',
      'Create a person, merchant, biller, employer, family member, or client.',
      {
        name: assistantStringProperty('Counterparty name.'),
        kind: assistantStringProperty('Counterparty kind.', {
          enum: ['employer', 'family', 'client', 'merchant', 'biller', 'other']
        }),
        note: assistantStringProperty('Optional counterparty note.')
      },
      ['name'],
      createCounterparty,
      { actionVerb: 'Created', entityRequirements: [{ type: 'counterparty', role: 'new' }] }
    ),
    coreTool(
      'archive_counterparty',
      'Archive a counterparty. Confirmation is required.',
      {
        counterparty: assistantStringProperty(
          'Counterparty ID or exact name, matched case-insensitively.'
        ),
        counterpartyId: assistantStringProperty(
          'Counterparty ID or exact name, matched case-insensitively.'
        ),
        confirmed: HOST_CONFIRMATION_PROPERTY
      },
      [],
      archiveCounterparty,
      {
        actionVerb: 'Archived',
        approvalFields: ['confirmed'],
        confirmation: { mode: 'always' },
        entityRequirements: [{ type: 'counterparty', role: 'target', ambiguity: 'clarify' }]
      }
    ),
    coreTool(
      'set_exchange_rate',
      'Set the workbook USD-to-base conversion rate.',
      { usdRate: assistantNumberProperty('Positive USD-to-base conversion rate.') },
      ['usdRate'],
      setExchangeRate,
      { actionVerb: 'Updated' }
    ),
    coreTool(
      'navigate_app',
      'Navigate Cavalry to a page without changing workbook data.',
      { routeId: assistantStringProperty('Destination route.', { enum: APP_ROUTES }) },
      ['routeId'],
      navigateApp,
      {
        actionVerb: 'Opened',
        requiresWorkbook: false,
        atomicity: 'navigation',
        idempotency: 'route'
      }
    ),
    coreTool('save_workbook', 'Save the freshest workbook state now.', {}, [], saveWorkbookTool, {
      actionVerb: 'Saved',
      idempotency: 'workbook-state'
    })
  ]
});
