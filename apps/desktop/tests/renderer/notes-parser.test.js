import { describe, expect, it } from 'vitest';

import {
  parseNotesLine,
  parseNotesText,
  resolveNotesEntry,
  validateNotesEntry
} from '../../src/renderer/features/notes/notes-parser.js';
import { submitNotesBatchCommand } from '../../src/renderer/features/notes/notes-controller.js';

function makeNotesWorkbook(overrides = {}) {
  return {
    id: 'notes-workbook',
    version: 2,
    name: 'Notes Test',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'bank',
        name: 'BPI Checking',
        group: 'asset',
        subtype: 'checking',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'card',
        name: 'Credit Card',
        group: 'liability',
        subtype: 'credit_card',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'transport-expense',
        name: 'Transportation Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'coffee-expense',
        name: 'Coffee Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'groceries-expense',
        name: 'Groceries Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'general-expense',
        name: 'General Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'transportation',
        name: 'Transportation',
        type: 'expense',
        color: '#68c89b',
        currency: 'PHP',
        linkedAccountId: 'transport-expense',
        isActive: true
      },
      {
        id: 'coffee',
        name: 'Coffee',
        type: 'expense',
        color: '#deb063',
        currency: 'PHP',
        linkedAccountId: 'coffee-expense',
        isActive: true
      },
      {
        id: 'groceries',
        name: 'Groceries',
        type: 'expense',
        color: '#8daed7',
        currency: 'PHP',
        linkedAccountId: 'groceries-expense',
        isActive: true
      },
      {
        id: 'general',
        name: 'General',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'general-expense',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    recurringItems: [],
    recurringReconciliations: [],
    sheets: [],
    ...overrides
  };
}

function makeSmartNotesWorkbook(overrides = {}) {
  const base = makeNotesWorkbook();
  return {
    ...base,
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'petty-cash',
        name: 'Petty Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'bank',
        name: 'BPI Checking',
        group: 'asset',
        subtype: 'checking',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'gcash',
        name: 'GCash',
        group: 'asset',
        subtype: 'wallet',
        currency: 'PHP',
        institution: 'GCash',
        isActive: true
      },
      {
        id: 'card',
        name: 'Credit Card',
        group: 'liability',
        subtype: 'credit_card',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'personal-care-expense',
        name: 'Personal Care Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'shopping-expense',
        name: 'Shopping Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'random-expense',
        name: 'Random Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'personal-care',
        name: 'Personal Care',
        type: 'expense',
        linkedAccountId: 'personal-care-expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'shopping',
        name: 'Shopping',
        type: 'expense',
        linkedAccountId: 'shopping-expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'random',
        name: 'Random',
        type: 'expense',
        linkedAccountId: 'random-expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    ...overrides
  };
}

function makeServices() {
  let sequence = 0;
  return {
    today: () => '2026-07-29',
    defaultDate: () => '2026-07-29',
    now: () => '2026-07-29T01:00:00.000Z',
    createId(prefix = 'id') {
      sequence += 1;
      return `${prefix}-notes-${sequence}`;
    },
    transactionBuilderServices: {
      createId(prefix = 'id') {
        sequence += 1;
        return `${prefix}-notes-${sequence}`;
      }
    }
  };
}

