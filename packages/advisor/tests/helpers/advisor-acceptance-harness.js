// Shared fixtures and workflows for Advisor acceptance tests.

import { runAdvisorOrchestratorTurn } from '@cavalry/advisor/application/advisor/advisor-orchestrator.js';
import { buildAdvisorTurnTrace } from '@cavalry/advisor/application/advisor/advisor-turn-trace.js';
import { buildAdvisorPartialTransactionRecovery } from '@cavalry/advisor/application/advisor/partial-extraction.js';
import {
  resolveAdvisorReferents,
  shouldApplySubscriptionRecommendation
} from '@cavalry/advisor/application/advisor/referent-resolution.js';
import { adjudicateAdvisorTransactionIntent } from '@cavalry/advisor/application/advisor/intent-adjudication.js';
import { classifyAdvisorCommandMode } from '@cavalry/advisor/domain/advisor/command-mode.js';
import { buildAdvisorAccountSnapshotPacket } from '@cavalry/advisor/domain/advisor/packets.js';

export const ADVISOR_ACCEPTANCE_PROVIDER_PROFILES = Object.freeze({
  rules_engine: {
    runtimeProviderKind: 'rules_engine',
    settings: { provider: 'local' },
    modelBehavior: 'none'
  },
  remote_llm: {
    runtimeProviderKind: 'remote_llm',
    settings: { provider: 'openai', model: 'acceptance-remote-model' },
    modelBehavior: 'supported'
  },
  local_llm: {
    runtimeProviderKind: 'local_llm',
    settings: { provider: 'custom', model: 'acceptance-local-model' },
    modelBehavior: 'unavailable'
  }
});

export const spendingTurn = {
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

export const categorizationReviewTurn = {
  intent: 'categorization_review',
  targetIntent: 'categorization_review',
  responseStyle: 'recommendation',
  taskSpec: {
    intent: 'categorization_review',
    outputMode: 'analysis',
    dataNeeds: ['category_quality_signals', 'cleanup_candidates'],
    answerPlan: {
      tableAllowed: false
    }
  }
};

export const accountAnalysisTurn = {
  intent: 'account_analysis',
  targetIntent: 'account_analysis',
  responseStyle: 'recommendation',
  taskSpec: {
    intent: 'account_analysis',
    outputMode: 'analysis',
    dataNeeds: ['account_balances', 'account_roster', 'asset_liability_split'],
    answerPlan: {
      tableAllowed: false
    }
  }
};

export function makeAcceptanceWorkbook() {
  return {
    id: 'acceptance-workbook',
    name: 'Acceptance Workbook',
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', isActive: true },
      { id: 'credit-card', name: 'Credit Card', group: 'liability', isActive: true },
      { id: 'expense-food', name: 'Food Expense', group: 'expense', isActive: true },
      { id: 'expense-software', name: 'Software Expense', group: 'expense', isActive: true },
      { id: 'expense-random', name: 'Random Expense', group: 'expense', isActive: true }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', isActive: true },
      { id: 'software', name: 'Software', type: 'expense', isActive: true },
      { id: 'subscriptions', name: 'Subscriptions', type: 'expense', isActive: true },
      { id: 'random', name: 'Random', type: 'expense', isActive: true }
    ],
    counterparties: [
      { id: 'openai', name: 'OpenAI', kind: 'merchant', isActive: true },
      { id: 'netflix', name: 'Netflix', kind: 'biller', isActive: true }
    ],
    transactions: [
      {
        id: 'txn-chatgpt',
        date: '2026-06-05',
        template: 'expense_charged',
        description: 'ChatGPT Pro',
        categoryId: 'software',
        counterpartyId: 'openai',
        amount: 20,
        originalCurrency: 'USD',
        baseAmount: 1120,
        lines: [
          {
            id: 'txn-chatgpt-debit',
            accountId: 'expense-software',
            direction: 'debit',
            baseAmount: 1120
          },
          {
            id: 'txn-chatgpt-credit',
            accountId: 'credit-card',
            direction: 'credit',
            baseAmount: 1120
          }
        ]
      },
      {
        id: 'txn-netflix',
        date: '2026-06-08',
        template: 'expense_charged',
        description: 'Netflix',
        categoryId: 'subscriptions',
        counterpartyId: 'netflix',
        amount: 15,
        originalCurrency: 'USD',
        baseAmount: 840,
        lines: [
          {
            id: 'txn-netflix-debit',
            accountId: 'expense-software',
            direction: 'debit',
            baseAmount: 840
          },
          {
            id: 'txn-netflix-credit',
            accountId: 'credit-card',
            direction: 'credit',
            baseAmount: 840
          }
        ]
      },
      {
        id: 'txn-random',
        date: '2026-06-14',
        template: 'expense_paid',
        description: 'Unknown store',
        categoryId: 'random',
        amount: 300,
        originalCurrency: 'PHP',
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
      }
    ],
    recurringItems: [],
    aiDrafts: [],
    advisorDraftGroups: [],
    sheets: []
  };
}

