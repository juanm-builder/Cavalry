import { describe, expect, it, vi } from 'vitest';

import { executeCavalryAssistantTool } from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';
import { fuzzyEntitySuggestions } from '../../src/renderer/features/assistant/cavalry-assistant-tool-support.js';
import {
  buildCavalryAssistantWorkspaceSnapshot,
  CAVALRY_ASSISTANT_SNAPSHOT_MAX_CHARS
} from '../../src/renderer/features/assistant/cavalry-assistant-workspace-snapshot.js';

function expenseTransaction({ id, date, description, amount, categoryId, counterpartyId = '' }) {
  return {
    id,
    date,
    monthKey: date.slice(0, 7),
    template: 'expense_paid',
    description,
    categoryId,
    counterpartyId,
    originalCurrency: 'PHP',
    amount,
    baseAmount: amount,
    source: 'manual',
    lines: [
      {
        id: `line-${id}-expense`,
        accountId: categoryId === 'transport' ? 'transport-expense' : 'food-expense',
        direction: 'debit',
        amount,
        currency: 'PHP',
        baseAmount: amount
      },
      {
        id: `line-${id}-cash`,
        accountId: 'cash',
        direction: 'credit',
        amount,
        currency: 'PHP',
        baseAmount: amount
      }
    ]
  };
}

function refundTransaction({ id, date, description, amount, categoryId, counterpartyId = '' }) {
  return {
    id,
    date,
    monthKey: date.slice(0, 7),
    template: 'merchant_refund',
    eventKind: 'merchant_refund',
    description,
    categoryId,
    counterpartyId,
    originalCurrency: 'PHP',
    amount,
    baseAmount: amount,
    source: 'manual',
    lines: [
      {
        id: `line-${id}-cash`,
        accountId: 'cash',
        direction: 'debit',
        amount,
        currency: 'PHP',
        baseAmount: amount
      },
      {
        id: `line-${id}-expense`,
        accountId: 'food-expense',
        direction: 'credit',
        amount,
        currency: 'PHP',
        baseAmount: amount
      }
    ]
  };
}

function makeWorkbook() {
  return {
    id: 'open-advisor-workbook',
    version: 2,
    name: 'Open Advisor',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'opening-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      },
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'card',
        name: 'Credit Card',
        group: 'liability',
        subtype: 'credit_card',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'transport-expense',
        name: 'Transport Expense',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'transport',
        name: 'Transport',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'transport-expense',
        isActive: true
      }
    ],
    counterparties: [
      { id: 'market', name: 'Corner Market', kind: 'merchant', isActive: true },
      { id: 'grab', name: 'Grab', kind: 'merchant', isActive: true }
    ],
    transactions: [
      expenseTransaction({
        id: 'txn-1',
        date: '2026-07-02',
        description: 'Groceries',
        amount: 1200,
        categoryId: 'food',
        counterpartyId: 'market'
      }),
      expenseTransaction({
        id: 'txn-2',
        date: '2026-07-08',
        description: 'Groceries again',
        amount: 800,
        categoryId: 'food',
        counterpartyId: 'market'
      }),
      expenseTransaction({
        id: 'txn-3',
        date: '2026-07-09',
        description: 'Ride to work',
        amount: 400,
        categoryId: 'transport',
        counterpartyId: 'grab'
      })
    ],
    recurringItems: [
      {
        id: 'internet',
        kind: 'bill',
        name: 'Internet',
        categoryId: 'food',
        accountId: 'cash',
        amount: 1500,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-07-15',
        isActive: true
      }
    ],
    sheets: [
      {
        id: 'july',
        name: 'July',
        monthIndex: 6,
        budgets: [{ categoryId: 'food', planned: 5000 }],
        budgetLineItems: []
      }
    ],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

function makeContext(workbook) {
  return {
    getWorkbook: vi.fn(() => workbook),
    services: {
      createId: (prefix = 'id') => `${prefix}_1`,
      defaultDate: () => '2026-07-10',
      today: () => '2026-07-10'
    }
  };
}

function callTool(name, argumentsValue, context) {
  return executeCavalryAssistantTool(
    {
      type: 'function_call',
      name,
      call_id: `call-${name}`,
      arguments: JSON.stringify(argumentsValue)
    },
    context
  );
}

