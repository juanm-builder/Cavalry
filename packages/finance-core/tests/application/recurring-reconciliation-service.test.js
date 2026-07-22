import { describe, expect, it } from 'vitest';

import {
  confirmRecurringReconciliationCommand,
  getRecurringCandidateEligibility,
  reconcileRecurringOccurrence,
  reconcileRecurringOccurrences,
  recurringReconciliationKey,
  rejectRecurringReconciliationCommand,
  scoreRecurringReconciliationCandidate,
  unlinkRecurringReconciliationCommand
} from '@cavalry/finance-core/application/recurring/recurring-reconciliation-service.js';
import {
  cloneFixture,
  makeBasicSpendingWorkbook,
  makeLine,
  makeTransaction
} from '../fixtures/core-workbook-fixtures.js';

function makeOccurrence(overrides = {}) {
  return {
    id: 'rec-chatgpt:2026-07-14:0',
    recurringItemId: 'rec-chatgpt',
    name: 'ChatGPT Pro',
    kind: 'subscription',
    categoryId: 'subscriptions',
    accountId: 'credit-card',
    dueDate: '2026-07-14',
    amount: 6490,
    recurringItem: {
      id: 'rec-chatgpt',
      name: 'ChatGPT Pro',
      categoryId: 'subscriptions',
      accountId: 'credit-card'
    },
    ...overrides
  };
}

function makeExpense(overrides = {}) {
  const amount = overrides.amount == null ? 6490 : overrides.amount;
  const template = overrides.template || 'expense_charged';
  const paymentAccount = template === 'expense_charged' ? 'credit-card' : 'cash';
  return makeTransaction({
    id: overrides.id || 'txn-chatgpt',
    date: overrides.date || '2026-07-14',
    template,
    description: overrides.description || 'ChatGPT Pro',
    categoryId: overrides.categoryId || 'subscriptions',
    amount,
    recurringItemId: overrides.recurringItemId || '',
    lines: [
      makeLine('subscriptions-expense', 'debit', amount),
      makeLine(overrides.paymentAccount || paymentAccount, 'credit', amount)
    ],
    ...overrides
  });
}

function setup(overrides = {}) {
  const workbook = cloneFixture(makeBasicSpendingWorkbook());
  const occurrence = makeOccurrence(overrides.occurrence);
  workbook.recurringItems = [occurrence.recurringItem];
  workbook.recurringReconciliations = overrides.records || [];
  workbook.transactions = overrides.transactions || [];
  return { workbook, occurrence };
}

