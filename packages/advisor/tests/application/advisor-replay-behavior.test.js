// Replay-style tests for Advisor behavior.

import { describe, expect, it } from 'vitest';
import { runAdvisorTurn } from '@cavalry/advisor/application/advisor/run-advisor-turn.js';

function makeWorkbook() {
  return {
    id: 'workbook-replay',
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', isActive: true },
      { id: 'expense-food', name: 'Food Expense', group: 'expense', isActive: true },
      { id: 'expense-random', name: 'Random Expense', group: 'expense', isActive: true },
      { id: 'card', name: 'Credit Card', group: 'liability', isActive: true }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', isActive: true },
      { id: 'random', name: 'Random', type: 'expense', isActive: true }
    ],
    counterparties: [],
    transactions: [
      {
        id: 'txn-food',
        date: '2026-06-20',
        template: 'expense_paid',
        description: 'Lunch',
        categoryId: 'food',
        amount: 200,
        baseAmount: 200,
        lines: [
          { id: 'txn-food-debit', accountId: 'expense-food', direction: 'debit', baseAmount: 200 },
          { id: 'txn-food-credit', accountId: 'cash', direction: 'credit', baseAmount: 200 }
        ]
      },
      {
        id: 'txn-random',
        date: '2026-06-21',
        template: 'expense_paid',
        description: 'Unknown software tool',
        categoryId: 'random',
        amount: 300,
        baseAmount: 300,
        lines: [
          {
            id: 'txn-random-debit',
            accountId: 'expense-random',
            direction: 'debit',
            baseAmount: 300
          },
          { id: 'txn-random-credit', accountId: 'cash', direction: 'credit', baseAmount: 300 }
        ]
      },
      {
        id: 'txn-card',
        date: '2026-06-22',
        template: 'debt_payment',
        description: 'Credit card principal',
        amount: 500,
        baseAmount: 500,
        lines: [
          { id: 'txn-card-debit', accountId: 'card', direction: 'debit', baseAmount: 500 },
          { id: 'txn-card-credit', accountId: 'cash', direction: 'credit', baseAmount: 500 }
        ]
      }
    ],
    sheets: [],
    recurringItems: []
  };
}

const context = {
  profile: {
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-30',
    rangeLabel: 'June 2026'
  },
  snapshot: {
    income: 0,
    outflow: 1000,
    expense: 500,
    savings: 0,
    debt: 500,
    net: -1000,
    liquidAssets: 2000,
    averageMonthlyOutflow: 1000
  },
  budget: {
    plannedOutflow: 800,
    budgetUsedPercent: 125,
    topSpendRows: [
      { category: { id: 'random', name: 'Random' }, total: 300 },
      { category: { id: 'food', name: 'Food' }, total: 200 }
    ],
    overspentRows: []
  }
};

function makeSummary(intent, packetName, packet) {
  return {
    task_spec: {
      intent,
      outputMode: 'analysis',
      answerPlan: { tableAllowed: false }
    },
    scope: {
      period_label: 'June 2026',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'PHP'
    },
    data_packets: {
      [packetName]: packet
    }
  };
}

function makeDeps(summary) {
  return {
    now: () => '2026-06-23T00:00:00.000Z',
    buildSummary: () => summary,
    modelClient: {
      chat: async () => ({ ok: false, error: 'model should not be called for rules replay' })
    }
  };
}

