// Tests for Advisor ledger draft semantics.

import { describe, expect, it } from 'vitest';
import {
  applyLedgerCleanupAiDraftMutation,
  getMeaningfulLedgerCleanupPayload,
  normalizeLedgerCleanupPayload,
  normalizeLedgerReviewPayload,
  validateLedgerCleanupDraft,
  validateLedgerReviewDraft
} from '@cavalry/advisor/domain/advisor/ledger-drafts.js';

const services = {
  ensureCategoryPlannerBucket: (_workbook, category) => {
    category.plannerBucketId = category.plannerBucketId || 'bucket-main';
    return category.plannerBucketId;
  },
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
      kind: counterparty.kind || 'merchant',
      isActive: true
    };
    workbook.counterparties = workbook.counterparties || [];
    workbook.counterparties.push(created);
    return created;
  },
  getLedgerCleanupTransactionFields: (_workbook, transaction, patch) => {
    if (transaction.template === 'manual_journal') {
      return null;
    }
    const creditLine = (transaction.lines || []).find((line) => line.direction === 'credit') || {};
    return {
      template: patch.template || transaction.template || 'expense_paid',
      date: patch.date || transaction.date,
      description:
        typeof patch.description !== 'undefined'
          ? String(patch.description || '')
          : transaction.description,
      amount: Number(patch.amount || 0) > 0 ? Number(patch.amount) : transaction.amount,
      currency: patch.currency || transaction.originalCurrency || 'PHP',
      categoryId:
        typeof patch.categoryId !== 'undefined'
          ? String(patch.categoryId || '')
          : transaction.categoryId,
      counterpartyId:
        typeof patch.counterpartyId !== 'undefined'
          ? String(patch.counterpartyId || '')
          : transaction.counterpartyId,
      primaryAccountId: patch.primaryAccountId || creditLine.accountId || '',
      note: typeof patch.note !== 'undefined' ? String(patch.note || '') : transaction.note || ''
    };
  },
  getTransactionEditDraft: (_workbook, transaction) => {
    if (transaction.template === 'manual_journal') {
      return { isManualOnly: true };
    }
    const creditLine = (transaction.lines || []).find((line) => line.direction === 'credit') || {};
    return {
      isManualOnly: false,
      template: transaction.template || 'expense_paid',
      date: transaction.date,
      amount: transaction.amount,
      currency: transaction.originalCurrency || 'PHP',
      categoryId: transaction.categoryId,
      counterpartyId: transaction.counterpartyId,
      primaryAccountId: creditLine.accountId || '',
      note: transaction.note || ''
    };
  },
  isAccountNameTaken: (workbook, name, group, currency) =>
    (workbook.accounts || []).some(
      (account) =>
        account.name.toLowerCase() === String(name || '').toLowerCase() &&
        account.group === group &&
        account.currency === currency &&
        account.isActive !== false
    ),
  buildLedgerTransactionFromDraftFields: (workbook, fields, transaction) => {
    const category = (workbook.categories || []).find((item) => item.id === fields.categoryId);
    if (!category) throw new Error(`Category not found: ${fields.categoryId}`);
    const creditAccount = (workbook.accounts || []).find(
      (item) => item.id === fields.primaryAccountId
    );
    if (!creditAccount) throw new Error(`Account not found: ${fields.primaryAccountId}`);
    const amount = Number(fields.amount || 0) || 0;
    if (!(amount > 0)) throw new Error('Amount is required.');
    return Object.assign({}, transaction, {
      date: fields.date,
      description: fields.description || transaction.description,
      amount,
      baseAmount: amount,
      categoryId: fields.categoryId,
      counterpartyId: fields.counterpartyId || '',
      note: fields.note || '',
      lines: [
        {
          id: `${transaction.id}-debit`,
          accountId: category.linkedAccountId,
          direction: 'debit',
          amount,
          currency: workbook.currency,
          baseAmount: amount
        },
        {
          id: `${transaction.id}-credit`,
          accountId: creditAccount.id,
          direction: 'credit',
          amount,
          currency: workbook.currency,
          baseAmount: amount
        }
      ]
    });
  },
  normalizeAccount: (account, index, currency) => ({
    id: account.id || `account-${index}`,
    name: account.name,
    group: account.group,
    subtype: account.subtype || '',
    currency,
    note: account.note || '',
    isActive: account.isActive !== false
  }),
  normalizeCategory: (category, index, currency) => ({
    id: category.id || `category-${index}`,
    name: category.name,
    type: category.type || 'expense',
    color: category.color || '#ef7f7f',
    currency,
    linkedAccountId: category.linkedAccountId || '',
    isActive: category.isActive !== false
  }),
  normalizeCounterparty: (counterparty, index) => ({
    id: counterparty.id || `counterparty-${index}`,
    name: counterparty.name,
    kind: counterparty.kind || 'merchant',
    note: counterparty.note || '',
    isActive: counterparty.isActive !== false
  }),
  refreshGeneratedDailyInterestAfterTransaction: () => {},
  typeColors: {
    expense: '#ef7f7f',
    income: '#53d18f',
    savings: '#84b7ff',
    debt: '#f2b359'
  },
  typeLabels: {
    expense: 'Expense',
    income: 'Income',
    savings: 'Savings',
    debt: 'Debt'
  },
  validateWorkbookHealth: (workbook) => {
    const categoryIds = new Set((workbook.categories || []).map((category) => category.id));
    const accountIds = new Set((workbook.accounts || []).map((account) => account.id));
    const errors = [];
    (workbook.transactions || []).forEach((transaction) => {
      if (transaction.categoryId && !categoryIds.has(transaction.categoryId)) {
        errors.push({ message: `Missing category ${transaction.categoryId}` });
      }
      (transaction.lines || []).forEach((line) => {
        if (!accountIds.has(line.accountId)) {
          errors.push({ message: `Missing account ${line.accountId}` });
        }
      });
    });
    return { errors, warnings: [], notices: [] };
  }
};