describe('workspace snapshot', () => {
  it('summarizes position, accounts, month flow, budgets, and upcoming bills', () => {
    const built = buildCavalryAssistantWorkspaceSnapshot(makeWorkbook(), { today: '2026-07-10' });

    expect(built).not.toBeNull();
    const { snapshot, json } = built;
    expect(snapshot.workbook).toMatchObject({ name: 'Open Advisor', currency: 'PHP' });
    expect(snapshot.asOf).toBe('2026-07-10');
    expect(snapshot.position).toHaveProperty('netWorth');
    expect(snapshot.accounts.rows.some((row) => row.name === 'Cash')).toBe(true);
    expect(snapshot.thisMonth.range).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(snapshot.thisMonth.expense).toBe(2400);
    expect(snapshot.thisMonth.topExpenseCategories[0]).toMatchObject({
      category: 'Food',
      total: 2000,
      transactionCount: 2
    });
    expect(snapshot.budgets.rows[0]).toMatchObject({ category: 'Food', planned: 5000 });
    expect(snapshot.upcomingBills[0]).toMatchObject({ name: 'Internet', amount: 1500 });
    expect(snapshot.counts.transactions).toBe(3);
    expect(json.length).toBeLessThanOrEqual(CAVALRY_ASSISTANT_SNAPSHOT_MAX_CHARS);
  });

  it('stays within the size budget for a large workbook by shedding detail', () => {
    const workbook = makeWorkbook();
    for (let index = 0; index < 60; index += 1) {
      workbook.accounts.push({
        id: `extra-${index}`,
        name: `Extra Savings Account Number ${index}`,
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      });
    }

    const built = buildCavalryAssistantWorkspaceSnapshot(workbook, { today: '2026-07-10' });

    expect(built.json.length).toBeLessThanOrEqual(CAVALRY_ASSISTANT_SNAPSHOT_MAX_CHARS);
    expect(built.snapshot.accounts.omittedCount).toBeGreaterThan(0);
  });

  it('nets refunds in the snapshot instead of presenting them as new spending', () => {
    const workbook = makeWorkbook();
    workbook.transactions.push(
      refundTransaction({
        id: 'txn-refund',
        date: '2026-07-10',
        description: 'Groceries refund',
        amount: 300,
        categoryId: 'food',
        counterpartyId: 'market'
      })
    );

    const { snapshot } = buildCavalryAssistantWorkspaceSnapshot(workbook, {
      today: '2026-07-10'
    });

    expect(snapshot.thisMonth.expense).toBe(2100);
    expect(snapshot.thisMonth.topExpenseCategories[0]).toMatchObject({
      category: 'Food',
      total: 1700,
      transactionCount: 3
    });
  });

  it('never throws on a malformed or empty workbook', () => {
    expect(buildCavalryAssistantWorkspaceSnapshot(null, { today: '2026-07-10' })).toBeNull();
    expect(() =>
      buildCavalryAssistantWorkspaceSnapshot({ name: 'Broken' }, { today: 'not-a-date' })
    ).not.toThrow();
  });
});

describe('summarize_spending tool', () => {
  it('aggregates the full filtered set by category with shares and citable evidence', async () => {
    const workbook = makeWorkbook();
    const result = await callTool(
      'summarize_spending',
      { groupBy: 'category', start: '2026-07-01', end: '2026-07-31' },
      makeContext(workbook)
    );

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.data.groupBy).toBe('category');
    expect(result.data.grandTotal).toBe(2400);
    expect(result.data.groups).toEqual([
      expect.objectContaining({ label: 'Food', total: 2000, transactionCount: 2, share: 83.3 }),
      expect.objectContaining({ label: 'Transport', total: 400, transactionCount: 1, share: 16.7 })
    ]);
    expect(result.data.transactionCount).toBe(3);
    // Evidence covers every underlying record, not just a preview page.
    expect(result.referenceData.evidenceSets[0].source_refs).toHaveLength(3);
    expect(result.data.evidenceSetId).toBe(result.referenceData.evidenceSets[0].id);
  });

  it('groups by counterparty and by month', async () => {
    const workbook = makeWorkbook();
    const context = makeContext(workbook);

    const byCounterparty = await callTool(
      'summarize_spending',
      { groupBy: 'counterparty' },
      context
    );
    expect(byCounterparty.data.groups[0]).toMatchObject({ label: 'Corner Market', total: 2000 });

    const byMonth = await callTool('summarize_spending', { groupBy: 'month' }, context);
    expect(byMonth.data.groups).toEqual([
      expect.objectContaining({ label: '2026-07', total: 2400, transactionCount: 3 })
    ]);
  });

  it('reports omitted groups when the limit truncates the breakdown', async () => {
    const workbook = makeWorkbook();
    const result = await callTool(
      'summarize_spending',
      { groupBy: 'category', limit: 1 },
      makeContext(workbook)
    );

    expect(result.data.groups).toHaveLength(1);
    expect(result.data.groupCount).toBe(2);
    expect(result.data.omitted).toEqual({ groupCount: 1, total: 400 });
  });
});

describe('entity resolution guidance', () => {
  it('offers close matches instead of dead-ending on an unknown name', async () => {
    const workbook = makeWorkbook();
    const result = await callTool(
      'search_transactions',
      { category: 'foods' },
      makeContext(workbook)
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_found');
    expect(result.errors[0].message).toContain('Closest matches');
    expect(result.errors[0].message).toContain('Food (food)');
  });

  it('lists the colliding records when a name is ambiguous', () => {
    const items = [
      { id: 'a1', name: 'Savings' },
      { id: 'a2', name: 'Savings' }
    ];

    expect(fuzzyEntitySuggestions(items, 'saving', ['name'])).toContain('Savings (a1)');
  });

  it('returns no suggestions for a reference with nothing similar', () => {
    expect(fuzzyEntitySuggestions([{ id: 'a1', name: 'Savings' }], 'zzzz', ['name'])).toBe('');
  });
});
