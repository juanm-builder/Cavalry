// Tests for Advisor agent tools.

import { describe, expect, it } from 'vitest';
import {
  ADVISOR_AGENT_TOOL_SCHEMAS,
  runAdvisorAgentTool,
  runAdvisorAgentToolLoop
} from '@cavalry/advisor/application/advisor/agent-tools.js';

const workbook = {
  currency: 'PHP',
  settings: { usdToBaseRate: 56 },
  accounts: [
    {
      id: 'expense_account',
      name: 'Expense Account',
      group: 'asset',
      subtype: 'checking',
      isActive: true
    },
    {
      id: 'rcbc_card',
      name: 'RCBC Credit Card',
      group: 'liability',
      subtype: 'credit card',
      isActive: true
    }
  ],
  categories: [{ id: 'cc_payment', name: 'Credit Card Payment', type: 'debt', isActive: true }],
  counterparties: [],
  transactions: []
};

describe('advisor agent tools', () => {
  it('exposes safe finance tools for Responses function calling', () => {
    expect(ADVISOR_AGENT_TOOL_SCHEMAS.map((tool) => tool.name)).toEqual([
      'classify_finance_intent',
      'lookup_accounts',
      'lookup_categories',
      'lookup_counterparties',
      'prepare_transaction_draft',
      'revise_draft',
      'explain_draft'
    ]);
  });

  it('prepares draft candidates through validation without mutating the workbook', () => {
    const before = workbook.transactions.length;
    const result = runAdvisorAgentTool(
      'prepare_transaction_draft',
      {
        prompt:
          'i paid for my credit card bill using my expense account. the amount is my entire expense account which is 19807.51',
        template: 'expense_charged',
        fields: {
          amount: 19807.51,
          primaryAccountName: 'Credit card'
        },
        confidence: 0.51,
        reason: 'Model guessed card charge.'
      },
      {
        workbook,
        currentDate: '2026-07-03'
      }
    );

    expect(result).toMatchObject({
      ok: true,
      directMutation: false,
      mutation: 'draft_candidate_only',
      draftCandidate: {
        status: 'draft',
        template: 'debt_payment',
        dateDefaulted: true
      }
    });
    expect(result.draftCandidate.fields).toMatchObject({
      date: '2026-07-03',
      primaryAccountId: 'expense_account',
      secondaryAccountId: 'rcbc_card',
      categoryId: 'cc_payment'
    });
    expect(workbook.transactions.length).toBe(before);
  });

  it('runs a fake Responses tool loop without accepting direct workbook mutation', async () => {
    const calls = [];
    const modelClient = {
      async createResponse(payload) {
        calls.push(payload);
        if (calls.length === 1) {
          return {
            id: 'resp_1',
            output: [
              {
                type: 'function_call',
                call_id: 'call_prepare',
                name: 'prepare_transaction_draft',
                arguments: JSON.stringify({
                  prompt:
                    'i paid for my credit card bill using my expense account. the amount is my entire expense account which is 19807.51',
                  template: 'expense_charged',
                  fields: {
                    amount: 19807.51,
                    primaryAccountName: 'Credit card'
                  },
                  confidence: 0.51,
                  reason: 'Model guessed card charge.'
                })
              },
              {
                type: 'function_call',
                call_id: 'call_mutate',
                name: 'direct_mutate_workbook',
                arguments: JSON.stringify({
                  transaction: { amount: 19807.51 }
                })
              }
            ]
          };
        }
        return {
          id: 'resp_2',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Draft prepared for review.' }]
            }
          ]
        };
      }
    };

    const result = await runAdvisorAgentToolLoop({
      modelClient,
      workbook,
      input:
        'i paid for my credit card bill using my expense account. the amount is my entire expense account which is 19807.51',
      currentDate: '2026-07-03'
    });

    expect(result.directWorkbookMutation).toBe(false);
    expect(result.preparedDrafts).toHaveLength(1);
    expect(result.preparedDrafts[0].template).toBe('debt_payment');
    expect(result.toolCalls.map((call) => call.name)).toEqual([
      'prepare_transaction_draft',
      'direct_mutate_workbook'
    ]);
    expect(result.toolCalls[1].result).toMatchObject({
      ok: false,
      directMutation: false
    });
    expect(workbook.transactions).toEqual([]);
  });
});
