import { describe, expect, it } from 'vitest';

import {
  buildRecurringDraftProposalFromSubscriptionCandidate,
  completeSubscriptionReviewScan,
  normalizeSubscriptionReviewProgressPercent,
  validateSubscriptionReviewModelSuggestions
} from '@cavalry/advisor/application/advisor/subscription-review-service.js';

const candidates = [
  {
    id: 'subscription_review_netflix',
    name: 'Netflix',
    suggestedName: 'Netflix',
    suggestedFrequency: 'Monthly',
    classification: 'likely_subscription',
    confidence: 0.82,
    reason: 'Stable recurring charge.',
    transactionIds: ['netflix-apr', 'netflix-may', 'netflix-jun'],
    source_refs: ['transaction:netflix-apr', 'transaction:netflix-may', 'transaction:netflix-jun']
  },
  {
    id: 'subscription_review_grocery',
    name: 'Metro Supermarket',
    suggestedName: 'Metro Supermarket',
    suggestedFrequency: 'Monthly',
    classification: 'not_subscription',
    confidence: 0.72,
    transactionIds: ['grocery-may'],
    source_refs: ['transaction:grocery-may']
  }
];

describe('subscription review model grounding', () => {
  it('accepts only suggestions grounded in known candidates, transactions, refs, classifications, and cadences', () => {
    const suggestions = validateSubscriptionReviewModelSuggestions(
      JSON.stringify({
        suggestions: [
          {
            candidate_id: 'subscription_review_netflix',
            classification: 'likely_subscription',
            confidence: 0.94,
            reason: 'Stable monthly charge.',
            suggested_name: 'Netflix',
            suggested_frequency: 'Monthly',
            representative_transaction_ids: ['netflix-apr', 'netflix-may'],
            source_refs: ['transaction:netflix-apr']
          },
          {
            candidate_id: 'subscription_review_netflix',
            classification: 'likely_subscription',
            confidence: 0.8,
            suggested_frequency: 'Monthly',
            representative_transaction_ids: ['invented-transaction'],
            source_refs: ['transaction:netflix-apr']
          },
          {
            candidate_id: 'subscription_review_grocery',
            classification: 'maybe_subscription',
            confidence: 0.6,
            suggested_frequency: 'Every 3 Days',
            representative_transaction_ids: ['grocery-may'],
            source_refs: ['transaction:grocery-may']
          },
          {
            candidate_id: 'unknown-candidate',
            classification: 'likely_subscription',
            confidence: 0.9,
            suggested_frequency: 'Monthly',
            representative_transaction_ids: [],
            source_refs: []
          },
          {
            candidate_id: 'subscription_review_netflix',
            classification: 'likely_subscription',
            confidence: 0.9,
            suggested_frequency: 'Monthly',
            representative_transaction_ids: ['netflix-apr'],
            source_refs: ['transaction:fabricated']
          }
        ]
      }),
      candidates
    );

    expect(suggestions).toEqual([
      expect.objectContaining({
        candidateId: 'subscription_review_netflix',
        suggestedFrequency: 'Monthly',
        representativeTransactionIds: ['netflix-apr', 'netflix-may'],
        source_refs: ['transaction:netflix-apr']
      })
    ]);
  });

  it('shows only grounded model-reviewed candidates and has no rules fallback on model failure', () => {
    const valid = validateSubscriptionReviewModelSuggestions(
      JSON.stringify({
        suggestions: [
          {
            candidate_id: 'subscription_review_netflix',
            classification: 'likely_subscription',
            confidence: 94,
            reason: 'Stable monthly charge.',
            suggested_name: 'Netflix Premium',
            suggested_frequency: 'monthly',
            representative_transaction_ids: ['netflix-apr'],
            source_refs: ['transaction:netflix-apr']
          }
        ]
      }),
      candidates
    );

    expect(completeSubscriptionReviewScan(candidates, { ok: true, suggestions: valid })).toEqual([
      expect.objectContaining({
        id: 'subscription_review_netflix',
        confidence: 0.94,
        suggestedName: 'Netflix Premium',
        modelReviewed: true
      })
    ]);
    expect(
      completeSubscriptionReviewScan(candidates, {
        ok: false,
        skipped: true,
        note: 'Advisor model required.'
      })
    ).toEqual([]);
  });

  it('clamps progress into a stable percentage', () => {
    expect(normalizeSubscriptionReviewProgressPercent(-12)).toBe(0);
    expect(normalizeSubscriptionReviewProgressPercent(42.6)).toBe(43);
    expect(normalizeSubscriptionReviewProgressPercent(144)).toBe(100);
    expect(normalizeSubscriptionReviewProgressPercent('not running')).toBe(0);
  });

  it('builds a bulk recurring draft from the earliest reviewed source transaction', () => {
    const proposal = buildRecurringDraftProposalFromSubscriptionCandidate(
      {
        currency: 'PHP',
        categories: [{ id: 'subscriptions', name: 'Subscriptions', type: 'expense' }],
        transactions: [
          { id: 'netflix-jun', date: '2026-06-03', amount: 549, originalCurrency: 'PHP' },
          {
            id: 'netflix-apr',
            date: '2026-04-03',
            amount: 549,
            originalCurrency: 'PHP',
            counterpartyId: 'netflix'
          },
          { id: 'netflix-may', date: '2026-05-03', amount: 549, originalCurrency: 'PHP' }
        ]
      },
      {
        name: 'Netflix',
        suggestedName: 'Netflix',
        categoryId: 'subscriptions',
        accountId: 'card',
        amount: 549,
        suggestedFrequency: 'Monthly',
        transactionIds: ['netflix-jun', 'netflix-apr', 'netflix-may']
      }
    );

    expect(proposal).toMatchObject({
      kind: 'subscription',
      anchorDate: '2026-04-03',
      createdFromTransactionId: 'netflix-apr',
      sourceTransactionIds: ['netflix-apr', 'netflix-may', 'netflix-jun']
    });
  });
});
