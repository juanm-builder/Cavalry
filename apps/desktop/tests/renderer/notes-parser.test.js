import { describe, expect, it } from 'vitest';

import {
  parseNotesLine,
  parseNotesText,
  resolveNotesEntry,
  validateNotesEntry
} from '../../src/renderer/features/notes/notes-parser.js';
import { reconcileEntries } from '../../src/renderer/features/notes/notes-draft-storage.js';
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

    expect(entry.amount).toBe(0);
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

  it('requires explicit review before saving entries with inference guidance', () => {
    const workbook = makeNotesWorkbook();
    const services = makeServices();
    const entries = parseNotesText('₱180 coffee cash\n₱400 unknown cash', workbook, {
      today: services.today
    });
    const blocked = submitNotesBatchCommand(workbook, entries, services);
    expect(blocked.ok).toBe(false);
    expect(workbook.transactions).toEqual([]);
    const reviewed = entries.map((entry) =>
      resolveNotesEntry(workbook, entry, { manuallyReviewed: true })
    );
    const result = submitNotesBatchCommand(workbook, reviewed, services);

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

describe('messy financial notes corpus', () => {
  const today = '2026-09-10';

  it('keeps date headings and totals out of the ledger and retains source context', () => {
    const text =
      '# Spending\nSeptember 9, 2026\n- lunch 180 cash\nTotal: 180\nReminder: pay rent 12000\nJust trying to spend less.';
    const [entry, ...extra] = parseNotesText(text, makeNotesWorkbook(), { today });
    expect(extra).toEqual([]);
    expect(entry).toMatchObject({
      amount: 180,
      date: '2026-09-09',
      lineNumber: 3,
      sourceText: '- lunch 180 cash',
      sourceLineNumbers: [3],
      sourceContext: { date: '2026-09-09', text: 'September 9, 2026', lineNumber: 2 }
    });
  });

  it('groups multiline fields without losing original text or borrowing from the next purchase', () => {
    const text = 'Lunch\n amount: 180\n paid with cash\n\nGroceries 500 debit';
    const entries = parseNotesText(text, makeNotesWorkbook(), { today });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      amount: 180,
      sourceText: 'Lunch\n amount: 180\n paid with cash',
      sourceLineNumbers: [1, 2, 3],
      primaryAccountId: 'cash',
      description: 'Lunch'
    });
    expect(entries[1]).toMatchObject({ amount: 500, lineNumber: 5, primaryAccountId: 'bank' });
  });

  it('supports a merchant line followed by an unlabeled amount and a payment line', () => {
    const [entry] = parseNotesText('Groceries\n500\nGCash', makeSmartNotesWorkbook(), { today });
    expect(entry).toMatchObject({
      amount: 500,
      sourceLineNumbers: [1, 2, 3],
      primaryAccountId: 'gcash'
    });
  });

  it('splits semicolon purchases and strips list numbers without treating them as amounts', () => {
    const entries = parseNotesText(
      '1. coffee 180 cash; groceries 250 debit\n2) transportation 100 cash',
      makeNotesWorkbook(),
      { today }
    );
    expect(entries.map((entry) => entry.amount)).toEqual([180, 250, 100]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
    expect(entries.map((entry) => entry.lineNumber)).toEqual([1, 1, 2]);
  });

  it.each([
    ['2 coffees PHP 180 cash', 180],
    ['coffee: ₱180.50, cash', 180.5],
    ['groceries 1,234.56 cash', 1234.56],
    ['groceries 1.234,56 cash', 1234.56],
    ['coffee 180,50 cash', 180.5],
    ['salary 25k cash', 25000],
    ['coffee one hundred eighty cash', 180],
    ['transportation one kay cash', 1000],
    ['coffee PHP 180 ref #123456 cash', 180]
  ])('reads the actual amount from %s', (text, amount) => {
    expect(parseNotesLine(text, makeNotesWorkbook(), { today }).amount).toBe(amount);
  });

  it.each([
    ['coffee 180 cash, actually 160', 'correction_review'],
    ['coffee 100 + 20 cash', 'amount_ambiguous'],
    ['coffee 100-200 cash', 'amount_ambiguous'],
    ['coffee -180 cash', 'amount_format_review'],
    ['coffee (180) cash', 'amount_format_review'],
    ['coffee 1,23,4 cash', 'amount_format_review'],
    ['coffee PHP 180 USD cash', 'amount_format_review'],
    ['coffee 180.999 cash', 'amount_format_review']
  ])('does not guess a ready amount for %s', (text, code) => {
    const entry = parseNotesLine(text, makeNotesWorkbook(), { today });
    expect(entry.amount).toBe(0);
    expect(entry.issues.map((item) => item.code)).toContain(code);
  });

  it('keeps a correction attached to the original transaction and requires review', () => {
    const [entry, ...others] = parseNotesText(
      'coffee 180 cash\nactually 160',
      makeNotesWorkbook(),
      { today }
    );
    expect(others).toEqual([]);
    expect(entry).toMatchObject({
      amount: 0,
      sourceLineNumbers: [1, 2],
      sourceText: 'coffee 180 cash\nactually 160'
    });
    expect(entry.issues.map((item) => item.code)).toContain('correction_review');
  });

  it.each([
    ['9 September 2026 coffee 180 cash', '2026-09-09'],
    ['Sept. 9 coffee 180 cash', '2026-09-09'],
    ['2026-9-9 coffee 180 cash', '2026-09-09'],
    ['29/07/2026 coffee 180 cash', '2026-07-29'],
    ['yesterday coffee 180 cash', '2026-09-09']
  ])('separates dates from money in %s', (text, date) => {
    expect(parseNotesLine(text, makeNotesWorkbook(), { today })).toMatchObject({
      amount: 180,
      date
    });
  });

  it.each([
    '09/10 coffee 180 cash',
    '2026-09-09 yesterday today coffee 180 cash',
    'last Friday coffee 180 cash'
  ])('requires review of unresolved dates in %s', (text) => {
    const entry = parseNotesLine(text, makeNotesWorkbook(), { today });
    expect(entry.date).toBe('');
    expect(entry.issues.map((item) => item.code)).toContain('date_ambiguous');
  });

  it('does not use a month heading as a precise date or amount', () => {
    const [entry, ...others] = parseNotesText(
      'September 2026\ncoffee 180 cash',
      makeNotesWorkbook(),
      { today }
    );
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ amount: 180, date: '' });
    expect(entry.issues.map((item) => item.code)).toContain('date_ambiguous');
  });

  it.each([
    ['paid credit card 500 cash', 'transaction_kind_unsupported'],
    ['refund 180 coffee cash', 'transaction_kind_unsupported'],
    ['lunch about 180 cash', 'amount_approximate'],
    ['lunch unpaid 180 cash', 'transaction_intent_review'],
    ['tomorrow coffee 180 cash', 'date_future_review'],
    ['grocries 500 cash', 'category_typo_review']
  ])('keeps uncertain financial intent visible for %s', (text, code) => {
    const entry = parseNotesLine(text, makeNotesWorkbook(), { today });
    expect(entry.issues.map((item) => item.code)).toContain(code);
    expect(
      resolveNotesEntry(makeNotesWorkbook(), entry, { keepInferenceIssues: true }).issues.map(
        (item) => item.code
      )
    ).toContain(code);
  });

  it('returns no transactions for ordinary notes and summaries', () => {
    expect(
      parseNotesText(
        'Spending\nRemember: buy groceries 500\nTotal 500\nI want to use cash more often.',
        makeNotesWorkbook(),
        { today }
      )
    ).toEqual([]);
  });
});

