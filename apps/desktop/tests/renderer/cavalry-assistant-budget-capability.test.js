import { describe, expect, it, vi } from 'vitest';

import {
  executeCavalryAssistantTool,
  getCavalryAssistantToolDefinitions
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';
import {
  confirmationReplayArguments,
  pendingConfirmationFromResult
} from '../../src/renderer/features/assistant/cavalry-assistant-confirmations.js';
import { buildCavalryAssistantInstructions } from '../../src/renderer/features/assistant/cavalry-assistant-instructions.js';

function workbook() {
  return {
    id: 'budget-qa',
    version: 2,
    name: 'Main Plan',
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [],
    transactions: [],
    counterparties: [],
    recurringItems: [],
    aiDrafts: [],
    externalDraftGroups: [],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', isActive: true },
      { id: 'salary', name: 'Salary', type: 'income', isActive: true }
    ],
    sheets: [
      {
        id: 'sept',
        name: 'September',
        monthKey: '2026-09',
        monthIndex: 8,
        budgets: [
          { categoryId: 'food', planned: 3000, createdAt: '2026-09-01', note: 'Keep this note' }
        ],
        budgetLineItems: [],
        entries: []
      },
      {
        id: 'oct',
        name: 'October',
        monthKey: '2026-10',
        monthIndex: 9,
        budgets: [
          { categoryId: 'food', planned: 4000, createdAt: '2026-09-02', note: 'October note' }
        ],
        budgetLineItems: [],
        entries: []
      }
    ]
  };
}

function harness(initial = workbook()) {
  let value = initial;
  let sequence = 0;
  const commit = vi.fn((result) => {
    value = result.workbook;
    return {
      ...result,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence: { status: 'saved', durable: true }
    };
  });
  const context = {
    getWorkbook: () => value,
    commitCommandResult: commit,
    services: { defaultDate: () => '2026-09-10', createId: (prefix) => `${prefix}-${++sequence}` }
  };
  return {
    get workbook() {
      return value;
    },
    context,
    commit,
    call(name, args = {}, extra = {}) {
      return executeCavalryAssistantTool({ name, arguments: args }, { ...context, ...extra });
    }
  };
}

function reviewedArguments(result) {
  return confirmationReplayArguments(
    pendingConfirmationFromResult({
      toolResults: [
        { callId: 'budget-proposal', toolName: 'archive_budget', arguments: {}, result }
      ]
    })
  );
}