describe('notes parser', () => {
  it('parses the three-line quick-entry example into ready transactions', () => {
    const entries = parseNotesText(
      ['₱1,000 transportation credit card', '₱180 coffee cash', '₱2,450 groceries debit'].join(
        '\n'
      ),
      makeNotesWorkbook(),
      { today: () => '2026-07-29' }
    );

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.amount)).toEqual([1000, 180, 2450]);
    expect(entries.map((entry) => entry.categoryId)).toEqual([
      'transportation',
      'coffee',
      'groceries'
    ]);
    expect(entries.map((entry) => entry.primaryAccountId)).toEqual(['card', 'cash', 'bank']);
    expect(entries.map((entry) => entry.template)).toEqual([
      'expense_charged',
      'expense_paid',
      'expense_paid'
    ]);
    expect(entries.every((entry) => entry.date === '2026-07-29')).toBe(true);
    expect(entries.every((entry) => entry.issues.length === 0)).toBe(true);
  });

  it('keeps original line numbers while ignoring blank lines', () => {
    const entries = parseNotesText(
      '₱180 coffee cash\n\n₱100 transportation cash',
      makeNotesWorkbook(),
      {
        today: '2026-07-29'
      }
    );

    expect(entries.map((entry) => entry.lineNumber)).toEqual([1, 3]);
    expect(entries.map((entry) => entry.id)).toEqual(['notes-line-1', 'notes-line-3']);
  });

  it('does not treat Food as the default for the reported quick-entry notes', () => {
    const workbook = makeSmartNotesWorkbook();
    const entries = parseNotesText(
      ['2000 Make up - Credit Card', '1200 - Medicine - GCash', '122,000 - Laptop'].join('\n'),
      workbook,
      { today: '2026-07-29' }
    );

    expect(entries.map((entry) => entry.amount)).toEqual([2000, 1200, 122000]);
    expect(entries.map((entry) => entry.categoryId)).toEqual([
      'personal-care',
      'personal-care',
      'shopping'
    ]);
    expect(entries.map((entry) => entry.categoryName)).toEqual([
      'Personal Care',
      'Personal Care',
      'Shopping'
    ]);
    expect(entries.map((entry) => entry.primaryAccountId)).toEqual(['card', 'gcash', 'cash']);
    expect(entries.map((entry) => entry.paymentLabel)).toEqual(['Credit card', 'E-wallet', 'Cash']);
    expect(entries.some((entry) => entry.categoryId === 'food')).toBe(false);
    expect(entries[2].issues.map((item) => item.code)).toContain('payment_unspecified');
    expect(entries.every((entry) => validateNotesEntry(workbook, entry).length === 0)).toBe(true);
  });

  it('uses the most specific semantic category when broader fallbacks also exist', () => {
    const base = makeSmartNotesWorkbook();
    const workbook = makeSmartNotesWorkbook({
      accounts: [
        ...base.accounts,
        {
          id: 'health-expense',
          name: 'Health Expense',
          group: 'expense',
          currency: 'PHP',
          isActive: true
        },
        {
          id: 'beauty-expense',
          name: 'Beauty Expense',
          group: 'expense',
          currency: 'PHP',
          isActive: true
        }
      ],
      categories: [
        ...base.categories,
        {
          id: 'health',
          name: 'Health',
          type: 'expense',
          linkedAccountId: 'health-expense',
          currency: 'PHP',
          isActive: true
        },
        {
          id: 'beauty',
          name: 'Beauty',
          type: 'expense',
          linkedAccountId: 'beauty-expense',
          currency: 'PHP',
          isActive: true
        }
      ]
    });

    const entries = parseNotesText('₱1,200 Medicine cash\n₱2,000 Make up cash', workbook, {
      today: '2026-07-29'
    });

    expect(entries.map((entry) => entry.categoryId)).toEqual(['health', 'beauty']);
    expect(entries.every((entry) => validateNotesEntry(workbook, entry).length === 0)).toBe(true);
  });

  it('uses category rules before generic category fallback', () => {
    const base = makeSmartNotesWorkbook();
    const workbook = makeSmartNotesWorkbook({
      categories: base.categories.map((category) =>
        category.id === 'shopping'
          ? {
              ...category,
              autoCategorizeRules: [
                { field: 'description', operator: 'contains', value: 'National Book Store' }
              ]
            }
          : category
      )
    });
    const entry = parseNotesLine('₱650 National Book Store GCash', workbook, {
      today: '2026-07-29'
    });

    expect(entry.categoryId).toBe('shopping');
    expect(entry.primaryAccountId).toBe('gcash');
    expect(entry.issues.map((item) => item.code)).not.toContain('category_uncertain');
  });

  it('learns both category and payment account from matching transaction history', () => {
    const workbook = makeSmartNotesWorkbook({
      transactions: [
        {
          id: 'prior-watsons',
          date: '2026-07-20',
          monthKey: '2026-07',
          template: 'expense_paid',
          description: 'Watsons Greenbelt',
          categoryId: 'personal-care',
          originalCurrency: 'PHP',
          amount: 300,
          baseAmount: 300,
          fxRateToBase: 1,
          lines: [
            {
              id: 'prior-watsons-category',
              accountId: 'personal-care-expense',
              direction: 'debit',
              amount: 300,
              currency: 'PHP',
              baseAmount: 300
            },
            {
              id: 'prior-watsons-gcash',
              accountId: 'gcash',
              direction: 'credit',
              amount: 300,
              currency: 'PHP',
              baseAmount: 300
            }
          ]
        }
      ]
    });
    const entry = parseNotesLine('₱475 Watsons Greenbelt', workbook, {
      today: '2026-07-29'
    });

    expect(entry.categoryId).toBe('personal-care');
    expect(entry.primaryAccountId).toBe('gcash');
    expect(entry.paymentLabel).toBe('E-wallet');
    expect(entry.issues).toEqual([]);
  });

  it('uses a generic category deterministically and never falls back by array order', () => {
    const workbook = makeSmartNotesWorkbook();
    const reordered = makeSmartNotesWorkbook({ categories: [...workbook.categories].reverse() });
    const withoutGeneric = makeSmartNotesWorkbook({
      categories: workbook.categories.filter((category) => category.id !== 'random')
    });

    const foodFirst = parseNotesLine('₱500 completely novel purchase cash', workbook, {
      today: '2026-07-29'
    });
    const randomFirst = parseNotesLine('₱500 completely novel purchase cash', reordered, {
      today: '2026-07-29'
    });
    const noGeneric = parseNotesLine('₱500 completely novel purchase cash', withoutGeneric, {
      today: '2026-07-29'
    });

    expect(foodFirst.categoryId).toBe('random');
    expect(randomFirst.categoryId).toBe('random');
    expect(foodFirst.issues.map((item) => item.code)).toContain('category_uncertain');
    expect(randomFirst.issues.map((item) => item.code)).toContain('category_uncertain');
    expect(noGeneric.categoryId).toBe('');
    expect(noGeneric.categoryId).not.toBe('food');
    expect(noGeneric.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['category_uncertain', 'category_missing'])
    );
  });

  it('accepts an explicitly named fallback category without second-guessing it', () => {
    const entry = parseNotesLine('₱100 general cash', makeNotesWorkbook(), {
      today: '2026-07-29'
    });

    expect(entry.categoryId).toBe('general');
    expect(entry.issues).toEqual([]);
  });

  it('marks fallback categories and ambiguous accounts for review', () => {
    const workbook = makeNotesWorkbook({
      accounts: [
        ...makeNotesWorkbook().accounts.map((account) =>
          account.id === 'card' ? { ...account, name: 'Everyday Visa' } : account
        ),
        {
          id: 'card-two',
          name: 'Travel Card',
          group: 'liability',
          subtype: 'credit_card',
          currency: 'PHP',
          isActive: true
        }
      ]
    });
    const entry = parseNotesLine('₱850 mystery purchase credit card', workbook, {
      lineNumber: 4,
      today: '2026-07-29'
    });

    expect(entry.categoryId).toBe('general');
    expect(entry.primaryAccountId).toBe('card');
    expect(entry.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['category_uncertain', 'payment_ambiguous'])
    );

    const reviewed = resolveNotesEntry(
      workbook,
      { ...entry, categoryId: 'transportation', primaryAccountId: 'card-two' },
      { manuallyReviewed: true }
    );
    expect(reviewed.issues).toEqual([]);
    expect(reviewed.manuallyReviewed).toBe(true);
  });

  it('honors explicit currency markers and rejects impossible dates', () => {
    const workbook = makeNotesWorkbook({ currency: 'USD' });
    const entry = parseNotesLine('2026-02-31 PHP 500 coffee cash', workbook, {
      today: '2026-07-29'
    });

    expect(entry.currency).toBe('PHP');
    expect(entry.amount).toBe(500);
    expect(entry.issues.map((item) => item.code)).toContain('date_invalid');
    expect(validateNotesEntry(workbook, entry).map((item) => item.code)).toContain('date_invalid');
  });

  it('flags multiple amounts and categories with broken ledger links', () => {
    const workbook = makeNotesWorkbook({
      categories: makeNotesWorkbook().categories.map((category) =>
        category.id === 'coffee' ? { ...category, linkedAccountId: 'missing-expense' } : category
      )
    });
    const entry = parseNotesLine('₱100 200 coffee cash', workbook, {
      today: '2026-07-29'
    });

    expect(entry.amount).toBe(100);
    expect(entry.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['amount_ambiguous', 'category_link_invalid'])
    );
  });
});

