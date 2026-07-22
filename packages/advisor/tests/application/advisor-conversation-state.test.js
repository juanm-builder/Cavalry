// Tests for Advisor conversation state.

import { describe, expect, it } from 'vitest';
import { buildNextAdvisorConversationState } from '@cavalry/advisor/application/advisor/advisor-conversation-state.js';

describe('advisor conversation state', () => {
  it('stores categorization cleanup candidates for follow-up cleanup commands', () => {
    const state = buildNextAdvisorConversationState({
      previousState: null,
      turn: {
        intent: 'analysis',
        targetIntent: 'categorization_review',
        responseStyle: 'recommendation',
        question: 'review category issues',
        resolvedQuestion: 'Review category issues.'
      },
      summary: {
        scope: {
          period_start: '2026-06-01',
          period_end: '2026-06-30',
          period_label: 'June 2026'
        },
        data_packets: {
          categorization_review: {
            packet_version: 'cavalry.categorization_review.v1',
            selection: {
              included_refs: ['category:misc', 'transaction:txn-one']
            },
            period: {
              start: '2026-06-01',
              end: '2026-06-30',
              label: 'June 2026'
            },
            counts: {
              safe_candidate_changes: 1
            },
            candidate_cleanup: {
              mode: 'ledger_cleanup_v1',
              categoryChanges: [],
              counterpartyChanges: [],
              transactionPatches: [{ transactionId: 'txn-one', categoryId: 'food' }]
            },
            candidate_improvements: [
              {
                kind: 'transaction',
                title: 'Recategorize coffee',
                source_refs: ['transaction:txn-one']
              }
            ],
            sample_transactions_needing_review: []
          }
        }
      },
      answerText: 'I found one cleanup candidate.'
    });

    expect(state.lastCategorizationReview).toMatchObject({
      packet_version: 'cavalry.categorization_review.v1',
      candidate_cleanup: {
        transactionPatches: [{ transactionId: 'txn-one', categoryId: 'food' }]
      },
      source_refs: ['category:misc', 'transaction:txn-one']
    });

    const next = buildNextAdvisorConversationState({
      previousState: state,
      turn: {
        intent: 'analysis',
        targetIntent: 'spending_analysis',
        question: 'how much did I spend?',
        resolvedQuestion: 'Summarize spending.'
      },
      summary: {
        scope: {},
        data_packets: {}
      },
      answerText: 'Spending summary.'
    });

    expect(next.lastCategorizationReview).toEqual(state.lastCategorizationReview);
  });
});
