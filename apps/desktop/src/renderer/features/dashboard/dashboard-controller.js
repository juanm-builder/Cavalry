import {
  buildDashboardCategoryDrilldownViewModel,
  buildDashboardFlowDrilldownViewModel
} from '@cavalry/finance-core';
import { buildDashboardRouteModel } from './dashboard-route-model.js';

export const DASHBOARD_EVENT_TYPES = Object.freeze({
  navigate: 'route/navigate',
  categoryDrilldown: 'dashboard/category-drilldown-requested',
  flowDrilldown: 'dashboard/flow-drilldown-requested',
  accountDrilldown: 'accounts/history-requested',
  accountGroupDrilldown: 'accounts/group-drilldown-requested',
  monthDrilldown: 'dashboard/month-drilldown-requested',
  transactionDetail: 'transactions/detail-requested',
  customization: 'dashboard/customization-requested',
  exportWorkbook: 'workbook/export-requested'
});

const FLOW_TYPES = new Set(['inflow', 'income', 'expense', 'outflow', 'debt', 'savings', 'both']);
const ACCOUNT_GROUPS = new Set(['asset', 'liability', 'net-worth']);

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
        'dashboard.action.invalid-range',
        'Dashboard drilldown actions require a complete ISO date range.'
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
    return failure('dashboard.navigation.route-required', 'Navigation requires a routeId.');
  }
  return success({
    type: DASHBOARD_EVENT_TYPES.navigate,
    payload: { routeId }
  });
}

function handleCategoryDrilldown(payload, context, buildModel) {
  const categoryId = asString(payload.categoryId);
  if (!categoryId) {
    return failure('dashboard.category.id-required', 'Category drilldown requires a categoryId.');
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
    return failure('dashboard.category.not-found', `Category "${categoryId}" was not found.`);
  }
  return success({
    type: DASHBOARD_EVENT_TYPES.categoryDrilldown,
    payload: {
      categoryId,
      rangeStart: rangeResult.range.start,
      rangeEnd: rangeResult.range.end,
      model
    }
  });
}

function handleFlowDrilldown(payload, context, buildModel) {
  const flowType = asString(payload.flowType || payload.type || 'outflow');
  if (!FLOW_TYPES.has(flowType)) {
    return failure('dashboard.flow.invalid-type', `Unsupported dashboard flow type "${flowType}".`);
  }
  const routeModel = getRouteModel(buildModel, context);
  const monthKey = asString(payload.monthKey);
  if (monthKey && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    return failure('dashboard.flow.invalid-month', 'Flow drilldown monthKey must use YYYY-MM.');
  }
  const rangeResult = resolveRange(payload, routeModel.range);
  if (!rangeResult.ok) {
    return rangeResult.error;
  }
  const model = buildDashboardFlowDrilldownViewModel(context.workbook, {
    flowType,
    monthKey,
    rangeStart: monthKey ? '' : rangeResult.range.start,
    rangeEnd: monthKey ? '' : rangeResult.range.end,
    defaultRange: routeModel.range
  });
  return success({
    type: DASHBOARD_EVENT_TYPES.flowDrilldown,
    payload: {
      flowType,
      monthKey: model.monthKey,
      rangeStart: model.range.start,
      rangeEnd: model.range.end,
      model
    }
  });
}

function handleAccountDrilldown(payload, context, buildModel) {
  const accountId = asString(payload.accountId);
  if (!accountId) {
    return failure('dashboard.account.id-required', 'Account drilldown requires an accountId.');
  }
  const account = findById(context.workbook && context.workbook.accounts, accountId);
  if (!account) {
    return failure('dashboard.account.not-found', `Account "${accountId}" was not found.`);
  }
  const routeModel = getRouteModel(buildModel, context);
  return success({
    type: DASHBOARD_EVENT_TYPES.accountDrilldown,
    payload: {
      accountId,
      rangeStart: routeModel.range.start,
      rangeEnd: routeModel.range.end,
      account: cloneSerializable(account)
    }
  });
}

