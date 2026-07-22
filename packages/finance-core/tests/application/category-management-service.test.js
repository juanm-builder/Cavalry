import { describe, expect, it } from 'vitest';

import {
  CategoryManagementError,
  createCategoryWithLinkedAccount,
  deleteCategory,
  getCategoryUsageSummary,
  renameCategory,
  replaceCategoryLinkedAccount,
  setCategoryActive,
  updateCategoryLinkedAccount
} from '@cavalry/finance-core/application/categories/category-management-service.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeWorkbook() {
  return {
    currency: 'PHP',
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        color: '#f97316',
        currency: 'PHP',
        isActive: true,
        plannerBucketId: 'bucket-food',
        linkedAccountId: 'food-expense'
      },
      {
        id: 'salary',
        name: 'Salary',
        type: 'income',
        color: '#16a34a',
        currency: 'PHP',
        isActive: true,
        plannerBucketId: 'bucket-income',
        linkedAccountId: 'salary-income'
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
        id: 'salary-income',
        name: 'Salary',
        group: 'income',
        subtype: 'income',
        currency: 'PHP',
        isActive: true
      },
      { id: 'cash', name: 'Cash', group: 'asset', subtype: 'cash', currency: 'PHP', isActive: true }
    ],
    transactions: [
      {
        id: 'txn-food',
        categoryId: 'food',
        template: 'expense_paid',
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: 250 },
          { accountId: 'cash', direction: 'credit', amount: 250 }
        ]
      }
    ],
    recurringItems: [{ id: 'rec-food', categoryId: 'food', isActive: true }],
    sheets: [
      {
        id: 'sheet-june',
        budgets: [{ categoryId: 'food', planned: 1000 }],
        budgetLineItems: [{ id: 'line-food', categoryId: 'food', planned: 500 }],
        entries: [{ id: 'entry-food', categoryId: 'food', amount: 300 }]
      }
    ]
  };
}

function makeServices() {
  return {
    typeLabels: {
      income: 'Income',
      expense: 'Expense',
      savings: 'Savings',
      debt: 'Debt'
    },
    typeColors: {
      income: '#16a34a',
      expense: '#f97316',
      savings: '#0ea5e9',
      debt: '#dc2626'
    },
    normalizeCategory(input, index, baseCurrency) {
      return {
        id: input.id || 'cat_' + String(index + 1),
        name: String(input.name || '').trim(),
        type: input.type,
        color: input.color,
        currency: String(input.currency || baseCurrency || 'PHP')
          .trim()
          .toUpperCase(),
        isActive: input.isActive !== false,
        plannerBucketId: String(input.plannerBucketId || '').trim()
      };
    },
    normalizeAccount(input, index, baseCurrency) {
      return {
        id: input.id || 'account_' + String(index + 1),
        name: String(input.name || '').trim(),
        group: String(input.group || 'asset').toLowerCase(),
        subtype: String(input.subtype || '').trim(),
        currency: String(input.currency || baseCurrency || 'PHP')
          .trim()
          .toUpperCase(),
        note: String(input.note || ''),
        isActive: input.isActive !== false
      };
    },
    ensureCategoryPlannerBucket(workbook, category) {
      if (!category.plannerBucketId) {
        category.plannerBucketId = 'bucket-' + category.type;
      }
      return category.plannerBucketId;
    },
    getCategoryById(workbook, categoryId) {
      return (workbook.categories || []).find((category) => category.id === categoryId) || null;
    },
    getAccountById(workbook, accountId) {
      return (workbook.accounts || []).find((account) => account.id === accountId) || null;
    },
    isCategoryNameTaken(workbook, name, excludeId) {
      const targetName = String(name || '')
        .trim()
        .toLowerCase();
      return (workbook.categories || []).some((category) => {
        return (
          category.id !== excludeId &&
          String(category.name || '')
            .trim()
            .toLowerCase() === targetName
        );
      });
    },
    isAccountNameTaken(workbook, name, group, currency, excludeId) {
      const targetName = String(name || '')
        .trim()
        .toLowerCase();
      const targetGroup = String(group || '').toLowerCase();
      const targetCurrency = String(currency || '').toUpperCase();
      return (workbook.accounts || []).some((account) => {
        return (
          account.id !== excludeId &&
          account.isActive !== false &&
          account.group === targetGroup &&
          account.currency === targetCurrency &&
          String(account.name || '')
            .trim()
            .toLowerCase() === targetName
        );
      });
    },
    getAccountTransactionUsage(workbook, accountId) {
      const relatedTransactions = (workbook.transactions || []).filter((transaction) => {
        return (transaction.lines || []).some((line) => line.accountId === accountId);
      });
      return {
        relatedTransactions,
        hasHistory: relatedTransactions.length > 0,
        openingOnly: false
      };
    },
    archiveAccount(workbook, accountId) {
      const account = (workbook.accounts || []).find((item) => item.id === accountId);
      if (!account) {
        return false;
      }
      account.isActive = false;
      return true;
    }
  };
}

