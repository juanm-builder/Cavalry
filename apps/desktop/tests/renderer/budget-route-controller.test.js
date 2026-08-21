import { describe, expect, it } from 'vitest';

import {
  BUDGET_EVENT_TYPES,
  createBudgetController
} from '../../src/renderer/features/budgets/budget-controller.js';
import { buildBudgetRouteModel } from '../../src/renderer/features/budgets/budget-route-model.js';
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

function makeBudgetWorkbook() {
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
    },
    {
      id: 'sheet-july',
      name: 'July',
      monthIndex: 6,
      budgets: [],
      budgetLineItems: []
    }
  ];
  return workbook;
}

function expectSerializable(value) {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

describe('budget route model', () => {
  it('builds a deterministic serializable empty-workbook model without mutation', () => {
    const workbook = makeEmptyWorkbook();
    const original = cloneFixture(workbook);
    const dependencies = { clock: { today: () => FIXED_DATE } };

    const first = buildBudgetRouteModel(workbook, {}, dependencies);
    const second = buildBudgetRouteModel(workbook, {}, dependencies);

    expect(first).toEqual(second);
    expect(first.range).toEqual({ start: '2026-06-01', end: '2026-06-30' });
    expect(first.currentDate).toBe(FIXED_DATE);
    expect(first.periodLabel).toBe('June 1 - 30, 2026');
    expect(first.sheet).toBeNull();
    expect(first.canAddBudget).toBe(false);
    expect(first.summary.totalBudget).toBe(0);
    expect(first.emptyState).toEqual({
      isEmpty: true,
      hasSheets: false,
      hasTransactions: false,
      hasCategoryBudgets: false
    });
    expect(workbook).toEqual(original);
    expectSerializable(first);
  });

  it('selects a budget sheet and derives populated finance data from explicit view state', () => {
    const workbook = makeBudgetWorkbook();
    const original = cloneFixture(workbook);
    const june = buildBudgetRouteModel(workbook, {}, { currentDate: FIXED_DATE });
    const july = buildBudgetRouteModel(
      workbook,
      { sheetId: 'sheet-july' },
      { currentDate: FIXED_DATE }
    );
    const julyFromRange = buildBudgetRouteModel(
      workbook,
      { range: { start: '2026-07-01', end: '2026-07-31' } },
      { currentDate: FIXED_DATE }
    );

    expect(june.sheet).toEqual({
      id: 'sheet-june',
      name: 'June',
      monthKey: '2026-06',
      monthIndex: 5
    });
    expect(june.range).toEqual({ start: '2026-06-01', end: '2026-06-30' });
    expect(june.summary.totalBudget).toBe(800);
    expect(june.categoryOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'food', planned: 200 }),
        expect.objectContaining({ id: 'subscriptions', planned: 600 })
      ])
    );
    expect(june.summary.spent).toBe(2029);
    expect(june.categoryRows.map((row) => row.category.id)).toEqual([
      'shopping',
      'food',
      'transport',
      'salary',
      'subscriptions'
    ]);
    expect(july.sheet).toEqual({
      id: 'sheet-july',
      name: 'July',
      monthKey: '2026-07',
      monthIndex: 6
    });
    expect(julyFromRange.sheet).toEqual({
      id: 'sheet-july',
      name: 'July',
      monthKey: '2026-07',
      monthIndex: 6
    });
    expect(july.range).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(workbook).toEqual(original);
    expectSerializable(june);
    expectSerializable(july);
  });
});

