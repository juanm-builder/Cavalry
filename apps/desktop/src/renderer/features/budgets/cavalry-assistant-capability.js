import { buildBudgetSummary } from '@cavalry/finance-core';
import { defineCavalryAssistantCapability } from '../assistant/cavalry-assistant-capability-registry.js';
import {
  assistantBooleanProperty,
  assistantNumberProperty,
  assistantStringProperty,
  defineCavalryAssistantTool
} from '../assistant/cavalry-assistant-tool-definitions.js';
import {
  collection,
  commitCommand,
  confirmationRequired,
  currentDate,
  errorItem,
  envelope,
  hasAnyArgument,
  readBudgets,
  resolutionFailure,
  resolveArgument
} from '../assistant/cavalry-assistant-tool-support.js';
import { BUDGET_CATEGORY_TYPES, createBudgetController } from './budget-controller.js';

const CONFIRMATION_COPY =
  'Set confirmed to true only after the user explicitly confirms this destructive action.';
const BUDGET_CATEGORY_TYPE_SET = new Set(BUDGET_CATEGORY_TYPES);
const BUDGET_READ_SCOPE =
  'Monthly category plans only. A missing budget row does not mean a named bill or subscription is absent. Check list_recurring_bills for recurring names and requested schedule dates.';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function budgetReference(workbook, args, options) {
  const keys = options.keys.filter((key) => hasOwn(args, key));
  let resolved;
  for (const key of keys.length ? keys : [options.keys[0]]) {
    const reference = asText(args[key]);
    const idMatches = collection(workbook, options.collection).filter(
      (item) =>
        reference &&
        (key.endsWith('Id')
          ? asText(item.id).toLowerCase() === reference.toLowerCase()
          : asText(item.id) === reference)
    );
    const candidate =
      idMatches.length === 1
        ? { ok: true, value: idMatches[0], id: asText(idMatches[0].id), provided: true }
        : resolveArgument(workbook, args, { ...options, keys: [key] });
    if (!candidate.ok) return candidate;
    if (resolved && resolved.id !== candidate.id) {
      return {
        ok: false,
        status: 'validation_failed',
        error: errorItem(
          'budget_reference_conflict',
          `${options.label} references identify different records. Use one exact ID.`,
          key
        )
      };
    }
    resolved = candidate;
  }
  return resolved;
}

function budgetMonthRange(month) {
  const value = asText(month);
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1000 || year > 9999 || monthNumber < 1 || monthNumber > 12) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    monthIndex: monthNumber - 1,
    monthKey: value,
    start: `${value}-01`,
    end: `${value}-${String(lastDay).padStart(2, '0')}`
  };
}

function sheetMonthKey(workbook, sheet) {
  const direct = asText(sheet && sheet.monthKey);
  if (/^\d{4}-\d{2}$/.test(direct)) return direct;
  const year = Number(workbook && workbook.year);
  const monthIndex = Number(sheet && sheet.monthIndex);
  return Number.isInteger(year) && Number.isInteger(monthIndex)
    ? `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`
    : '';
}

function resolveBudgetPeriod(environment, { allowMissing = false, optional = false } = {}) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  const hasSheet = hasAnyArgument(args, ['sheetId', 'sheet']);
  const hasMonth = hasOwn(args, 'month');
  const range = hasMonth ? budgetMonthRange(args.month) : null;
  if (hasMonth && !range) {
    return {
      ok: false,
      resolution: {
        status: 'validation_failed',
        error: errorItem('budget_month_invalid', 'Use a valid YYYY-MM budget month.', 'month')
      }
    };
  }
  if (hasSheet) {
    const sheet = budgetReference(workbook, args, {
      collection: 'sheets',
      keys: ['sheetId', 'sheet'],
      label: 'Budget sheet'
    });
    if (!sheet.ok) return { ok: false, resolution: sheet };
    if (range && sheetMonthKey(workbook, sheet.value) !== range.monthKey) {
      return {
        ok: false,
        resolution: {
          status: 'validation_failed',
          error: errorItem(
            'budget_period_conflict',
            'The budget sheet and YYYY-MM month must identify the same period.',
            'month'
          )
        }
      };
    }
    return { ok: true, sheet, range };
  }
  if (range) {
    const matches = collection(workbook, 'sheets').filter(
      (sheet) => sheetMonthKey(workbook, sheet) === range.monthKey
    );
    if (matches.length > 1) {
      return {
        ok: false,
        resolution: {
          status: 'ambiguous_reference',
          error: errorItem(
            'budget_period_ambiguous',
            `More than one budget sheet uses ${range.monthKey}. Choose the sheet by ID.`,
            'month'
          )
        }
      };
    }
    if (!matches.length && !allowMissing) {
      return {
        ok: false,
        resolution: {
          status: 'not_found',
          error: errorItem(
            'budget_period_not_found',
            `No budget sheet exists for ${range.monthKey}.`,
            'month'
          )
        }
      };
    }
    const existing = matches[0] || null;
    return {
      ok: true,
      sheet: { ok: true, value: existing, id: asText(existing?.id), provided: true },
      range
    };
  }
  if (optional) return { ok: true, sheet: null, range: null };
  return {
    ok: false,
    resolution: {
      status: 'validation_failed',
      error: errorItem(
        'budget_period_required',
        'Provide a budget sheet or a month in YYYY-MM format.',
        'month'
      )
    }
  };
}