export function makeAcceptanceContext() {
  return {
    profile: {
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30',
      rangeLabel: 'June 2026'
    },
    snapshot: {
      income: 0,
      outflow: 2260,
      expense: 2260,
      savings: 0,
      debt: 0,
      net: -2260,
      liquidAssets: 10000,
      averageMonthlyOutflow: 2260
    },
    budget: {
      plannedOutflow: 2000,
      budgetUsedPercent: 113,
      topSpendRows: [
        { category: { id: 'software', name: 'Software' }, total: 1960 },
        { category: { id: 'random', name: 'Random' }, total: 300 }
      ],
      overspentRows: [
        {
          category: { id: 'random', name: 'Random' },
          planned: 100,
          actual: 300,
          remaining: -200,
          percent: 300
        }
      ]
    }
  };
}

export function makeSpendingSummary() {
  return {
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
          source_count: 3,
          included_count: 3,
          omitted_count: 0,
          continuation_supported: false,
          included_transaction_ids: ['txn-chatgpt', 'txn-netflix', 'txn-random']
        },
        totals: {
          selected_period_consumption_spending: {
            amount: '2260.00',
            display: 'PHP 2,260.00'
          },
          selected_period_total_outflow: {
            amount: '2260.00',
            display: 'PHP 2,260.00'
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
            counterparty_id: 'openai',
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
            counterparty_id: 'netflix',
            counterparty_name: 'Netflix',
            source_ref: 'transaction:txn-netflix',
            source_refs: ['transaction:txn-netflix']
          }
        ],
        counts: {
          selected_period_transactions: 3,
          recurring_or_subscription_rows: 2
        }
      }
    }
  };
}

export function makeCategorizationSummary() {
  return {
    schema_version: 'cavalry.advisor_packet.v2',
    task_spec: categorizationReviewTurn.taskSpec,
    scope: {
      period_label: 'June 2026',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'PHP'
    },
    data_packets: {
      categorization_review: {
        packet_version: 'cavalry.categorization_review.v1',
        selection: {
          policy: 'categorization_review_slices',
          source_count: 3,
          included_count: 3,
          omitted_count: 0,
          continuation_supported: false,
          included_refs: ['transaction:txn-random']
        },
        counts: {
          transactions_reviewed: 3,
          transactions_in_vague_or_missing_categories: 1,
          safe_candidate_changes: 1
        },
        category_reliability: {
          level: 'medium',
          score: 70,
          warnings: ['Random category contains reviewable transactions.']
        },
        candidate_cleanup: {
          categoryChanges: [
            {
              action: 'rename',
              categoryId: 'random',
              name: 'Needs Review',
              type: 'expense'
            }
          ]
        },
        source_refs: ['transaction:txn-random', 'category:random']
      }
    }
  };
}

export function makeAccountSummary(workbook = makeAcceptanceWorkbook()) {
  const packet = buildAdvisorAccountSnapshotPacket(workbook, { asOfDate: '2026-06-30' });
  return {
    schema_version: 'cavalry.advisor_packet.v2',
    task_spec: accountAnalysisTurn.taskSpec,
    scope: {
      period_label: 'June 2026',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      as_of: '2026-06-30',
      currency: 'PHP'
    },
    data_packets: {
      account_snapshot: packet
    }
  };
}

export function makeCleanupServices() {
  return {
    cleanupProposal: {
      categoryChanges: [
        {
          action: 'rename',
          categoryId: 'random',
          name: 'Needs Review',
          type: 'expense'
        }
      ]
    },
    buildAdvisorCleanupSuggestionPacketRows: () => [
      {
        title: 'Rename Random',
        source_refs: ['category:random', 'transaction:txn-random']
      }
    ]
  };
}