function handleAccountGroupDrilldown(payload, context, buildModel) {
  const accountGroup = asString(payload.accountGroup);
  if (!ACCOUNT_GROUPS.has(accountGroup)) {
    return failure(
      'dashboard.account-group.invalid',
      'Account group drilldown requires a supported accountGroup.'
    );
  }
  const routeModel = getRouteModel(buildModel, context);
  return success({
    type: DASHBOARD_EVENT_TYPES.accountGroupDrilldown,
    payload: {
      accountGroup,
      rangeStart: routeModel.range.start,
      rangeEnd: routeModel.range.end
    }
  });
}

function handleMonthDrilldown(payload, context, buildModel) {
  const sheetId = asString(payload.sheetId);
  if (!sheetId) {
    return failure('dashboard.month.sheet-required', 'Month drilldown requires a sheetId.');
  }
  const sheet = findById(context.workbook && context.workbook.sheets, sheetId);
  if (!sheet) {
    return failure('dashboard.month.sheet-not-found', `Budget sheet "${sheetId}" was not found.`);
  }
  const routeModel = getRouteModel(buildModel, context);
  const rangeResult = resolveRange(payload, routeModel.range);
  if (!rangeResult.ok) {
    return rangeResult.error;
  }
  return success({
    type: DASHBOARD_EVENT_TYPES.monthDrilldown,
    payload: {
      sheetId,
      rangeStart: rangeResult.range.start,
      rangeEnd: rangeResult.range.end,
      sheet: cloneSerializable(sheet)
    }
  });
}

function handleTransactionDetail(payload, context) {
  const transactionId = asString(payload.transactionId);
  if (!transactionId) {
    return failure(
      'dashboard.transaction.id-required',
      'Transaction detail requires a transactionId.'
    );
  }
  const transaction = findById(context.workbook && context.workbook.transactions, transactionId);
  if (!transaction) {
    return failure(
      'dashboard.transaction.not-found',
      `Transaction "${transactionId}" was not found.`
    );
  }
  return success({
    type: DASHBOARD_EVENT_TYPES.transactionDetail,
    payload: {
      transactionId,
      transaction: cloneSerializable(transaction)
    }
  });
}

function handleCustomization(context, buildModel) {
  const routeModel = getRouteModel(buildModel, context);
  return success({
    type: DASHBOARD_EVENT_TYPES.customization,
    payload: { layout: routeModel.layout }
  });
}

function handleExport(payload, context) {
  const workbook = context && context.workbook;
  if (!workbook || typeof workbook !== 'object') {
    return failure(
      'dashboard.export.workbook-required',
      'Workbook export requires a hydrated workbook.'
    );
  }
  const requestedFormat = asString(payload.format || 'portable-html');
  if (!['portable-html', 'json'].includes(requestedFormat)) {
    return failure(
      'dashboard.export.invalid-format',
      `Unsupported workbook export format "${requestedFormat}".`
    );
  }
  return success({
    type: DASHBOARD_EVENT_TYPES.exportWorkbook,
    payload: {
      workbookId: asString(workbook.id),
      format: requestedFormat
    }
  });
}

export function createDashboardController(dependencies = {}) {
  const modelDependencies = {
    clock: dependencies.clock,
    currentDate: dependencies.currentDate
  };
  const buildModel = (workbook, viewState = {}) => {
    return buildDashboardRouteModel(workbook, viewState, modelDependencies);
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
        if (actionType === 'open-account-history') {
          return handleAccountDrilldown(payload, context, buildModel);
        }
        if (actionType === 'open-dashboard-account-group') {
          return handleAccountGroupDrilldown(payload, context, buildModel);
        }
        if (actionType === 'open-dashboard-month') {
          return handleMonthDrilldown(payload, context, buildModel);
        }
        if (actionType === 'open-transaction-detail') {
          return handleTransactionDetail(payload, context);
        }
        if (actionType === 'open-dashboard-customizer') {
          return handleCustomization(context, buildModel);
        }
        if (actionType === 'export-workbook') {
          return handleExport(payload, context);
        }
        return failure(
          'dashboard.action.unsupported',
          actionType
            ? `Unsupported dashboard action "${actionType}".`
            : 'Dashboard action type is required.',
          false
        );
      } catch (error) {
        return failure(
          'dashboard.action.failed',
          asString(error && error.message) || 'The dashboard action could not be prepared.'
        );
      }
    }
  };
}
