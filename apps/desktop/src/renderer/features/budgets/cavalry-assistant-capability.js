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
  hasAnyArgument,
  readBudgets,
  resolutionFailure,
  resolveArgument
} from '../assistant/cavalry-assistant-tool-support.js';
import { BUDGET_CATEGORY_TYPES, createBudgetController } from './budget-controller.js';

const CONFIRMATION_COPY =
  'Set confirmed to true only after the user explicitly confirms this destructive action.';
const BUDGET_CATEGORY_TYPE_SET = new Set(BUDGET_CATEGORY_TYPES);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
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

function setBudgetTargets(environment) {
  const workbook = environment.workbook;
  const args = environment.arguments;
  const hasSheet = hasAnyArgument(args, ['sheetId', 'sheet']);
  const hasMonth = hasOwn(args, 'month');
  const category = resolveArgument(workbook, args, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category'
  });
  if (!category.ok) return { ok: false, resolution: category };
  if (
    category.value.isActive === false ||
    !BUDGET_CATEGORY_TYPE_SET.has(asText(category.value.type))
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
    const sheet = resolveArgument(workbook, args, {
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
    return { ok: true, sheet, category, range };
  }

  if (range) {
    const existing = collection(workbook, 'sheets').find(
      (sheet) => sheetMonthKey(workbook, sheet) === range.monthKey
    );
    return {
      ok: true,
      sheet: {
        ok: true,
        value: existing || null,
        id: asText(existing && existing.id),
        provided: true
      },
      category,
      range
    };
  }

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

async function setBudget(environment) {
  const operation = asText(environment.arguments.operation).toLowerCase();
  if (!['create', 'upsert'].includes(operation)) {
    return resolutionFailure(environment, {
      status: 'validation_failed',
      error: errorItem(
        'budget_operation_invalid',
        'Budget operation must be either "create" or "upsert".',
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
  const targets = setBudgetTargets(environment);
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
  if (environment.arguments.confirmed !== true) {
    return confirmationRequired(
      environment,
      `remove the ${targets.category.value.name} budget from ${targets.sheet.value.name || targets.sheet.id}`
    );
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
      categoryId: targets.category.id,
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
    'Income plans are supported. When the user asks for expected salary, allowance, or other income, call set_budget with that income category; do not claim the app only supports expense budgets. Set operation to create for a new plan or upsert only when the user explicitly asks to set or update a possibly existing plan. Budgets are monthly and do not support recurrence.',
  tools: [
    {
      definition: () =>
        defineCavalryAssistantTool(
          'read_budgets',
          'Read plan-versus-actual data, including expected income and planned expenses, debt, and savings.',
          {
            sheet: assistantStringProperty(
              'Optional sheet ID or exact sheet name, matched case-insensitively.'
            ),
            sheetId: assistantStringProperty(
              'Optional sheet ID or exact sheet name, matched case-insensitively.'
            )
          }
        ),
      execute: readBudgets,
      access: 'read',
      confirmation: { mode: 'none' }
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'set_budget',
          'Create or upsert a monthly plan for an active income, expense, debt, or savings category. This is also the action for expected-income budgets. A sheet or YYYY-MM month is required. Create refuses an existing direct or legacy plan; upsert may update a direct plan but never shadows a legacy plan. Recurrence is unsupported.',
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
            planned: assistantNumberProperty('Positive planned amount.'),
            operation: assistantStringProperty(
              'Required operation: "create" for a new plan, or "upsert" to create or update a direct category plan.'
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
      actionVerb: 'Removed plan for'
    }
  ]
});