describe('budget controller', () => {
  it('emits explicit navigation, drilldown, and budget-add payloads', () => {
    const workbook = makeBudgetWorkbook();
    const original = cloneFixture(workbook);
    const context = { workbook, viewState: { sheetId: 'sheet-june' } };
    const controller = createBudgetController({ clock: () => FIXED_DATE });

    expect(
      controller.handleAction(
        {
          type: 'route/navigate',
          payload: { routeId: 'categories' }
        },
        context
      )
    ).toEqual({
      ok: true,
      handled: true,
      events: [{ type: BUDGET_EVENT_TYPES.navigate, payload: { routeId: 'categories' } }],
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
      type: BUDGET_EVENT_TYPES.categoryDrilldown,
      payload: {
        categoryId: 'food',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        model: { categoryId: 'food', isKnownCategory: true, rangeKind: 'date' }
      }
    });

    const transactionId = workbook.transactions[0].id;
    const transactionResult = controller.handleAction(
      {
        type: 'open-budget-transaction',
        payload: { transactionId }
      },
      context
    );
    expect(transactionResult.events[0]).toEqual({
      type: BUDGET_EVENT_TYPES.transactionDetail,
      payload: { transactionId }
    });

    const flowResult = controller.handleAction(
      {
        type: 'open-dashboard-flow',
        payload: { flowType: 'expense' }
      },
      context
    );
    expect(flowResult.events[0]).toMatchObject({
      type: BUDGET_EVENT_TYPES.flowDrilldown,
      payload: {
        flowType: 'expense',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        model: { flowType: 'expense', rangeKind: 'date' }
      }
    });

    expect(
      controller.handleAction(
        {
          type: 'open-simple-budget',
          payload: { sheetId: 'sheet-june' }
        },
        context
      )
    ).toEqual({
      ok: true,
      handled: true,
      events: [
        {
          type: BUDGET_EVENT_TYPES.addBudget,
          payload: {
            sheetId: 'sheet-june',
            rangeStart: '2026-06-01',
            rangeEnd: '2026-06-30',
            categoryId: '',
            planned: '',
            createdAt: FIXED_DATE,
            currentDate: FIXED_DATE,
            sheet: workbook.sheets[0]
          }
        }
      ],
      warnings: [],
      errors: []
    });

    expect(workbook).toEqual(original);
    expectSerializable(categoryResult);
    expectSerializable(flowResult);
  });

  it('opens the budget editor when no category exists so one can be created inline', () => {
    const controller = createBudgetController({ currentDate: FIXED_DATE });

    expect(
      controller.handleAction(
        { type: 'open-simple-budget' },
        {
          workbook: makeEmptyWorkbook(),
          viewState: {}
        }
      )
    ).toEqual({
      ok: true,
      handled: true,
      events: [
        {
          type: BUDGET_EVENT_TYPES.addBudget,
          payload: {
            sheetId: '',
            rangeStart: '2026-06-01',
            rangeEnd: '2026-06-30',
            categoryId: '',
            planned: '',
            createdAt: FIXED_DATE,
            currentDate: FIXED_DATE,
            sheet: null
          }
        }
      ],
      warnings: [],
      errors: []
    });
  });

  it('creates the displayed month sheet when saving a monthly budget', () => {
    const workbook = makeBudgetWorkbook();
    const controller = createBudgetController({
      currentDate: FIXED_DATE,
      createId: () => 'sheet-august'
    });
    const context = {
      workbook,
      viewState: { range: { start: '2026-08-01', end: '2026-08-31' } }
    };

    const opened = controller.handleAction({ type: 'open-simple-budget', payload: {} }, context);
    expect(opened.events[0].payload).toMatchObject({
      sheetId: '',
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31'
    });

    const saved = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: '',
          categoryId: 'food',
          planned: 700,
          createdAt: FIXED_DATE,
          rangeStart: '2026-08-01',
          rangeEnd: '2026-08-31'
        }
      },
      { workbook }
    );

    expect(saved.ok).toBe(true);
    expect(saved.workbook.sheets.at(-1)).toMatchObject({
      id: 'sheet-august',
      monthKey: '2026-08',
      monthIndex: 7,
      budgets: [{ categoryId: 'food', planned: 700, createdAt: FIXED_DATE }]
    });
    expect(workbook.sheets).toHaveLength(2);
  });

  it('creates and selects plan months beyond the workbook legacy year', () => {
    const workbook = makeBudgetWorkbook();
    const controller = createBudgetController({
      currentDate: FIXED_DATE,
      createId: () => 'sheet-january-2027'
    });

    const saved = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: '',
          categoryId: 'food',
          planned: 900,
          createdAt: FIXED_DATE,
          rangeStart: '2027-01-01',
          rangeEnd: '2027-01-31'
        }
      },
      { workbook }
    );

    expect(saved.ok).toBe(true);
    expect(saved.workbook.sheets.at(-1)).toMatchObject({
      id: 'sheet-january-2027',
      name: '2027-01',
      monthKey: '2027-01',
      monthIndex: 0,
      budgets: [{ categoryId: 'food', planned: 900, createdAt: FIXED_DATE }]
    });

    const model = buildBudgetRouteModel(
      saved.workbook,
      { range: { start: '2027-01-01', end: '2027-01-31' } },
      { currentDate: FIXED_DATE }
    );
    expect(model.sheet).toMatchObject({ id: 'sheet-january-2027', monthKey: '2027-01' });
    expect(model.summary.totalBudget).toBe(900);
  });

  it('creates, edits, and archives budgets with new workbook identity', () => {
    const original = makeBudgetWorkbook();
    const controller = createBudgetController({ currentDate: FIXED_DATE });

    const created = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: 'sheet-july',
          categoryId: 'food',
          planned: 450,
          createdAt: FIXED_DATE
        }
      },
      { workbook: original }
    );
    expect(created.ok).toBe(true);
    expect(created.workbook).not.toBe(original);
    expect(original.sheets[1].budgets).toEqual([]);
    expect(created.workbook.sheets[1].budgets).toEqual([
      { categoryId: 'food', planned: 450, createdAt: FIXED_DATE }
    ]);
    expect(created.events.map((event) => event.type)).toEqual([
      BUDGET_EVENT_TYPES.budgetSaved,
      BUDGET_EVENT_TYPES.closeEditor,
      BUDGET_EVENT_TYPES.scheduleSave
    ]);

    const edited = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: 'sheet-july',
          categoryId: 'food',
          planned: 500,
          createdAt: FIXED_DATE
        }
      },
      { workbook: created.workbook }
    );
    expect(edited.workbook.sheets[1].budgets[0].planned).toBe(500);
    expect(created.workbook.sheets[1].budgets[0].planned).toBe(450);

    const archived = controller.handleAction(
      {
        type: 'archive-budget',
        payload: { sheetId: 'sheet-july', categoryId: 'food' }
      },
      { workbook: edited.workbook }
    );
    expect(archived.workbook).not.toBe(edited.workbook);
    expect(archived.workbook.sheets[1].budgets).toEqual([]);
  });

  it('creates an expected-income budget with the same coherent save command', () => {
    const workbook = makeBudgetWorkbook();
    const original = cloneFixture(workbook);
    const controller = createBudgetController({ currentDate: FIXED_DATE });

    const saved = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: 'sheet-july',
          categoryId: 'salary',
          planned: 30000,
          operation: 'create',
          createdAt: FIXED_DATE,
          note: 'Expected salary'
        }
      },
      { workbook }
    );

    expect(saved.ok).toBe(true);
    expect(workbook).toEqual(original);
    expect(saved.workbook.sheets[1].budgets).toEqual([
      {
        categoryId: 'salary',
        planned: 30000,
        createdAt: FIXED_DATE,
        note: 'Expected salary'
      }
    ]);
    expect(saved.events[0]).toMatchObject({
      type: BUDGET_EVENT_TYPES.budgetSaved,
      payload: {
        budgetId: 'budget:sheet-july:salary',
        sheetId: 'sheet-july',
        categoryId: 'salary',
        operation: 'created'
      }
    });
    expect(saved.workbook.sheets[1].budgets[0]).not.toHaveProperty('id');
    expect(saved.workbook.sheets[1].budgets[0]).not.toHaveProperty('operation');
    expect(saved.events.map((event) => event.type)).toEqual([
      BUDGET_EVENT_TYPES.budgetSaved,
      BUDGET_EVENT_TYPES.closeEditor,
      BUDGET_EVENT_TYPES.scheduleSave
    ]);
  });

  it('refuses create over an existing expected-income budget and reports explicit upsert', () => {
    const workbook = makeBudgetWorkbook();
    workbook.sheets[1].budgets = [
      {
        categoryId: 'salary',
        planned: 25000,
        createdAt: '2026-06-01',
        note: 'Manually entered expected salary'
      }
    ];
    const original = cloneFixture(workbook);
    const controller = createBudgetController({ currentDate: FIXED_DATE });

    const duplicate = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: 'sheet-july',
          categoryId: 'salary',
          planned: 30000,
          operation: 'create',
          createdAt: FIXED_DATE
        }
      },
      { workbook }
    );

    expect(duplicate).toMatchObject({
      ok: false,
      errors: [{ code: 'budget.save.already-exists' }]
    });
    expect(duplicate).not.toHaveProperty('workbook');
    expect(workbook).toEqual(original);

    const updated = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: 'sheet-july',
          categoryId: 'salary',
          planned: 30000,
          operation: 'upsert',
          createdAt: '2026-06-01',
          note: 'Manually entered expected salary'
        }
      },
      { workbook }
    );

    expect(updated.ok).toBe(true);
    expect(updated.events[0]).toMatchObject({
      type: BUDGET_EVENT_TYPES.budgetSaved,
      payload: {
        budgetId: 'budget:sheet-july:salary',
        operation: 'updated'
      }
    });
    expect(updated.workbook.sheets[1].budgets).toEqual([
      {
        categoryId: 'salary',
        planned: 30000,
        createdAt: '2026-06-01',
        note: 'Manually entered expected salary'
      }
    ]);
    expect(workbook).toEqual(original);
  });

  it('does not shadow or migrate a legacy expected-income budget line item', () => {
    const workbook = makeBudgetWorkbook();
    workbook.sheets[1].budgetLineItems = [
      {
        id: 'expected-salary-line',
        categoryId: 'salary',
        name: 'Expected salary',
        planned: 28000,
        currency: 'PHP',
        isActive: true,
        note: 'Keep this legacy plan intact'
      }
    ];
    const original = cloneFixture(workbook);
    const controller = createBudgetController({ currentDate: FIXED_DATE });

    for (const operation of ['create', 'upsert']) {
      const result = controller.handleAction(
        {
          type: 'save-budget',
          payload: {
            sheetId: 'sheet-july',
            categoryId: 'salary',
            planned: 30000,
            operation,
            createdAt: FIXED_DATE
          }
        },
        { workbook }
      );

      expect(result).toMatchObject({
        ok: false,
        errors: [{ code: 'budget.save.legacy-overlap' }]
      });
      expect(result).not.toHaveProperty('workbook');
    }
    expect(workbook).toEqual(original);
    expect(workbook.sheets[1].budgets).toEqual([]);
  });

  it('requires an explicit period, rejects period conflicts, and rejects recurrence', () => {
    const workbook = makeBudgetWorkbook();
    const original = cloneFixture(workbook);
    const controller = createBudgetController({ currentDate: FIXED_DATE });
    const basePayload = {
      categoryId: 'salary',
      planned: 30000,
      operation: 'create',
      createdAt: FIXED_DATE
    };

    const missingPeriod = controller.handleAction(
      { type: 'save-budget', payload: basePayload },
      { workbook }
    );
    const conflictingPeriod = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          ...basePayload,
          sheetId: 'sheet-june',
          rangeStart: '2026-07-01',
          rangeEnd: '2026-07-31'
        }
      },
      { workbook }
    );
    const recurrence = controller.handleAction(
      {
        type: 'save-budget',
        payload: { ...basePayload, sheetId: 'sheet-july', recurrence: 'Monthly' }
      },
      { workbook }
    );

    expect(missingPeriod).toMatchObject({
      ok: false,
      errors: [{ code: 'budget.save.month-required' }]
    });
    expect(conflictingPeriod).toMatchObject({
      ok: false,
      errors: [{ code: 'budget.save.period-conflict' }]
    });
    expect(recurrence).toMatchObject({
      ok: false,
      errors: [{ code: 'budget.save.recurrence-unsupported' }]
    });
    expect(workbook).toEqual(original);
  });

  it('archives category budgets backed by manual budget line items', () => {
    const workbook = makeBudgetWorkbook();
    workbook.sheets[1].budgetLineItems = [
      {
        id: 'food-line-item',
        categoryId: 'food',
        name: 'Food allocation',
        planned: 450,
        currency: 'PHP',
        isActive: true
      }
    ];
    const controller = createBudgetController({ currentDate: FIXED_DATE });

    const archived = controller.handleAction(
      {
        type: 'archive-budget',
        payload: { sheetId: 'sheet-july', categoryId: 'food' }
      },
      { workbook }
    );

    expect(archived.ok).toBe(true);
    expect(archived.workbook.sheets[1].budgetLineItems[0].isActive).toBe(false);
    expect(archived.workbook.sheets[1].budgets).toEqual([]);
    expect(archived.events[0]).toEqual({
      type: BUDGET_EVENT_TYPES.budgetArchived,
      payload: {
        sheetId: 'sheet-july',
        categoryId: 'food',
        lineItemIds: ['food-line-item']
      }
    });
  });

  it('rejects invalid budget mutations without changing the workbook', () => {
    const workbook = makeBudgetWorkbook();
    const original = cloneFixture(workbook);
    const controller = createBudgetController({ currentDate: FIXED_DATE });
    const invalidAmount = controller.handleAction(
      {
        type: 'save-budget',
        payload: { sheetId: 'sheet-june', categoryId: 'food', planned: 0 }
      },
      { workbook }
    );
    const invalidCategory = controller.handleAction(
      {
        type: 'save-budget',
        payload: {
          sheetId: 'sheet-june',
          categoryId: 'missing-income-category',
          planned: 1000,
          operation: 'create',
          createdAt: FIXED_DATE
        }
      },
      { workbook }
    );

    expect(invalidAmount).toMatchObject({
      ok: false,
      errors: [{ code: 'budget.save.amount-required' }]
    });
    expect(invalidAmount).not.toHaveProperty('workbook');
    expect(invalidCategory).toMatchObject({
      ok: false,
      errors: [{ code: 'budget.save.category-invalid' }]
    });
    expect(invalidCategory).not.toHaveProperty('workbook');
    expect(workbook).toEqual(original);
  });
});
