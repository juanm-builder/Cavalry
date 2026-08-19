import { describe, expect, it } from 'vitest';

import {
  buildCategoriesFeatureModel,
  CATEGORY_ACTIONS,
  executeCategoryCommand
} from '../../src/renderer/features/categories/category-controller.js';

function makeWorkbook() {
  return {
    id: 'category-controller-workbook',
    version: 2,
    name: 'Categories',
    year: 2026,
    currency: 'PHP',
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
        id: 'unused',
        name: 'Unused',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'unused-expense',
        isActive: true
      },
      {
        id: 'system',
        name: 'System',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'system-expense',
        isSystem: true,
        isActive: true
      }
    ],
    accounts: [
      {
        id: 'food-expense',
        name: 'Food',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'unused-expense',
        name: 'Unused',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'system-expense',
        name: 'System',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      },
      { id: 'cash', name: 'Cash', group: 'asset', subtype: 'cash', currency: 'PHP', isActive: true }
    ],
    transactions: [
      {
        id: 'txn-food',
        date: '2026-06-01',
        template: 'expense_paid',
        categoryId: 'food',
        amount: 125,
        baseAmount: 125,
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: 125, baseAmount: 125 },
          { accountId: 'cash', direction: 'credit', amount: 125, baseAmount: 125 }
        ]
      }
    ],
    recurringItems: [],
    sheets: []
  };
}

