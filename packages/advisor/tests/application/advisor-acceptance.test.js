// Acceptance tests for Advisor safety and recovery behavior.

import { describe, expect, it } from 'vitest';
import {
  ADVISOR_ACCEPTANCE_PROVIDER_PROFILES,
  accountAnalysisTurn,
  categorizationReviewTurn,
  createAdvisorAcceptanceChat,
  makeAccountSummary,
  makeAcceptanceContext,
  makeAcceptanceWorkbook,
  makeCategorizationSummary,
  makeCleanupServices,
  makeSpendingSummary,
  replayCreditCardChargeCommand,
  replayImageTransactionExtractionFailure,
  replaySubscriptionReferentFollowup,
  spendingTurn
} from '../helpers/advisor-acceptance-harness.js';

const providerNames = Object.keys(ADVISOR_ACCEPTANCE_PROVIDER_PROFILES);

function expectSafety(trace) {
  expect(trace.safety).toMatchObject({
    directWorkbookMutation: false,
    modelOutputAcceptedAsMutation: false,
    writesRequireReview: true
  });
}

function expectProvider(trace, providerName) {
  expect(trace.providerProfile.runtimeProviderKind).toBe(
    ADVISOR_ACCEPTANCE_PROVIDER_PROFILES[providerName].runtimeProviderKind
  );
}