function makeWorkbook() {
  return {
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      { id: 'food-account', name: 'Food', group: 'expense', currency: 'PHP', isActive: true },
      { id: 'misc-account', name: 'Misc', group: 'expense', currency: 'PHP', isActive: true },
      { id: 'gifts-account', name: 'Gifts', group: 'expense', currency: 'PHP', isActive: true }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-account',
        isActive: true
      },
      {
        id: 'misc',
        name: 'Misc',
        type: 'expense',
        linkedAccountId: 'misc-account',
        isActive: true
      },
      {
        id: 'gifts',
        name: 'Gifts',
        type: 'expense',
        linkedAccountId: 'gifts-account',
        isActive: true
      }
    ],
    counterparties: [{ id: 'old-store', name: 'Old Store', kind: 'merchant', isActive: true }],
    recurringItems: [{ id: 'misc-recurring', categoryId: 'misc', counterpartyId: 'old-store' }],
    sheets: [
      {
        id: 'sheet-june',
        budgets: [{ categoryId: 'misc', planned: 500 }],
        budgetLineItems: [{ categoryId: 'misc', name: 'Misc' }]
      }
    ],
    transactions: [
      {
        id: 'txn-food',
        template: 'expense_paid',
        date: '2026-06-01',
        description: 'Lunch',
        categoryId: 'food',
        counterpartyId: 'old-store',
        amount: 100,
        baseAmount: 100,
        originalCurrency: 'PHP',
        lines: [
          {
            id: 'txn-food-debit',
            accountId: 'food-account',
            direction: 'debit',
            amount: 100,
            currency: 'PHP',
            baseAmount: 100
          },
          {
            id: 'txn-food-credit',
            accountId: 'cash',
            direction: 'credit',
            amount: 100,
            currency: 'PHP',
            baseAmount: 100
          }
        ]
      },
      {
        id: 'txn-misc',
        template: 'expense_paid',
        date: '2026-06-02',
        description: 'Gift',
        categoryId: 'misc',
        counterpartyId: 'old-store',
        amount: 200,
        baseAmount: 200,
        originalCurrency: 'PHP',
        lines: [
          {
            id: 'txn-misc-debit',
            accountId: 'misc-account',
            direction: 'debit',
            amount: 200,
            currency: 'PHP',
            baseAmount: 200
          },
          {
            id: 'txn-misc-credit',
            accountId: 'cash',
            direction: 'credit',
            amount: 200,
            currency: 'PHP',
            baseAmount: 200
          }
        ]
      },
      {
        id: 'manual-one',
        template: 'manual_journal',
        date: '2026-06-03',
        description: 'Manual entry',
        categoryId: 'food',
        counterpartyId: '',
        amount: 50,
        baseAmount: 50,
        originalCurrency: 'PHP',
        lines: [
          {
            id: 'manual-one-debit',
            accountId: 'food-account',
            direction: 'debit',
            amount: 50,
            currency: 'PHP',
            baseAmount: 50
          },
          {
            id: 'manual-one-credit',
            accountId: 'cash',
            direction: 'credit',
            amount: 50,
            currency: 'PHP',
            baseAmount: 50
          }
        ]
      }
    ]
  };
}

