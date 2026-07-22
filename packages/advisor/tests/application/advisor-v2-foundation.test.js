// Tests for the Advisor v2 foundation.

import { describe, expect, it } from 'vitest';
import {
  buildAdvisorModelCapabilityProfile,
  chooseAdvisorResponseMode
} from '@cavalry/advisor/application/advisor/model-capabilities.js';
import { buildAdvisorGenerationProfile } from '@cavalry/advisor/application/advisor/generation-profiles.js';
import {
  buildAdvisorResponseRepairPlan,
  composeAdvisorMixedFallback
} from '@cavalry/advisor/application/advisor/response-repair.js';
import {
  buildAdvisorConversationSummary,
  detectAdvisorRepeatedQuestion
} from '@cavalry/advisor/application/advisor/conversation-summary.js';
import { buildAdvisorDraftGroupsFromToolResults } from '@cavalry/advisor/application/advisor/draft-groups.js';
import { buildAdvisorEvidenceWorkspace } from '@cavalry/advisor/application/advisor/evidence-workspace.js';
import {
  buildAdvisorResponseSkeleton,
  renderAdvisorResponseMarkdown
} from '@cavalry/advisor/application/advisor/response-skeletons.js';
import {
  listAdvisorToolDefinitions,
  runAdvisorToolCall
} from '@cavalry/advisor/application/advisor/tools/registry.js';

function makeWorkbook() {
  return {
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', isActive: true },
      { id: 'expense', name: 'Expense', group: 'expense', isActive: true }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense' },
      { id: 'transport', name: 'Transport', type: 'expense' }
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
          { accountId: 'expense', direction: 'debit', baseAmount: 200 },
          { accountId: 'cash', direction: 'credit', baseAmount: 200 }
        ]
      }
    ]
  };
}