describe('category management service', () => {
  it('creates a category with a linked posting account and planner bucket', () => {
    const workbook = makeWorkbook();
    const result = createCategoryWithLinkedAccount(
      workbook,
      {
        name: 'Groceries',
        type: 'expense',
        postingAccountName: 'Food'
      },
      makeServices()
    );

    expect(result.feedback).toEqual({
      categoryId: 'cat_3',
      kind: 'good',
      message: 'Category created.'
    });
    expect(result.category).toMatchObject({
      id: 'cat_3',
      name: 'Groceries',
      type: 'expense',
      currency: 'PHP',
      isActive: true,
      plannerBucketId: 'bucket-expense',
      linkedAccountId: 'account_4'
    });
    expect(result.account).toMatchObject({
      id: 'account_4',
      name: 'Food 2',
      group: 'expense',
      subtype: 'expense',
      currency: 'PHP',
      note: 'Linked posting account for Groceries'
    });
    expect(workbook.categories).toContain(result.category);
    expect(workbook.accounts).toContain(result.account);
  });

  it('validates category creation and defaults unknown types to expense', () => {
    const workbook = makeWorkbook();

    expect(() => createCategoryWithLinkedAccount(workbook, { name: '  ' }, makeServices())).toThrow(
      'Category name is required.'
    );
    expect(() =>
      createCategoryWithLinkedAccount(workbook, { name: 'food' }, makeServices())
    ).toThrow('A category with this name already exists.');

    const result = createCategoryWithLinkedAccount(
      workbook,
      {
        name: 'Misc',
        type: 'not-real',
        postingAccountName: ''
      },
      makeServices()
    );

    expect(result.category.type).toBe('expense');
    expect(result.account.name).toBe('Misc');
  });

  it('creates income linked accounts even without renderer type services', () => {
    const workbook = { currency: 'PHP', categories: [], accounts: [] };
    const result = createCategoryWithLinkedAccount(workbook, {
      name: 'Bonus',
      type: 'income',
      postingAccountName: 'Bonus Income'
    });

    expect(result.category).toMatchObject({
      name: 'Bonus',
      type: 'income',
      linkedAccountId: 'account_1'
    });
    expect(result.account).toMatchObject({
      name: 'Bonus Income',
      group: 'income',
      subtype: 'income',
      currency: 'PHP'
    });
  });

  it('renames a category without renaming its linked posting account', () => {
    const workbook = makeWorkbook();
    const result = renameCategory(
      workbook,
      { categoryId: 'food', name: '  Dining  ' },
      makeServices()
    );

    expect(result.changed).toBe(true);
    expect(result.category.name).toBe('Dining');
    expect(workbook.accounts.find((account) => account.id === 'food-expense').name).toBe('Food');
    expect(result.feedback).toEqual({
      categoryId: 'food',
      kind: 'good',
      message: 'Category renamed.'
    });
    expect(() =>
      renameCategory(workbook, { categoryId: 'food', name: 'Salary' }, makeServices())
    ).toThrow('A category with this name already exists.');
  });

  it('hides and restores categories through isActive', () => {
    const workbook = makeWorkbook();

    const hidden = setCategoryActive(
      workbook,
      { categoryId: 'food', isActive: false },
      makeServices()
    );
    expect(hidden.category.isActive).toBe(false);
    expect(hidden.feedback).toEqual({
      categoryId: 'food',
      kind: 'warn',
      message: 'Category hidden from new entry choices.'
    });

    const restored = setCategoryActive(
      workbook,
      { categoryId: 'food', isActive: true },
      makeServices()
    );
    expect(restored.category.isActive).toBe(true);
    expect(restored.feedback).toEqual({
      categoryId: 'food',
      kind: 'good',
      message: 'Category restored.'
    });
  });

  it('updates or creates linked category posting accounts', () => {
    const workbook = makeWorkbook();

    const renamed = updateCategoryLinkedAccount(
      workbook,
      {
        categoryId: 'food',
        linkedAccountName: 'Meals'
      },
      makeServices()
    );
    expect(renamed.account).toMatchObject({
      id: 'food-expense',
      name: 'Meals',
      group: 'expense',
      subtype: 'expense'
    });
    expect(renamed.feedback.message).toBe('Linked account saved.');

    workbook.categories.push({
      id: 'rent',
      name: 'Rent',
      type: 'expense',
      currency: 'PHP',
      isActive: true
    });
    const created = updateCategoryLinkedAccount(
      workbook,
      {
        categoryId: 'rent',
        linkedAccountName: 'Rent Expense'
      },
      makeServices()
    );
    expect(created.account).toMatchObject({
      id: 'account_4',
      name: 'Rent Expense',
      group: 'expense'
    });
    expect(created.category.linkedAccountId).toBe('account_4');

    expect(() =>
      updateCategoryLinkedAccount(
        workbook,
        {
          categoryId: 'rent',
          linkedAccountName: 'Meals'
        },
        makeServices()
      )
    ).toThrow('An active linked account with this name already exists.');
  });

  it('replaces linked accounts by archiving accounts with history and removing unused accounts', () => {
    const workbook = makeWorkbook();
    const archived = replaceCategoryLinkedAccount(workbook, { categoryId: 'food' }, makeServices());

    expect(archived.archivedPreviousAccount).toBe(true);
    expect(workbook.accounts.find((account) => account.id === 'food-expense').isActive).toBe(false);
    expect(archived.account).toMatchObject({
      name: 'Food',
      group: 'expense',
      note: 'Replacement linked account'
    });
    expect(archived.feedback).toEqual({
      categoryId: 'food',
      kind: 'warn',
      message: 'Linked account archived. Replacement created.'
    });
    expect(workbook.categories.find((category) => category.id === 'food').linkedAccountId).toBe(
      archived.account.id
    );

    workbook.categories.push({
      id: 'travel',
      name: 'Travel',
      type: 'expense',
      currency: 'PHP',
      isActive: true,
      linkedAccountId: 'travel-expense'
    });
    workbook.accounts.push({
      id: 'travel-expense',
      name: 'Travel',
      group: 'expense',
      subtype: 'expense',
      currency: 'PHP',
      isActive: true
    });
    const removed = replaceCategoryLinkedAccount(
      workbook,
      { categoryId: 'travel' },
      makeServices()
    );

    expect(removed.removedPreviousAccount).toBe(true);
    expect(workbook.accounts.find((account) => account.id === 'travel-expense')).toBeUndefined();
    expect(removed.feedback.message).toBe('Linked account replaced.');
  });

  it('summarizes category usage across transactions, budgets, entries, and recurring items', () => {
    const usage = getCategoryUsageSummary(makeWorkbook(), 'food');

    expect(usage).toEqual({
      categoryId: 'food',
      transactionCount: 1,
      budgetCount: 1,
      budgetLineItemCount: 1,
      sheetEntryCount: 1,
      recurringItemCount: 1,
      totalReferences: 5,
      hasReferences: true
    });
  });

  it('blocks accidental hard delete for referenced categories and preserves workbook state', () => {
    const workbook = makeWorkbook();
    const before = clone(workbook);

    expect(() => deleteCategory(workbook, { categoryId: 'food' })).toThrow(CategoryManagementError);
    expect(() => deleteCategory(workbook, { categoryId: 'food' })).toThrow(
      'Category is still referenced. Hide it instead of deleting it.'
    );
    expect(workbook).toEqual(before);
  });

  it('deletes unused categories and preserves forced cleanup behavior for referenced categories', () => {
    const workbook = makeWorkbook();
    workbook.categories.push({
      id: 'travel',
      name: 'Travel',
      type: 'expense',
      currency: 'PHP',
      isActive: true
    });

    const unused = deleteCategory(workbook, { categoryId: 'travel' });
    expect(unused.changed).toBe(true);
    expect(workbook.categories.some((category) => category.id === 'travel')).toBe(false);

    const forced = deleteCategory(workbook, { categoryId: 'food', allowReferencedDelete: true });
    expect(forced.usage.totalReferences).toBe(5);
    expect(workbook.categories.some((category) => category.id === 'food')).toBe(false);
    expect(workbook.transactions[0].categoryId).toBe('');
    expect(workbook.sheets[0].budgets).toEqual([]);
    expect(workbook.sheets[0].budgetLineItems).toEqual([]);
    expect(workbook.sheets[0].entries[0].categoryId).toBe('');
    expect(workbook.recurringItems).toEqual([]);
  });
});
