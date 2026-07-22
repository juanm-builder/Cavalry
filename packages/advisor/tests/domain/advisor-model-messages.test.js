// Tests for Advisor model messages.

import { describe, expect, it } from 'vitest';
import {
  buildAdvisorModelMessages,
  buildAdvisorTransactionImageIntentMessages,
  getAdvisorModelBehaviorContract,
  getAdvisorRecentHistoryMessages
} from '@cavalry/advisor/domain/advisor/model-messages.js';

describe('advisor model messages', () => {
  it('includes the calm advisor behavior contract', () => {
    const contract = getAdvisorModelBehaviorContract().join(' ');
    expect(contract).toContain('Cavalry calculates; you explain');
    expect(contract).toContain('Use task_spec as the contract');
    expect(contract).toContain('Use answer_plan only as non-binding guidance');
    expect(contract).toContain('For greetings, do not show financial metrics');
    expect(contract).toContain('For small talk, answer naturally');
    expect(contract).toContain('For transaction capability questions');
    expect(contract).toContain('Cavalry workbook account draft');
    expect(contract).toContain('natural conversational shape');
    expect(contract).toContain('vary the wording and structure');
    expect(contract).toContain('do not list total assets, total liabilities, or net worth unless');
    expect(contract).toContain('below a typical 3-6 month buffer');
    expect(contract).toContain('Avoid words like critical, extreme');
    expect(contract).toContain('Do not add boilerplate disclaimers');
  });

  it('builds model messages with transaction analysis packet instructions', () => {
    const summary = {
      resolved_question: 'Analyze selected-period spending.',
      intent: 'spending_analysis',
      target_intent: 'spending_analysis',
      response_style: 'recommendation',
      task_spec: {
        intent: 'spending_analysis',
        dateScope: {
          type: 'current_week',
          start: '2026-06-15',
          end: '2026-06-19',
          label: 'June 15 - 19, 2026',
          source: 'prompt'
        },
        outputMode: 'analysis'
      },
      answer_plan: {
        sections: [
          'quick_read',
          'scope_used',
          'important_observations',
          'cleanup_or_data_quality_notes',
          'next_best_actions'
        ],
        tableAllowed: false
      },
      data_packets: {
        transaction_analysis: {
          packet_version: 'cavalry.transaction_analysis.v1',
          top_spending_categories: [{ name: 'Food', amount: '1200.00' }]
        }
      }
    };
    const messages = buildAdvisorModelMessages('whats your analysis on these spendings?', summary, {
      proseMode: true,
      history: [
        { role: 'assistant', text: 'Starting local advisor...' },
        { role: 'user', text: 'hi' }
      ]
    });

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('If data_packets.transaction_analysis is present');
    expect(messages[0].content).toContain('Use task_spec.dateScope');
    expect(messages[0].content).toContain('Return concise natural Markdown');
    expect(messages[0].content).toContain('Do not show answer_plan section ids');
    expect(messages[0].content).toContain('Avoid recurring report headers');
    expect(messages[0].content).not.toContain('Use answer_plan.sections');
    expect(messages[0].content).toContain(
      'raw transaction rows only when the user explicitly asks'
    );
    expect(messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(messages[2].content).toContain('Cavalry facts:');
    expect(messages[2].content).toContain('"schema_version": "cavalry.advisor_facts.v1"');
    expect(messages[2].content).toContain('"selected_packet_kind": "transaction_analysis"');
    expect(messages[2].content).toContain('Cavalry source packet:');
    expect(messages[2].content).toContain('"transaction_analysis"');
    expect(messages[2].content).toContain('"task_spec"');
    expect(messages[2].content).toContain('"answer_plan"');
    expect(messages[2].content).toContain('"June 15 - 19, 2026"');
  });

  it('uses lightweight packets for conversational turns', () => {
    const messages = buildAdvisorModelMessages(
      'how are you?',
      {
        schema_version: 'cavalry.advisor_packet.v2',
        question: 'how are you?',
        resolved_question: 'Respond naturally. Do not mention budgets or transactions.',
        intent: 'small_talk',
        target_intent: 'small_talk',
        answer_plan: {
          sections: ['brief_reply', 'gentle_invitation']
        },
        conversation_context: {
          previous_answer_summary: 'Budget pressure was 951% and spending was high.'
        },
        computed: {
          cashflow_period: {
            spending: { amount: '999999.00' }
          }
        },
        risks: [{ title: 'Budget pressure' }]
      },
      {
        proseMode: true
      }
    );

    expect(messages[1].content).toContain('"target_intent": "small_talk"');
    expect(messages[1].content).toContain('No workbook metrics are included');
    expect(messages[1].content).not.toContain('999999.00');
    expect(messages[1].content).not.toContain('Budget pressure');
    expect(messages[1].content).not.toContain('"answer_plan"');
    expect(messages[1].content).not.toContain('brief_reply');
    expect(messages[1].content).not.toMatch(
      /\b(transactions?|spending|budgets?|bills?|financial, tax)\b/i
    );
    expect(messages[1].content).toContain('"data_packets": {}');
  });

  it('includes account snapshot packets for account advice', () => {
    const messages = buildAdvisorModelMessages(
      'what advice do you have about my accounts?',
      {
        schema_version: 'cavalry.advisor_packet.v2',
        resolved_question: 'Review account balances.',
        intent: 'account_analysis',
        target_intent: 'account_analysis',
        response_style: 'recommendation',
        task_spec: {
          intent: 'account_analysis',
          outputMode: 'analysis'
        },
        data_packets: {
          account_snapshot: {
            packet_version: 'cavalry.account_snapshot.v1',
            as_of: '2026-06-30',
            selection: {
              policy: 'active_asset_liability_accounts_plus_archived_nonzero',
              source_count: 2,
              included_count: 2
            },
            totals: {
              assets: {
                amount: '5000.00',
                currency: 'PHP',
                source_refs: ['account_snapshot:assets']
              },
              liabilities: {
                amount: '1200.00',
                currency: 'PHP',
                source_refs: ['account_snapshot:liabilities']
              }
            },
            accounts: [
              {
                account_id: 'cash',
                name: 'Cash',
                group: 'asset',
                balance: '5000.00',
                balance_display: 'PHP 5000.00',
                source_ref: 'account:cash',
                source_refs: ['account:cash']
              }
            ]
          }
        }
      },
      {
        proseMode: true
      }
    );

    expect(messages[0].content).toContain('data_packets.account_snapshot');
    expect(messages[0].content).toContain(
      'do not include total assets, total liabilities, or net worth unless'
    );
    expect(messages[1].content).toContain('"selected_packet_kind": "account_snapshot"');
    expect(messages[1].content).toContain('"name": "Cash"');
    expect(messages[1].content).toContain('"account_snapshot"');
    expect(messages[1].content).not.toMatch(/lack account access/i);
  });

  it('includes full category inventory packets for category roster reads', () => {
    const messages = buildAdvisorModelMessages(
      'can u read all my categories first?',
      {
        schema_version: 'cavalry.advisor_packet.v2',
        resolved_question: 'Show the full category inventory.',
        intent: 'category_inventory',
        target_intent: 'category_inventory',
        response_style: 'breakdown',
        task_spec: {
          intent: 'category_inventory',
          outputMode: 'analysis'
        },
        data_packets: {
          category_inventory: {
            packet_version: 'cavalry.category_inventory.v1',
            selection: {
              policy: 'full_category_inventory',
              source_count: 2,
              included_count: 2,
              omitted_count: 0
            },
            categories: [
              {
                category_id: 'food',
                name: 'Food',
                type: 'expense',
                selected_period_transaction_count: 1,
                source_ref: 'category:food'
              },
              {
                category_id: 'transport',
                name: 'Transport',
                type: 'expense',
                selected_period_transaction_count: 0,
                source_ref: 'category:transport'
              }
            ]
          }
        }
      },
      {
        proseMode: true
      }
    );

    expect(messages[0].content).toContain('data_packets.category_inventory');
    expect(messages[0].content).toContain('zero selected-period transactions');
    expect(messages[1].content).toContain('"selected_packet_kind": "category_inventory"');
    expect(messages[1].content).toContain('"categories"');
    expect(messages[1].content).toContain('"Transport"');
  });

  it('keeps transaction capability model packets free of workbook rows and metrics', () => {
    const messages = buildAdvisorModelMessages(
      'can you read my transactions?',
      {
        schema_version: 'cavalry.advisor_packet.v2',
        question: 'can you read my transactions?',
        resolved_question: 'Confirm capability.',
        intent: 'transaction_capability',
        target_intent: 'transaction_capability',
        answer_plan: {
          sections: ['capability_confirmation', 'analysis_offer']
        },
        data_packets: {
          transaction_list: {
            transactions: [{ description: 'Hidden row', amount: '999999.00' }]
          }
        },
        risks: [{ title: 'Budget pressure' }]
      },
      {
        proseMode: true
      }
    );

    expect(messages[1].content).toContain('"target_intent": "transaction_capability"');
    expect(messages[1].content).toContain('No workbook metrics are included');
    expect(messages[1].content).toContain('Can confirm transaction analysis capability');
    expect(messages[1].content).not.toContain('Hidden row');
    expect(messages[1].content).not.toContain('999999.00');
    expect(messages[1].content).not.toContain('Budget pressure');
    expect(messages[1].content).not.toContain('"answer_plan"');
    expect(messages[1].content).toContain('"data_packets": {}');
  });

  it('filters status chatter from recent history', () => {
    expect(
      getAdvisorRecentHistoryMessages([
        { role: 'assistant', text: 'Starting local advisor...' },
        { role: 'assistant', text: 'Local model is generating...' },
        { role: 'user', text: 'Analyze spending' }
      ])
    ).toEqual([{ role: 'user', content: 'Analyze spending' }]);
  });

  it('builds multimodal image transaction intake messages', () => {
    const messages = buildAdvisorTransactionImageIntentMessages(
      {
        currency: 'PHP',
        accounts: [{ id: 'cash', name: 'Cash', group: 'asset', isActive: true }],
        categories: [{ id: 'food', name: 'Food', type: 'expense', isActive: true }],
        counterparties: []
      },
      '',
      [
        {
          id: 'image-one',
          filename: 'receipt.jpg',
          mimeType: 'image/jpeg',
          size: 1200,
          width: 900,
          height: 1200,
          dataUrl: 'data:image/jpeg;base64,abc'
        }
      ],
      {
        currentDate: '2026-06-19'
      }
    );

    expect(messages[0].content).toContain('Transaction Image Intake');
    expect(messages[0].content).toContain('grand total');
    expect(messages[0].content).toContain('sourceAttachmentId');
    expect(messages[0].content).toContain('Total Sales');
    expect(messages[0].content).toContain('Do not extract line items');
    expect(messages[0].content).toContain('user-provided text for account and date');
    expect(messages[1].content).toHaveLength(2);
    expect(messages[1].content[0]).toMatchObject({ type: 'text' });
    expect(messages[1].content[0].text).toContain('cavalry.transaction_image_intent.v1');
    expect(messages[1].content[0].text).toContain(
      'transaction_drafts | needs_info | not_transaction'
    );
    expect(messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/jpeg;base64,abc'
      }
    });
  });
});
