import { describe, expect, it } from 'vitest';

import { inferCavalryAssistantTransactionArguments } from '../../src/renderer/features/assistant/cavalry-assistant-transaction-inference.js';

function makeWorkbook() {
  return {
    currency: 'PHP',
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        isActive: true
      },
      {
        id: 'bank',
        name: 'Main Bank',
        group: 'asset',
        subtype: 'bank',
        isActive: true
      },
      {
        id: 'card',
        name: 'Credit Card',
        group: 'liability',
        subtype: 'credit_card',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        subtype: 'expense',
        isActive: true
      },
      {
        id: 'shopping-expense',
        name: 'Shopping Expense',
        group: 'expense',
        subtype: 'expense',
        isActive: true
      },
      {
        id: 'salary-income',
        name: 'Salary Income',
        group: 'income',
        subtype: 'income',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'shopping',
        name: 'Shopping',
        type: 'expense',
        linkedAccountId: 'shopping-expense',
        isActive: true
      },
      {
        id: 'salary',
        name: 'Salary',
        type: 'income',
        linkedAccountId: 'salary-income',
        isActive: true
      }
    ],
    counterparties: [{ id: 'market', name: 'Market', kind: 'merchant', isActive: true }],
    transactions: [
      {
        id: 'prior-food',
        date: '2026-07-01',
        template: 'expense_paid',
        description: 'Food',
        categoryId: 'food',
        counterpartyId: '',
        lines: [
          { accountId: 'food-expense', direction: 'debit' },
          { accountId: 'cash', direction: 'credit' }
        ]
      }
    ]
  };
}

function infer(arguments_, question) {
  return inferCavalryAssistantTransactionArguments(makeWorkbook(), arguments_, {
    currentDate: '2026-07-29',
    question
  });
}

describe('Cavalry assistant transaction inference authority', () => {
  it('lets explicit income text override a conflicting expense template, category, and account', () => {
    const result = infer(
      {
        template: 'expense_charged',
        amount: 500,
        description: 'Salary',
        category: 'Food',
        primaryAccount: 'Credit Card'
      },
      'I received salary 500 in Main Bank'
    );

    expect(result.arguments).toMatchObject({
      template: 'income_received',
      categoryId: 'salary',
      primaryAccountId: 'bank'
    });
    expect(result.arguments).not.toHaveProperty('category');
    expect(result.arguments).not.toHaveProperty('primaryAccount');
    expect(result.inferredFields).toMatchObject({
      template: { value: 'income_received', reason: 'finance_intent' },
      categoryId: { value: 'salary', reason: 'transaction_semantics' },
      primaryAccountId: { value: 'bank', reason: 'explicit_account_role' }
    });
  });

  it('lets explicit category and funding-account text override conflicting model values', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 125,
        description: 'Food',
        category: 'Shopping',
        primaryAccount: 'Main Bank'
      },
      'I paid 125 for Food from Cash'
    );

    expect(result.arguments).toMatchObject({
      categoryId: 'food',
      primaryAccountId: 'cash'
    });
    expect(result.arguments).not.toHaveProperty('category');
    expect(result.arguments).not.toHaveProperty('primaryAccount');
  });

  it('treats blank optional entity keys as absent and fills deterministic values', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 125,
        description: 'Food',
        category: '',
        categoryId: '',
        primaryAccount: '',
        primaryAccountId: '',
        counterparty: '',
        counterpartyId: ''
      },
      'I paid 125 for Food from Cash'
    );

    expect(result.arguments).toMatchObject({
      categoryId: 'food',
      primaryAccountId: 'cash'
    });
    expect(result.arguments.category).toBeUndefined();
    expect(result.arguments.primaryAccount).toBeUndefined();
  });

  it('preserves nonblank model values when the user text is genuinely ambiguous', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 125,
        description: 'Online order',
        category: 'Shopping',
        primaryAccount: 'Main Bank'
      },
      'Record a 125 transaction'
    );

    expect(result.arguments).toMatchObject({
      template: 'expense_paid',
      category: 'Shopping',
      primaryAccount: 'Main Bank'
    });
    expect(result.inferredFields).not.toHaveProperty('categoryId');
    expect(result.inferredFields).not.toHaveProperty('primaryAccountId');
  });

  it('ignores incidental category mentions in budget-review clauses', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 240,
        description: 'Dinner'
      },
      'I paid 240 for dinner from Cash after checking my Transport budget'
    );

    expect(result.arguments).toMatchObject({
      categoryId: 'food',
      primaryAccountId: 'cash'
    });
    expect(result.arguments.categoryId).not.toBe('shopping');
  });

  it('ignores negated account roles and prefers a positive account instruction', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 100,
        description: 'Food'
      },
      'I paid 100 for Food, not from Main Bank; use Cash'
    );

    expect(result.arguments.primaryAccountId).toBe('cash');
    expect(result.inferredFields.primaryAccountId.reason).toBe('explicit_account_role');
  });

  it('uses an existing counterparty id and never invents a dangling name reference', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 125,
        description: 'Groceries'
      },
      'I paid 125 at Market for groceries'
    );

    expect(result.arguments.counterpartyId).toBe('market');
    expect(result.arguments).not.toHaveProperty('counterpartyName');
    expect(result.inferredFields.counterpartyId).toEqual({
      value: 'market',
      reason: 'counterparty_from_request'
    });
  });

  it('canonicalizes a model-supplied existing counterparty name to its id', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 125,
        description: 'Groceries',
        counterpartyName: 'Market'
      },
      'Record a 125 transaction'
    );

    expect(result.arguments.counterpartyId).toBe('market');
    expect(result.arguments).not.toHaveProperty('counterpartyName');
    expect(result.inferredFields.counterpartyId).toEqual({
      value: 'market',
      reason: 'canonical_counterparty_reference'
    });
  });

  it('drops an unresolved free counterparty name instead of creating a dangling id', () => {
    const result = infer(
      {
        template: 'expense_paid',
        amount: 125,
        description: 'Unidentified purchase',
        counterpartyName: 'Imaginary Vendor'
      },
      'Record a 125 transaction'
    );

    expect(result.arguments).not.toHaveProperty('counterpartyName');
    expect(result.arguments).not.toHaveProperty('counterpartyId');
  });
});