describe('advisor replay-style behavior', () => {
  it('deepens repeated spending-habit questions without diagnostic leakage', async () => {
    const packet = {
      packet_version: 'cavalry.transaction_analysis.v1',
      selection: {
        policy: 'ranked_analysis_slices',
        source_count: 3,
        included_count: 3,
        omitted_count: 0,
        continuation_supported: false
      },
      period: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' },
      totals: {
        selected_period_total_outflow: { amount: '1000.00', amount_display: 'PHP 1,000.00' },
        selected_period_consumption_spending: { amount: '500.00', amount_display: 'PHP 500.00' },
        selected_period_spending: { amount: '500.00', amount_display: 'PHP 500.00' },
        selected_period_debt_payments: { amount: '500.00', amount_display: 'PHP 500.00' },
        selected_period_transfers_or_internal_moves: { amount: '0.00', amount_display: 'PHP 0.00' },
        selected_period_net_cashflow: { amount: '-1000.00', amount_display: '-PHP 1,000.00' }
      },
      category_reliability: {
        score: 55,
        level: 'medium',
        warnings: ['Random contains ambiguous software spending.'],
        blockingIssues: []
      },
      limitations: []
    };

    const result = await runAdvisorTurn(
      {
        requestId: 'replay-spending',
        traceId: 'trace-replay-spending',
        message: 'How can I improve my spending habits?',
        settings: { provider: 'local' },
        turn: {
          intent: 'spending_analysis',
          targetIntent: 'spending_analysis',
          responseStyle: 'recommendation',
          question: 'How can I improve my spending habits?',
          taskSpec: {
            intent: 'spending_analysis',
            outputMode: 'analysis',
            answerPlan: { tableAllowed: false }
          }
        },
        context,
        workbook: makeWorkbook(),
        conversationState: {
          lastQuestion: 'How can I improve my spending habits?',
          lastAnswerSummary: 'Previous answer listed categories but did not give a plan.'
        }
      },
      makeDeps(makeSummary('spending_analysis', 'transaction_analysis', packet))
    );

    expect(result.status).toBe('answered');
    expect(result.message.text).toContain('previous answer');
    expect(result.message.text).toContain('Debt payments');
    expect(result.message.text).toContain('Consumption spending');
    expect(result.message.text).not.toMatch(/Model note|grounding checks|schema parsing/i);
    expect(result.message.actions.map((action) => action.id)).toContain(
      'simulate_spending_reduction'
    );
  });

  it('turns category-improvement replay into proposal actions and a draft-group preview', async () => {
    const packet = {
      packet_version: 'cavalry.categorization_review.v1',
      selection: {
        policy: 'categorization_review_slices',
        source_count: 4,
        included_count: 4,
        omitted_count: 0,
        continuation_supported: false,
        included_refs: ['transaction:txn-random']
      },
      period: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' },
      counts: {
        transactions_reviewed: 3,
        vague_categories: 1,
        transactions_in_vague_or_missing_categories: 1,
        duplicate_category_label_groups: 0,
        duplicate_counterparty_label_groups: 0,
        safe_candidate_changes: 1
      },
      category_reliability: {
        score: 62,
        level: 'medium',
        warnings: ['Random should be reviewed before strong recommendations.'],
        blockingIssues: []
      },
      limitations: ['This is a review packet, not a workbook mutation.']
    };

    const result = await runAdvisorTurn(
      {
        requestId: 'replay-categories',
        traceId: 'trace-replay-categories',
        message: 'Review all my transactions and improve my categories. I want better labels.',
        settings: { provider: 'local' },
        turn: {
          intent: 'categorization_review',
          targetIntent: 'categorization_review',
          responseStyle: 'recommendation',
          question: 'Review all my transactions and improve my categories. I want better labels.',
          taskSpec: {
            intent: 'categorization_review',
            outputMode: 'analysis',
            answerPlan: { tableAllowed: false }
          }
        },
        context,
        workbook: makeWorkbook()
      },
      makeDeps(makeSummary('categorization_review', 'categorization_review', packet))
    );

    expect(result.status).toBe('answered');
    expect(result.message.text).toContain('Nothing has changed yet');
    expect(result.message.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['prepare_category_cleanup_draft', 'compare_before_after_categories'])
    );
    expect(result.message.draftGroups).toHaveLength(1);
    expect(result.message.text).not.toMatch(
      /Would you like me to help|Model note|grounding checks/i
    );
  });
});