function createModelClient(modelBehavior, calls) {
  return {
    chat: async (payload) => {
      calls.push(payload);
      if (modelBehavior === 'supported') {
        return { ok: true, text: 'Supported answer' };
      }
      if (modelBehavior === 'invalid') {
        return { ok: true, text: 'Unsupported answer' };
      }
      if (modelBehavior === 'quota') {
        return {
          ok: false,
          error: 'You exceeded your current quota, please check your plan and billing details.'
        };
      }
      return {
        ok: false,
        error: 'Configured advisor model is unavailable in this acceptance replay.'
      };
    }
  };
}

function makeDeps({ summary, modelBehavior, calls, events }) {
  return {
    now: () => '2026-06-27T00:00:00.000Z',
    onEvent: (event) => {
      events.push(event);
    },
    buildSummary: () => summary,
    buildMessages: () => [
      { role: 'system', content: 'acceptance contract' },
      { role: 'user', content: 'acceptance packet' }
    ],
    getResponseFormat: () => ({ type: 'json_schema' }),
    formatModelResponse: (text) => ({ text, references: [] }),
    formatProseResponse: (text) => ({ text, references: [] }),
    validateAnswer: ({ text }) => ({
      ok: text === 'Supported answer',
      issues: text === 'Supported answer' ? [] : [{ code: 'unsupported_number' }],
      retryInstruction: 'Use only supported acceptance evidence.'
    }),
    modelClient: createModelClient(modelBehavior, calls)
  };
}

export function createAdvisorAcceptanceChat({
  providerProfile = 'rules_engine',
  modelBehavior
} = {}) {
  const profile =
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES[providerProfile] ||
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.rules_engine;
  const calls = [];
  const events = [];
  const history = [];
  let conversationState = null;
  let turnIndex = 0;
  const effectiveModelBehavior = modelBehavior || profile.modelBehavior;

  return {
    calls,
    events,
    get conversationState() {
      return conversationState;
    },
    async send({
      message,
      turn,
      summary,
      workbook,
      context,
      services,
      persistAdvisorDrafts = false
    }) {
      turnIndex += 1;
      const result = await runAdvisorOrchestratorTurn(
        {
          requestId: 'acceptance_request_' + String(turnIndex),
          traceId: 'acceptance_trace_' + String(turnIndex),
          message,
          settings: profile.settings,
          turn,
          context: context || makeAcceptanceContext(),
          workbook,
          services,
          history,
          conversationState,
          persistAdvisorDrafts,
          exposeTurnTrace: true,
          createId: (prefix) => prefix + '_acceptance_' + String(turnIndex)
        },
        makeDeps({
          summary,
          modelBehavior: effectiveModelBehavior,
          calls,
          events
        })
      );
      conversationState = result.nextConversationState || conversationState;
      history.push({ role: 'user', content: message });
      history.push({
        role: 'assistant',
        content: result.message && result.message.text ? result.message.text : ''
      });
      return result;
    }
  };
}

export function replayImageTransactionExtractionFailure({ providerProfile = 'rules_engine' } = {}) {
  const profile =
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES[providerProfile] ||
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.rules_engine;
  const blockedItems = [
    {
      stage: 'review',
      reason: 'The payment account was not visible.',
      action: {
        type: 'transaction_draft',
        template: 'expense_paid',
        status: 'needs_info',
        fields: {
          date: '2026-06-24',
          description: 'Coffee receipt',
          amount: 180,
          currency: 'PHP',
          counterpartyName: 'Cafe'
        },
        missingFields: ['primaryAccountId'],
        evidenceSource: 'image'
      }
    }
  ];
  const text = buildAdvisorPartialTransactionRecovery({
    blockedItems,
    diagnostic: { reason: 'Review blocked the image candidate.' }
  });
  const message = { text, actions: [] };
  const turnTrace = buildAdvisorTurnTrace({
    requestId: 'acceptance_image_request',
    traceId: 'acceptance_image_trace',
    status: 'needs_info',
    provider: profile.settings.provider,
    settings: profile.settings,
    responseMode: profile.runtimeProviderKind === 'rules_engine' ? 'rules' : 'prose',
    events: [
      {
        type: 'image_intake_review_blocked',
        at: '2026-06-27T00:00:00.000Z',
        metadata: { reason: 'review_blocked' }
      }
    ],
    actions: [],
    blockedDraftCandidates: blockedItems,
    message,
    directWorkbookMutation: false,
    modelOutputAcceptedAsMutation: false
  });
  return {
    text,
    message,
    blockedItems,
    turnTrace
  };
}