describe('assistant monthly budget mutations', () => {
  it('keeps budget absence scoped when the requested name belongs to a recurring tracker', async () => {
    const h = harness();
    h.workbook.categories[0].name = 'Advisor QA Coffee';
    h.workbook.recurringItems.push({
      id: 'qa-stream',
      name: 'Advisor QA Stream',
      kind: 'subscription',
      categoryId: 'food',
      amount: 499,
      currency: 'PHP',
      frequency: 'Monthly',
      dueDate: '2026-10-05',
      isActive: true
    });
    const before = structuredClone(h.workbook);
    for (const month of ['2026-09', '2026-12']) {
      const read = await h.call('read_budgets', { month });
      expect(read.ok).toBe(true);
      expect(read.data.scope).toContain(
        'A missing budget row does not mean a named bill or subscription is absent'
      );
      expect(read.data.scope).toContain('list_recurring_bills');
      expect(
        read.data.budgets
          .flatMap((budget) => budget.rows)
          .some((row) => row.categoryName === 'Advisor QA Stream')
      ).toBe(false);
    }
    const trackers = await h.call('list_recurring_bills', { includeArchived: true });
    expect(trackers.data.recurringItems.some((item) => item.name === 'Advisor QA Stream')).toBe(
      true
    );
    const tools = getCavalryAssistantToolDefinitions({
      workbook: h.workbook,
      activeRouteId: 'budgets',
      question:
        'Check Advisor QA Coffee budget for September and October, and Advisor QA Stream for October, November and December. Show planned amounts and dates.'
    });
    const instructions = buildCavalryAssistantInstructions({ toolDefinitions: tools });
    expect(instructions).toContain('resolve each named item separately');
    expect(instructions).toContain(
      'read_budgets alone cannot establish that a bill or subscription is absent'
    );
    expect(instructions).toContain(
      'check list_recurring_bills with every requested month in monthKeys'
    );
    expect(instructions).toContain('query each requested month and use its effective amount/date');
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.workbook).toEqual(before);
  });

  it('updates only the explicit month while preserving metadata and the other month', async () => {
    const h = harness();
    const september = structuredClone(h.workbook.sheets[0]);
    const result = await h.call('set_budget', {
      month: '2026-10',
      category: 'Food',
      operation: 'update',
      planned: 4500.25
    });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      data: { budget: { month: '2026-10', planned: 4500.25, operation: 'updated' } }
    });
    expect(h.workbook.sheets[0]).toEqual(september);
    expect(h.workbook.sheets[1].budgets[0]).toEqual({
      categoryId: 'food',
      planned: 4500.25,
      createdAt: '2026-09-02',
      note: 'October note'
    });
  });

  it('creates a missing month across the year boundary without changing existing sheets or categories', async () => {
    const h = harness();
    const before = structuredClone(h.workbook);
    const result = await h.call('set_budget', {
      month: '2027-01',
      categoryId: 'salary',
      operation: 'create',
      planned: 35000
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        budget: { month: '2027-01', categoryId: 'salary', categoryType: 'income', planned: 35000 }
      }
    });
    expect(h.workbook.sheets.filter((sheet) => ['sept', 'oct'].includes(sheet.id))).toEqual(
      before.sheets
    );
    expect(h.workbook.categories).toEqual(before.categories);
    expect(h.workbook.year).toBe(2026);
  });

  it('reads precisely the requested month and reports an absent month without creating it', async () => {
    const h = harness();
    expect(await h.call('read_budgets', { month: '2026-10' })).toMatchObject({
      ok: true,
      data: { count: 1, budgets: [{ monthKey: '2026-10', sheet: { id: 'oct' } }] }
    });
    expect(await h.call('read_budgets', { month: '2027-01' })).toMatchObject({
      ok: true,
      data: { count: 0, budgets: [], month: '2027-01' }
    });
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.workbook.sheets).toHaveLength(2);
  });

  it('requires a removal period instead of defaulting to the first sheet', async () => {
    const h = harness();
    const before = structuredClone(h.workbook);
    const result = await h.call('archive_budget', { category: 'Food' });
    expect(result).toMatchObject({
      ok: false,
      changed: false,
      errors: [{ code: 'budget_period_required' }]
    });
    expect(result).not.toHaveProperty('confirmation');
    expect(h.workbook).toEqual(before);
  });

  it('binds month removal to the reviewed IDs and removes only that plan after approval', async () => {
    const h = harness();
    const september = structuredClone(h.workbook.sheets[0]);
    const proposal = await h.call('archive_budget', { month: '2026-10', category: 'Food' });
    expect(proposal).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      data: { budget: { sheetId: 'oct', month: '2026-10', categoryName: 'Food', planned: 4000 } }
    });
    expect(h.commit).not.toHaveBeenCalled();
    const args = reviewedArguments(proposal);
    expect(args).toMatchObject({
      sheetId: 'oct',
      categoryId: 'food',
      expectedBudgetState: expect.any(String),
      confirmed: true
    });
    const result = await h.call('archive_budget', args, { approvedByUser: true });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      data: { budget: { month: '2026-10', categoryName: 'Food', archived: true } }
    });
    expect(h.workbook.sheets[0]).toEqual(september);
    expect(h.workbook.sheets[1].budgets).toEqual([]);
    expect(await h.call('archive_budget', args, { approvedByUser: true })).toMatchObject({
      ok: false,
      changed: false,
      errors: [{ code: 'budget_not_found' }]
    });
    expect(h.commit).toHaveBeenCalledOnce();
  });

  it.each(['amount', 'note', 'category name', 'currency', 'workbook'])(
    'rejects removal when the reviewed %s has changed',
    async (change) => {
      const h = harness();
      const proposal = await h.call('archive_budget', { month: '2026-10', categoryId: 'food' });
      if (change === 'amount') h.workbook.sheets[1].budgets[0].planned = 6000;
      if (change === 'note') h.workbook.sheets[1].budgets[0].note = 'Edited since preview';
      if (change === 'category name') h.workbook.categories[0].name = 'Groceries';
      if (change === 'currency') h.workbook.currency = 'USD';
      if (change === 'workbook') h.workbook.id = 'another-workbook';
      const before = structuredClone(h.workbook);
      const result = await h.call('archive_budget', reviewedArguments(proposal), {
        approvedByUser: true
      });
      expect(result).toMatchObject({
        ok: false,
        status: 'conflict',
        changed: false,
        errors: [{ code: 'budget_confirmation_stale' }]
      });
      expect(h.workbook).toEqual(before);
      expect(h.commit).not.toHaveBeenCalled();
    }
  );

  it('allows unrelated month changes while preserving them when a reviewed removal is approved', async () => {
    const h = harness();
    const proposal = await h.call('archive_budget', { month: '2026-10', categoryId: 'food' });
    h.workbook.sheets[0].budgets[0].planned = 7000;
    expect(
      await h.call('archive_budget', reviewedArguments(proposal), { approvedByUser: true })
    ).toMatchObject({ ok: true });
    expect(h.workbook.sheets[0].budgets[0].planned).toBe(7000);
  });

  it('does not accept model-supplied confirmation or an unreviewed target', async () => {
    const h = harness();
    const args = { month: '2026-10', categoryId: 'food', confirmed: true };
    expect(await h.call('archive_budget', args)).toMatchObject({
      ok: false,
      status: 'confirmation_required'
    });
    expect(await h.call('archive_budget', args, { approvedByUser: true })).toMatchObject({
      ok: false,
      status: 'confirmation_required'
    });
    const tool = getCavalryAssistantToolDefinitions().find(
      (item) => item.name === 'archive_budget'
    );
    expect(tool.parameters.properties).not.toHaveProperty('expectedBudgetState');
    expect(tool.parameters.properties).not.toHaveProperty('confirmed');
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('rejects ambiguous names and month matches instead of choosing the first record', async () => {
    const h = harness();
    h.workbook.categories.push({ id: 'food-other', name: 'Food', type: 'expense', isActive: true });
    const args = { month: '2026-10', category: 'Food', operation: 'update', planned: 2000 };
    expect(await h.call('set_budget', args)).toMatchObject({
      ok: false,
      status: 'ambiguous_reference'
    });
    h.workbook.sheets.push({ ...structuredClone(h.workbook.sheets[1]), id: 'oct-other' });
    expect(
      await h.call('set_budget', {
        month: '2026-10',
        categoryId: 'food',
        operation: 'update',
        planned: 2000
      })
    ).toMatchObject({ ok: false, errors: [{ code: 'budget_period_ambiguous' }] });
    expect(await h.call('archive_budget', { month: '2026-10', categoryId: 'food' })).toMatchObject({
      ok: false,
      errors: [{ code: 'budget_period_ambiguous' }]
    });
    expect(h.commit).not.toHaveBeenCalled();
    expect(
      await h.call('set_budget', {
        sheetId: 'oct',
        categoryId: 'food',
        operation: 'update',
        planned: 2000
      })
    ).toMatchObject({ ok: true });
  });

  it.each([
    { sheetId: 'sept', sheet: 'October', categoryId: 'food' },
    { sheetId: 'sept', categoryId: 'food', category: 'Salary' },
    { sheetId: 'sept', month: '2026-10', categoryId: 'food' }
  ])('rejects contradictory target aliases: %j', async (target) => {
    const h = harness();
    const before = structuredClone(h.workbook);
    expect(
      await h.call('set_budget', { ...target, operation: 'update', planned: 2000 })
    ).toMatchObject({ ok: false, changed: false });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it.each([0, -10, 0.001, 0.009, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER])(
    'rejects unsafe/sub-cent amount %s without removing an existing plan',
    async (planned) => {
      const h = harness();
      const before = structuredClone(h.workbook);
      expect(
        await h.call('set_budget', {
          month: '2026-10',
          categoryId: 'food',
          operation: 'update',
          planned
        })
      ).toMatchObject({ ok: false, changed: false });
      expect(h.workbook).toEqual(before);
      expect(h.commit).not.toHaveBeenCalled();
    }
  );

  it('does not create on update or overwrite on create', async () => {
    const h = harness();
    const before = structuredClone(h.workbook);
    for (const args of [
      { month: '2026-10', categoryId: 'food', operation: 'create' },
      { month: '2026-10', categoryId: 'salary', operation: 'update' },
      { month: '2027-01', categoryId: 'salary', operation: 'update' }
    ])
      expect(await h.call('set_budget', { ...args, planned: 5000 })).toMatchObject({
        ok: false,
        changed: false
      });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('rejects duplicate direct plans and legacy overlap without overwriting either source', async () => {
    const h = harness();
    h.workbook.sheets[0].budgets.push({ categoryId: 'food', planned: 1000 });
    h.workbook.sheets[1].budgetLineItems.push({
      id: 'legacy',
      categoryId: 'food',
      planned: 4000,
      name: 'Legacy Food',
      isActive: true
    });
    const before = structuredClone(h.workbook);
    expect(
      await h.call('set_budget', {
        month: '2026-09',
        categoryId: 'food',
        operation: 'upsert',
        planned: 6000
      })
    ).toMatchObject({ ok: false, errors: [{ code: 'budget.save.ambiguous' }] });
    expect(
      await h.call('set_budget', {
        month: '2026-10',
        categoryId: 'food',
        operation: 'upsert',
        planned: 6000
      })
    ).toMatchObject({ ok: false, errors: [{ code: 'budget.save.legacy-overlap' }] });
    expect(h.workbook).toEqual(before);
  });

  it('does not interpret a foreign currency, impossible date, or workbook title as a valid budget target', async () => {
    const h = harness();
    const before = structuredClone(h.workbook);
    for (const overrides of [
      { currency: 'USD' },
      { createdAt: '2026-02-31' },
      { month: '2026-13' }
    ]) {
      expect(
        await h.call('set_budget', {
          month: '2026-10',
          categoryId: 'food',
          operation: 'update',
          planned: 6000,
          ...overrides
        })
      ).toMatchObject({ ok: false, changed: false });
    }
    expect(
      await h.call('set_budget', {
        sheet: 'Main Plan',
        categoryId: 'food',
        operation: 'update',
        planned: 6000
      })
    ).toMatchObject({ ok: false, errors: [{ code: 'reference_not_found' }] });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('removes legacy manual planning while preserving recurring commitments and other categories', async () => {
    const h = harness();
    const sheet = h.workbook.sheets[1];
    sheet.budgets = [
      { categoryId: 'salary', planned: 35000, createdAt: '2026-09-01', note: 'Keep salary' }
    ];
    sheet.budgetLineItems = [
      {
        id: 'manual-food',
        categoryId: 'food',
        name: 'Legacy Food',
        planned: 1200,
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'tracked-food',
        categoryId: 'food',
        name: 'Tracked bill',
        planned: 500,
        recurringItemId: 'recurring-food',
        isActive: true
      }
    ];
    const salary = structuredClone(sheet.budgets[0]);
    const tracked = structuredClone(sheet.budgetLineItems[1]);
    const proposal = await h.call('archive_budget', { month: '2026-10', categoryId: 'food' });
    expect(proposal).toMatchObject({ data: { budget: { planned: 1200, currency: 'PHP' } } });
    expect(
      await h.call('archive_budget', reviewedArguments(proposal), { approvedByUser: true })
    ).toMatchObject({ ok: true });
    expect(h.workbook.sheets[1].budgets).toEqual([salary]);
    expect(h.workbook.sheets[1].budgetLineItems[0].isActive).toBe(false);
    expect(h.workbook.sheets[1].budgetLineItems[1]).toEqual(tracked);
  });
});
