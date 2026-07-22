// Tests for the Advisor orchestrator facade.

import { describe, expect, it } from 'vitest';
import { runAdvisorOrchestratorTurn } from '@cavalry/advisor/application/advisor/advisor-orchestrator.js';
import { validateAdvisorAnswer } from '@cavalry/advisor/domain/advisor/answer-validation.js';
import {
  ADVISOR_ACCEPTANCE_PROVIDER_PROFILES,
  createAdvisorAcceptanceChat,
  makeAcceptanceContext,
  makeAcceptanceWorkbook,
  makeSpendingSummary,
  spendingTurn
} from '../helpers/advisor-acceptance-harness.js';

function makeRemoteDeps({ summary, modelTexts }) {
  const calls = [];
  let index = 0;
  return {
    calls,
    deps: {
      now: () => '2026-06-27T00:00:00.000Z',
      buildSummary: () => summary,
      buildMessages: () => [
        { role: 'system', content: 'remote acceptance test' },
        { role: 'user', content: 'advisor packet' }
      ],
      getResponseFormat: () => null,
      formatModelResponse: (text) => ({ text, references: [] }),
      formatProseResponse: (text) => ({ text, references: [] }),
      validateAnswer: validateAdvisorAnswer,
      modelClient: {
        chat: async (payload) => {
          calls.push(payload);
          const text = modelTexts[Math.min(index, modelTexts.length - 1)];
          index += 1;
          return { ok: true, text };
        }
      }
    }
  };
}

