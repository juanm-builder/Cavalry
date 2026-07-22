import { ACCOUNT_ACTIONS } from '../accounts/account-controller.js';
import { CATEGORY_ACTIONS, executeCategoryCommand } from '../categories/category-controller.js';
import { matchCategoryIcon } from '../categories/category-options.js';
import { createBudgetController } from '../budgets/budget-controller.js';
import { BILLS_ACTIONS, createBillsController } from '../recurring/bills-controller.js';
import { SETTINGS_ACTIONS, createSettingsController } from '../settings/settings-controller.js';

export {
  CAVALRY_ASSISTANT_TOOLS,
  getCavalryAssistantToolDefinitions
} from './cavalry-assistant-tool-definitions.js';
import {
  APP_ROUTES,
  BILL_WRITE_PROPERTIES,
  CATEGORY_CUSTOMIZATION_PROPERTIES,
  TOOL_NAMES,
  asArray,
  asObject,
  asText,
  hasOwn
} from './cavalry-assistant-tool-definitions.js';
import {
  accountStateCommand,
  analyzeRecurringExpenses,
  billFormDefaults,
  collection,
  commitCommand,
  confirmationRequired,
  createAccountTool,
  createTransaction,
  currentDate,
  deleteTransaction,
  envelope,
  errorItem,
  failure,
  hasAnyArgument,
  listAccounts,
  listCategories,
  listCounterparties,
  listRecurringBills,
  mergeKnown,
  readBudgets,
  readWorkspaceContext,
  readWorkspaceSummary,
  resolutionFailure,
  resolveArgument,
  safeEventList,
  summarizeCategory,
  summarizeCounterparty,
  summarizeRecurring,
  searchTransactions,
  toolCallParts,
  updateAccountTool,
  updateTransaction
} from './cavalry-assistant-tool-support.js';
import { payBill } from './cavalry-assistant-pay-bill.js';

async function readPersistedWorkbook(environment, fallbackWorkbook) {
  try {
    const workbook = await environment.context.getWorkbook();
    return workbook && typeof workbook === 'object'
      ? { ok: true, workbook }
      : {
          ok: false,
          workbook: fallbackWorkbook,
          message: 'The updated workbook could not be read back for verification.'
        };
  } catch (error) {
    return {
      ok: false,
      workbook: fallbackWorkbook,
      message:
        asText(error?.message) || 'The updated workbook could not be read back for verification.'
    };
  }
}

function verificationFailure(response, code, message, data) {
  return {
    ...response,
    ok: false,
    status: 'verification_failed',
    data,
    errors: [errorItem(code, message, 'icon')]
  };
}

async function createCategoryTool(environment) {
  const args = environment.arguments;
  const name = asText(args.name);
  const type = asText(args.type) || 'expense';
  const payload = mergeKnown(
    {
      name,
      type,
      postingAccountName: asText(args.postingAccountName || args.name),
      icon: matchCategoryIcon(name, type)
    },
    args,
    Object.keys(CATEGORY_CUSTOMIZATION_PROPERTIES)
  );
  const result = executeCategoryCommand(
    environment.workbook,
    {
      type: CATEGORY_ACTIONS.CREATE,
      payload
    },
    environment.services
  );
  const response = await commitCommand(
    environment,
    result,
    'assistant_category_created',
    (next, command) => {
      const id = asText(
        command.events.find((event) => event.type === 'category.created')?.categoryId
      );
      return {
        category: summarizeCategory(
          collection(next, 'categories').find((item) => item.id === id),
          next
        )
      };
    }
  );
  if (!(response.ok && response.changed)) return response;
  const readBack = await readPersistedWorkbook(environment, result.workbook);
  const categoryId = asText(
    asArray(result.events).find((event) => event.type === 'category.created')?.categoryId
  );
  const category = summarizeCategory(
    collection(readBack.workbook, 'categories').find((item) => asText(item.id) === categoryId),
    readBack.workbook
  );
  const data = { ...response.data, category, requestedIcon: asText(payload.icon) };
  if (!readBack.ok || !category || category.icon !== asText(payload.icon)) {
    return verificationFailure(
      response,
      'category_icon_verification_failed',
      readBack.ok
        ? `Category “${name}” was saved, but its persisted icon is “${category?.icon || '(empty)'}” instead of “${asText(payload.icon)}”.`
        : readBack.message,
      { ...data, iconVerified: false }
    );
  }
  return { ...response, data: { ...data, iconVerified: true } };
}

