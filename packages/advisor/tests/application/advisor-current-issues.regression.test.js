// Regression tests for current Advisor issues.

import { describe, expect, it } from 'vitest';
import { runAdvisorTurn } from '@cavalry/advisor/application/advisor/run-advisor-turn.js';
import {
  getAdvisorProviderStatusCopy,
  normalizeAdvisorProviderProfile
} from '@cavalry/advisor/application/advisor/provider-profile.js';
import {
  buildAdvisorRecommendationFromSummary,
  resolveAdvisorReferents
} from '@cavalry/advisor/application/advisor/referent-resolution.js';
import {
  adjudicateAdvisorTransactionIntent,
  advisorPromptLooksLikeCreditCardExpense,
  advisorPromptLooksLikeTransactionBatch
} from '@cavalry/advisor/application/advisor/intent-adjudication.js';
import { buildAdvisorPartialTransactionRecovery } from '@cavalry/advisor/application/advisor/partial-extraction.js';
import { classifyAdvisorCommandMode } from '@cavalry/advisor/domain/advisor/command-mode.js';

const spendingTurn = {
  intent: 'spending_analysis',
  targetIntent: 'spending_analysis',
  responseStyle: 'breakdown',
  taskSpec: {
    intent: 'spending_analysis',
    outputMode: 'analysis',
    answerPlan: {
      tableAllowed: false
    }
  }
};

const analysisSummary = {
  schema_version: 'cavalry.advisor_packet.v2',
  task_spec: spendingTurn.taskSpec,
  scope: {
    period_label: 'June 2026',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    currency: 'PHP'
  },
  data_packets: {
    transaction_analysis: {
      packet_version: 'cavalry.transaction_analysis.v1',
      selection: {
        policy: 'ranked_analysis_slices',
        source_count: 4,
        included_count: 4,
        omitted_count: 0,
        included_transaction_ids: ['txn-chatgpt', 'txn-netflix']
      },
      totals: {
        selected_period_consumption_spending: {
          amount: '120.00',
          display: 'PHP 120.00'
        },
        selected_period_total_outflow: {
          amount: '120.00',
          display: 'PHP 120.00'
        }
      },
      recurring_or_subscription_rows: [
        {
          transaction_id: 'txn-chatgpt',
          date: '2026-06-05',
          description: 'ChatGPT Pro',
          amount: '20.00',
          amount_display: 'USD 20.00',
          currency: 'USD',
          category_id: 'software',
          counterparty_name: 'OpenAI',
          source_ref: 'transaction:txn-chatgpt',
          source_refs: ['transaction:txn-chatgpt']
        },
        {
          transaction_id: 'txn-netflix',
          date: '2026-06-08',
          description: 'Netflix',
          amount: '15.00',
          amount_display: 'USD 15.00',
          currency: 'USD',
          category_id: 'subscriptions',
          counterparty_name: 'Netflix',
          source_ref: 'transaction:txn-netflix',
          source_refs: ['transaction:txn-netflix']
        }
      ],
      counts: {
        selected_period_transactions: 4,
        recurring_or_subscription_rows: 2
      }
    }
  }
};

