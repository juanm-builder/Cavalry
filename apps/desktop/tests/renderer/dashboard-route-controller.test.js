import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_EVENT_TYPES,
  createDashboardController
} from '../../src/renderer/features/dashboard/dashboard-controller.js';
import { buildDashboardRouteModel } from '../../src/renderer/features/dashboard/dashboard-route-model.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

const FIXED_DATE = '2026-06-15';

function makeEmptyWorkbook() {
  return {
    id: 'wb-empty',
    version: 2,
    name: 'Empty Workbook',
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [],
    categories: [],
    counterparties: [],
    transactions: [],
    sheets: [],
    recurringItems: [],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

function makeDashboardWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.sheets = [
    {
      id: 'sheet-june',
      name: 'June',
      monthIndex: 5,
      budgets: [
        { categoryId: 'food', planned: 200 },
        { categoryId: 'subscriptions', planned: 600 }
      ],
      budgetLineItems: []
    }
  ];
  workbook.settings.dashboardLayout = [
    { id: 'recent_activity', visible: true },
    { id: 'command', visible: true },
    { id: 'flows', visible: false }
  ];
  return workbook;
}

function expectSerializable(value) {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

describe('dashboard route model', () => {
  it('builds a deterministic serializable empty-workbook model without mutation', () => {
    const workbook = makeEmptyWorkbook();
    const original = cloneFixture(workbook);
    const dependencies = { clock: { today: () => FIXED_DATE } };

    const first = buildDashboardRouteModel(workbook, {}, dependencies);
    const second = buildDashboardRouteModel(workbook, {}, dependencies);

    expect(first).toEqual(second);
    expect(first.range).toEqual({ start: '2026-01-01', end: FIXED_DATE });
    expect(first.currentDate).toBe(FIXED_DATE);
    expect(first.periodLabel).toBe('January 1 - June 15, 2026');
    expect(first.emptyState).toEqual({
      isEmpty: true,
      hasAccounts: false,
      hasCategories: false,
      hasTransactions: false,
      hasBudgetSheets: false
    });
    expect(first.periodSummary.transactions).toEqual([]);
    expect(first.categoryLookup).toEqual({});
    expect(workbook).toEqual(original);
    expectSerializable(first);
  });

  it('derives populated finance data and normalized explicit view state', () => {
    const workbook = makeDashboardWorkbook();
    const original = cloneFixture(workbook);
    const model = buildDashboardRouteModel(
      workbook,
      {
        range: { start: '2026-06-01', end: '2026-06-30' },
        asOfDate: '2026-06-20',
        spendingPreset: 'this_month',
        layout: [
          { id: 'money_shape', visible: false },
          { id: 'command', visible: true },
          { id: 'money_shape', visible: true },
          { id: 'unknown', visible: true }
        ]
      },
      { currentDate: FIXED_DATE }
    );

    expect(model.range).toEqual({ start: '2026-06-01', end: '2026-06-30' });
    expect(model.asOfDate).toBe('2026-06-20');
    expect(model.periodSummary.transactions).toHaveLength(5);
    expect(model.periodSummary.income).toBe(50000);
    expect(model.categoryLookup.food).toEqual({ id: 'food', name: 'Food', type: 'expense' });
    expect(model.timeline.series.weekly.map((row) => row.shortLabel)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun'
    ]);
    expect(model.timeline.series.monthly).toHaveLength(30);
    expect(model.timeline.series.monthly[0].shortLabel).toBe('1');
    expect(model.timeline.series.monthly[29].shortLabel).toBe('30');
    expect(model.timeline.series.yearly).toHaveLength(12);
    expect(model.timeline.series.yearly[0].shortLabel).toBe('Jan');
    expect(model.timeline.series.yearly[11].shortLabel).toBe('Dec');
    expect(model.timeframes.weekly.range).toEqual({
      start: '2026-06-15',
      end: '2026-06-21'
    });
    expect(model.timeframes.monthly.range).toEqual({
      start: '2026-06-01',
      end: '2026-06-30'
    });
    expect(model.timeframes.yearly.range).toEqual({
      start: '2026-01-01',
      end: '2026-12-31'
    });
    expect(model.timeframes.monthly.stats.period.income).toBe(50000);
    expect(model.timeframes.monthly.spendingSummary.total).toBe(2029);
    expect(model.layout).toEqual([
      { id: 'money_shape', visible: false },
      { id: 'command', visible: true },
      { id: 'flows', visible: true }
    ]);
    expect(model.viewState.spendingPreset).toBe('this_month');
    expect(workbook).toEqual(original);
    expectSerializable(model);
  });
});

describe('dashboard controller', () => {
  it('emits explicit navigation, drilldown, customization, and export payloads', () => {
    const workbook = makeDashboardWorkbook();
    const original = cloneFixture(workbook);
    const viewState = { range: { start: '2026-06-01', end: '2026-06-30' } };
    const context = { workbook, viewState };
    const controller = createDashboardController({ clock: () => FIXED_DATE });

    expect(
      controller.handleAction(
        {
          type: 'route/navigate',
          payload: { routeId: 'ledger' }
        },
        context
      )
    ).toEqual({
      ok: true,
      handled: true,
      events: [{ type: DASHBOARD_EVENT_TYPES.navigate, payload: { routeId: 'ledger' } }],
      warnings: [],
      errors: []
    });

    const categoryResult = controller.handleAction(
      {
        type: 'open-dashboard-category',
        payload: { categoryId: 'food' }
      },
      context
    );
    expect(categoryResult.events[0]).toMatchObject({
      type: DASHBOARD_EVENT_TYPES.categoryDrilldown,
      payload: {
        categoryId: 'food',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        model: {
          categoryId: 'food',
          isKnownCategory: true,
          rangeKind: 'date'
        }
      }
    });
    expect(categoryResult.events[0].payload.model.summary.transactionCount).toBe(1);

    const flowResult = controller.handleAction(
      {
        type: 'open-dashboard-flow',
        payload: { flowType: 'expense' }
      },
      context
    );
    expect(flowResult.events[0]).toMatchObject({
      type: DASHBOARD_EVENT_TYPES.flowDrilldown,
      payload: {
        flowType: 'expense',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        model: { flowType: 'expense', rangeKind: 'date' }
      }
    });

    const accountResult = controller.handleAction(
      {
        type: 'open-account-history',
        payload: { accountId: 'bank' }
      },
      context
    );
    expect(accountResult.events[0]).toEqual({
      type: DASHBOARD_EVENT_TYPES.accountDrilldown,
      payload: {
        accountId: 'bank',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        account: workbook.accounts.find((account) => account.id === 'bank')
      }
    });

    const groupResult = controller.handleAction(
      {
        type: 'open-dashboard-account-group',
        payload: { accountGroup: 'net-worth' }
      },
      context
    );
    expect(groupResult.events[0]).toEqual({
      type: DASHBOARD_EVENT_TYPES.accountGroupDrilldown,
      payload: {
        accountGroup: 'net-worth',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30'
      }
    });

    const customizeResult = controller.handleAction({ type: 'open-dashboard-customizer' }, context);
    expect(customizeResult.events[0]).toEqual({
      type: DASHBOARD_EVENT_TYPES.customization,
      payload: { layout: controller.buildModel(workbook, viewState).layout }
    });

    expect(controller.handleAction({ type: 'export-workbook' }, context)).toEqual({
      ok: true,
      handled: true,
      events: [
        {
          type: DASHBOARD_EVENT_TYPES.exportWorkbook,
          payload: { workbookId: 'wb-income-expense', format: 'portable-html' }
        }
      ],
      warnings: [],
      errors: []
    });

    expect(workbook).toEqual(original);
    expectSerializable(categoryResult);
    expectSerializable(flowResult);
  });

  it('returns structured handled and unhandled failures', () => {
    const controller = createDashboardController({ currentDate: FIXED_DATE });
    const context = { workbook: makeDashboardWorkbook(), viewState: {} };

    expect(
      controller.handleAction(
        {
          type: 'open-dashboard-category',
          payload: { categoryId: 'missing' }
        },
        context
      )
    ).toEqual({
      ok: false,
      handled: true,
      events: [],
      warnings: [],
      errors: [
        { code: 'dashboard.category.not-found', message: 'Category "missing" was not found.' }
      ]
    });
    expect(controller.handleAction({ type: 'other/action' }, context)).toMatchObject({
      ok: false,
      handled: false,
      events: [],
      errors: [{ code: 'dashboard.action.unsupported' }]
    });
  });
});