async function categoryCommand(environment, actionType, reason, options = {}) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  if (options.confirmed && environment.arguments.confirmed !== true) {
    return confirmationRequired(environment, `${options.actionLabel} “${resolved.value.name}”`);
  }
  const payload = {
    categoryId: resolved.id,
    ...(hasOwn(environment.arguments, 'name') ? { name: environment.arguments.name } : {}),
    ...(hasOwn(environment.arguments, 'linkedAccountName')
      ? { linkedAccountName: environment.arguments.linkedAccountName }
      : {}),
    ...Object.fromEntries(
      Object.keys(CATEGORY_CUSTOMIZATION_PROPERTIES)
        .filter((field) => hasOwn(environment.arguments, field))
        .map((field) => [field, environment.arguments[field]])
    )
  };
  const result = executeCategoryCommand(
    environment.workbook,
    { type: actionType, payload },
    environment.services
  );
  const response = await commitCommand(environment, result, reason, (next) => ({
    category: summarizeCategory(
      collection(next, 'categories').find((item) => item.id === resolved.id),
      next
    ),
    events: safeEventList(result.events)
  }));
  const shouldVerifyIcon = hasOwn(environment.arguments, 'icon');
  if (!(response.ok && response.changed && shouldVerifyIcon)) return response;
  const readBack = await readPersistedWorkbook(environment, result.workbook);
  const category = summarizeCategory(
    collection(readBack.workbook, 'categories').find((item) => item.id === resolved.id),
    readBack.workbook
  );
  const requestedIcon = asText(environment.arguments.icon);
  const data = {
    ...response.data,
    category,
    requestedIcon
  };
  if (!readBack.ok || !category || category.icon !== requestedIcon) {
    return verificationFailure(
      response,
      'category_icon_verification_failed',
      readBack.ok
        ? `Category “${asText(resolved.value.name)}” was saved, but its persisted icon is “${
            category?.icon || '(empty)'
          }” instead of “${requestedIcon}”.`
        : readBack.message,
      { ...data, iconVerified: false }
    );
  }
  return {
    ...response,
    data: { ...data, iconVerified: true }
  };
}