describe('advisor ledger draft domain', () => {
  it('normalizes cleanup payload aliases and filters no-op changes', () => {
    const workbook = makeWorkbook();
    const cleanup = normalizeLedgerCleanupPayload({
      reason: 'Tidy labels',
      category_changes: [
        { operation: 'deactivate', category_id: 'misc', replacement_category_id: 'gifts' },
        { operation: 'rename', category_id: 'food', name: 'Food' }
      ],
      transaction_patches: [
        { transaction_id: 'txn-food', description: 'Lunch' },
        { transaction_id: 'txn-misc', amount: 250 }
      ]
    });

    expect(cleanup.categoryChanges).toHaveLength(2);
    const meaningful = getMeaningfulLedgerCleanupPayload(workbook, cleanup, services);
    expect(meaningful.categoryChanges).toHaveLength(1);
    expect(meaningful.transactionPatches.map((patch) => patch.transactionId)).toEqual(['txn-misc']);
  });

  it('applies cleanup drafts with created references and merged references', () => {
    const workbook = makeWorkbook();
    const draft = {
      objectType: 'ledgerCleanup',
      operation: 'edit',
      proposed: {
        categoryChanges: [
          { action: 'create', clientId: 'phone-load', name: 'Phone Load', type: 'expense' },
          { action: 'rename', categoryId: 'food', name: 'Food & Dining' },
          { action: 'merge', categoryId: 'misc', replacementCategoryId: 'gifts' }
        ],
        counterpartyChanges: [
          { action: 'create', clientId: 'smart-prepaid', name: 'Smart Prepaid', kind: 'biller' },
          { action: 'rename', counterpartyId: 'old-store', name: 'Neighborhood Store' }
        ],
        transactionPatches: [
          {
            transactionId: 'txn-food',
            categoryId: 'gifts',
            amount: 125,
            date: '2026-06-04',
            primaryAccountId: 'cash',
            description: 'Gift lunch'
          },
          {
            transactionId: 'txn-misc',
            categoryId: 'phone-load',
            counterpartyId: 'smart-prepaid',
            amount: 250,
            date: '2026-06-05',
            primaryAccountId: 'cash',
            description: 'Phone load'
          }
        ]
      }
    };

    const proposed = validateLedgerCleanupDraft(workbook, draft, services);
    expect(proposed.transactionPatches[1]).toMatchObject({
      categoryId: 'phone-load',
      counterpartyId: 'smart-prepaid'
    });

    expect(applyLedgerCleanupAiDraftMutation(workbook, draft, services)).toBe(
      '2 transaction patches'
    );
    expect(workbook.categories.find((category) => category.id === 'food').name).toBe(
      'Food & Dining'
    );
    expect(workbook.categories.find((category) => category.id === 'misc').isActive).toBe(false);
    expect(workbook.recurringItems[0].categoryId).toBe('gifts');
    expect(workbook.sheets[0].budgets[0].categoryId).toBe('gifts');
    expect(
      workbook.counterparties.find((counterparty) => counterparty.id === 'old-store').name
    ).toBe('Neighborhood Store');
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn-food')
    ).toMatchObject({
      amount: 125,
      date: '2026-06-04',
      categoryId: 'gifts'
    });
    expect(
      workbook.transactions.find((transaction) => transaction.id === 'txn-misc')
    ).toMatchObject({
      categoryId: 'phone-load',
      counterpartyId: 'smart-prepaid',
      description: 'Phone load'
    });
  });

  it('allows metadata-only cleanup patches for manual transactions', () => {
    const workbook = makeWorkbook();
    applyLedgerCleanupAiDraftMutation(
      workbook,
      {
        objectType: 'ledgerCleanup',
        proposed: {
          transactionPatches: [
            {
              transactionId: 'manual-one',
              description: 'Reviewed manual entry',
              note: 'Looks right',
              categoryId: 'gifts'
            }
          ]
        }
      },
      services
    );

    expect(
      workbook.transactions.find((transaction) => transaction.id === 'manual-one')
    ).toMatchObject({
      description: 'Reviewed manual entry',
      note: 'Looks right',
      categoryId: 'gifts'
    });
  });

  it('validates cleanup and review blockers', () => {
    const workbook = makeWorkbook();
    expect(() =>
      validateLedgerCleanupDraft(
        workbook,
        {
          objectType: 'ledgerCleanup',
          proposed: { transactionPatches: [{ transactionId: 'missing', categoryId: 'gifts' }] }
        },
        services
      )
    ).toThrow('Transaction not found: missing');

    expect(() =>
      validateLedgerReviewDraft(workbook, {
        objectType: 'ledgerReview',
        proposed: { groups: [] }
      })
    ).toThrow('Ledger review draft has no transactions to review.');

    expect(() =>
      validateLedgerReviewDraft(workbook, {
        objectType: 'ledgerReview',
        proposed: { groups: [{ items: [{ transaction_id: 'missing' }] }] }
      })
    ).toThrow('Transaction not found: missing');
  });

  it('normalizes and validates ledger review source refs', () => {
    const workbook = makeWorkbook();
    const review = normalizeLedgerReviewPayload({
      counts: { review_item_count: 1 },
      groups: [
        {
          id: 'missing-category',
          title: 'Missing category',
          source_refs: ['category:food'],
          items: [
            {
              transaction_id: 'txn-food',
              current_category: 'Food',
              source_ref: 'transaction:txn-food'
            }
          ]
        }
      ]
    });

    expect(review.counts.reviewItemCount).toBe(1);
    expect(review.sourceRefs).toEqual(['transaction:txn-food', 'category:food']);
    expect(validateLedgerReviewDraft(workbook, { proposed: review })).toEqual(review);
  });
});