describe('source formatting stays financially safe', () => {
  it('does not turn a leading negative sign into a list marker', () => {
    const [entry] = parseNotesText('-180 coffee cash', makeNotesWorkbook(), {
      today: '2026-09-10'
    });
    expect(entry.amount).toBe(0);
    expect(entry.issues.map((issue) => issue.code)).toContain('amount_format_review');
  });

  it('keeps unchecked checklist items under review', () => {
    const [entry] = parseNotesText('- [ ] coffee 180 cash', makeNotesWorkbook(), {
      today: '2026-09-10'
    });
    expect(entry.issues.map((issue) => issue.code)).toContain('transaction_intent_review');
    expect(entry.sourceText).toBe('- [ ] coffee 180 cash');
  });

  it('never applies a USD exchange rate to a different currency', () => {
    const entry = parseNotesLine(
      'coffee EUR 180 cash',
      makeNotesWorkbook({ settings: { usdToBaseRate: 58 } }),
      { today: '2026-09-10' }
    );
    expect(entry).toMatchObject({ currency: 'EUR', amount: 180, fxRateToBase: 0 });
    expect(entry.issues.map((issue) => issue.code)).toContain('fx_rate_missing');
  });
});

describe('Notes review cannot change unsupported financial intent', () => {
  it.each(['refund 180 coffee cash', 'paid credit card 500 cash', 'coffee 180 cash every month'])(
    'blocks %s even after manual review',
    (text) => {
      const workbook = makeSmartNotesWorkbook();
      const parsed = parseNotesLine(text, workbook, { today: '2026-07-29' });
      const reviewed = resolveNotesEntry(
        workbook,
        {
          ...parsed,
          amount: 500,
          date: '2026-07-29',
          description: 'Edited description',
          categoryId: 'shopping',
          primaryAccountId: 'cash'
        },
        { manuallyReviewed: true }
      );
      expect(reviewed.issues.map((issue) => issue.code)).toContain('transaction_kind_unsupported');
      const result = submitNotesBatchCommand(workbook, [reviewed], makeServices());
      expect(result.ok).toBe(false);
      expect(workbook.transactions).toEqual([]);
    }
  );

  it('does not save uncertain parser inference through a direct batch command', () => {
    const workbook = makeSmartNotesWorkbook();
    const [entry] = parseNotesText('500 mystery cash', workbook, { today: '2026-07-29' });
    expect(entry.issues.length).toBeGreaterThan(0);
    const result = submitNotesBatchCommand(workbook, [entry], makeServices());
    expect(result.ok).toBe(false);
    expect(workbook.transactions).toEqual([]);
  });
});