async function autoAssignCategoryIcons(environment) {
  const args = environment.arguments;
  const includeHidden = asText(args.scope) === 'all';
  const includeSystem = args.includeSystem !== false;
  const candidates = collection(environment.workbook, 'categories').filter(
    (category) =>
      (includeHidden || category.isActive !== false) &&
      (includeSystem || category.isSystem !== true)
  );
  let workbook = environment.workbook;
  const events = [];
  const requestedUpdates = [];
  for (const sourceCategory of candidates) {
    const category = collection(workbook, 'categories').find(
      (item) => asText(item.id) === asText(sourceCategory.id)
    );
    const icon = matchCategoryIcon(category?.name, category?.type);
    if (category?.icon === icon) continue;
    const result = executeCategoryCommand(
      workbook,
      {
        type: CATEGORY_ACTIONS.UPDATE,
        payload: { categoryId: asText(category?.id), icon }
      },
      environment.services
    );
    if (!result.ok) {
      const cause = asArray(result.errors)[0];
      const categoryName = asText(category?.name) || '(unnamed category)';
      const categoryId = asText(category?.id);
      return envelope(environment.toolName, environment.toolCallId, {
        ok: false,
        status: 'validation_failed',
        errors: [
          errorItem(
            'category_icon_assignment_failed',
            `Could not assign “${icon}” to “${categoryName}”${
              categoryId ? ` (${categoryId})` : ''
            }: ${asText(cause?.message) || 'the category could not be updated.'}`,
            'icon'
          )
        ],
        warnings: result.warnings
      });
    }
    workbook = result.workbook;
    events.push(...asArray(result.events));
    requestedUpdates.push({
      categoryId: asText(category?.id),
      name: asText(category?.name),
      previousIcon: asText(category?.icon),
      requestedIcon: icon
    });
  }
  const buildData = (next) => {
    const updates = requestedUpdates.map((requested) => {
      const persisted = collection(next, 'categories').find(
        (category) => asText(category.id) === requested.categoryId
      );
      const icon = asText(persisted?.icon);
      return {
        ...requested,
        name: asText(persisted?.name) || requested.name,
        icon,
        verified: Boolean(persisted) && icon === requested.requestedIcon
      };
    });
    return {
      scope: includeHidden ? 'all' : 'active',
      updatedCount: updates.length,
      verifiedCount: updates.filter((update) => update.verified).length,
      updates,
      categories: candidates.map((category) =>
        summarizeCategory(
          collection(next, 'categories').find((item) => asText(item.id) === asText(category.id)),
          next
        )
      )
    };
  };
  const response = await commitCommand(
    environment,
    { ok: true, workbook, events, warnings: [], errors: [] },
    'assistant_category_icons_auto_assigned',
    buildData
  );
  if (!(response.ok && response.changed)) return response;
  const readBack = await readPersistedWorkbook(environment, workbook);
  const data = buildData(readBack.workbook);
  const unverified = data.updates.filter((update) => !update.verified);
  if (!readBack.ok || unverified.length) {
    const names = unverified.map((update) => `“${update.name}”`).join(', ');
    return verificationFailure(
      response,
      'category_icon_bulk_verification_failed',
      readBack.ok
        ? `The persisted icon could not be verified for ${names || 'one or more categories'}. Review the returned icon values and retry those categories.`
        : readBack.message,
      data
    );
  }
  return { ...response, data };
}

function budgetTargets(environment) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  let sheet;
  if (hasAnyArgument(args, ['sheetId', 'sheet'])) {
    sheet = resolveArgument(workbook, args, {
      collection: 'sheets',
      keys: ['sheetId', 'sheet'],
      label: 'Budget sheet'
    });
  } else {
    const first = collection(workbook, 'sheets')[0] || null;
    sheet = first
      ? { ok: true, value: first, id: asText(first.id), provided: false }
      : {
          ok: false,
          status: 'validation_failed',
          error: errorItem('budget_sheet_required', 'A budget sheet is required.', 'sheet')
        };
  }
  if (!sheet.ok) return { ok: false, resolution: sheet };
  const category = resolveArgument(workbook, args, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category'
  });
  if (!category.ok) return { ok: false, resolution: category };
  return { ok: true, sheet, category };
}

function budgetMonthRange(workbook, month) {
  const value = asText(month);
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year !== Number(workbook.year) || monthNumber < 1 || monthNumber > 12) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    monthIndex: monthNumber - 1,
    start: `${value}-01`,
    end: `${value}-${String(lastDay).padStart(2, '0')}`
  };
}

