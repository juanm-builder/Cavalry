// Tests for Advisor draft mutations.

import { describe, expect, it } from 'vitest';
import {
  applyAccountAiDraftMutation,
  applyBudgetAiDraftMutation,
  applyCategoryAiDraftMutation,
  applyCounterpartyAiDraftMutation,
  applyRecurringAiDraftMutation,
  validateEntityAiDraftMutation
} from '@cavalry/advisor/domain/advisor/draft-mutations.js';

const services = {
  ensureCategoryPlannerBucket: (_workbook, category) => {
    category.plannerBucketId = category.plannerBucketId || 'bucket-main';
    return category.plannerBucketId;
  },
  isAccountNameTaken: (workbook, name, group, currency, excludeId) =>
    (workbook.accounts || []).some(
      (account) =>
        account.id !== excludeId &&
        account.name.toLowerCase() === String(name || '').toLowerCase() &&
        account.group === group &&
        account.currency === currency &&
        account.isActive !== false
    ),
  normalizeCategory: (category, index, currency) => ({
    id: category.id || `cat-${index}`,
    name: category.name,
    type: category.type || 'expense',
    color: category.color || '#ef7f7f',
    currency,
    isActive: category.isActive !== false,
    plannerBucketId: category.plannerBucketId || ''
  }),
  normalizeAccount: (account, index, currency) => ({
    id: account.id || `account-${index}`,
    name: account.name,
    group: account.group,
    subtype: account.subtype || '',
    currency: account.currency || currency,
    note: account.note || '',
    openedDate: account.openedDate || '2026-06-26',
    isActive: account.isActive !== false
  }),
  normalizeRecurringItem: (item, index, currency) => ({
    id: item.id || `recurring-${index}`,
    kind: item.kind || 'bill',
    name: String(item.name || '').trim(),
    categoryId: String(item.categoryId || '').trim(),
    amount: Number(item.amount || item.planned || 0) || 0,
    currency,
    anchorDate: String(item.anchorDate || item.dueDate || '').trim(),
    isActive: item.isActive !== false
  }),
  ensureCounterparty: (workbook, counterparty) => {
    const name = String(counterparty.name || '').trim();
    if (!name) return null;
    const existing = (workbook.counterparties || []).find(
      (item) => item.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing;
    const created = {
      id: `counterparty-${(workbook.counterparties || []).length}`,
      name,
      kind: counterparty.kind || 'other',
      note: counterparty.note || '',
      isActive: true
    };
    workbook.counterparties = workbook.counterparties || [];
    workbook.counterparties.push(created);
    return created;
  },
  typeColors: {
    expense: '#ef7f7f',
    income: '#53d18f',
    savings: '#84b7ff',
    debt: '#f2b359'
  }
};

function makeWorkbook() {
  return {
    currency: 'PHP',
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        isActive: true,
        plannerBucketId: 'bucket-main'
      },
      { id: 'old', name: 'Old', type: 'expense', currency: 'PHP', isActive: false }
    ],
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      { id: 'food-account', name: 'Food', group: 'expense', currency: 'PHP', isActive: true }
    ],
    counterparties: [{ id: 'store', name: 'Store', kind: 'merchant', note: '', isActive: true }],
    recurringItems: [
      {
        id: 'rent',
        name: 'Rent',
        categoryId: 'food',
        amount: 1000,
        currency: 'PHP',
        anchorDate: '2026-06-01',
        isActive: true
      }
    ],
    transactions: [{ id: 'txn-one' }],
    sheets: [{ id: 'sheet-june', budgets: [{ categoryId: 'food', planned: 500 }] }]
  };
}