describe('advisor v2 foundation', () => {
  it('chooses response modes from capability profiles instead of raw provider labels', () => {
    const rules = buildAdvisorModelCapabilityProfile({ provider: 'local' });
    const localModel = buildAdvisorModelCapabilityProfile({
      provider: 'custom',
      contextWindowTokens: 32768
    });
    const remote = buildAdvisorModelCapabilityProfile({ provider: 'openai', model: 'gpt-test' });

    expect(rules).toMatchObject({ providerKind: 'rules', preferredResponseMode: 'rules' });
    expect(localModel).toMatchObject({
      providerKind: 'local_model',
      preferredResponseMode: 'prose'
    });
    expect(remote).toMatchObject({ providerKind: 'remote_model', preferredResponseMode: 'prose' });
    expect(chooseAdvisorResponseMode(localModel)).toBe('prose');
    expect(chooseAdvisorResponseMode(remote)).toBe('prose');
  });

  it('builds route-specific generation profiles with local-model prose budgets', () => {
    const profile = buildAdvisorModelCapabilityProfile({
      provider: 'custom',
      contextWindowTokens: 32768
    });
    const generation = buildAdvisorGenerationProfile({
      capabilityProfile: profile,
      responseMode: 'prose',
      turn: { targetIntent: 'spending_analysis', responseStyle: 'breakdown' },
      summary: {}
    });

    expect(generation).toMatchObject({
      profile_version: 'cavalry.advisor_generation_profile.v1',
      purpose: 'financial_explanation',
      provider_kind: 'local_model',
      response_mode: 'prose',
      temperature: 0.25,
      maxTokens: 1800
    });
  });

  it('runs deterministic advisor tools through a bounded registry envelope', () => {
    expect(listAdvisorToolDefinitions('spending_analysis').map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'summarize_spending',
        'classify_cash_movements',
        'simulate_spending_change'
      ])
    );
    expect(listAdvisorToolDefinitions('account_analysis').map((tool) => tool.name)).toEqual([
      'summarize_accounts'
    ]);
    expect(listAdvisorToolDefinitions('category_inventory').map((tool) => tool.name)).toEqual([
      'list_categories'
    ]);

    const result = runAdvisorToolCall(
      {
        id: 'call-one',
        tool: 'summarize_spending',
        arguments: {
          date_scope: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' }
        }
      },
      {
        workbook: makeWorkbook(),
        context: {
          profile: {},
          snapshot: { outflow: 200, expense: 200, income: 0, savings: 0, debt: 0, net: -200 },
          budget: {}
        }
      }
    );

    expect(result).toMatchObject({
      toolResultVersion: 'cavalry.advisor_tool_result.v1',
      toolCallId: 'call-one',
      toolName: 'summarize_spending',
      ok: true,
      coverage: {
        totalEligibleRecords: 1,
        returnedRecords: expect.any(Number)
      }
    });
    expect(result.data.semantic_summary.spending_definitions.consumption_only.amount).toBe(200);

    const categories = runAdvisorToolCall(
      {
        id: 'call-categories',
        tool: 'list_categories',
        arguments: {
          date_scope: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' }
        }
      },
      {
        workbook: makeWorkbook(),
        context: {
          profile: {},
          snapshot: {},
          budget: {}
        }
      }
    );

    expect(categories).toMatchObject({
      toolName: 'list_categories',
      ok: true,
      coverage: {
        selectionPolicy: 'full_category_inventory',
        totalEligibleRecords: 2,
        returnedRecords: 2
      }
    });
    expect(categories.data.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category_id: 'food', selected_period_transaction_count: 1 }),
        expect.objectContaining({ category_id: 'transport', selected_period_transaction_count: 0 })
      ])
    );
  });

  it('creates repair plans and mixed fallbacks without exposing diagnostics', () => {
    const validation = {
      issues: [{ code: 'internal_diagnostic_leak', message: 'debug text leaked' }],
      retryInstruction: 'Remove diagnostics.'
    };
    const plan = buildAdvisorResponseRepairPlan({
      text: '# Useful\nExpenses were PHP 200.00.\n\n# Debug\nModel note: grounding checks failed.',
      validation
    });

    expect(plan.repairNeeded).toBe(true);
    expect(plan.validSections.map((section) => section.heading)).toEqual(['Useful']);
    expect(plan.invalidSections.map((section) => section.heading)).toEqual(['Debug']);
    expect(
      composeAdvisorMixedFallback({
        repairPlan: plan,
        deterministicText: 'I kept the verified totals and removed unsupported details.'
      })
    ).not.toContain('Model note');
  });

  it('builds evidence workspaces and response skeletons from tool-backed packets', () => {
    const toolResult = runAdvisorToolCall(
      {
        id: 'call-spending',
        tool: 'summarize_spending',
        arguments: {
          date_scope: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' }
        }
      },
      {
        workbook: makeWorkbook(),
        context: {
          profile: {},
          snapshot: { outflow: 200, expense: 200, income: 0, savings: 0, debt: 0, net: -200 },
          budget: {}
        }
      }
    );
    const summary = {
      scope: {
        period_label: 'June 2026',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        currency: 'PHP'
      },
      data_packets: {
        transaction_analysis: toolResult.data.packet
      }
    };
    const workspace = buildAdvisorEvidenceWorkspace({
      summary,
      toolResults: [toolResult],
      actions: []
    });
    const response = buildAdvisorResponseSkeleton({
      turn: { targetIntent: 'spending_analysis' },
      summary,
      evidenceWorkspace: workspace,
      actions: []
    });

    expect(workspace).toMatchObject({
      workspaceVersion: 'cavalry.advisor_evidence.v1',
      facts: expect.arrayContaining([expect.objectContaining({ id: 'fact_consumption_spending' })])
    });
    expect(response).toMatchObject({
      responseVersion: 'cavalry.advisor_response.v2',
      directAnswer: expect.stringContaining('consumption spending')
    });
    expect(renderAdvisorResponseMarkdown(response)).toContain('I checked');
    expect(renderAdvisorResponseMarkdown(response)).not.toContain('What I checked');
  });

  it('builds account evidence and response skeletons from account snapshots', () => {
    const toolResult = runAdvisorToolCall(
      {
        id: 'call-accounts',
        tool: 'summarize_accounts',
        arguments: {
          as_of_date: '2026-06-30'
        }
      },
      {
        workbook: makeWorkbook(),
        context: {
          profile: { asOfDate: '2026-06-30' },
          snapshot: {},
          budget: {}
        }
      }
    );
    const summary = {
      scope: {
        period_label: 'June 2026',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        currency: 'PHP'
      },
      data_packets: {
        account_snapshot: toolResult.data.packet
      }
    };
    const workspace = buildAdvisorEvidenceWorkspace({
      summary,
      toolResults: [toolResult],
      actions: []
    });
    const response = buildAdvisorResponseSkeleton({
      turn: { targetIntent: 'account_analysis' },
      summary,
      evidenceWorkspace: workspace,
      actions: []
    });

    expect(toolResult.toolName).toBe('summarize_accounts');
    expect(workspace.facts.map((fact) => fact.id)).toContain('fact_account_cash');
    expect(response.directAnswer).toContain('account snapshot');
    expect(renderAdvisorResponseMarkdown(response)).toContain('Largest asset accounts');
  });

  it('builds category inventory evidence and response skeletons from category tools', () => {
    const toolResult = runAdvisorToolCall(
      {
        id: 'call-categories',
        tool: 'list_categories',
        arguments: {
          date_scope: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' }
        }
      },
      {
        workbook: makeWorkbook(),
        context: {
          profile: {},
          snapshot: {},
          budget: {}
        }
      }
    );
    const summary = {
      scope: {
        period_label: 'June 2026',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        currency: 'PHP'
      },
      data_packets: {
        category_inventory: toolResult.data.packet
      }
    };
    const workspace = buildAdvisorEvidenceWorkspace({
      summary,
      toolResults: [toolResult],
      actions: []
    });
    const response = buildAdvisorResponseSkeleton({
      turn: { targetIntent: 'category_inventory' },
      summary,
      evidenceWorkspace: workspace,
      actions: []
    });
    const markdown = renderAdvisorResponseMarkdown(response);

    expect(workspace.facts.map((fact) => fact.id)).toEqual(
      expect.arrayContaining(['fact_categories_total', 'fact_category_transport'])
    );
    expect(response.directAnswer).toContain('full category inventory');
    expect(markdown).toContain('**Transport**');
    expect(markdown).toContain('0 selected-period transactions');
  });

  it('builds draft-group previews from proposal tool results without mutation', () => {
    const proposalResult = runAdvisorToolCall(
      {
        id: 'call-proposal',
        tool: 'prepare_category_drafts',
        arguments: {
          date_scope: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' }
        }
      },
      {
        workbook: makeWorkbook(),
        context: {
          profile: {},
          snapshot: { outflow: 200, expense: 200, income: 0, savings: 0, debt: 0, net: -200 },
          budget: {}
        }
      }
    );
    const groups = buildAdvisorDraftGroupsFromToolResults({
      taskSpec: { specVersion: 'cavalry.advisor_task.v2' },
      toolResults: [proposalResult]
    });

    expect(proposalResult.data).toMatchObject({
      creates_mutation: false,
      review_required: true
    });
    expect(groups).toEqual([
      expect.objectContaining({
        groupId: 'advisor_draft_group_1',
        title: 'Category cleanup proposals',
        status: 'pending'
      })
    ]);
  });

  it('summarizes conversation continuity and detects repeated questions', () => {
    const summary = buildAdvisorConversationSummary(
      {
        currentGoals: ['Improve spending decisions'],
        lastQuestion: 'How can I improve my spending habits?',
        lastAnswerSummary: 'Focused on categories.'
      },
      [{ role: 'user', content: 'How can I improve my spending habits?' }]
    );

    expect(summary).toMatchObject({
      summaryVersion: 'cavalry.advisor_conversation_summary.v1',
      currentGoals: ['Improve spending decisions'],
      lastAnswerSummary: 'Focused on categories.'
    });
    expect(
      detectAdvisorRepeatedQuestion('How can I improve my spending habits?', {
        lastQuestion: 'How can I improve my spending habits?'
      })
    ).toMatchObject({
      repeated: true,
      reason: 'exact_repeat'
    });
  });
});