function budgetTargets(environment, { allowMissing = false, requireActive = false } = {}) {
  const period = resolveBudgetPeriod(environment, { allowMissing });
  if (!period.ok) return period;
  const category = budgetReference(environment.workbook, environment.arguments, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category'
  });
  if (!category.ok) return { ok: false, resolution: category };
  if (
    requireActive &&
    (category.value.isActive === false ||
      !BUDGET_CATEGORY_TYPE_SET.has(asText(category.value.type)))
  ) {
    return {
      ok: false,
      resolution: {
        status: 'validation_failed',
        error: errorItem(
          'budget_category_invalid',
          'Budgets require an active income, expense, debt, or savings category.',
          'category'
        )
      }
    };
  }
  return { ...period, category };
}

async function readBudgetPlans(environment) {
  const targets = resolveBudgetPeriod(environment, { allowMissing: true, optional: true });
  if (!targets.ok) return resolutionFailure(environment, targets.resolution);
  if (targets.sheet && !targets.sheet.value) {
    return envelope(environment.toolName, environment.toolCallId, {
      data: { budgets: [], count: 0, month: targets.range.monthKey, scope: BUDGET_READ_SCOPE }
    });
  }
  const result = await readBudgets({
    ...environment,
    workbook: targets.sheet
      ? { ...environment.workbook, sheets: [targets.sheet.value] }
      : environment.workbook,
    arguments: {}
  });
  return { ...result, data: { ...result.data, scope: BUDGET_READ_SCOPE } };
}

function removalState(environment, targets) {
  const sheet = targets.sheet.value;
  return {
    workbookId: asText(environment.workbook.id),
    currency: asText(environment.workbook.currency).toUpperCase(),
    sheetId: targets.sheet.id,
    month: sheetMonthKey(environment.workbook, sheet),
    sheetName: asText(sheet.name),
    categoryId: targets.category.id,
    categoryName: asText(targets.category.value.name),
    categoryType: asText(targets.category.value.type),
    budgets: asArray(sheet.budgets).filter(
      (budget) => asText(budget.categoryId) === targets.category.id
    ),
    manualItems: asArray(sheet.budgetLineItems).filter(
      (item) =>
        asText(item.categoryId) === targets.category.id &&
        item.isActive !== false &&
        !asText(item.recurringItemId)
    )
  };
}

async function setBudget(environment) {
  const operation = asText(environment.arguments.operation).toLowerCase();
  if (!['create', 'update', 'upsert'].includes(operation)) {
    return resolutionFailure(environment, {
      status: 'validation_failed',
      error: errorItem(
        'budget_operation_invalid',
        'Budget operation must be "create", "update", or "upsert".',
        'operation'
      )
    });
  }
  if (asText(environment.arguments.recurrence)) {
    return resolutionFailure(environment, {
      status: 'validation_failed',
      error: errorItem(
        'budget_recurrence_unsupported',
        'Income and category budgets are monthly plans and do not support recurrence.',
        'recurrence'
      )
    });
  }
  const currency = asText(environment.arguments.currency).toUpperCase();
  if (currency && currency !== asText(environment.workbook.currency).toUpperCase()) {
    return resolutionFailure(environment, {
      status: 'validation_failed',
      error: errorItem(
        'budget_currency_mismatch',
        `Budgets are planned in ${asText(environment.workbook.currency).toUpperCase()}. Do not silently treat another currency as the base currency.`,
        'currency'
      )
    });
  }
  const targets = budgetTargets(environment, { allowMissing: true, requireActive: true });
  if (!targets.ok) return resolutionFailure(environment, targets.resolution);
  const controller = createBudgetController(environment.services);
  const existing = asArray(targets.sheet.value && targets.sheet.value.budgets).find(
    (budget) => asText(budget && budget.categoryId) === targets.category.id
  );
  const result = controller.handleAction(
    {
      type: 'save-budget',
      payload: {
        sheetId: targets.sheet.id,
        ...(targets.range ? { rangeStart: targets.range.start, rangeEnd: targets.range.end } : {}),
        categoryId: targets.category.id,
        planned: environment.arguments.planned,
        operation,
        createdAt:
          asText(environment.arguments.createdAt) ||
          asText(existing && existing.createdAt) ||
          currentDate(environment.workbook, environment.services),
        note: hasOwn(environment.arguments, 'note')
          ? asText(environment.arguments.note)
          : asText(existing && existing.note)
      }
    },
    { workbook: environment.workbook }
  );
  return commitCommand(environment, result, 'assistant_budget_saved', (next, command) => {
    const event = asArray(command.events).find((item) => item.type === 'budget/saved');
    const sheetId = asText((event && event.payload && event.payload.sheetId) || targets.sheet.id);
    const resultOperation = asText(event && event.payload && event.payload.operation);
    const savedSheet = collection(next, 'sheets').find(
      (sheet) => asText(sheet && sheet.id) === sheetId
    );
    const saved = asArray(savedSheet && savedSheet.budgets).find(
      (budget) => budget.categoryId === targets.category.id
    );
    const planned = Number(saved && saved.planned) || 0;
    return {
      budget: {
        id: `budget:${sheetId}:${targets.category.id}`,
        sheetId,
        sheetName: asText(savedSheet && savedSheet.name),
        month: sheetMonthKey(next, savedSheet),
        categoryId: targets.category.id,
        categoryName: asText(targets.category.value.name),
        categoryType: asText(targets.category.value.type),
        operation: resultOperation,
        amount: planned,
        planned,
        currency: asText(next && next.currency).toUpperCase(),
        note: asText(saved && saved.note)
      }
    };
  });
}