describe('category controller', () => {
  it('creates a category and linked account on a cloned workbook', () => {
    const workbook = makeWorkbook();
    const result = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.CREATE,
      payload: {
        name: 'Travel',
        type: 'expense',
        postingAccountName: 'Travel Expense',
        icon: 'flight',
        color: '#5ba1df',
        description: 'Flights and travel costs',
        plannerBucketId: 'daily-expenses',
        autoCategorizeRules: [{ field: 'description', operator: 'contains', value: 'airline' }]
      }
    });

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.categories.some((category) => category.name === 'Travel')).toBe(false);
    expect(
      result.workbook.categories.find((category) => category.name === 'Travel').linkedAccountId
    ).toBeTruthy();
    expect(result.workbook.categories.find((category) => category.name === 'Travel')).toMatchObject(
      {
        icon: 'flight',
        color: '#5ba1df',
        description: 'Flights and travel costs',
        plannerBucketId: 'daily-expenses',
        autoCategorizeRules: [{ field: 'description', operator: 'contains', value: 'airline' }]
      }
    );
    expect(result.events[0]).toMatchObject({ type: 'category.created' });
  });

  it('assigns a valid semantic icon when a category is created without one', () => {
    const workbook = makeWorkbook();
    const result = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.CREATE,
      payload: {
        name: 'Telecommunications',
        type: 'expense',
        postingAccountName: 'Telecommunications Expense'
      }
    });

    expect(result.ok).toBe(true);
    expect(
      result.workbook.categories.find((category) => category.name === 'Telecommunications')
    ).toMatchObject({ icon: 'phone_iphone' });
  });

  it('blocks referenced deletes and system mutations without changing identity', () => {
    const workbook = makeWorkbook();
    const referenced = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.DELETE,
      payload: { categoryId: 'food' }
    });
    const system = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.RENAME,
      payload: { categoryId: 'system', name: 'Changed' }
    });

    expect(referenced.ok).toBe(false);
    expect(referenced.workbook).toBe(workbook);
    expect(referenced.errors[0].code).toBe('category_in_use');
    expect(system.ok).toBe(false);
    expect(system.workbook).toBe(workbook);
    expect(system.errors[0].code).toBe('category.system_protected');
  });

  it('updates category appearance and rules on a cloned workbook', () => {
    const workbook = makeWorkbook();
    const result = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.RENAME,
      payload: {
        categoryId: 'unused',
        name: 'Flexible Spending',
        icon: 'flight',
        color: '#5ba1df',
        description: 'Flexible expenses',
        plannerBucketId: '',
        autoCategorizeRules: [{ field: 'description', operator: 'contains', value: 'airline' }]
      }
    });

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.categories.find((category) => category.id === 'unused').name).toBe('Unused');
    expect(result.workbook.categories.find((category) => category.id === 'unused')).toMatchObject({
      name: 'Flexible Spending',
      icon: 'flight',
      color: '#5ba1df',
      description: 'Flexible expenses',
      plannerBucketId: '',
      autoCategorizeRules: [{ field: 'description', operator: 'contains', value: 'airline' }]
    });
    expect(result.events[0]).toMatchObject({ type: 'category.updated', categoryId: 'unused' });
  });

  it('supports icon-only updates, including system appearance, and rejects invalid icons', () => {
    const workbook = makeWorkbook();
    const updated = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.UPDATE,
      payload: { categoryId: 'unused', icon: 'shopping_bag', color: '#5ba1df' }
    });
    const systemAppearance = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.UPDATE,
      payload: { categoryId: 'system', icon: 'category' }
    });
    const invalid = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.UPDATE,
      payload: { categoryId: 'unused', icon: 'not_a_real_category_icon' }
    });
    const empty = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.UPDATE,
      payload: { categoryId: 'unused', icon: '' }
    });

    expect(updated.ok).toBe(true);
    expect(updated.workbook.categories.find((category) => category.id === 'unused')).toMatchObject({
      icon: 'shopping_bag',
      color: '#5ba1df'
    });
    expect(workbook.categories.find((category) => category.id === 'unused').icon).toBeUndefined();
    expect(systemAppearance.ok).toBe(true);
    expect(
      systemAppearance.workbook.categories.find((category) => category.id === 'system').icon
    ).toBe('category');
    expect(invalid).toMatchObject({
      ok: false,
      workbook,
      errors: [expect.objectContaining({ code: 'category.icon_invalid' })]
    });
    expect(empty).toMatchObject({
      ok: false,
      workbook,
      errors: [expect.objectContaining({ code: 'category.icon_invalid' })]
    });
  });

  it('updates linked accounts and deletes unused categories immutably', () => {
    const workbook = makeWorkbook();
    const linked = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.LINK,
      payload: { categoryId: 'food', linkedAccountName: 'Meals Expense' }
    });
    const deleted = executeCategoryCommand(workbook, {
      type: CATEGORY_ACTIONS.DELETE,
      payload: { categoryId: 'unused' }
    });

    expect(linked.ok).toBe(true);
    expect(linked.workbook.accounts.find((account) => account.id === 'food-expense').name).toBe(
      'Meals Expense'
    );
    expect(workbook.accounts.find((account) => account.id === 'food-expense').name).toBe('Food');
    expect(deleted.ok).toBe(true);
    expect(deleted.workbook.categories.some((category) => category.id === 'unused')).toBe(false);
  });

  it('builds a serializable model with reference and protection flags', () => {
    const model = buildCategoriesFeatureModel(makeWorkbook());

    expect(model.categoryRows.find((row) => row.id === 'food')).toMatchObject({
      color: '#c47a2c',
      hasReferences: true,
      spent: 125
    });
    expect(model.categoryRows.find((row) => row.id === 'system')).toMatchObject({
      isSystem: true,
      canDelete: false
    });
    expect(() => JSON.stringify(model)).not.toThrow();
  });

  it('treats merchant refunds as spending reversals', () => {
    const workbook = makeWorkbook();
    workbook.transactions.push({
      id: 'txn-food-refund',
      date: '2026-06-02',
      template: 'merchant_refund',
      categoryId: 'food',
      amount: 200,
      baseAmount: 200,
      lines: [
        { accountId: 'cash', direction: 'debit', amount: 200, baseAmount: 200 },
        { accountId: 'food-expense', direction: 'credit', amount: 200, baseAmount: 200 }
      ]
    });

    const food = buildCategoriesFeatureModel(workbook).categoryRows.find(
      (row) => row.id === 'food'
    );
    expect(food).toMatchObject({
      spent: -75,
      amountTone: 'good',
      activityLabel: 'Refunded',
      percent: 100
    });
  });

  it('presents savings and debt activity as favorable progress', () => {
    const workbook = makeWorkbook();
    workbook.categories.push(
      {
        id: 'emergency-fund',
        name: 'Emergency Fund',
        type: 'savings',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'card-paydown',
        name: 'Card Paydown',
        type: 'debt',
        currency: 'PHP',
        isActive: true
      }
    );
    workbook.transactions.push(
      {
        id: 'txn-save',
        date: '2026-06-02',
        template: 'expense_paid',
        eventKind: 'savings_contribution',
        categoryId: 'emergency-fund',
        amount: 300,
        baseAmount: 300,
        lines: []
      },
      {
        id: 'txn-paydown',
        date: '2026-06-03',
        template: 'debt_payment',
        eventKind: 'debt_principal_payment',
        categoryId: 'card-paydown',
        amount: 200,
        baseAmount: 200,
        lines: []
      }
    );

    const rows = buildCategoriesFeatureModel(workbook).categoryRows;
    expect(rows.find((row) => row.id === 'emergency-fund')).toMatchObject({
      spent: 300,
      amountTone: 'good',
      activityLabel: 'Saved'
    });
    expect(rows.find((row) => row.id === 'card-paydown')).toMatchObject({
      spent: 200,
      amountTone: 'good',
      activityLabel: 'Paid down'
    });
  });
});
