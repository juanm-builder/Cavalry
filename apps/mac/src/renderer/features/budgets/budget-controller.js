import {
  archiveBudget as archiveCoreBudget,
  buildDashboardCategoryDrilldownViewModel,
  buildDashboardFlowDrilldownViewModel,
  createBudget as createCoreBudget,
  editBudget as editCoreBudget
} from '@cavalry/finance-core';
import { buildBudgetRouteModel } from './budget-route-model.js';

export const BUDGET_EVENT_TYPES = Object.freeze({
  navigate: 'route/navigate',
  categoryDrilldown: 'dashboard/category-drilldown-requested',
  flowDrilldown: 'dashboard/flow-drilldown-requested',
  transactionDetail: 'budget/transaction-detail-requested',
  addBudget: 'budget/add-requested',
  budgetSaved: 'budget/saved',
  budgetArchived: 'budget/archived',
  viewStateChange: 'budget/view-state-change-requested',
  closeEditor: 'overlay/close-requested',
  scheduleSave: 'workbook/save-requested'
});

const FLOW_TYPES = new Set(['inflow', 'income', 'expense', 'outflow', 'debt', 'savings', 'both']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneWorkbook(workbook) {
  if (typeof structuredClone === 'function') return structuredClone(workbook);
  return cloneSerializable(workbook);
}

function success(event) {
  return cloneSerializable({
    ok: true,
    handled: true,
    events: [event],
    warnings: [],
    errors: []
  });
}

function failure(code, message, handled = true) {
  return {
    ok: false,
    handled,
    events: [],
    warnings: [],
    errors: [{ code, message }]
  };
}

function findById(items, id) {
  return asArray(items).find((item) => asString(item && item.id) === id) || null;
}

function resolveRange(payload, fallbackRange) {
  const source = asObject(payload);
  const rawStart = asString(source.rangeStart || source.start || source.startDate);
  const rawEnd = asString(source.rangeEnd || source.end || source.endDate);
  if (!rawStart && !rawEnd) {
    return {
      ok: true,
      range: { start: fallbackRange.start, end: fallbackRange.end }
    };
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(rawStart) || !datePattern.test(rawEnd) || rawStart > rawEnd) {
    return {
      ok: false,
      error: failure(
        'budget.action.invalid-range',
        'Budget drilldown actions require a complete ISO date range.'
      )
    };
  }
  return { ok: true, range: { start: rawStart, end: rawEnd } };
}

function getRouteModel(buildModel, context) {
  const source = asObject(context);
  return buildModel(source.workbook, source.viewState || {});
}

function handleNavigation(payload) {
  const routeId = asString(payload.routeId);
  if (!routeId) {
    return failure('budget.navigation.route-required', 'Navigation requires a routeId.');
  }
  return success({
    type: BUDGET_EVENT_TYPES.navigate,
    payload: { routeId }
  });
}

function handleCategoryDrilldown(payload, context, buildModel) {
  const categoryId = asString(payload.categoryId);
  if (!categoryId) {
    return failure('budget.category.id-required', 'Category drilldown requires a categoryId.');
  }
  const routeModel = getRouteModel(buildModel, context);
  const rangeResult = resolveRange(payload, routeModel.range);
  if (!rangeResult.ok) {
    return rangeResult.error;
  }
  const model = buildDashboardCategoryDrilldownViewModel(context.workbook, {
    categoryId,
    rangeStart: rangeResult.range.start,
    rangeEnd: rangeResult.range.end
  });
  if (!model.isKnownCategory) {
    return failure('budget.category.not-found', `Category "${categoryId}" was not found.`);
  }
  return success({
    type: BUDGET_EVENT_TYPES.categoryDrilldown,
    payload: {
      categoryId,
      rangeStart: rangeResult.range.start,
      rangeEnd: rangeResult.range.end,
      model
    }
  });
}

function handleFlowDrilldown(payload, context, buildModel) {
  const flowType = asString(payload.flowType || payload.type || 'expense');
  if (!FLOW_TYPES.has(flowType)) {
    return failure('budget.flow.invalid-type', `Unsupported budget flow type "${flowType}".`);
  }
  const routeModel = getRouteModel(buildModel, context);
  const rangeResult = resolveRange(payload, routeModel.range);
  if (!rangeResult.ok) {
    return rangeResult.error;
  }
  const model = buildDashboardFlowDrilldownViewModel(context.workbook, {
    flowType,
    rangeStart: rangeResult.range.start,
    rangeEnd: rangeResult.range.end,
    defaultRange: routeModel.range
  });
  return success({
    type: BUDGET_EVENT_TYPES.flowDrilldown,
    payload: {
      flowType,
      rangeStart: model.range.start,
      rangeEnd: model.range.end,
      model
    }
  });
}

function handleTransactionDetail(payload, context) {
  const transactionId = asString(payload.transactionId);
  if (!transactionId) {
    return failure('budget.transaction.id-required', 'Choose a transaction to inspect.');
  }
  if (!findById(context.workbook && context.workbook.transactions, transactionId)) {
    return failure('budget.transaction.not-found', `Transaction "${transactionId}" was not found.`);
  }
  return success({
    type: BUDGET_EVENT_TYPES.transactionDetail,
    payload: { transactionId }
  });
}

function handleAddBudget(payload, context, buildModel) {
  const routeModel = getRouteModel(buildModel, context);
  if (!asArray(routeModel.categoryOptions).length) {
    return failure(
      'budget.add.category-required',
      'Create an expense category before adding a budget.'
    );
  }
  const sheetId = asString(payload.sheetId || (routeModel.sheet && routeModel.sheet.id));
  const sheet = sheetId ? findById(context.workbook && context.workbook.sheets, sheetId) : null;
  if (sheetId && !sheet) {
    return failure('budget.add.sheet-not-found', `Budget sheet "${sheetId}" was not found.`);
  }
  const existingBudget = asArray(sheet && sheet.budgets).find(
    (budget) => asString(budget && budget.categoryId) === asString(payload.categoryId)
  );
  return success({
    type: BUDGET_EVENT_TYPES.addBudget,
    payload: {
      sheetId: sheet ? sheetId : '',
      rangeStart: routeModel.range.start,
      rangeEnd: routeModel.range.end,
      categoryId: asString(payload.categoryId),
      planned: Number(payload.planned) || '',
      createdAt: asString(existingBudget && existingBudget.createdAt) || routeModel.currentDate,
      currentDate: routeModel.currentDate,
      sheet: sheet ? cloneSerializable(sheet) : null
    }
  });
}

function handleViewStateChange(payload) {
  const rangeStart = asString(payload.rangeStart || payload.start);
  const rangeEnd = asString(payload.rangeEnd || payload.end);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(rangeStart) || !datePattern.test(rangeEnd) || rangeStart > rangeEnd) {
    return failure('budget.range.invalid', 'Budget periods require a complete date range.');
  }
  return success({
    type: BUDGET_EVENT_TYPES.viewStateChange,
    payload: { range: { start: rangeStart, end: rangeEnd } }
  });
}

