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

  it('rejects the whole batch when any parsed uncertainty is unresolved', () => {
    const workbook = makeNotesWorkbook();
    const services = makeServices();
    const entries = parseNotesText('₱180 coffee cash\n₱400 unknown cash', workbook, {
      today: services.today
    });
    const result = submitNotesBatchCommand(workbook, entries, services);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({ code: 'notes.unresolved_entry', lineNumber: 2 })
    );
    expect(result.workbook).toBe(workbook);
    expect(workbook.transactions).toEqual([]);
  });
});