export function replaySubscriptionReferentFollowup({
  providerProfile = 'rules_engine',
  prompt = 'add those to my subscriptions',
  conversationState
} = {}) {
  const profile =
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES[providerProfile] ||
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.rules_engine;
  const resolved = resolveAdvisorReferents(prompt, conversationState || {});
  const shouldApply = shouldApplySubscriptionRecommendation(prompt, conversationState || {});
  const drafts = shouldApply
    ? resolved.items.map((item, index) => ({
        id: 'acceptance_recurring_draft_' + String(index + 1),
        status: 'pending',
        operation: 'create',
        objectType: 'recurringItem',
        title: 'Track ' + item.name,
        summary: 'Create a recurring-item tracker from the previous Advisor recommendation.',
        proposed: {
          kind: item.kind === 'subscription' ? 'subscription' : 'bill',
          name: item.name,
          categoryId: item.categoryId,
          counterpartyId: item.counterpartyId,
          amount: item.amount,
          currency: item.currency,
          frequency: item.frequency,
          anchorDate: item.anchorDate,
          sourceTransactionIds: item.transactionIds
        },
        sourceRefs: item.sourceRefs,
        confidence: item.confidence,
        reason: item.reason
      }))
    : [];
  const actions = drafts.map((draft) => ({
    id: 'acceptance_ai_draft_action_' + draft.id,
    type: 'ai_draft_reference',
    aiDraftId: draft.id,
    title: draft.title,
    summary: draft.summary,
    status: draft.status
  }));
  const text = drafts.length
    ? 'I queued reviewable recurring-item drafts from the previous recommendation. Review them before applying anything.'
    : 'I could not resolve that follow-up to a previous subscription recommendation. Nothing changed.';
  const message = { text, actions };
  const turnTrace = buildAdvisorTurnTrace({
    requestId: 'acceptance_referent_request',
    traceId: 'acceptance_referent_trace',
    status: drafts.length ? 'answered' : 'needs_info',
    provider: profile.settings.provider,
    settings: profile.settings,
    responseMode: profile.runtimeProviderKind === 'rules_engine' ? 'rules' : 'prose',
    events: [
      {
        type: drafts.length ? 'referent_resolved' : 'referent_unresolved',
        at: '2026-06-27T00:00:00.000Z',
        metadata: { targetIntent: 'create_recurring_item' }
      }
    ],
    actions,
    preparedDrafts: drafts,
    nextConversationState: conversationState,
    message,
    directWorkbookMutation: false,
    modelOutputAcceptedAsMutation: false
  });
  return {
    resolved,
    drafts,
    actions,
    text,
    message,
    turnTrace
  };
}

export function replayCreditCardChargeCommand({
  providerProfile = 'rules_engine',
  prompt = 'also add 15usd charged to my credit card. purchased credits for open ai API'
} = {}) {
  const profile =
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES[providerProfile] ||
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.rules_engine;
  const command = classifyAdvisorCommandMode(prompt);
  const adjudicated = adjudicateAdvisorTransactionIntent({ message: prompt, intent: {} });
  const action = {
    id: 'acceptance_credit_card_transaction_draft',
    type: 'transaction_draft',
    status: 'needs_info',
    template: adjudicated.intent && adjudicated.intent.template,
    fields: adjudicated.intent && adjudicated.intent.fields,
    missingFields: ['primaryAccountId', 'categoryId']
  };
  const message = {
    text: 'I can prepare that as a credit-card expense draft, but it still needs review before posting.',
    actions: [action]
  };
  const turnTrace = buildAdvisorTurnTrace({
    requestId: 'acceptance_credit_card_request',
    traceId: 'acceptance_credit_card_trace',
    status: 'needs_info',
    provider: profile.settings.provider,
    settings: profile.settings,
    responseMode: profile.runtimeProviderKind === 'rules_engine' ? 'rules' : 'prose',
    events: [
      {
        type: 'transaction_intent_adjudicated',
        at: '2026-06-27T00:00:00.000Z',
        metadata: { targetIntent: 'record_transaction' }
      }
    ],
    actions: [action],
    message,
    directWorkbookMutation: false,
    modelOutputAcceptedAsMutation: false
  });
  return {
    command,
    adjudicated,
    action,
    message,
    turnTrace
  };
}