describe('Notes duplicate write boundary', () => {
  it('rejects an existing ledger duplicate until explicitly reviewed', () => {
    const workbook = makeNotesWorkbook();
    const services = makeServices();
    const [entry] = parseNotesText('180 coffee cash', workbook, { today: services.today });
    const first = submitNotesBatchCommand(workbook, [entry], services);
    expect(first.ok).toBe(true);
    const repeated = submitNotesBatchCommand(first.workbook, [entry], services);
    expect(repeated.ok).toBe(false);
    expect(repeated.workbook.transactions).toHaveLength(1);
    const reviewed = resolveNotesEntry(first.workbook, entry, { manuallyReviewed: true });
    const confirmed = submitNotesBatchCommand(first.workbook, [reviewed], services);
    expect(confirmed.ok).toBe(true);
    expect(confirmed.workbook.transactions).toHaveLength(2);
  });
});

describe('native Notes reminder regression', () => {
  it('does not create a candidate from a reminder before a summary or another amount', () => {
    const source =
      '2026-09-10\ncoffee 180 GCash\nlunch 220 or 200 GCash?\nRemember to find the taxi receipt\nTotal 380\nMoved 500 from Cash to GCash';
    const entries = parseNotesText(source, makeSmartNotesWorkbook(), { today: '2026-09-10' });
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.lineNumber)).toEqual([2, 3, 6]);
    expect(entries.map((entry) => entry.amount)).toEqual([180, 0, 500]);
    expect(entries.every((entry) => !entry.sourceText.includes('Remember'))).toBe(true);
    expect(entries[2]).toMatchObject({
      template: 'transfer',
      primaryAccountId: 'cash',
      secondaryAccountId: 'gcash',
      issues: []
    });
  });
});