describe('advisor orchestrator facade', () => {
  it('normalizes read-only QA turns while preserving the certified behavior', async () => {
    const chat = createAdvisorAcceptanceChat({ providerProfile: 'rules_engine' });
    const result = await chat.send({
      message: 'Review recent spending.',
      turn: spendingTurn,
      summary: makeSpendingSummary(),
      workbook: makeAcceptanceWorkbook(),
      context: makeAcceptanceContext()
    });

    expect(result.status).toBe('answered');
    expect(result.message.text).toMatch(/consumption|spending|checked/i);
    expect(result.actionCards).toEqual(result.message.actions);
    expect(result.draftGroups).toEqual(result.message.draftGroups);
    expect(result.statePatch.conversationState).toMatchObject({
      lastTargetIntent: 'spending_analysis',
      lastRecommendation: expect.objectContaining({
        type: 'subscription_candidates'
      })
    });
    expect(result.safeFallbackUsed).toBe(false);
    expect(result.turnTrace).toMatchObject({
      traceVersion: 'cavalry.advisor_turn_trace.v1',
      orchestrator: {
        version: 'cavalry.advisor_orchestrator.v1',
        adapter: 'read_only_qa'
      },
      safety: {
        directWorkbookMutation: false,
        modelOutputAcceptedAsMutation: false,
        writesRequireReview: true
      }
    });
  });

  it('surfaces safeFallbackUsed when configured providers fall back to a skeleton', async () => {
    const chat = createAdvisorAcceptanceChat({
      providerProfile: 'remote_llm',
      modelBehavior: 'invalid'
    });
    const result = await chat.send({
      message: 'Review recent spending.',
      turn: spendingTurn,
      summary: makeSpendingSummary(),
      workbook: makeAcceptanceWorkbook(),
      context: makeAcceptanceContext()
    });

    expect(result.status).toBe('fallback');
    expect(result.safeFallbackUsed).toBe(true);
    expect(result.turnTrace.fallback).toMatchObject({
      used: true,
      usedSkeleton: true,
      hasUsefulCopy: true
    });
    expect(result.message.text).not.toMatch(/^I could not produce a verified Advisor answer/i);
  });

  it('adapts subscription referent follow-ups into reviewable draft actions', async () => {
    const chat = createAdvisorAcceptanceChat({ providerProfile: 'rules_engine' });
    const first = await chat.send({
      message: 'which of these look like subscriptions?',
      turn: spendingTurn,
      summary: makeSpendingSummary(),
      workbook: makeAcceptanceWorkbook(),
      context: makeAcceptanceContext()
    });

    const result = await runAdvisorOrchestratorTurn({
      requestId: 'orchestrator_subscription_request',
      traceId: 'orchestrator_subscription_trace',
      adapter: 'subscription_referent_followup',
      message: 'add those to my subscriptions',
      settings: ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.rules_engine.settings,
      conversationState: first.nextConversationState,
      exposeTurnTrace: true,
      createId: (prefix) => prefix + '_orchestrator_test'
    });

    expect(result.status).toBe('answered');
    expect(result.preparedDrafts).toHaveLength(2);
    expect(result.preparedDrafts.map((draft) => draft.objectType)).toEqual([
      'recurringItem',
      'recurringItem'
    ]);
    expect(result.actionCards.map((action) => action.type)).toEqual([
      'ai_draft_reference',
      'ai_draft_reference'
    ]);
    expect(result.message.text).toMatch(/queued|reviewable|draft/i);
    expect(result.turnTrace).toMatchObject({
      route: {
        route: 'legacy_adapter',
        targetIntent: 'create_recurring_item'
      },
      orchestrator: {
        adapter: 'subscription_referent_followup'
      },
      safety: {
        directWorkbookMutation: false,
        modelOutputAcceptedAsMutation: false,
        reviewableDraftCount: 2
      }
    });
  });

  it('adapts credit-card charge commands as expense transaction drafts, not account creation', async () => {
    const result = await runAdvisorOrchestratorTurn({
      requestId: 'orchestrator_credit_card_request',
      traceId: 'orchestrator_credit_card_trace',
      adapter: 'credit_card_transaction_draft',
      message: 'also add 15usd charged to my credit card. purchased credits for open ai API',
      settings: ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.rules_engine.settings,
      exposeTurnTrace: true,
      createId: (prefix) => prefix + '_orchestrator_test'
    });

    expect(result.adjudicated).toMatchObject({
      changed: true,
      intent: expect.objectContaining({
        template: 'expense_charged',
        paymentAccountHint: 'credit card',
        notIntent: ['create_account']
      })
    });
    expect(result.actionCards).toEqual([
      expect.objectContaining({
        type: 'transaction_draft',
        template: 'expense_charged'
      })
    ]);
    expect(result.actionCards).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ai_draft_reference', objectType: 'account' })
      ])
    );
    expect(result.turnTrace).toMatchObject({
      route: {
        route: 'legacy_adapter',
        targetIntent: 'record_transaction'
      },
      orchestrator: {
        adapter: 'credit_card_transaction_draft'
      },
      safety: {
        directWorkbookMutation: false,
        modelOutputAcceptedAsMutation: false,
        reviewableActionCount: 1
      }
    });
  });

  it('accepts a valid remote model response for read-only spending review', async () => {
    const summary = makeSpendingSummary();
    const validText = [
      'I checked 3 June records in the Advisor packet.',
      '',
      'Consumption spending was **PHP 2,260.00**. The useful review items are ChatGPT Pro, Netflix, and Unknown store in Random. Nothing changed in your workbook.'
    ].join('\n');
    const fixture = makeRemoteDeps({
      summary,
      modelTexts: [validText]
    });

    const result = await runAdvisorOrchestratorTurn(
      {
        requestId: 'orchestrator_remote_valid_request',
        traceId: 'orchestrator_remote_valid_trace',
        message: 'Review recent spending.',
        settings: ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.remote_llm.settings,
        turn: spendingTurn,
        workbook: makeAcceptanceWorkbook(),
        context: makeAcceptanceContext(),
        exposeTurnTrace: true
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.safeFallbackUsed).toBe(false);
    expect(result.message.text).toBe(validText);
    expect(result.turnTrace.modelDiagnostics).toMatchObject({
      retryAttempted: false,
      attempts: [
        expect.objectContaining({
          transportSucceeded: true,
          parseSucceeded: true,
          validationSucceeded: true
        })
      ]
    });
    expect(fixture.calls).toHaveLength(1);
  });

  it('silently falls back for invalid remote answers while preserving diagnostics', async () => {
    const summary = makeSpendingSummary();
    const invalidText =
      'Your spending was **PHP 999,999.00** and I updated the workbook categories.';
    const fixture = makeRemoteDeps({
      summary,
      modelTexts: [invalidText, invalidText]
    });

    const result = await runAdvisorOrchestratorTurn(
      {
        requestId: 'orchestrator_remote_invalid_request',
        traceId: 'orchestrator_remote_invalid_trace',
        message: 'Review recent spending.',
        settings: ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.remote_llm.settings,
        turn: spendingTurn,
        workbook: makeAcceptanceWorkbook(),
        context: makeAcceptanceContext(),
        exposeTurnTrace: true
      },
      fixture.deps
    );

    expect(result.status).toBe('fallback');
    expect(result.safeFallbackUsed).toBe(true);
    expect(result.message.text).not.toMatch(/I had trouble generating/i);
    expect(result.message.text).not.toMatch(/^I could not produce a verified Advisor answer/i);
    expect(result.turnTrace.modelDiagnostics).toMatchObject({
      retryAttempted: true,
      finalValidationIssueCodes: expect.arrayContaining(['unsupported_number'])
    });
    expect(result.turnTrace.modelDiagnostics.attempts).toHaveLength(2);
    expect(result.turnTrace.modelDiagnostics.attempts[0]).toMatchObject({
      transportSucceeded: true,
      parseSucceeded: true,
      validationSucceeded: false,
      modelOutputExcerpt: expect.stringContaining('PHP 999,999.00')
    });
    expect(result.turnTrace.fallback).toMatchObject({
      used: true,
      usedSkeleton: true
    });
  });
});