describe('recurring reconciliation service', () => {
  it('automatically reconciles a unique high-confidence credit-card charge with explainable evidence', () => {
    const transaction = makeExpense();
    const { workbook, occurrence } = setup({ transactions: [transaction] });

    const result = reconcileRecurringOccurrence(workbook, occurrence);

    expect(result).toMatchObject({
      decision: 'matched',
      reason: 'unique_high_confidence',
      matchType: 'automatic',
      transaction: { id: 'txn-chatgpt' }
    });
    expect(result.candidate.score).toBeGreaterThanOrEqual(90);
    expect(result.signals.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'transaction_form_match',
        'amount_exact',
        'merchant_exact',
        'date_exact',
        'account_match',
        'category_match'
      ])
    );
  });

  it('supports direct bank or cash expense payments when the tracker uses an asset account', () => {
    const transaction = makeExpense({
      id: 'txn-rent-cash',
      template: 'expense_paid',
      description: 'Apartment rent',
      amount: 20000,
      categoryId: 'utilities',
      paymentAccount: 'cash'
    });
    const occurrence = makeOccurrence({
      id: 'rec-rent:2026-07-14:0',
      recurringItemId: 'rec-rent',
      name: 'Apartment rent',
      categoryId: 'utilities',
      accountId: 'cash',
      amount: 20000,
      recurringItem: {
        id: 'rec-rent',
        name: 'Apartment rent',
        categoryId: 'utilities',
        accountId: 'cash'
      }
    });
    const { workbook } = setup({ occurrence, transactions: [transaction] });
    workbook.recurringItems = [occurrence.recurringItem];

    expect(reconcileRecurringOccurrence(workbook, occurrence)).toMatchObject({
      decision: 'matched',
      matchType: 'automatic',
      transaction: { id: 'txn-rent-cash' }
    });
  });

  it('uses a cross-month date window instead of restricting candidates to a sheet month', () => {
    const transaction = makeExpense({ id: 'txn-month-edge', date: '2026-06-30' });
    const { workbook, occurrence } = setup({
      occurrence: { dueDate: '2026-07-01', id: 'rec-chatgpt:2026-07-01:0' },
      transactions: [transaction]
    });

    const candidate = scoreRecurringReconciliationCandidate(workbook, occurrence, transaction);

    expect(candidate).toMatchObject({ eligible: true, distanceDays: -1 });
    expect(reconcileRecurringOccurrence(workbook, occurrence).decision).toBe('matched');
  });

  it('keeps a 65-89 candidate for review and refuses ambiguous high-scoring candidates', () => {
    const generic = makeExpense({ description: 'Online charge' });
    const first = makeExpense({ id: 'txn-first' });
    const second = makeExpense({ id: 'txn-second', date: '2026-07-15' });
    const reviewSetup = setup({ transactions: [generic] });
    const ambiguousSetup = setup({ transactions: [first, second] });

    const review = reconcileRecurringOccurrence(reviewSetup.workbook, reviewSetup.occurrence);
    const ambiguous = reconcileRecurringOccurrence(
      ambiguousSetup.workbook,
      ambiguousSetup.occurrence
    );

    expect(review).toMatchObject({
      decision: 'review',
      reason: 'candidate_needs_review'
    });
    expect(review.candidate.score).toBeGreaterThanOrEqual(65);
    expect(review.candidate.score).toBeLessThan(90);
    expect(ambiguous).toMatchObject({
      decision: 'review',
      reason: 'ambiguous_candidates',
      ambiguity: { isAmbiguous: true, requiredMargin: 10 }
    });
  });

  it('excludes income, opening balances, and ordinary transfers even when text and amount match', () => {
    const { workbook, occurrence } = setup();
    const income = makeExpense({
      id: 'txn-income',
      template: 'income_received',
      categoryId: 'salary'
    });
    const opening = makeExpense({ id: 'txn-opening', template: 'opening_balance' });
    const transfer = makeTransaction({
      id: 'txn-transfer',
      date: occurrence.dueDate,
      template: 'transfer',
      description: occurrence.name,
      amount: occurrence.amount,
      lines: [
        makeLine('bank', 'credit', occurrence.amount),
        makeLine('cash', 'debit', occurrence.amount)
      ]
    });

    expect(getRecurringCandidateEligibility(workbook, occurrence, income)).toMatchObject({
      eligible: false,
      rejectionCode: 'unsupported_template'
    });
    expect(getRecurringCandidateEligibility(workbook, occurrence, opening)).toMatchObject({
      eligible: false,
      rejectionCode: 'unsupported_template'
    });
    expect(getRecurringCandidateEligibility(workbook, occurrence, transfer)).toMatchObject({
      eligible: false,
      rejectionCode: 'unexpected_template'
    });
  });

  it('accepts debt payments and only accepts transfer-form card payments targeting the tracker liability', () => {
    const { workbook } = setup();
    const occurrence = makeOccurrence({
      id: 'rec-statement:2026-07-20:0',
      recurringItemId: 'rec-statement',
      name: 'RCBC card statement',
      categoryId: 'credit-card-payment',
      accountId: 'credit-card',
      liabilityAccountId: 'credit-card',
      dueDate: '2026-07-20',
      amount: 10000,
      recurringItem: {
        id: 'rec-statement',
        name: 'RCBC card statement',
        categoryId: 'credit-card-payment',
        accountId: 'credit-card',
        liabilityAccountId: 'credit-card'
      }
    });
    workbook.recurringItems = [occurrence.recurringItem];
    const debt = makeTransaction({
      id: 'txn-debt',
      date: '2026-07-20',
      template: 'debt_payment',
      description: 'RCBC card statement',
      categoryId: 'credit-card-payment',
      amount: 10000,
      lines: [makeLine('credit-card', 'debit', 10000), makeLine('bank', 'credit', 10000)]
    });
    const statementTransfer = makeTransaction({
      id: 'txn-statement-transfer',
      date: '2026-07-20',
      template: 'transfer',
      description: 'RCBC card statement',
      amount: 10000,
      lines: [makeLine('credit-card', 'debit', 10000), makeLine('bank', 'credit', 10000)]
    });
    const ordinaryTransfer = makeTransaction({
      id: 'txn-ordinary-transfer',
      date: '2026-07-20',
      template: 'transfer',
      description: 'RCBC card statement',
      amount: 10000,
      lines: [makeLine('cash', 'debit', 10000), makeLine('bank', 'credit', 10000)]
    });

    expect(getRecurringCandidateEligibility(workbook, occurrence, debt).eligible).toBe(true);
    expect(getRecurringCandidateEligibility(workbook, occurrence, statementTransfer).eligible).toBe(
      true
    );
    expect(getRecurringCandidateEligibility(workbook, occurrence, ordinaryTransfer)).toMatchObject({
      eligible: false,
      rejectionCode: 'ordinary_transfer'
    });
    expect(reconcileRecurringOccurrence(workbook, occurrence, [statementTransfer])).toMatchObject({
      decision: 'matched',
      matchType: 'automatic'
    });
  });

  it('honors stored and legacy matches, suppresses rejected candidates, and supports a confirm override', () => {
    const transaction = makeExpense({ recurringItemId: 'rec-chatgpt' });
    const legacySetup = setup({ transactions: [transaction] });
    const rejectedSetup = setup({
      transactions: [transaction],
      records: [
        {
          id: 'reject-chatgpt-july',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-07-14',
          transactionId: 'txn-chatgpt',
          decision: 'rejected',
          method: 'manual',
          allocatedBaseAmount: 0,
          confidence: 100
        }
      ]
    });

    expect(
      reconcileRecurringOccurrence(legacySetup.workbook, legacySetup.occurrence)
    ).toMatchObject({
      decision: 'matched',
      reason: 'legacy_tracker_link',
      matchType: 'legacy'
    });
    expect(
      reconcileRecurringOccurrence(rejectedSetup.workbook, rejectedSetup.occurrence)
    ).toMatchObject({
      decision: 'unmatched',
      rejectedTransactionIds: ['txn-chatgpt']
    });
    expect(
      reconcileRecurringOccurrence(rejectedSetup.workbook, rejectedSetup.occurrence, undefined, {
        confirmedTransactionId: 'txn-chatgpt'
      })
    ).toMatchObject({ decision: 'matched', reason: 'confirmed_transaction' });
  });

  it('does not reuse a transaction already allocated to another occurrence', () => {
    const transaction = makeExpense();
    const { workbook, occurrence } = setup({
      transactions: [transaction],
      records: [
        {
          id: 'match-chatgpt-june',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-06-14',
          transactionId: transaction.id,
          decision: 'matched',
          method: 'manual',
          allocatedBaseAmount: 6490,
          confidence: 100
        }
      ]
    });

    expect(getRecurringCandidateEligibility(workbook, occurrence, transaction)).toMatchObject({
      eligible: false,
      rejectionCode: 'transaction_matched_elsewhere'
    });
    expect(
      reconcileRecurringOccurrence(workbook, occurrence, [transaction], {
        confirmedTransactionId: transaction.id
      })
    ).toMatchObject({
      decision: 'unmatched',
      reason: 'confirmed_transaction_ineligible'
    });
  });

  it('does not let an obsolete occurrence date strand a same-tracker transaction after a schedule edit', () => {
    const transaction = makeExpense({
      recurringItemId: 'rec-chatgpt',
      recurringOccurrenceDate: '2026-07-14'
    });
    const recurringItem = {
      ...makeOccurrence().recurringItem,
      anchorDate: '2026-07-15',
      frequency: 'Monthly',
      isActive: true
    };
    const occurrence = makeOccurrence({
      id: 'rec-chatgpt:2026-07-15:0',
      dueDate: '2026-07-15',
      recurringItem
    });
    const { workbook } = setup({
      occurrence,
      transactions: [transaction],
      records: [
        {
          id: 'old-schedule-match',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-07-14',
          transactionId: transaction.id,
          decision: 'matched',
          method: 'explicit',
          allocatedBaseAmount: 6490,
          confidence: 100
        }
      ]
    });

    expect(getRecurringCandidateEligibility(workbook, occurrence, transaction)).toMatchObject({
      eligible: true,
      linkKind: 'legacy'
    });
    expect(reconcileRecurringOccurrence(workbook, occurrence)).toMatchObject({
      decision: 'matched',
      reason: 'legacy_tracker_link',
      transaction: { id: transaction.id }
    });
  });

  it('learns merchant text from an earlier confirmed occurrence', () => {
    const prior = makeExpense({
      id: 'txn-openai-june',
      date: '2026-06-14',
      description: 'OPENAI CHATGPT'
    });
    const current = makeExpense({
      id: 'txn-openai-july',
      description: 'OPENAI CHATGPT'
    });
    const occurrence = makeOccurrence({
      name: 'AI tools',
      recurringItem: {
        id: 'rec-chatgpt',
        name: 'AI tools',
        categoryId: 'subscriptions',
        accountId: 'credit-card'
      }
    });
    const record = {
      id: 'confirmed-openai-june',
      recurringItemId: 'rec-chatgpt',
      occurrenceDate: '2026-06-14',
      transactionId: 'txn-openai-june',
      decision: 'matched',
      method: 'manual',
      allocatedBaseAmount: 6490,
      confidence: 100
    };
    const withoutHistory = setup({ occurrence, transactions: [prior, current] });
    const withHistory = setup({ occurrence, transactions: [prior, current], records: [record] });

    const unlearned = reconcileRecurringOccurrence(
      withoutHistory.workbook,
      withoutHistory.occurrence
    );
    const learned = reconcileRecurringOccurrence(withHistory.workbook, withHistory.occurrence);

    expect(unlearned).toMatchObject({ decision: 'review', reason: 'candidate_needs_review' });
    expect(unlearned.candidate.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'merchant_no_match', points: 0 })])
    );
    expect(learned).toMatchObject({
      decision: 'matched',
      reason: 'unique_high_confidence',
      transaction: { id: 'txn-openai-july' }
    });
    expect(learned.candidate.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'merchant_exact', points: 25 })])
    );
  });

  it('aggregates multiple stored allocations into partial and complete occurrence settlement', () => {
    const first = makeExpense({ id: 'txn-part-one', amount: 2000 });
    const second = makeExpense({ id: 'txn-part-two', amount: 4490 });
    const records = [
      {
        id: 'allocation-one',
        recurringItemId: 'rec-chatgpt',
        occurrenceDate: '2026-07-14',
        transactionId: 'txn-part-one',
        decision: 'matched',
        method: 'manual',
        allocatedBaseAmount: 2000,
        confidence: 100
      }
    ];
    const partialSetup = setup({ transactions: [first, second], records });
    const completeSetup = setup({
      transactions: [first, second],
      records: [
        ...records,
        {
          id: 'allocation-two',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-07-14',
          transactionId: 'txn-part-two',
          decision: 'matched',
          method: 'manual',
          allocatedBaseAmount: 4490,
          confidence: 100
        }
      ]
    });

    expect(
      reconcileRecurringOccurrence(partialSetup.workbook, partialSetup.occurrence)
    ).toMatchObject({
      decision: 'partial',
      reason: 'partial_candidate_needs_review',
      candidate: { transactionId: 'txn-part-two' },
      settlement: {
        state: 'partial',
        allocatedBaseAmount: 2000,
        remainingBaseAmount: 4490,
        allocations: [{ transactionId: 'txn-part-one' }]
      }
    });
    expect(
      reconcileRecurringOccurrence(completeSetup.workbook, completeSetup.occurrence)
    ).toMatchObject({
      decision: 'matched',
      reason: 'stored_allocations_complete',
      settlement: {
        state: 'matched',
        allocatedBaseAmount: 6490,
        remainingBaseAmount: 0
      }
    });
  });

  it('ignores orphaned proof records and never allocates more than the current transaction', () => {
    const orphaned = setup({
      transactions: [],
      records: [
        {
          id: 'orphaned-allocation',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-07-14',
          transactionId: 'missing-transaction',
          decision: 'matched',
          method: 'manual',
          allocatedBaseAmount: 6490,
          confidence: 100
        }
      ]
    });
    const reducedTransaction = makeExpense({ amount: 3000 });
    const reduced = setup({
      transactions: [reducedTransaction],
      records: [
        {
          id: 'stale-full-allocation',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-07-14',
          transactionId: reducedTransaction.id,
          decision: 'matched',
          method: 'explicit',
          allocatedBaseAmount: 6490,
          confidence: 100
        }
      ]
    });
    const retypedTransaction = makeExpense({ template: 'income_received' });
    const retyped = setup({
      transactions: [retypedTransaction],
      records: [
        {
          id: 'semantically-stale-allocation',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-07-14',
          transactionId: retypedTransaction.id,
          decision: 'matched',
          method: 'explicit',
          allocatedBaseAmount: 6490,
          confidence: 100
        }
      ]
    });
    const cardPaymentTransaction = makeExpense({ template: 'debt_payment' });
    const cardPayment = setup({
      transactions: [cardPaymentTransaction],
      records: [
        {
          id: 'card-charge-retyped-as-payment',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-07-14',
          transactionId: cardPaymentTransaction.id,
          decision: 'matched',
          method: 'explicit',
          allocatedBaseAmount: 6490,
          confidence: 100
        }
      ]
    });

    expect(reconcileRecurringOccurrence(orphaned.workbook, orphaned.occurrence)).toMatchObject({
      decision: 'unmatched',
      settlement: {
        allocatedBaseAmount: 0,
        orphanedAllocations: [{ transactionId: 'missing-transaction' }]
      }
    });
    expect(reconcileRecurringOccurrence(reduced.workbook, reduced.occurrence)).toMatchObject({
      decision: 'partial',
      settlement: {
        allocatedBaseAmount: 3000,
        remainingBaseAmount: 3490
      }
    });
    expect(reconcileRecurringOccurrence(retyped.workbook, retyped.occurrence)).toMatchObject({
      decision: 'unmatched',
      settlement: {
        allocatedBaseAmount: 0,
        invalidAllocations: [
          {
            transactionId: retypedTransaction.id,
            rejectionCode: 'unsupported_template'
          }
        ]
      }
    });
    expect(
      reconcileRecurringOccurrence(cardPayment.workbook, cardPayment.occurrence)
    ).toMatchObject({
      decision: 'unmatched',
      settlement: {
        allocatedBaseAmount: 0,
        invalidAllocations: [
          {
            transactionId: cardPaymentTransaction.id,
            rejectionCode: 'unexpected_template'
          }
        ]
      }
    });
  });

  it('allocates candidates one-to-one and surfaces cross-occurrence ambiguity', () => {
    const transaction = makeExpense();
    const first = makeOccurrence({ id: 'occurrence-one' });
    const second = makeOccurrence({ id: 'occurrence-two', recurringItemId: 'rec-chatgpt-copy' });
    const { workbook } = setup({ transactions: [transaction] });
    workbook.recurringItems.push({
      ...first.recurringItem,
      id: 'rec-chatgpt-copy'
    });
    second.recurringItem = {
      ...second.recurringItem,
      id: 'rec-chatgpt-copy'
    };
    const before = JSON.stringify(workbook);

    const batch = reconcileRecurringOccurrences(workbook, [first, second]);

    expect(batch.matchedTransactionIds).toEqual([]);
    expect(batch.reviewCount).toBe(2);
    expect(batch.results).toEqual([
      expect.objectContaining({
        decision: 'review',
        reason: 'transaction_ambiguous_between_occurrences'
      }),
      expect.objectContaining({
        decision: 'review',
        reason: 'transaction_ambiguous_between_occurrences'
      })
    ]);
    expect(JSON.stringify(workbook)).toBe(before);
  });

  it('immutably confirms, rejects, and unlinks keyed occurrence decisions', () => {
    const transaction = makeExpense();
    const { workbook, occurrence } = setup({ transactions: [transaction] });
    const before = JSON.stringify(workbook);
    const input = {
      recurringItemId: occurrence.recurringItemId,
      occurrenceDate: occurrence.dueDate,
      transactionId: transaction.id,
      allocatedBaseAmount: 3000,
      method: 'manual',
      confidence: 98,
      matchSignals: [{ code: 'user_confirmed' }]
    };

    const confirmed = confirmRecurringReconciliationCommand(workbook, input, {
      createId: () => 'reconciliation-confirmed',
      now: '2026-07-16T01:00:00.000Z'
    });
    const rejected = rejectRecurringReconciliationCommand(confirmed.workbook, input, {
      now: '2026-07-16T02:00:00.000Z'
    });
    const unlinked = unlinkRecurringReconciliationCommand(rejected.workbook, input);

    expect(confirmed).toMatchObject({
      ok: true,
      record: {
        id: 'reconciliation-confirmed',
        decision: 'matched',
        method: 'manual',
        allocatedBaseAmount: 3000,
        confidence: 98
      }
    });
    expect(
      recurringReconciliationKey(
        confirmed.record.recurringItemId,
        confirmed.record.occurrenceDate,
        confirmed.record.transactionId
      )
    ).toBe('rec-chatgpt::2026-07-14::txn-chatgpt');
    expect(rejected).toMatchObject({
      ok: true,
      record: {
        id: 'reconciliation-confirmed',
        decision: 'rejected',
        allocatedBaseAmount: 0,
        updatedAt: '2026-07-16T02:00:00.000Z'
      }
    });
    expect(unlinked).toMatchObject({ ok: true, workbook: { recurringReconciliations: [] } });
    expect(JSON.stringify(workbook)).toBe(before);
  });

  it('rejects stale confirmations that would reuse or misclassify a transaction', () => {
    const transaction = makeExpense();
    const { workbook, occurrence } = setup({
      transactions: [transaction],
      records: [
        {
          id: 'existing-june-match',
          recurringItemId: 'rec-chatgpt',
          occurrenceDate: '2026-06-14',
          transactionId: transaction.id,
          decision: 'matched',
          method: 'manual',
          allocatedBaseAmount: 6490,
          confidence: 100
        }
      ]
    });
    const input = {
      recurringItemId: occurrence.recurringItemId,
      occurrenceDate: occurrence.dueDate,
      transactionId: transaction.id,
      method: 'manual'
    };

    expect(confirmRecurringReconciliationCommand(workbook, input)).toMatchObject({
      ok: false,
      error: { code: 'recurring_reconciliation.ineligible_transaction' }
    });

    const transfer = makeTransaction({
      id: 'ordinary-transfer',
      date: occurrence.dueDate,
      template: 'transfer',
      description: occurrence.name,
      amount: occurrence.amount,
      lines: [
        makeLine('bank', 'credit', occurrence.amount),
        makeLine('cash', 'debit', occurrence.amount)
      ]
    });
    const transferWorkbook = setup({ transactions: [transfer] }).workbook;
    expect(
      confirmRecurringReconciliationCommand(transferWorkbook, {
        ...input,
        transactionId: transfer.id
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'recurring_reconciliation.ineligible_transaction' }
    });
  });
});