describe('Notes transfers preserve human direction and financial safety', () => {
  const today = '2026-07-29';
  it.each([
    'transfer 2k from BPI to GCash',
    'transferred 2,000 from BPI Checking to GCash',
    'moved two thousand from BPI to GCash',
    'sent PHP 2000 to GCash from BPI',
    'send 2000 from BPI to GCash',
    'xfer 2k BPI to GCash',
    'BPI -> GCash 2000',
    'BPI => GCash 2000',
    'BPI to GCash 2000',
    'GCash ← BPI 2000',
    'BPI → GCash 2000',
    'GCash <- BPI 2000',
    'deposited 2000 from BPI to GCash',
    'topped up GCash 2000 from BPI to GCash'
  ])('resolves %s without counting it as spending', (text) => {
    const workbook = makeSmartNotesWorkbook();
    const entry = parseNotesLine(text, workbook, { today });
    expect(entry).toMatchObject({
      template: 'transfer',
      amount: 2000,
      primaryAccountId: 'bank',
      secondaryAccountId: 'gcash',
      categoryId: '',
      issues: []
    });
    const result = submitNotesBatchCommand(workbook, [entry], makeServices());
    expect(result.ok).toBe(true);
    const transaction = result.workbook.transactions[0];
    expect(transaction).toMatchObject({ template: 'transfer', categoryId: '' });
    expect(transaction.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'bank', direction: 'credit', amount: 2000 }),
        expect.objectContaining({ accountId: 'gcash', direction: 'debit', amount: 2000 })
      ])
    );
  });
  it.each([
    'tranfer 500 from BPI to GCash',
    'tranfser 500 from BPI to GCash',
    'transfr 500 frm BPI to GCash',
    'transfer 500 form BPI to GCash',
    "hasn't transferred 500 from BPI to GCash",
    'transfer 500 to GCash',
    'transfer 500 from BPI',
    'transfer 500 from BPI to BPI',
    'transfer 500 from BPl to GCash',
    'transfer 500 between BPI and GCash',
    'transfer 500 from BPI or Cash to GCash',
    'transfer 500 from BPI to Unknown Bank',
    'transfer 500 from Cash to Unknown Bank',
    'transfer 500 from Cash to BPI Savings',
    'transfer 500 from Cash to BPI Saving',
    'transfer 500 from Cash or Unknown Account to GCash',
    'transfer 2O00 from BPI to GCash',
    'transfer 500 from BPI to GCash to Cash',
    'did not transfer 500 from BPI to GCash',
    "didn't transfer 500 from BPI to GCash",
    "can't transfer 500 from BPI to GCash",
    "won't transfer 500 from BPI to GCash",
    'cannot transfer 500 from BPI to GCash',
    'will transfer 500 from BPI to GCash',
    'transfer 500 from BPI to GCash later today',
    'transfer 500 from BPI to GCash tomorrow',
    'transfer 500 actually 600 from BPI to GCash',
    'transfer 500 BPI -> GCash -> Cash'
  ])('requires review for %s instead of posting a guessed expense', (text) => {
    const workbook = makeSmartNotesWorkbook();
    const entry = parseNotesLine(text, workbook, { today });
    expect(entry.template).toBe('transfer');
    expect(entry.issues.length).toBeGreaterThan(0);
    expect(submitNotesBatchCommand(workbook, [entry], makeServices()).ok).toBe(false);
    expect(workbook.transactions).toEqual([]);
  });
  it('requires a choice when a shorthand bank name matches two accounts', () => {
    const workbook = makeSmartNotesWorkbook();
    workbook.accounts.push({
      id: 'savings',
      name: 'BPI Savings',
      group: 'asset',
      subtype: 'savings',
      currency: 'PHP'
    });
    const entry = parseNotesLine('transfer 500 from BPI to GCash', workbook, { today });
    expect(entry.primaryAccountId).toBe('');
    expect(entry.issues.map((item) => item.code)).toContain('transfer_account_ambiguous');
  });
  it('does not turn bank-transfer payment method into an account transfer', () => {
    const entry = parseNotesLine('groceries 500 paid via bank transfer', makeNotesWorkbook(), {
      today
    });
    expect(entry.template).toBe('expense_paid');
  });
  it('keeps both transfer legs in duplicate checking and explicit review', () => {
    const workbook = makeSmartNotesWorkbook();
    const entry = parseNotesLine('transfer 500 from BPI to GCash', workbook, { today });
    const first = submitNotesBatchCommand(workbook, [entry], makeServices());
    expect(first.ok).toBe(true);
    expect(submitNotesBatchCommand(first.workbook, [entry], makeServices()).ok).toBe(false);
    const reworded = parseNotesLine('moved 500 to GCash from BPI', first.workbook, { today });
    expect(submitNotesBatchCommand(first.workbook, [reworded], makeServices()).ok).toBe(false);
    expect(
      submitNotesBatchCommand(
        workbook,
        [entry, { ...entry, id: 'second', lineNumber: 2 }],
        makeServices()
      ).ok
    ).toBe(false);
    const anotherDestination = { ...entry, secondaryAccountId: 'cash' };
    expect(submitNotesBatchCommand(first.workbook, [anotherDestination], makeServices()).ok).toBe(
      true
    );
    const reviewed = resolveNotesEntry(first.workbook, entry, { manuallyReviewed: true });
    expect(submitNotesBatchCommand(first.workbook, [reviewed], makeServices()).ok).toBe(true);
  });
  it('cannot change transfer intent to expense in direct command input', () => {
    const workbook = makeSmartNotesWorkbook();
    const entry = parseNotesLine('transfer 500 from BPI to GCash', workbook, { today });
    const unsafe = { ...entry, template: 'expense_paid', categoryId: 'shopping', issues: [] };
    expect(submitNotesBatchCommand(workbook, [unsafe], makeServices()).ok).toBe(false);
  });
});