describe('advisor current issue regressions', () => {
  it('uses the verified skeleton instead of the generic model-failure answer', async () => {
    const result = await runAdvisorTurn(
      {
        requestId: 'request-skeleton-fallback',
        traceId: 'trace-skeleton-fallback',
        message: 'Where did my money go?',
        settings: { provider: 'openai' },
        turn: spendingTurn,
        context: {}
      },
      {
        now: () => '2026-06-27T00:00:00.000Z',
        buildSummary: () => analysisSummary,
        buildMessages: () => [{ role: 'user', content: 'packet' }],
        formatProseResponse: (text) => ({ text, references: [] }),
        validateAnswer: () => ({
          ok: false,
          issues: [{ code: 'unsupported_number' }],
          retryInstruction: 'Use only supported evidence.'
        }),
        modelClient: {
          chat: async () => ({ ok: true, text: 'Unsupported answer' })
        }
      }
    );

    expect(result.status).toBe('fallback');
    expect(result.message.text).toContain('verified built-in review');
    expect(result.message.text).toContain('Consumption spending');
    expect(result.message.text).not.toContain('I could not produce a verified Advisor answer');
    expect(result.message.actions.map((action) => action.id)).toContain(
      'show_supporting_transactions'
    );
    expect(result.nextConversationState.lastRecommendation).toMatchObject({
      type: 'subscription_candidates'
    });
  });

  it('stores subscription recommendations and resolves "those" follow-ups', () => {
    const recommendation = buildAdvisorRecommendationFromSummary({ summary: analysisSummary });
    const resolved = resolveAdvisorReferents('add those to my subscriptions', {
      lastRecommendation: recommendation
    });

    expect(recommendation).toMatchObject({
      type: 'subscription_candidates',
      targetObjectType: 'recurringItem'
    });
    expect(resolved).toMatchObject({
      resolved: true,
      action: 'create_recurring_item_draft',
      targetObjectType: 'recurringItem'
    });
    expect(resolved.items.map((item) => item.name)).toEqual(['ChatGPT Pro', 'Netflix']);
  });

  it('treats charged-to-card purchase language as an expense, not account creation', () => {
    const prompt = 'also add 15usd charged to my credit card. purchased credits for open ai API';
    const command = classifyAdvisorCommandMode(prompt);
    const adjudicated = adjudicateAdvisorTransactionIntent({ message: prompt, intent: {} });

    expect(command).toMatchObject({
      intent: 'record_expense',
      handler: 'transaction_draft'
    });
    expect(adjudicated.changed).toBe(true);
    expect(adjudicated.intent).toMatchObject({
      command: 'record_expense',
      template: 'expense_charged',
      paymentAccountHint: 'credit card',
      notIntent: ['create_account']
    });
    expect(adjudicated.adjudication.amount).toBe(15);
    expect(adjudicated.adjudication.currency).toBe('USD');
  });

  it('treats credit-card bill payment language as debt payment, not a new card charge', () => {
    const prompt =
      'i paid for my credit card bill using my expense account. the amount is my entire expense account which is 19807.51';
    const adjudicated = adjudicateAdvisorTransactionIntent({ message: prompt, intent: {} });

    expect(advisorPromptLooksLikeCreditCardExpense(prompt)).toBe(false);
    expect(adjudicated.changed).toBe(true);
    expect(adjudicated.intent).toMatchObject({
      command: 'record_debt_payment',
      template: 'debt_payment',
      liabilityAccountHint: 'credit card',
      notIntent: ['create_account']
    });
    expect(adjudicated.intent.fields.amount).toBe(19807.51);
    expect(adjudicated.adjudication).toMatchObject({
      route: 'record_debt_payment',
      template: 'debt_payment',
      amount: 19807.51
    });
  });

  it.each([
    [
      'yo, i payed my cc bill from expense acct. amount is 19,807.51, can u put that in?',
      'record_debt_payment',
      'debt_payment'
    ],
    [
      'quick add: 15 USD charged on my rcbc cc for openai api pls',
      'record_expense',
      'expense_charged'
    ]
  ])('adjudicates messy user wording: %s', (prompt, command, template) => {
    const adjudicated = adjudicateAdvisorTransactionIntent({ message: prompt, intent: {} });

    expect(adjudicated.changed).toBe(true);
    expect(adjudicated.intent).toMatchObject({
      command,
      template
    });
  });

  it('does not route multi-transaction card batches through the single credit-card shortcut', () => {
    const prompt =
      'Hi, please add the following transactions. Today, I purchased 10,000 pesos worth of coffee at Harlan & Holden. I also ate at Wolfgang for 100,000 pesos. I bought some shoes for my dad at Hermes amounting to 50,000 pesos. Everything was charged through my credit card.';
    const adjudicated = adjudicateAdvisorTransactionIntent({ message: prompt, intent: {} });

    expect(advisorPromptLooksLikeTransactionBatch(prompt)).toBe(true);
    expect(advisorPromptLooksLikeCreditCardExpense(prompt)).toBe(false);
    expect(adjudicated.changed).toBe(false);
    expect(adjudicated.adjudication.reason).toBe('No credit-card expense signal.');
  });

  it('reports partial image extraction fields when review blocks a candidate', () => {
    const reply = buildAdvisorPartialTransactionRecovery({
      blockedItems: [
        {
          stage: 'review',
          reason: 'The payment account was not visible.',
          action: {
            template: 'expense_paid',
            fields: {
              date: '2026-06-24',
              description: 'Coffee receipt',
              amount: 180,
              currency: 'PHP',
              counterpartyName: 'Cafe'
            },
            missingFields: ['primaryAccountId']
          }
        }
      ],
      diagnostic: { reason: 'Review blocked the image candidate.' }
    });

    expect(reply).toContain('could read part of the attached image');
    expect(reply).toContain('description: Coffee receipt');
    expect(reply).toContain('amount: PHP 180');
    expect(reply).toContain('Still needed: payment account');
    expect(reply).not.toContain('I could not create a transaction draft from the attached image.');
  });

  it('exposes provider profiles with runtime names and API-safe status copy', () => {
    expect(normalizeAdvisorProviderProfile({ provider: 'local' })).toMatchObject({
      legacyProviderKind: 'rules',
      runtimeProviderKind: 'rules_engine',
      label: 'Built-in rules advisor',
      statusNoun: 'built-in rules advisor'
    });
    expect(normalizeAdvisorProviderProfile({ provider: 'custom' })).toMatchObject({
      legacyProviderKind: 'local_model',
      runtimeProviderKind: 'local_llm',
      statusNoun: 'local model'
    });
    expect(normalizeAdvisorProviderProfile({ provider: 'openai' })).toMatchObject({
      legacyProviderKind: 'remote_model',
      runtimeProviderKind: 'remote_llm',
      statusNoun: 'Advisor model'
    });
    expect(getAdvisorProviderStatusCopy({ provider: 'openai' }, 'running')).toBe(
      'Running Advisor model...'
    );
    expect(getAdvisorProviderStatusCopy({ provider: 'custom' }, 'running')).toBe(
      'Running local model...'
    );
    expect(getAdvisorProviderStatusCopy({ provider: 'local' }, 'running')).toBe(
      'Running built-in rules advisor...'
    );
  });
});
