// Tests for Advisor-dependent draft card view models.
// Locks browser-safe AI draft display copy before renderer wiring.

import { describe, expect, it } from 'vitest';

import {
  buildAiDraftCardViewModel,
  buildAiDraftDetailHeaderViewModel,
  buildAiDraftQueueItemViewModel,
  formatAiDraftDate,
  getAiDraftDisplayAmount,
  getAiDraftKindLabel,
  getAiDraftReviewTitle,
  getAiDraftTrustLabels
} from '@cavalry/advisor/application/drafts/draft-card-view-model-service.js';

function makeWorkbook() {
  return {
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash Wallet' },
      { id: 'card', name: 'Credit Card' }
    ],
    categories: [
      { id: 'groceries', name: 'Groceries', type: 'expense' },
      { id: 'salary', name: 'Salary', type: 'income' }
    ],
    counterparty: [],
    counterparties: [
      { id: 'employer', name: 'Acme Payroll' },
      { id: 'store', name: 'Corner Store' }
    ],
    transactions: [
      {
        id: 'txn-1',
        date: '2026-07-01',
        description: 'Old cafe',
        categoryId: 'groceries',
        counterpartyId: 'store'
      }
    ]
  };
}

function makeTransactionDraft(overrides = {}) {
  return Object.assign(
    {
      id: 'draft-1',
      objectType: 'transaction',
      operation: 'create',
      status: 'pending',
      title: 'Draft title',
      confidence: 0.76,
      createdAt: '2026-07-08T12:00:00.000Z',
      source: {
        intake: {
          interpreter: 'model',
          attachmentStatus: 'image_verified'
        },
        gateReview: {
          reviewer: 'model',
          decision: 'approved'
        }
      },
      proposed: {
        template: 'expense_paid',
        fields: {
          template: 'expense_paid',
          date: '2026-07-08',
          amount: 1200,
          currency: 'PHP',
          description: 'corner store groceries',
          categoryId: 'groceries',
          primaryAccountId: 'cash',
          counterpartyId: 'store'
        }
      }
    },
    overrides
  );
}

describe('draft card view-model service', () => {
  it('builds transaction card display labels, tones, dates, trust labels, and edit fields without mutating input', () => {
    const workbook = makeWorkbook();
    const draft = makeTransactionDraft();
    const before = JSON.stringify({ workbook, draft });

    const model = buildAiDraftCardViewModel(workbook, draft, {
      validation: { ok: true }
    });

    expect(JSON.stringify({ workbook, draft })).toBe(before);
    expect(model).toMatchObject({
      draftId: 'draft-1',
      objectType: 'transaction',
      operationLabel: 'Create',
      displayStatusLabel: 'Ready',
      statusCopy: 'Ready to apply. A snapshot will be created first.',
      cardTone: 'draft',
      canResolve: true,
      canConfirm: true,
      kindLabel: 'Expense',
      objectLabel: 'Transaction',
      title: 'Corner Store Groceries',
      titleEditField: 'categoryId',
      moneyTone: 'bad',
      moneyIcon: 'north_east',
      amountDisplay: '\u20b11,200.00',
      amountEditField: 'amount',
      confidenceLabel: '76% confidence',
      createdAtLabel: 'Jul 8, 2026',
      reviewStatus: { label: 'Ready', tone: 'good', icon: 'task_alt' }
    });
    expect(model.trustLabels).toEqual(['Model interpreted', 'Model approved', 'Image verified']);
  });

  it('keeps needs-details and resolved status copy stable', () => {
    const workbook = makeWorkbook();
    const needsDetails = buildAiDraftQueueItemViewModel(
      workbook,
      makeTransactionDraft({
        status: 'needs_fix',
        proposed: {
          template: 'expense_paid',
          fields: {
            template: 'expense_paid',
            amount: 0,
            categoryName: 'groceries'
          }
        }
      }),
      {
        validation: { ok: false, error: 'Choose an account.' }
      }
    );
    const confirmedReview = buildAiDraftDetailHeaderViewModel(
      workbook,
      {
        id: 'review-1',
        objectType: 'ledgerReview',
        operation: 'review',
        status: 'confirmed',
        confidence: 1,
        createdAt: '',
        proposed: { groups: [] }
      },
      {
        validation: { ok: true }
      }
    );

    expect(needsDetails).toMatchObject({
      displayStatusLabel: 'Needs Fix',
      statusCopy: 'Fix the blocking detail before posting.',
      cardTone: 'needs_info',
      validationMessage: 'Choose an account.',
      amountDisplay: 'Amount needed',
      reviewStatus: { label: 'Needs details', tone: 'warn', icon: 'help' }
    });
    expect(confirmedReview).toMatchObject({
      displayStatusLabel: 'Confirmed',
      statusCopy: 'Marked reviewed. No workbook changes were made.',
      cardTone: 'posted',
      kindLabel: 'Ledger Review',
      amountDisplay: '0 review items',
      createdAtLabel: 'Not dated'
    });
  });

  it('preserves draft title, kind, and amount semantics across supported object types', () => {
    const workbook = makeWorkbook();
    const income = makeTransactionDraft({
      proposed: {
        template: 'income_received',
        fields: {
          template: 'income_received',
          amount: 42000,
          currency: 'PHP',
          counterpartyName: 'Client Co',
          primaryAccountName: 'Cash Wallet'
        }
      }
    });
    const transfer = makeTransactionDraft({
      proposed: {
        template: 'transfer',
        fields: {
          template: 'transfer',
          primaryAccountName: 'Cash Wallet',
          secondaryAccountName: 'Credit Card',
          amount: 500
        }
      }
    });
    const account = {
      objectType: 'account',
      operation: 'create',
      title: 'Create Emergency Fund',
      proposed: {
        group: 'asset',
        subtype: 'savings',
        openingBalance: 2500,
        currency: 'PHP'
      }
    };
    const cleanup = {
      objectType: 'ledgerCleanup',
      operation: 'update',
      proposed: {
        categoryChanges: [{ action: 'create', name: 'Coffee', type: 'expense' }],
        counterpartyChanges: [{ action: 'create', name: 'Cafe', kind: 'merchant' }],
        transactionPatches: [{ transactionId: 'txn-1', categoryId: 'new-coffee' }]
      }
    };

    expect(getAiDraftKindLabel(income)).toBe('Incoming Money');
    expect(getAiDraftReviewTitle(income, workbook)).toBe('Income from Client Co');
    expect(getAiDraftReviewTitle(transfer, workbook)).toBe('Transfer: Cash Wallet to Credit Card');
    expect(getAiDraftReviewTitle(account, workbook)).toBe('Create Emergency Fund');
    expect(getAiDraftDisplayAmount(account, workbook)).toBe('\u20b12,500.00');
    expect(getAiDraftDisplayAmount(cleanup, workbook)).toBe('3 changes');
  });

  it('keeps trust label dedupe and draft date fallback stable', () => {
    expect(
      getAiDraftTrustLabels({
        source: {
          intake: {
            interpreter: 'model',
            attachmentStatus: 'document_extracted',
            evidenceSource: 'text_after_attachment'
          },
          gateReview: {
            reviewer: 'rules'
          }
        }
      })
    ).toEqual([
      'Model interpreted',
      'Not model reviewed',
      'Image not verified',
      'Document extracted'
    ]);

    expect(formatAiDraftDate('2026-02-03T08:00:00.000Z')).toBe('Feb 3, 2026');
    expect(formatAiDraftDate('')).toBe('Not dated');
  });
});