describe('advisor draft mutations', () => {
  it('creates categories with linked posting accounts and planner buckets', () => {
    const workbook = makeWorkbook();
    const id = applyCategoryAiDraftMutation(
      workbook,
      {
        operation: 'create',
        proposed: { name: 'Food', type: 'expense' }
      },
      services
    );

    expect(id).toBe('food');
    expect(workbook.categories.find((category) => category.id === 'food').isActive).toBe(true);

    const transportId = applyCategoryAiDraftMutation(
      workbook,
      {
        operation: 'create',
        proposed: { name: 'Transport', type: 'expense' }
      },
      services
    );
    expect(transportId).toBe('cat-2');
    expect(workbook.accounts.at(-1)).toMatchObject({
      name: 'Transport',
      group: 'expense',
      subtype: 'expense'
    });
    expect(workbook.categories.at(-1).plannerBucketId).toBe('bucket-main');
  });

  it('edits, archives, and validates simple entity drafts', () => {
    const workbook = makeWorkbook();
    expect(
      validateEntityAiDraftMutation(workbook, {
        objectType: 'category',
        operation: 'edit',
        targetId: 'food',
        proposed: { name: 'Meals' }
      })
    ).toBe(true);
    expect(
      applyCategoryAiDraftMutation(
        workbook,
        {
          operation: 'edit',
          targetId: 'food',
          proposed: { name: 'Meals', note: 'Daily food' }
        },
        services
      )
    ).toBe('food');
    expect(workbook.categories[0].name).toBe('Meals');

    expect(
      applyCounterpartyAiDraftMutation(
        workbook,
        {
          operation: 'edit',
          targetId: 'store',
          proposed: { name: 'Corner Store', kind: 'merchant' }
        },
        services
      )
    ).toBe('store');
    expect(workbook.counterparties[0].name).toBe('Corner Store');

    expect(
      applyCounterpartyAiDraftMutation(
        workbook,
        {
          operation: 'archive',
          targetId: 'store',
          proposed: {}
        },
        services
      )
    ).toBe('store');
    expect(workbook.counterparties[0].isActive).toBe(false);
  });

  it('creates, edits, archives, and validates account drafts', () => {
    const workbook = makeWorkbook();
    const createdId = applyAccountAiDraftMutation(
      workbook,
      {
        objectType: 'account',
        operation: 'create',
        proposed: { name: 'Savings Wallet', group: 'asset', subtype: 'wallet', currency: 'PHP' }
      },
      services
    );

    expect(createdId).toBe('account-2');
    expect(workbook.accounts.at(-1)).toMatchObject({
      name: 'Savings Wallet',
      group: 'asset',
      subtype: 'wallet',
      currency: 'PHP',
      isActive: true
    });

    expect(
      validateEntityAiDraftMutation(
        workbook,
        {
          objectType: 'account',
          operation: 'edit',
          targetId: createdId,
          proposed: { name: 'Emergency Wallet', group: 'asset', currency: 'PHP' }
        },
        services
      )
    ).toBe(true);
    expect(
      applyAccountAiDraftMutation(
        workbook,
        {
          objectType: 'account',
          operation: 'edit',
          targetId: createdId,
          proposed: { name: 'Emergency Wallet', note: 'Cash buffer' }
        },
        services
      )
    ).toBe(createdId);
    expect(workbook.accounts.find((account) => account.id === createdId)).toMatchObject({
      name: 'Emergency Wallet',
      note: 'Cash buffer'
    });

    expect(
      applyAccountAiDraftMutation(
        workbook,
        {
          objectType: 'account',
          operation: 'archive',
          targetId: createdId,
          proposed: { id: createdId }
        },
        services
      )
    ).toBe(createdId);
    expect(workbook.accounts.find((account) => account.id === createdId).isActive).toBe(false);
  });

  it('creates counterparties through the supplied service', () => {
    const workbook = makeWorkbook();
    const id = applyCounterpartyAiDraftMutation(
      workbook,
      {
        operation: 'create',
        proposed: { name: 'Globe', kind: 'biller', note: 'Phone load' }
      },
      services
    );

    expect(id).toBe('counterparty-1');
    expect(workbook.counterparties.at(-1)).toMatchObject({
      name: 'Globe',
      kind: 'biller',
      note: 'Phone load'
    });
  });

  it('creates and edits recurring drafts while linking source transactions', () => {
    const workbook = makeWorkbook();
    const createdId = applyRecurringAiDraftMutation(
      workbook,
      {
        operation: 'create',
        proposed: {
          name: 'Netflix',
          categoryId: 'food',
          amount: 549,
          anchorDate: '2026-06-18',
          sourceTransactionIds: ['txn-one']
        }
      },
      services
    );

    expect(createdId).toBe('recurring-1');
    expect(workbook.transactions[0].recurringItemId).toBe('recurring-1');

    const editedId = applyRecurringAiDraftMutation(
      workbook,
      {
        operation: 'edit',
        targetId: 'recurring-1',
        proposed: {
          name: 'Netflix Plan',
          categoryId: 'food',
          amount: 599,
          anchorDate: '2026-06-18'
        }
      },
      services
    );
    expect(editedId).toBe('recurring-1');
    expect(workbook.recurringItems.find((item) => item.id === 'recurring-1').name).toBe(
      'Netflix Plan'
    );
  });

  it('links every reviewed source transaction to the created recurring item', () => {
    const workbook = makeWorkbook();
    workbook.transactions.push({ id: 'txn-two' });

    const createdId = applyRecurringAiDraftMutation(
      workbook,
      {
        operation: 'create',
        proposed: {
          name: 'Netflix',
          categoryId: 'food',
          amount: 549,
          anchorDate: '2026-06-04',
          sourceTransactionIds: ['txn-two', 'txn-one', 'missing-transaction']
        }
      },
      services
    );

    expect(createdId).toBe('recurring-1');
    expect(workbook.recurringItems.at(-1)).toMatchObject({
      id: 'recurring-1',
      anchorDate: '2026-06-04'
    });
    expect(workbook.transactions.map((transaction) => transaction.recurringItemId)).toEqual([
      'recurring-1',
      'recurring-1'
    ]);
  });

  it('updates and archives budget drafts', () => {
    const workbook = makeWorkbook();
    expect(
      applyBudgetAiDraftMutation(workbook, {
        operation: 'create',
        proposed: { sheetId: 'sheet-june', categoryId: 'food', planned: 750.129 }
      })
    ).toBe('sheet-june:food');
    expect(workbook.sheets[0].budgets).toEqual([{ categoryId: 'food', planned: 750.13 }]);

    applyBudgetAiDraftMutation(workbook, {
      operation: 'archive',
      targetId: 'sheet-june',
      proposed: { categoryId: 'food' }
    });
    expect(workbook.sheets[0].budgets).toEqual([]);
  });

  it('applies reviewed delete drafts for workbook entities', () => {
    const workbook = makeWorkbook();
    workbook.transactions.push({
      id: 'txn-food',
      categoryId: 'food',
      counterpartyId: 'store',
      recurringItemId: 'rent'
    });
    workbook.sheets[0].budgetLineItems = [
      { id: 'line-food', categoryId: 'food', recurringItemId: 'rent', isActive: true }
    ];

    expect(
      applyCounterpartyAiDraftMutation(
        workbook,
        {
          operation: 'delete',
          objectType: 'counterparty',
          targetId: 'store',
          proposed: { id: 'store' }
        },
        services
      )
    ).toBe('store');
    expect(workbook.counterparties).toEqual([]);
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn-food').counterpartyId
    ).toBe('');

    expect(
      applyRecurringAiDraftMutation(
        workbook,
        {
          operation: 'delete',
          objectType: 'recurringItem',
          targetId: 'rent',
          proposed: { id: 'rent' }
        },
        services
      )
    ).toBe('rent');
    expect(workbook.recurringItems).toEqual([]);
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn-food').recurringItemId
    ).toBe('');
    expect(workbook.sheets[0].budgetLineItems[0]).toMatchObject({
      isActive: false,
      recurringItemId: ''
    });

    expect(
      applyCategoryAiDraftMutation(
        workbook,
        {
          operation: 'delete',
          objectType: 'category',
          targetId: 'food',
          proposed: { id: 'food' }
        },
        services
      )
    ).toBe('food');
    expect(workbook.categories.map((category) => category.id)).not.toContain('food');
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn-food').categoryId
    ).toBe('');
    expect(workbook.sheets[0].budgets).toEqual([]);
    expect(workbook.sheets[0].budgetLineItems).toEqual([]);
  });

  it('reports validation failures consistently', () => {
    const workbook = makeWorkbook();
    workbook.transactions.push({ id: 'txn-food-ref', categoryId: 'food' });
    expect(() =>
      validateEntityAiDraftMutation(workbook, {
        objectType: 'category',
        operation: 'delete',
        targetId: 'food',
        proposed: { id: 'food' }
      })
    ).toThrow('Category is still referenced.');
    expect(() =>
      validateEntityAiDraftMutation(workbook, {
        objectType: 'budget',
        operation: 'create',
        proposed: { sheetId: 'missing', categoryId: 'food' }
      })
    ).toThrow('Budget month not found.');
    expect(() =>
      validateEntityAiDraftMutation(
        workbook,
        {
          objectType: 'recurringItem',
          operation: 'create',
          proposed: { name: 'Bad recurring', amount: 10, anchorDate: '2026-06-18' }
        },
        services
      )
    ).toThrow('Recurring item needs a valid category, name, amount, and anchor date.');
    workbook.transactions.push({
      id: 'txn-cash-ref',
      lines: [{ accountId: 'cash' }]
    });
    expect(() =>
      validateEntityAiDraftMutation(
        workbook,
        {
          objectType: 'account',
          operation: 'delete',
          targetId: 'cash',
          proposed: { id: 'cash' }
        },
        services
      )
    ).toThrow('Account is still referenced.');
  });
});