function setBudgetTargets(environment) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  const category = resolveArgument(workbook, args, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category'
  });
  if (!category.ok) return { ok: false, resolution: category };
  if (category.value.isActive === false || category.value.type === 'income') {
    return {
      ok: false,
      resolution: {
        status: 'validation_failed',
        error: errorItem(
          'budget_category_invalid',
          'Budgets require an active expense, debt, or savings category.',
          'category'
        )
      }
    };
  }

  if (hasAnyArgument(args, ['sheetId', 'sheet'])) {
    const sheet = resolveArgument(workbook, args, {
      collection: 'sheets',
      keys: ['sheetId', 'sheet'],
      label: 'Budget sheet'
    });
    return sheet.ok ? { ok: true, sheet, category, range: null } : { ok: false, resolution: sheet };
  }

  if (hasOwn(args, 'month')) {
    const range = budgetMonthRange(workbook, args.month);
    if (!range) {
      return {
        ok: false,
        resolution: {
          status: 'validation_failed',
          error: errorItem(
            'budget_month_invalid',
            `Use a YYYY-MM month inside the ${Number(workbook.year) || 'current'} workbook year.`,
            'month'
          )
        }
      };
    }
    const existing = collection(workbook, 'sheets').find(
      (sheet) => Number(sheet.monthIndex) === range.monthIndex
    );
    return {
      ok: true,
      sheet: {
        ok: true,
        value: existing || null,
        id: asText(existing?.id),
        provided: true
      },
      category,
      range
    };
  }

  const first = collection(workbook, 'sheets')[0];
  if (!first) {
    return {
      ok: false,
      resolution: {
        status: 'validation_failed',
        error: errorItem(
          'budget_month_required',
          'Provide a budget month in YYYY-MM format.',
          'month'
        )
      }
    };
  }
  return {
    ok: true,
    sheet: { ok: true, value: first, id: asText(first.id), provided: false },
    category,
    range: null
  };
}

async function setBudget(environment) {
  const targets = setBudgetTargets(environment);
  if (!targets.ok) return resolutionFailure(environment, targets.resolution);
  const controller = createBudgetController(environment.services);
  const existingCreatedAt = asText(
    asArray(targets.sheet.value?.budgets).find(
      (budget) => asText(budget?.categoryId) === targets.category.id
    )?.createdAt
  );
  const result = controller.handleAction(
    {
      type: 'save-budget',
      payload: {
        sheetId: targets.sheet.id,
        ...(targets.range ? { rangeStart: targets.range.start, rangeEnd: targets.range.end } : {}),
        categoryId: targets.category.id,
        planned: environment.arguments.planned,
        createdAt:
          asText(environment.arguments.createdAt) ||
          existingCreatedAt ||
          currentDate(environment.workbook, environment.services)
      }
    },
    { workbook: environment.workbook }
  );
  return commitCommand(environment, result, 'assistant_budget_saved', (next, command) => {
    const event = asArray(command.events).find((item) => item.type === 'budget/saved');
    const sheetId = asText(event?.payload?.sheetId || targets.sheet.id);
    return {
      budget: {
        sheetId,
        categoryId: targets.category.id,
        planned:
          Number(
            collection(next, 'sheets')
              .find((sheet) => sheet.id === sheetId)
              ?.budgets?.find((budget) => budget.categoryId === targets.category.id)?.planned
          ) || 0
      }
    };
  });
}

async function archiveBudget(environment) {
  const targets = budgetTargets(environment);
  if (!targets.ok) return resolutionFailure(environment, targets.resolution);
  if (environment.arguments.confirmed !== true) {
    return confirmationRequired(
      environment,
      `remove the ${targets.category.value.name} budget from ${targets.sheet.value.name || targets.sheet.id}`
    );
  }
  const controller = createBudgetController({
    clock: environment.services.clock,
    currentDate: environment.services.currentDate
  });
  const result = controller.handleAction(
    {
      type: 'archive-budget',
      payload: { sheetId: targets.sheet.id, categoryId: targets.category.id }
    },
    { workbook: environment.workbook }
  );
  return commitCommand(environment, result, 'assistant_budget_archived', {
    budget: { sheetId: targets.sheet.id, categoryId: targets.category.id, archived: true }
  });
}

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

