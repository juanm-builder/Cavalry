import { describe, expect, it } from 'vitest';
import { withNotesDuplicateReview } from '../../src/renderer/features/notes/notes-duplicate-review.js';

const entry = {
  amount: 180,
  currency: 'PHP',
  date: '2026-09-10',
  categoryId: 'food',
  description: 'Lunch',
  primaryAccountId: 'cash',
  template: 'expense_paid',
  issues: []
};
const workbook = {
  currency: 'PHP',
  accounts: [
    { id: 'cash', group: 'asset' },
    { id: 'bank', group: 'asset' }
  ],
  transactions: [
    {
      ...entry,
      id: 'existing',
      description: ' lunch ',
      lines: [{ accountId: 'cash', direction: 'credit' }]
    }
  ]
};

describe('Notes existing-ledger duplicate review', () => {
  it('flags the exact existing match without changing the entry or ledger', () => {
    const result = withNotesDuplicateReview(workbook, entry);
    expect(result.issues.map((item) => item.code)).toEqual(['existing_transaction_review']);
    expect(entry.issues).toEqual([]);
    expect(workbook.transactions).toHaveLength(1);
  });

  it.each([
    { amount: 181 },
    { currency: 'USD' },
    { date: '2026-09-09' },
    { categoryId: 'groceries' },
    { primaryAccountId: 'bank' },
    { description: 'Dinner' },
    { template: 'income_received' }
  ])('does not mistake different financial facts for an exact duplicate: %s', (change) => {
    expect(withNotesDuplicateReview(workbook, { ...entry, ...change }).issues).toEqual([]);
  });

  it('allows an explicitly reviewed copy and edits to the same transaction', () => {
    expect(withNotesDuplicateReview(workbook, { ...entry, manuallyReviewed: true }).issues).toEqual(
      []
    );
    expect(
      withNotesDuplicateReview(workbook, { ...entry, transactionId: 'existing' }).issues
    ).toEqual([]);
  });

  it('compares native transaction currencies and clears a stale duplicate issue', () => {
    const foreign = {
      ...workbook,
      transactions: [{ ...workbook.transactions[0], originalCurrency: 'USD' }]
    };
    expect(withNotesDuplicateReview(foreign, entry).issues).toEqual([]);
    const flagged = withNotesDuplicateReview(workbook, entry);
    expect(withNotesDuplicateReview({ ...workbook, transactions: [] }, flagged).issues).toEqual([]);
  });
});