describe('notes batch command', () => {
  it('posts a reviewed batch through the canonical transaction command with one save event', () => {
    const workbook = makeNotesWorkbook();
    const services = makeServices();
    const entries = parseNotesText(
      ['₱1,000 transportation credit card', '₱180 coffee cash', '₱2,450 groceries debit'].join(
        '\n'
      ),
      workbook,
      { today: services.today }
    );
    const result = submitNotesBatchCommand(workbook, entries, services);

    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.transactions).toEqual([]);
    expect(result.workbook.transactions).toHaveLength(3);
    expect(
      result.workbook.transactions.every((transaction) => transaction.source === 'notes')
    ).toBe(true);
    expect(result.events.filter((event) => event.type === 'schedule-save')).toHaveLength(1);
    expect(result.workbook.transactions.map((transaction) => transaction.description)).toEqual([
      'Transportation',
      'Coffee',
      'Groceries'
    ]);
  });

  it('saves structurally valid entries even when inference guidance remains', () => {
    const workbook = makeNotesWorkbook();
    const services = makeServices();
    const entries = parseNotesText('₱180 coffee cash\n₱400 unknown cash', workbook, {
      today: services.today
    });
    const result = submitNotesBatchCommand(workbook, entries, services);

    expect(entries[1].issues.map((item) => item.code)).toContain('category_uncertain');
    expect(validateNotesEntry(workbook, entries[1])).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.workbook.transactions).toHaveLength(2);
    expect(result.workbook.transactions[1].categoryId).toBe('general');
    expect(result.events.filter((event) => event.type === 'schedule-save')).toHaveLength(1);
  });

  it('rejects the whole batch when an entry is structurally incomplete', () => {
    const smartWorkbook = makeSmartNotesWorkbook();
    const workbook = makeSmartNotesWorkbook({
      categories: smartWorkbook.categories.filter((category) => category.id !== 'random')
    });
    const services = makeServices();
    const entries = parseNotesText('₱180 personal care cash\n₱400 unknown cash', workbook, {
      today: services.today
    });
    const result = submitNotesBatchCommand(workbook, entries, services);

    expect(entries[1].categoryId).toBe('');
    expect(validateNotesEntry(workbook, entries[1]).map((item) => item.code)).toContain(
      'category_missing'
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({ code: 'notes.unresolved_entry', lineNumber: 2 })
    );
    expect(result.workbook).toBe(workbook);
    expect(workbook.transactions).toEqual([]);
  });

  it('edits a Notes transaction in place when transactionId is supplied', () => {
    const workbook = makeSmartNotesWorkbook();
    const services = makeServices();
    const [createdEntry] = parseNotesText('₱500 make up cash', workbook, {
      today: services.today
    });
    const created = submitNotesBatchCommand(workbook, [createdEntry], services);
    const createdTransaction = created.transactions[0];
    const editedEntry = resolveNotesEntry(created.workbook, {
      ...createdEntry,
      transactionId: createdTransaction.id,
      amount: 750,
      description: 'Laptop replacement',
      categoryId: 'shopping',
      primaryAccountId: 'gcash'
    });
    const edited = submitNotesBatchCommand(created.workbook, [editedEntry], services);

    expect(created.ok).toBe(true);
    expect(edited.ok).toBe(true);
    expect(edited.workbook).not.toBe(created.workbook);
    expect(created.workbook.transactions).toHaveLength(1);
    expect(created.workbook.transactions[0]).toMatchObject({
      id: createdTransaction.id,
      amount: 500,
      categoryId: 'personal-care'
    });
    expect(edited.workbook.transactions).toHaveLength(1);
    expect(edited.transactions).toHaveLength(1);
    expect(edited.transactions[0]).toMatchObject({
      id: createdTransaction.id,
      amount: 750,
      description: 'Laptop replacement',
      categoryId: 'shopping',
      source: 'notes'
    });
    expect(edited.events.filter((event) => event.type === 'schedule-save')).toHaveLength(1);
  });
});