async function archiveBudget(environment) {
  const targets = budgetTargets(environment);
  if (!targets.ok) return resolutionFailure(environment, targets.resolution);
  const state = removalState(environment, targets);
  if (!state.budgets.length && !state.manualItems.length) {
    return resolutionFailure(environment, {
      status: 'not_found',
      error: errorItem(
        'budget_not_found',
        'No removable category plan exists for this category and month. Recurring commitments must be managed separately.',
        'category'
      )
    });
  }
  const fingerprint = JSON.stringify(state);
  const expectedState = asText(environment.arguments.expectedBudgetState);
  if (environment.arguments.confirmed !== true || !expectedState) {
    const summary = buildBudgetSummary(environment.workbook, targets.sheet.value);
    const planned =
      Number(summary.rows.find((row) => row.categoryId === targets.category.id)?.planned) || 0;
    return confirmationRequired(
      environment,
      `remove the ${targets.category.value.name} plan for ${state.month || state.sheetName}`,
      {
        data: {
          budget: {
            sheetId: targets.sheet.id,
            sheetName: state.sheetName,
            month: state.month,
            categoryId: targets.category.id,
            categoryName: state.categoryName,
            planned,
            currency: asText(environment.workbook.currency).toUpperCase()
          }
        },
        proposal: {
          arguments: {
            sheetId: targets.sheet.id,
            categoryId: targets.category.id,
            expectedBudgetState: fingerprint
          }
        }
      }
    );
  }
  if (expectedState !== fingerprint) {
    return resolutionFailure(environment, {
      status: 'conflict',
      error: errorItem(
        'budget_confirmation_stale',
        'This budget changed after the removal was prepared. Review it and ask for removal again; nothing was removed.',
        'expectedBudgetState'
      )
    });
  }
  const controller = createBudgetController(environment.services);
  const result = controller.handleAction(
    {
      type: 'archive-budget',
      payload: { sheetId: targets.sheet.id, categoryId: targets.category.id }
    },
    { workbook: environment.workbook }
  );
  return commitCommand(environment, result, 'assistant_budget_archived', {
    budget: {
      sheetId: targets.sheet.id,
      id: `budget:${targets.sheet.id}:${targets.category.id}`,
      sheetName: state.sheetName,
      month: state.month,
      categoryId: targets.category.id,
      categoryName: state.categoryName,
      categoryType: asText(targets.category.value.type),
      archived: true
    }
  });
}