const TOOL_HANDLERS = Object.freeze({
  read_workspace_context: readWorkspaceContext,
  read_workspace_summary: readWorkspaceSummary,
  search_transactions: searchTransactions,
  list_accounts: listAccounts,
  list_categories: listCategories,
  read_budgets: readBudgets,
  list_recurring_bills: listRecurringBills,
  analyze_recurring_expenses: analyzeRecurringExpenses,
  list_counterparties: listCounterparties,
  create_transaction: createTransaction,
  update_transaction: updateTransaction,
  delete_transaction: deleteTransaction,
  create_account: createAccountTool,
  update_account: updateAccountTool,
  archive_account: (environment) =>
    accountStateCommand(
      environment,
      ACCOUNT_ACTIONS.ARCHIVE,
      'assistant_account_archived',
      'archive',
      true
    ),
  restore_account: (environment) =>
    accountStateCommand(
      environment,
      ACCOUNT_ACTIONS.RESTORE,
      'assistant_account_restored',
      'restore',
      false
    ),
  retire_account: (environment) =>
    accountStateCommand(
      environment,
      ACCOUNT_ACTIONS.RETIRE,
      'assistant_account_retired',
      'retire',
      true
    ),
  delete_account: (environment) =>
    accountStateCommand(
      environment,
      ACCOUNT_ACTIONS.DELETE,
      'assistant_account_deleted',
      'delete or archive',
      true
    ),
  create_category: createCategoryTool,
  update_category: (environment) =>
    categoryCommand(environment, CATEGORY_ACTIONS.UPDATE, 'assistant_category_updated'),
  auto_assign_category_icons: autoAssignCategoryIcons,
  rename_category: (environment) =>
    categoryCommand(environment, CATEGORY_ACTIONS.RENAME, 'assistant_category_renamed'),
  update_category_linked_account: (environment) =>
    categoryCommand(environment, CATEGORY_ACTIONS.LINK, 'assistant_category_link_updated'),
  archive_category: (environment) =>
    categoryCommand(environment, CATEGORY_ACTIONS.HIDE, 'assistant_category_archived', {
      confirmed: true,
      actionLabel: 'hide'
    }),
  restore_category: (environment) =>
    categoryCommand(environment, CATEGORY_ACTIONS.RESTORE, 'assistant_category_restored'),
  delete_category: (environment) =>
    categoryCommand(environment, CATEGORY_ACTIONS.DELETE, 'assistant_category_deleted', {
      confirmed: true,
      actionLabel: 'delete'
    }),
  set_budget: setBudget,
  archive_budget: archiveBudget,
  create_bill: createBill,
  update_bill: updateBill,
  pay_bill: payBill,
  archive_bill: archiveBill,
  create_counterparty: createCounterparty,
  archive_counterparty: archiveCounterparty,
  set_exchange_rate: setExchangeRate,
  navigate_app: navigateApp,
  save_workbook: saveWorkbookTool
});

export async function executeCavalryAssistantTool(toolCall, context = {}) {
  const parsed = toolCallParts(toolCall);
  const environment = {
    toolName: parsed.name,
    toolCallId: parsed.toolCallId,
    arguments: parsed.arguments,
    context: asObject(context),
    services: asObject(context.services),
    workbook: null
  };
  if (!parsed.name || !TOOL_NAMES.has(parsed.name) || !TOOL_HANDLERS[parsed.name]) {
    return failure(
      environment,
      'unsupported_tool',
      'unsupported_tool',
      `Cavalry assistant tool “${parsed.name || 'missing'}” is not available.`
    );
  }
  if (parsed.parseError) {
    return failure(environment, 'invalid_arguments', 'invalid_tool_arguments', parsed.parseError);
  }
  if (typeof context.getWorkbook !== 'function') {
    return failure(
      environment,
      'context_error',
      'workbook_reader_unavailable',
      'The assistant workbook reader is unavailable.'
    );
  }
  try {
    environment.workbook = await context.getWorkbook();
  } catch (error) {
    return failure(
      environment,
      'context_error',
      'workbook_read_failed',
      asText(error && error.message) || 'The current workbook could not be read.'
    );
  }
  if (!environment.workbook || typeof environment.workbook !== 'object') {
    return failure(
      environment,
      'workbook_required',
      'workbook_required',
      'Open a workbook before using Cavalry assistant tools.'
    );
  }
  try {
    return await TOOL_HANDLERS[parsed.name](environment);
  } catch (error) {
    return failure(
      environment,
      'tool_failed',
      asText(error && error.code) || 'tool_failed',
      asText(error && error.message) || 'The assistant tool could not be completed.'
    );
  }
}