it.each([
  'SGD 500',
  'USD500',
  'SGD500',
  '500 SGD',
  'CAD 500',
  'AUD 500',
  'HKD 500',
  'JPY 500',
  'S$500',
  'C$500'
])('preserves explicit foreign currency %s for transfer review', (amount) => {
  const workbook = makeSmartNotesWorkbook();
  const entry = parseNotesLine(`transfer ${amount} from Cash to GCash`, workbook, {
    today: '2026-07-29'
  });
  expect(entry.amount).toBe(500);
  expect(entry.currency).not.toBe('PHP');
  expect(entry.issues.map((item) => item.code)).toContain('currency_conversion_review');
  expect(submitNotesBatchCommand(workbook, [entry], makeServices()).ok).toBe(false);
});

it('requires review when shorthand might contain a decimal or thousands separator', () => {
  const entry = parseNotesLine('transfer 1.234k from Cash to GCash', makeSmartNotesWorkbook(), {
    today: '2026-07-29'
  });
  expect(entry).toMatchObject({ amount: 0, template: 'transfer' });
  expect(entry.issues.map((item) => item.code)).toContain('amount_ambiguous');
});
it('keeps a salary deposit into one own account as income', () => {
  const workbook = makeSmartNotesWorkbook();
  workbook.accounts.push({
    id: 'salary-income',
    name: 'Salary Income',
    group: 'income',
    currency: 'PHP'
  });
  workbook.categories.push({
    id: 'salary',
    name: 'Salary',
    type: 'income',
    linkedAccountId: 'salary-income'
  });
  const entry = parseNotesLine('salary deposited 500 to BPI today', workbook, {
    today: '2026-07-29'
  });
  expect(entry).toMatchObject({
    template: 'income_received',
    amount: 500,
    primaryAccountId: 'bank'
  });
});
it('uses a clear transfer description and keeps its original wording', () => {
  const text = 'sent 500 to GCash from Cash for next week';
  const entry = parseNotesLine(text, makeSmartNotesWorkbook(), { today: '2026-07-29' });
  expect(entry.description).toBe('Transfer: Cash → GCash · next week');
  expect(entry.sourceText).toBe(text);
});

it.each([
  ['.5k', 500],
  ['.50', 0.5]
])('preserves a leading decimal in transfer amount %s', (amount, expected) => {
  const entry = parseNotesLine(`transfer ${amount} from Cash to GCash`, makeSmartNotesWorkbook(), {
    today: '2026-07-29'
  });
  expect(entry).toMatchObject({ amount: expected, template: 'transfer', issues: [] });
});

it('does not infer a misspelled multiword account from one common word', () => {
  const workbook = makeSmartNotesWorkbook();
  workbook.accounts.push({
    id: 'freedom',
    name: 'Freedom Fund',
    group: 'asset',
    subtype: 'savings',
    currency: 'PHP'
  });
  const entry = parseNotesLine('transfer 500 from freedm fund to GCash', workbook, {
    today: '2026-07-29'
  });
  expect(entry.primaryAccountId).toBe('');
  expect(entry.issues.length).toBeGreaterThan(0);
});

it('reloads both current transfer legs and preserves a description edited elsewhere', () => {
  const workbook = makeSmartNotesWorkbook();
  const entry = parseNotesLine('transfer 500 from Credit Card to Cash', workbook, {
    today: '2026-07-29'
  });
  const first = submitNotesBatchCommand(workbook, [entry], makeServices());
  expect(first.ok).toBe(true);
  const transaction = first.workbook.transactions[0];
  transaction.lines.find((line) => line.direction === 'debit').accountId = 'gcash';
  transaction.description = 'Changed in ledger';
  const [reloaded] = reconcileEntries(first.workbook, [
    { ...entry, transactionId: transaction.id }
  ]);
  expect(reloaded).toMatchObject({
    primaryAccountId: 'card',
    secondaryAccountId: 'gcash',
    description: 'Changed in ledger',
    template: 'transfer'
  });
});

it.each(['¥500', '₫500', '₩500'])(
  'requires currency review for %s instead of silently saving base currency',
  (amount) => {
    const workbook = makeSmartNotesWorkbook();
    const entry = parseNotesLine(`transfer ${amount} from Cash to GCash`, workbook, {
      today: '2026-07-29'
    });
    expect(entry.issues.map((item) => item.code)).toContain('currency_symbol_review');
    expect(submitNotesBatchCommand(workbook, [entry], makeServices()).ok).toBe(false);
  }
);