function mutationSuccess(workbook, event) {
  return {
    ok: true,
    handled: true,
    workbook,
    events: [
      event,
      { type: BUDGET_EVENT_TYPES.closeEditor, payload: { id: 'budget-editor' } },
      { type: BUDGET_EVENT_TYPES.scheduleSave, payload: { reason: 'budget_changed' } }
    ],
    warnings: [],
    errors: []
  };
}

function handleSaveBudget(payload, context, dependencies = {}) {
  if (!(context.workbook && typeof context.workbook === 'object')) {
    return failure(
      'budget.save.workbook-required',
      'Saving a budget requires a hydrated workbook.'
    );
  }
  const sheetId = asString(payload.sheetId);
  const rangeStart = asString(payload.rangeStart);
  const rangeEnd = asString(payload.rangeEnd);
  const categoryId = asString(payload.categoryId);
  const planned = Number(payload.planned);
  const createdAt = asString(payload.createdAt);
  if (!sheetId && !/^\d{4}-\d{2}-\d{2}$/.test(rangeStart)) {
    return failure('budget.save.month-required', 'Choose the month this budget applies to.');
  }
  if (!categoryId) return failure('budget.save.category-required', 'Select a category.');
  if (!Number.isFinite(planned) || planned <= 0) {
    return failure(
      'budget.save.amount-required',
      'Enter a planned budget amount greater than zero.'
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) {
    return failure('budget.save.created-date-required', 'Choose when this budget was created.');
  }

  const workbook = cloneWorkbook(context.workbook);
  let sheet = sheetId ? findById(workbook.sheets, sheetId) : null;
  if (sheetId && !sheet) {
    return failure('budget.save.sheet-not-found', `Budget sheet "${sheetId}" was not found.`);
  }
  if (!sheet) {
    const year = Number(rangeStart.slice(0, 4));
    const month = Number(rangeStart.slice(5, 7));
    const workbookYear = Number(workbook.year);
    if (!(month >= 1 && month <= 12) || year !== workbookYear) {
      return failure(
        'budget.save.month-outside-workbook',
        'The budget month must be inside the current workbook year.'
      );
    }
    const monthIndex = month - 1;
    sheet = asArray(workbook.sheets).find(
      (candidate) => Number(candidate && candidate.monthIndex) === monthIndex
    );
    if (!sheet) {
      const monthKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
      const requestedId =
        typeof dependencies.createId === 'function'
          ? asString(dependencies.createId('sheet'))
          : `sheet-${monthKey}`;
      let nextId = requestedId || `sheet-${monthKey}`;
      let suffix = 2;
      while (findById(workbook.sheets, nextId)) {
        nextId = `sheet-${monthKey}-${suffix}`;
        suffix += 1;
      }
      sheet = {
        id: nextId,
        name: monthKey,
        monthKey,
        monthIndex,
        budgets: [],
        budgetLineItems: [],
        entries: []
      };
      workbook.sheets.push(sheet);
    }
  }
  const resolvedSheetId = asString(sheet.id);
  const existing = asArray(sheet.budgets).find(
    (budget) => asString(budget && budget.categoryId) === categoryId
  );
  const budget = existing
    ? editCoreBudget(workbook, resolvedSheetId, categoryId, { planned })
    : createCoreBudget(workbook, resolvedSheetId, { categoryId, planned });
  const savedBudget = asArray(sheet.budgets).find(
    (item) => asString(item && item.categoryId) === categoryId
  );
  if (savedBudget) savedBudget.createdAt = createdAt;
  return mutationSuccess(workbook, {
    type: BUDGET_EVENT_TYPES.budgetSaved,
    payload: {
      sheetId: resolvedSheetId,
      categoryId,
      budget: savedBudget || budget
    }
  });
}

function handleArchiveBudget(payload, context) {
  if (!(context.workbook && typeof context.workbook === 'object')) {
    return failure(
      'budget.archive.workbook-required',
      'Archiving a budget requires a hydrated workbook.'
    );
  }
  const sheetId = asString(payload.sheetId);
  const categoryId = asString(payload.categoryId);
  if (!sheetId || !categoryId) {
    return failure(
      'budget.archive.target-required',
      'Budget archive requires a sheetId and categoryId.'
    );
  }
  const workbook = cloneWorkbook(context.workbook);
  const sheet = findById(workbook.sheets, sheetId);
  if (!sheet) {
    return failure('budget.archive.sheet-not-found', 'Budget sheet was not found.');
  }
  const lineItemIds = asArray(sheet.budgetLineItems)
    .filter(
      (item) =>
        asString(item && item.categoryId) === categoryId &&
        item.isActive !== false &&
        !asString(item.recurringItemId)
    )
    .map((item) => asString(item.id))
    .filter(Boolean);
  const archivedLineItemIds = [];
  lineItemIds.forEach((lineItemId) => {
    const result = archiveCoreBudget(workbook, sheetId, categoryId, { lineItemId });
    if (result.archived) archivedLineItemIds.push(lineItemId);
  });
  const archived = archiveCoreBudget(workbook, sheetId, categoryId);
  if (!archived.archived && !archivedLineItemIds.length) {
    return failure('budget.archive.not-found', 'Budget was not found.');
  }
  return mutationSuccess(workbook, {
    type: BUDGET_EVENT_TYPES.budgetArchived,
    payload: {
      sheetId,
      categoryId,
      ...(archivedLineItemIds.length ? { lineItemIds: archivedLineItemIds } : {})
    }
  });
}

export function createBudgetController(dependencies = {}) {
  const modelDependencies = {
    clock: dependencies.clock,
    currentDate: dependencies.currentDate
  };
  const buildModel = (workbook, viewState = {}) => {
    return buildBudgetRouteModel(workbook, viewState, modelDependencies);
  };

  return {
    buildModel,
    handleAction(action, context = {}) {
      const source = asObject(action);
      const actionType = asString(source.type);
      const payload = asObject(source.payload);
      try {
        if (actionType === 'route/navigate') {
          return handleNavigation(payload);
        }
        if (actionType === 'open-dashboard-category') {
          return handleCategoryDrilldown(payload, context, buildModel);
        }
        if (actionType === 'open-dashboard-flow') {
          return handleFlowDrilldown(payload, context, buildModel);
        }
        if (actionType === 'open-budget-transaction') {
          return handleTransactionDetail(payload, context);
        }
        if (actionType === 'open-simple-budget') {
          return handleAddBudget(payload, context, buildModel);
        }
        if (actionType === 'set-budget-range') {
          return handleViewStateChange(payload);
        }
        if (actionType === 'save-budget') {
          return handleSaveBudget(payload, context, dependencies);
        }
        if (actionType === 'archive-budget') {
          return handleArchiveBudget(payload, context);
        }
        return failure(
          'budget.action.unsupported',
          actionType
            ? `Unsupported budget action "${actionType}".`
            : 'Budget action type is required.',
          false
        );
      } catch (error) {
        return failure(
          'budget.action.failed',
          asString(error && error.message) || 'The budget action could not be prepared.'
        );
      }
    }
  };
}