describe('advisor acceptance hardening', () => {
  it.each([
    ['remote_llm', 'invalid'],
    ['local_llm', 'unavailable']
  ])(
    'falls back to a verified skeleton for configured-provider failure: %s',
    async (providerName, modelBehavior) => {
      const chat = createAdvisorAcceptanceChat({ providerProfile: providerName, modelBehavior });
      const result = await chat.send({
        message: 'Where did my money go this month?',
        turn: spendingTurn,
        summary: makeSpendingSummary(),
        workbook: makeAcceptanceWorkbook(),
        context: makeAcceptanceContext()
      });

      expect(result.status).toBe('fallback');
      expectProvider(result.turnTrace, providerName);
      expect(result.turnTrace.fallback).toMatchObject({
        used: true,
        usedSkeleton: true,
        hasUsefulCopy: true
      });
      expect(result.turnTrace.actions.ids).toContain('show_supporting_transactions');
      expect(result.turnTrace.conversation).toMatchObject({
        hasLastRecommendation: true,
        lastRecommendationType: 'subscription_candidates',
        lastRecommendationCandidateCount: 2
      });
      expect(result.message.text).toMatch(/verified|checked|consumption|review/i);
      expect(result.message.text).not.toMatch(/^I could not produce a verified Advisor answer/i);
      expect(result.message.turnTrace).toMatchObject({
        traceVersion: 'cavalry.advisor_turn_trace.v1'
      });
      expectSafety(result.turnTrace);
    }
  );

  it('answers through rules_engine without a model call and still returns a structured trace', async () => {
    const chat = createAdvisorAcceptanceChat({ providerProfile: 'rules_engine' });
    const result = await chat.send({
      message: 'Where did my money go this month?',
      turn: spendingTurn,
      summary: makeSpendingSummary(),
      workbook: makeAcceptanceWorkbook(),
      context: makeAcceptanceContext()
    });

    expect(result.status).toBe('answered');
    expect(result.turnTrace.fallback.used).toBe(false);
    expect(result.turnTrace.providerProfile.runtimeProviderKind).toBe('rules_engine');
    expect(result.turnTrace.packet.kinds).toContain('transaction_analysis');
    expect(chat.calls).toHaveLength(0);
    expectSafety(result.turnTrace);
  });

  it.each(providerNames)(
    'returns needs-info image recovery copy and no mutation: %s',
    (providerName) => {
      const replay = replayImageTransactionExtractionFailure({ providerProfile: providerName });

      expectProvider(replay.turnTrace, providerName);
      expect(replay.turnTrace.status).toBe('needs_info');
      expect(replay.turnTrace.blockedDraftCandidates).toMatchObject({
        count: 1,
        stages: ['review']
      });
      expect(replay.turnTrace.actions.count).toBe(0);
      expect(replay.text).toMatch(/could read|still needed|nothing changed/i);
      expect(replay.text).not.toMatch(
        /^I could not create a transaction draft from the attached image/i
      );
      expectSafety(replay.turnTrace);
    }
  );

  it.each(providerNames)(
    'keeps categorization review as reviewable drafts: %s',
    async (providerName) => {
      const workbook = makeAcceptanceWorkbook();
      const chat = createAdvisorAcceptanceChat({ providerProfile: providerName });
      const result = await chat.send({
        message: 'review my categories and prepare cleanup',
        turn: categorizationReviewTurn,
        summary: makeCategorizationSummary(),
        workbook,
        context: makeAcceptanceContext(),
        services: makeCleanupServices(),
        persistAdvisorDrafts: false
      });

      expectProvider(result.turnTrace, providerName);
      expect(['answered', 'fallback']).toContain(result.status);
      expect(result.turnTrace.route.targetIntent).toBe('categorization_review');
      expect(result.turnTrace.draftGroups.count).toBeGreaterThan(0);
      expect(result.turnTrace.preparedDrafts).toMatchObject({
        count: 1,
        objectTypes: ['ledgerCleanup'],
        statuses: ['pending']
      });
      expect(result.turnTrace.actions.types).toContain('ai_draft_reference');
      expect(result.message.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'ai_draft_reference',
            status: 'pending'
          })
        ])
      );
      expect(result.message.draftGroups.length).toBeGreaterThan(0);
      expect(result.message.text).toMatch(/review|cleanup|supported|checked|verified/i);
      expect(workbook.aiDrafts).toEqual([]);
      expectSafety(result.turnTrace);
    }
  );

  it.each(providerNames)(
    'resolves subscription referent flow for "those" as reviewable drafts: %s',
    async (providerName) => {
      const chat = createAdvisorAcceptanceChat({ providerProfile: providerName });
      const first = await chat.send({
        message: 'which of these look like subscriptions?',
        turn: spendingTurn,
        summary: makeSpendingSummary(),
        workbook: makeAcceptanceWorkbook(),
        context: makeAcceptanceContext()
      });
      const followup = replaySubscriptionReferentFollowup({
        providerProfile: providerName,
        prompt: 'add those to my subscriptions',
        conversationState: first.nextConversationState
      });

      expect(first.nextConversationState.lastRecommendation).toMatchObject({
        type: 'subscription_candidates',
        targetObjectType: 'recurringItem'
      });
      expect(followup.resolved).toMatchObject({
        resolved: true,
        action: 'create_recurring_item_draft'
      });
      expect(followup.drafts).toHaveLength(2);
      expect(followup.drafts.map((draft) => draft.objectType)).toEqual([
        'recurringItem',
        'recurringItem'
      ]);
      expect(followup.actions.map((action) => action.type)).toEqual([
        'ai_draft_reference',
        'ai_draft_reference'
      ]);
      expect(followup.text).toMatch(/queued|review|draft/i);
      expectProvider(followup.turnTrace, providerName);
      expect(followup.turnTrace.preparedDrafts.reviewableCount).toBe(2);
      expectSafety(followup.turnTrace);
    }
  );

  it.each(providerNames)(
    'does not let a generic singular draft confirmation create subscription drafts: %s',
    async (providerName) => {
      const chat = createAdvisorAcceptanceChat({ providerProfile: providerName });
      const first = await chat.send({
        message: 'Where did my money go this month?',
        turn: spendingTurn,
        summary: makeSpendingSummary(),
        workbook: makeAcceptanceWorkbook(),
        context: makeAcceptanceContext()
      });
      const followup = replaySubscriptionReferentFollowup({
        providerProfile: providerName,
        prompt: 'can you create the draft',
        conversationState: first.nextConversationState
      });

      expect(followup.resolved).toMatchObject({
        resolved: true,
        action: 'create_recurring_item_draft'
      });
      expect(followup.drafts).toHaveLength(0);
      expect(followup.actions).toHaveLength(0);
      expect(followup.text).toMatch(/could not resolve|Nothing changed/i);
      expect(followup.turnTrace.preparedDrafts.reviewableCount).toBe(0);
      expectSafety(followup.turnTrace);
    }
  );

  it.each(providerNames)(
    'keeps credit-card charge language as an expense draft, not account creation: %s',
    (providerName) => {
      const replay = replayCreditCardChargeCommand({ providerProfile: providerName });

      expect(replay.command).toMatchObject({
        intent: 'record_expense',
        handler: 'transaction_draft'
      });
      expect(replay.command.intent).not.toBe('create_account');
      expect(replay.adjudicated).toMatchObject({
        changed: true,
        intent: expect.objectContaining({
          template: 'expense_charged',
          paymentAccountHint: 'credit card',
          notIntent: ['create_account']
        })
      });
      expect(replay.action).toMatchObject({
        type: 'transaction_draft',
        template: 'expense_charged',
        status: 'needs_info'
      });
      expect(replay.message.text).toMatch(/credit-card|expense|review/i);
      expectProvider(replay.turnTrace, providerName);
      expect(replay.turnTrace.actions.types).toContain('transaction_draft');
      expect(replay.turnTrace.safety.reviewableActionCount).toBeGreaterThan(0);
      expectSafety(replay.turnTrace);
    }
  );

  it.each(providerNames)(
    'answers account advice with real account rows: %s',
    async (providerName) => {
      const workbook = makeAcceptanceWorkbook();
      const chat = createAdvisorAcceptanceChat({
        providerProfile: providerName,
        modelBehavior: providerName === 'rules_engine' ? 'none' : 'invalid'
      });
      const result = await chat.send({
        message: 'What advice do you have about my accounts?',
        turn: accountAnalysisTurn,
        summary: makeAccountSummary(workbook),
        workbook,
        context: makeAcceptanceContext()
      });

      expect(['answered', 'fallback']).toContain(result.status);
      expect(result.message.text).toMatch(/Cash|Credit Card/);
      expect(result.message.text).toMatch(/PHP|account/i);
      expect(result.message.text).not.toMatch(/cannot|can't|do not have access|lack access/i);
      expect(result.turnTrace.packet.kinds).toContain('account_snapshot');
      expectProvider(result.turnTrace, providerName);
      expectSafety(result.turnTrace);
    }
  );
});