export default defineCavalryAssistantCapability({
  id: 'budgets.planning',
  title: 'Budgets and income plans',
  description:
    'Read, create, update, and remove monthly plans for income, expense, debt, and savings categories.',
  version: '2.1.0',
  compatibility: { minimumAppVersion: '2.1.0', workbookSchema: '2' },
  inputValidation: 'structure',
  instructions:
    'For mixed requests, resolve each named item separately: category budgets and recurring bills/subscriptions are different records. read_budgets alone cannot establish that a bill or subscription is absent. If a requested name is not a matching budget category or the user asks for charge dates, check list_recurring_bills with every requested month in monthKeys; clarify any remaining ambiguous name. Keep each result labeled by its actual record type. ' +
    'Income plans are supported. When the user asks for expected salary, allowance, or other income, call set_budget with that income category; do not claim the app only supports expense budgets. A budget is one monthly plan for an existing category, not a named sub-line under another category. If the user requests a separately named line, explain this limitation and ask before creating a new category. Never create a category merely to use it as a budget label. Set operation to create for a new plan, update for an existing plan, or upsert only when the user explicitly asks to set a possibly existing plan. Resolve the user’s requested month from the current date and pass YYYY-MM alone when known; the workbook name is not a budget sheet name. Use sheetId only when it comes from read_budgets, and never guess a sheet from the workbook title. For an unspecified period, ask which month before a write; each action affects only that month, never other months or recurring commitments. Read the target month before modifying an existing plan. Budgets are monthly and do not support recurrence.',
  tools: [
    {
      definition: () =>
        defineCavalryAssistantTool(
          'read_budgets',
          'Read plan-versus-actual data for a sheet or YYYY-MM month, including expected income and planned expenses, debt, and savings. Omit the period only to read all sheets.',
          {
            sheet: assistantStringProperty(
              'Optional sheet ID or exact sheet name, matched case-insensitively.'
            ),
            sheetId: assistantStringProperty(
              'Optional sheet ID or exact sheet name, matched case-insensitively.'
            ),
            month: assistantStringProperty('Optional budget month in YYYY-MM format.')
          }
        ),
      execute: readBudgetPlans,
      access: 'read',
      confirmation: { mode: 'none' }
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'set_budget',
          'Create, update, or upsert a monthly plan for an active income, expense, debt, or savings category. This is also the action for expected-income budgets. A sheet or YYYY-MM month is required. Create refuses an existing direct or legacy plan; update requires an existing direct plan; upsert may update a direct plan but never shadows a legacy plan. Recurrence is unsupported.',
          {
            sheet: assistantStringProperty(
              'Sheet ID or exact sheet name, matched case-insensitively.'
            ),
            sheetId: assistantStringProperty(
              'Sheet ID or exact sheet name, matched case-insensitively.'
            ),
            category: assistantStringProperty(
              'Income, expense, debt, or savings category ID or exact name.'
            ),
            categoryId: assistantStringProperty(
              'Income, expense, debt, or savings category ID or exact name.'
            ),
            planned: assistantNumberProperty(
              'Positive planned amount of at least 0.01 in the workbook base currency.'
            ),
            currency: assistantStringProperty(
              'Optional currency code; must match the workbook base currency. No automatic currency conversion.'
            ),
            operation: assistantStringProperty(
              'Required operation: "create" for a new plan, "update" for an existing plan only, or "upsert" to create or update a direct category plan.'
            ),
            month: assistantStringProperty(
              'Budget month in YYYY-MM format. Use this to create a missing month.'
            ),
            createdAt: assistantStringProperty(
              'Optional budget creation date in YYYY-MM-DD format.'
            ),
            note: assistantStringProperty('Optional plan note.'),
            recurrence: assistantStringProperty(
              'Unsupported for category budgets. Do not set this field; recurring income plans are not available.'
            )
          },
          ['planned', 'operation']
        ),
      execute: setBudget,
      access: 'write',
      entityRequirements: [
        { type: 'category', role: 'budget-category', ambiguity: 'clarify' },
        { type: 'budget-period', role: 'sheet-or-month', ambiguity: 'clarify' }
      ],
      confirmation: { mode: 'none' },
      atomicity: 'single-workbook-commit',
      idempotency: 'stable-category-sheet',
      actionVerb: 'Planned'
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'archive_budget',
          `Remove a category plan from a sheet. Confirmation is required. ${CONFIRMATION_COPY}`,
          {
            sheet: assistantStringProperty(
              'Sheet ID or exact sheet name, matched case-insensitively.'
            ),
            sheetId: assistantStringProperty(
              'Sheet ID or exact sheet name, matched case-insensitively.'
            ),
            category: assistantStringProperty('Category ID or exact name.'),
            categoryId: assistantStringProperty('Category ID or exact name.'),
            month: assistantStringProperty(
              'Required unless sheet is provided. Budget month in YYYY-MM format; only this month is removed.'
            ),
            expectedBudgetState: assistantStringProperty(
              'Host-controlled snapshot of the reviewed removal target. Never invent or change it.'
            ),
            confirmed: assistantBooleanProperty(CONFIRMATION_COPY)
          }
        ),
      execute: archiveBudget,
      access: 'write',
      entityRequirements: [
        { type: 'category', role: 'budget-category', ambiguity: 'clarify' },
        { type: 'budget-period', role: 'sheet', ambiguity: 'clarify' }
      ],
      confirmation: {
        mode: 'always',
        description: 'Removing a category plan requires explicit approval.'
      },
      atomicity: 'single-workbook-commit',
      idempotency: 'stable-category-sheet',
      approvalFields: ['confirmed'],
      hostInputFields: ['expectedBudgetState'],
      actionVerb: 'Removed plan for'
    }
  ]
});
