// Tests for Advisor application orchestration.

import { describe, expect, it } from 'vitest';
import { runAdvisorTurn } from '@cavalry/advisor/application/advisor/run-advisor-turn.js';
import { getAdvisorBrainRoute } from '@cavalry/advisor/application/advisor/route-registry.js';
import { buildAdvisorModelMessages } from '@cavalry/advisor/domain/advisor/model-messages.js';
import { CAVALRY_ADVISOR_GREETING_RESPONSE } from '@cavalry/advisor/domain/advisor/responses.js';

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

const transactionListTurn = {
  intent: 'transaction_list',
  targetIntent: 'transaction_list',
  responseStyle: 'breakdown',
  taskSpec: {
    intent: 'transaction_list',
    outputMode: 'table',
    dataNeeds: ['scoped_transaction_rows'],
    answerPlan: {
      tableAllowed: true
    }
  }
};

const netWorthImpactTurn = {
  intent: 'net_worth_impact_transactions',
  targetIntent: 'net_worth_impact_transactions',
  responseStyle: 'recommendation',
  taskSpec: {
    intent: 'net_worth_impact_transactions',
    outputMode: 'analysis',
    dataNeeds: ['scoped_financial_summary'],
    answerPlan: {
      tableAllowed: false
    }
  }
};

const categorizationReviewTurn = {
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

const greetingTurn = {
  intent: 'greeting',
  targetIntent: 'greeting',
  responseStyle: 'conversational',
  question: 'hello!',
  resolvedQuestion: 'Greet the user briefly and naturally.',
  taskSpec: {
    intent: 'greeting',
    outputMode: 'conversational',
    dataNeeds: [],
    answerPlan: {
      tableAllowed: false
    }
  }
};

const transactionCapabilityTurn = {
  intent: 'transaction_capability',
  targetIntent: 'transaction_capability',
  responseStyle: 'conversational',
  question: 'can you read my transactions?',
  resolvedQuestion:
    'Confirm that Cavalry can read and analyze transactions. Do not list transaction rows unless the user asks.',
  taskSpec: {
    intent: 'transaction_capability',
    outputMode: 'conversational',
    dataNeeds: [],
    answerPlan: {
      tableAllowed: false
    }
  }
};

const summary = {
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
        source_count: 42,
        included_count: 12,
        omitted_count: 30,
        continuation_supported: true
      },
      counts: {
        selected_period_transactions: 42
      }
    }
  }
};

const transactionListSummary = {
  schema_version: 'cavalry.advisor_packet.v2',
  task_spec: transactionListTurn.taskSpec,
  scope: {
    period_label: 'June 2026',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    currency: 'PHP'
  },
  data_packets: {
    transaction_list: {
      packet_version: 'cavalry.transaction_list.v1',
      mode: 'recent',
      selection: {
        policy: 'recent_transaction_rows',
        source_count: 27,
        included_count: 20,
        omitted_count: 7,
        continuation_supported: true
      },
      counts: {
        selected_period_transactions: 27,
        included_transactions: 20,
        omitted_transactions: 7
      },
      transactions: []
    }
  }
};

const lightweightSummary = {
  schema_version: 'cavalry.advisor_packet.v2',
  question: 'hello!',
  resolved_question: 'Greet the user briefly and naturally.',
  intent: 'greeting',
  target_intent: 'greeting',
  response_style: 'conversational',
  task_spec: greetingTurn.taskSpec,
  answer_plan: greetingTurn.taskSpec.answerPlan,
  scope: {
    period_label: 'June 2026',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    currency: 'PHP'
  },
  computed: {
    cashflow_period: {
      spending: { amount: '999999.00' }
    }
  },
  risks: [{ title: 'Budget pressure' }],
  data_packets: {}
};

function makeToolWorkbook() {
  return {
    id: 'workbook-tools',
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', isActive: true },
      { id: 'expense-food', name: 'Food Expense', group: 'expense', isActive: true },
      { id: 'expense-random', name: 'Random Expense', group: 'expense', isActive: true }
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
        description: 'Unknown tool',
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
      }
    ],
    sheets: [],
    recurringItems: []
  };
}

const toolContext = {
  profile: {
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-30',
    rangeLabel: 'June 2026'
  },
  snapshot: {
    income: 0,
    outflow: 500,
    expense: 500,
    savings: 0,
    debt: 0,
    net: -500,
    liquidAssets: 1000,
    averageMonthlyOutflow: 500
  },
  budget: {
    plannedOutflow: 400,
    budgetUsedPercent: 125,
    topSpendRows: [
      { category: { id: 'random', name: 'Random' }, total: 300 },
      { category: { id: 'food', name: 'Food' }, total: 200 }
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

function makeReadOnlySummary(turn, packetName, selection) {
  return {
    schema_version: 'cavalry.advisor_packet.v2',
    task_spec: turn.taskSpec,
    scope: {
      period_label: 'June 2026',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'PHP'
    },
    data_packets: {
      [packetName]: {
        packet_version: 'test.' + packetName,
        selection,
        counts: {
          selected_period_transactions: selection.source_count
        }
      }
    }
  };
}

function makeDeps(overrides = {}) {
  const events = [];
  const calls = [];
  return {
    events,
    calls,
    deps: Object.assign(
      {
        now: () => '2026-06-21T00:00:00.000Z',
        onEvent: (event) => {
          events.push(event);
        },
        buildSummary: () => summary,
        buildMessages: () => [
          { role: 'system', content: 'contract' },
          { role: 'user', content: 'packet' }
        ],
        getResponseFormat: () => ({ type: 'json_schema' }),
        formatModelResponse: (text) => ({
          text,
          references: [{ token: 'Spending', source_refs: ['computed.cashflow_period.spending'] }]
        }),
        formatProseResponse: (text) => ({ text, references: [] }),
        validateAnswer: ({ text }) => ({
          ok: text === 'Supported answer',
          issues: text === 'Supported answer' ? [] : [{ code: 'unsupported_number' }],
          retryInstruction: 'Use only supported numbers.'
        }),
        buildRulesAnswer: () => ({
          text: 'Rules answer',
          references: [{ token: 'Rules', source_refs: ['computed.cashflow_period.spending'] }]
        }),
        modelClient: {
          chat: async (payload) => {
            calls.push(payload);
            return { ok: true, text: 'Supported answer' };
          }
        }
      },
      overrides
    )
  };
}

describe('advisor application orchestrator', () => {
  it('registers the workbook-drafting Brain route as review-required', () => {
    expect(getAdvisorBrainRoute('advisor_brain')).toMatchObject({
      route: 'brain',
      intent: 'advisor_brain',
      packetKinds: ['advisor_brain_context'],
      selectionPolicy: 'context_on_demand',
      mutating: false,
      reviewRequired: true
    });
  });

  it('answers spending analysis with built-in rules without calling a model', async () => {
    const fixture = makeDeps({
      modelClient: {
        chat: async () => {
          throw new Error('model should not be called');
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-one',
        traceId: 'trace-one',
        message: 'Where did my money go this month?',
        settings: { provider: 'local' },
        turn: spendingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.provider).toBe('rules');
    expect(result.message.text).toBe('Rules answer');
    expect(result.message.advisorMeta).toMatchObject({
      provider_mode: 'rules',
      provider_label: 'Built-in rules',
      privacy_label: 'No model call',
      response_mode: 'rules',
      records_reviewed: 42,
      included_count: 12,
      omitted_count: 30
    });
    expect(result.message.actions.map((action) => action.id)).toEqual([
      'show_supporting_transactions',
      'review_category_assignments',
      'simulate_spending_reduction'
    ]);
    expect(result.nextConversationState).toMatchObject({
      lastTargetIntent: 'spending_analysis',
      lastPacketKind: 'transaction_analysis',
      activeScope: {
        label: 'June 2026'
      },
      continuation: {
        remainingCount: 30,
        offset: 12,
        pageSize: 12,
        selectionPolicy: 'ranked_analysis_slices'
      }
    });
    expect(result.traceSummary).toMatchObject({
      schema_version: 'cavalry.advisor_trace.v1',
      requestId: 'request-one',
      traceId: 'trace-one',
      status: 'answered',
      provider: 'rules',
      responseMode: 'rules',
      packetKinds: ['transaction_analysis'],
      packetSelection: expect.objectContaining({
        source_count: 42,
        included_count: 12,
        omitted_count: 30
      })
    });
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.events.map((event) => event.type)).toEqual([
      'resolving_turn',
      'collecting_context',
      'executing_tools',
      'building_evidence',
      'composing_response',
      'building_packet',
      'running_rules',
      'completed'
    ]);
  });

  it('executes deterministic tools and attaches evidence/response v2 for rules turns', async () => {
    const fixture = makeDeps({
      buildRulesAnswer: undefined
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-tools',
        traceId: 'trace-tools',
        message: 'How can I improve my spending habits?',
        settings: { provider: 'local' },
        turn: spendingTurn,
        context: toolContext,
        workbook: makeToolWorkbook()
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.toolResults.map((tool) => tool.toolName)).toEqual([
      'summarize_spending',
      'classify_cash_movements',
      'detect_recurring_transactions',
      'simulate_spending_change'
    ]);
    expect(result.evidenceWorkspace.workspaceVersion).toBe('cavalry.advisor_evidence.v1');
    expect(result.evidenceWorkspace.facts.map((fact) => fact.id)).toContain(
      'fact_consumption_spending'
    );
    expect(result.message.responseV2).toMatchObject({
      responseVersion: 'cavalry.advisor_response.v2',
      directAnswer: expect.stringContaining('consumption spending')
    });
    expect(result.message.text).toContain('consumption spending');
    expect(result.traceSummary).toMatchObject({
      trace_version: 'cavalry.advisor_trace.v2',
      toolCalls: expect.arrayContaining([
        expect.objectContaining({ toolName: 'summarize_spending', ok: true })
      ]),
      evidence: expect.objectContaining({
        factCount: expect.any(Number)
      }),
      privacy: {
        destination: 'none',
        packetKinds: ['transaction_analysis'],
        documentChunksSent: 0
      }
    });
  });

  it('prepares category cleanup draft-group previews from deterministic proposal tools', async () => {
    const fixture = makeDeps({
      buildSummary: () =>
        makeReadOnlySummary(categorizationReviewTurn, 'categorization_review', {
          policy: 'categorization_review_slices',
          source_count: 6,
          included_count: 4,
          omitted_count: 2,
          continuation_supported: true
        }),
      buildRulesAnswer: undefined
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-draft-groups',
        traceId: 'trace-draft-groups',
        message: 'Review all my transactions and improve my categories.',
        settings: { provider: 'local' },
        turn: categorizationReviewTurn,
        context: toolContext,
        workbook: makeToolWorkbook()
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.toolResults.map((tool) => tool.toolName)).toContain('prepare_category_drafts');
    expect(result.draftGroups).toEqual([
      expect.objectContaining({
        title: 'Category cleanup proposals',
        status: 'pending',
        impactPreview: expect.objectContaining({
          affectedTransactions: expect.any(Number)
        })
      })
    ]);
    expect(result.message.draftGroups).toHaveLength(1);
    expect(result.message.responseV2.drafts).toEqual(['advisor_draft_group_1']);
  });

  it('persists reviewable category cleanup drafts when proposal tools find safe changes', async () => {
    const workbook = makeToolWorkbook();
    const fixture = makeDeps({
      buildSummary: () =>
        makeReadOnlySummary(categorizationReviewTurn, 'categorization_review', {
          policy: 'categorization_review_slices',
          source_count: 6,
          included_count: 4,
          omitted_count: 2,
          continuation_supported: true
        }),
      buildRulesAnswer: undefined
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-real-draft-groups',
        traceId: 'trace-real-draft-groups',
        message: 'Review all my transactions and improve my categories.',
        settings: { provider: 'local' },
        turn: categorizationReviewTurn,
        context: toolContext,
        workbook,
        services: {
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
              source_refs: ['category:random']
            }
          ]
        }
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.preparedDrafts).toHaveLength(1);
    expect(result.preparedDrafts[0]).toMatchObject({
      objectType: 'ledgerCleanup',
      operation: 'edit',
      status: 'pending'
    });
    expect(workbook.aiDrafts.map((draft) => draft.id)).toEqual([result.preparedDrafts[0].id]);
    expect(workbook.advisorDraftGroups[0]).toMatchObject({
      draftIds: [result.preparedDrafts[0].id],
      status: 'pending'
    });
    expect(result.message.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_draft_reference',
          aiDraftId: result.preparedDrafts[0].id
        })
      ])
    );
    expect(result.message.actions.map((action) => action.id)).not.toContain(
      'prepare_category_cleanup_draft'
    );
    expect(result.message.draftGroups[0].draftIds).toEqual([result.preparedDrafts[0].id]);
    expect(result.message.responseV2.drafts).toEqual([result.message.draftGroups[0].groupId]);
  });

  it('blocks prepared cleanup candidates before persistence when gate validation fails', async () => {
    const workbook = makeToolWorkbook();
    const fixture = makeDeps({
      buildSummary: () =>
        makeReadOnlySummary(categorizationReviewTurn, 'categorization_review', {
          policy: 'categorization_review_slices',
          source_count: 6,
          included_count: 4,
          omitted_count: 2,
          continuation_supported: true
        }),
      buildRulesAnswer: undefined,
      validateDraftCandidate: () => ({
        ok: false,
        error: 'Cleanup target category no longer exists.'
      })
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-blocked-draft-groups',
        traceId: 'trace-blocked-draft-groups',
        message: 'Review all my transactions and improve my categories.',
        settings: { provider: 'local' },
        turn: categorizationReviewTurn,
        context: toolContext,
        workbook,
        services: {
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
              source_refs: ['category:random']
            }
          ]
        }
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.preparedDrafts).toHaveLength(0);
    expect(result.blockedDraftCandidates).toEqual([
      expect.objectContaining({
        stage: 'validation',
        error: 'Cleanup target category no longer exists.'
      })
    ]);
    expect(workbook.aiDrafts || []).toEqual([]);
    expect(workbook.advisorDraftGroups || []).toEqual([]);
    expect(result.message.text).toContain(
      'Advisor blocked it before showing it in the review queue'
    );
    expect(fixture.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['draft_gate_candidate_built', 'draft_gate_validation_blocked'])
    );
  });

  it('reuses an existing active cleanup draft instead of creating duplicates on replay', async () => {
    const workbook = makeToolWorkbook();
    const makeFixture = () =>
      makeDeps({
        buildSummary: () =>
          makeReadOnlySummary(categorizationReviewTurn, 'categorization_review', {
            policy: 'categorization_review_slices',
            source_count: 6,
            included_count: 4,
            omitted_count: 2,
            continuation_supported: true
          }),
        buildRulesAnswer: undefined
      });
    const input = {
      message: 'Review all my transactions and improve my categories.',
      settings: { provider: 'local' },
      turn: categorizationReviewTurn,
      context: toolContext,
      workbook,
      services: {
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
            source_refs: ['category:random']
          }
        ]
      }
    };

    const first = await runAdvisorTurn(
      Object.assign(
        {
          requestId: 'request-dedupe-one',
          traceId: 'trace-dedupe-one'
        },
        input
      ),
      makeFixture().deps
    );
    const second = await runAdvisorTurn(
      Object.assign(
        {
          requestId: 'request-dedupe-two',
          traceId: 'trace-dedupe-two'
        },
        input
      ),
      makeFixture().deps
    );

    expect(first.preparedDrafts[0].id).toBe(second.preparedDrafts[0].id);
    expect(workbook.aiDrafts.filter((draft) => draft.objectType === 'ledgerCleanup')).toHaveLength(
      1
    );
    expect(second.message.text).toContain('existing reviewable category cleanup draft');
    expect(second.message.actions.map((action) => action.id)).not.toContain(
      'prepare_category_cleanup_draft'
    );
  });

  it('uses prose facts mode for a configured API provider', async () => {
    const fixture = makeDeps();

    const result = await runAdvisorTurn(
      {
        requestId: 'request-two',
        traceId: 'trace-two',
        message: 'What did I overspend on?',
        settings: { provider: 'openai' },
        turn: spendingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.message.text).toBe('Supported answer');
    expect(result.message.advisorMeta).toMatchObject({
      provider_mode: 'remote_model',
      response_mode: 'prose',
      attempts: 1,
      scope: {
        label: 'June 2026'
      }
    });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toMatchObject({
      temperature: 0.25,
      top_p: 0.9,
      max_tokens: 1800
    });
    expect(fixture.calls[0].response_format).toBeUndefined();
    expect(fixture.events.map((event) => event.type)).toContain('validating');
  });

  it('sends lightweight greetings through the configured API model instead of local scripts', async () => {
    const fixture = makeDeps({
      buildSummary: () => lightweightSummary,
      buildMessages: (question, _context, summaryArg, options) =>
        buildAdvisorModelMessages(question, summaryArg, options),
      formatProseResponse: (text) => ({ text, references: [] }),
      validateAnswer: () => ({ ok: true, issues: [], retryInstruction: '' }),
      buildRulesAnswer: () => ({
        text: CAVALRY_ADVISOR_GREETING_RESPONSE,
        references: []
      }),
      modelClient: {
        chat: async (payload) => {
          fixture.calls.push(payload);
          return { ok: true, text: 'Hey, good to see you.' };
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-light-greeting',
        traceId: 'trace-light-greeting',
        message: 'hello!',
        settings: { provider: 'openai' },
        turn: greetingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.provider).toBe('openai');
    expect(result.message.text).toBe('Hey, good to see you.');
    expect(result.message.text).not.toContain('I also noticed');
    expect(result.message.text).not.toContain('Rules answer');
    expect(result.message.advisorMeta).toMatchObject({
      provider_mode: 'remote_model',
      response_mode: 'prose',
      records_reviewed: 0,
      packet_kinds: []
    });
    expect(result.traceSummary.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'collecting_context',
          metadata: expect.objectContaining({
            dataPlan: expect.objectContaining({
              intent: 'greeting',
              data_needs: [],
              packet_kinds: [],
              tool_names: [],
              action_ids: [],
              selection_policy: 'no_workbook_data',
              maximum_rows: 0
            })
          })
        })
      ])
    );
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0].response_format).toBeUndefined();
    const modelUserMessage =
      fixture.calls[0].messages[fixture.calls[0].messages.length - 1].content;
    expect(modelUserMessage).toContain('No workbook metrics are included');
    expect(modelUserMessage).toContain('"data_packets": {}');
    expect(modelUserMessage).not.toContain('999999.00');
    expect(modelUserMessage).not.toContain('Budget pressure');
    expect(modelUserMessage).not.toContain('"answer_plan"');
  });

  it('keeps lightweight greetings deterministic only for built-in rules mode', async () => {
    const fixture = makeDeps({
      buildSummary: () => lightweightSummary,
      buildRulesAnswer: () => ({
        text: CAVALRY_ADVISOR_GREETING_RESPONSE,
        references: []
      }),
      modelClient: {
        chat: async () => {
          throw new Error('model should not be called for rules mode');
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-light-rules',
        traceId: 'trace-light-rules',
        message: 'hello!',
        settings: { provider: 'local' },
        turn: greetingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.provider).toBe('rules');
    expect(result.message.text).toBe(CAVALRY_ADVISOR_GREETING_RESPONSE);
    expect(result.message.text).not.toContain('I also noticed');
    expect(result.message.text).not.toContain('spending, bills, cash flow, or budgeting');
    expect(fixture.calls).toHaveLength(0);
  });

  it('stores a pending transaction-analysis task after transaction capability turns', async () => {
    const capabilitySummary = Object.assign({}, lightweightSummary, {
      question: 'can you read my transactions?',
      resolved_question:
        'Confirm that Cavalry can read and analyze transactions. Do not list transaction rows unless the user asks.',
      intent: 'transaction_capability',
      target_intent: 'transaction_capability',
      task_spec: transactionCapabilityTurn.taskSpec,
      answer_plan: transactionCapabilityTurn.taskSpec.answerPlan
    });
    const fixture = makeDeps({
      buildSummary: () => capabilitySummary,
      validateAnswer: () => ({ ok: true, issues: [], retryInstruction: '' }),
      modelClient: {
        chat: async (payload) => {
          fixture.calls.push(payload);
          return { ok: true, text: 'Yes, I can analyze them when you ask.' };
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-capability',
        traceId: 'trace-capability',
        message: 'can you read my transactions?',
        settings: { provider: 'openai' },
        turn: transactionCapabilityTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.nextConversationState).toMatchObject({
      lastTargetIntent: 'transaction_capability',
      pendingTaskSpec: {
        intent: 'transaction_analysis',
        outputMode: 'analysis',
        followUpOf: 'transaction_capability'
      }
    });
    expect(result.nextConversationState.pendingTaskSpec.dataNeeds).toContain(
      'scoped_cashflow_split'
    );
  });

  it('runs transaction_list through the shared read-only QA route', async () => {
    const fixture = makeDeps({
      buildSummary: () => transactionListSummary,
      buildRulesAnswer: () => ({
        text: 'Rules table answer',
        references: [{ token: 'Recent transactions', source_refs: ['transaction:txn-one'] }]
      })
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-list',
        traceId: 'trace-list',
        message: 'Show my recent transactions',
        settings: { provider: 'openai' },
        turn: transactionListTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.message.text).toBe('Supported answer');
    expect(result.message.advisorMeta).toMatchObject({
      records_reviewed: 27,
      included_count: 20,
      omitted_count: 7,
      selection_policy: 'recent_transaction_rows',
      packet_kinds: ['transaction_list']
    });
    expect(result.message.actions.map((action) => action.id)).toEqual([
      'show_full_transaction_list',
      'show_next_page'
    ]);
    expect(result.nextConversationState).toMatchObject({
      lastTargetIntent: 'transaction_list',
      lastPacketKind: 'transaction_list',
      continuation: {
        remainingCount: 7,
        offset: 20,
        pageSize: 20,
        selectionPolicy: 'recent_transaction_rows'
      }
    });
    expect(result.traceSummary.packetSelection).toMatchObject({
      policy: 'recent_transaction_rows',
      source_count: 27,
      included_count: 20,
      omitted_count: 7,
      continuation_supported: true
    });
    expect(result.traceSummary.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'collecting_context',
          metadata: expect.objectContaining({
            dataPlan: expect.objectContaining({
              intent: 'transaction_list',
              packet_kinds: ['transaction_list'],
              selection_policy: 'requested_transaction_rows'
            })
          })
        })
      ])
    );
    expect(fixture.calls).toHaveLength(1);
  });

  it('runs net-worth impact through the shared read-only QA route', async () => {
    const fixture = makeDeps({
      buildSummary: () =>
        makeReadOnlySummary(netWorthImpactTurn, 'transaction_net_worth_impact', {
          policy: 'ranked_net_worth_impact_rows',
          source_count: 18,
          included_count: 12,
          omitted_count: 6,
          continuation_supported: true
        })
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-impact',
        traceId: 'trace-impact',
        message: 'Which transactions changed my net worth?',
        settings: { provider: 'openai' },
        turn: netWorthImpactTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.message.advisorMeta).toMatchObject({
      records_reviewed: 18,
      included_count: 12,
      omitted_count: 6,
      selection_policy: 'ranked_net_worth_impact_rows',
      packet_kinds: ['transaction_net_worth_impact']
    });
    expect(result.message.actions.map((action) => action.id)).toEqual([
      'show_largest_impacts',
      'show_excluded_neutral_transactions'
    ]);
    expect(result.traceSummary.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'collecting_context',
          metadata: expect.objectContaining({
            dataPlan: expect.objectContaining({
              intent: 'net_worth_impact_transactions',
              packet_kinds: ['transaction_net_worth_impact']
            })
          })
        })
      ])
    );
  });

  it('runs categorization review through the shared read-only QA route', async () => {
    const fixture = makeDeps({
      buildSummary: () =>
        makeReadOnlySummary(categorizationReviewTurn, 'categorization_review', {
          policy: 'categorization_review_slices',
          source_count: 9,
          included_count: 4,
          omitted_count: 5,
          continuation_supported: true
        })
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-categorization',
        traceId: 'trace-categorization',
        message: 'Review my categories',
        settings: { provider: 'openai' },
        turn: categorizationReviewTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.message.advisorMeta).toMatchObject({
      records_reviewed: 9,
      included_count: 4,
      omitted_count: 5,
      selection_policy: 'categorization_review_slices',
      packet_kinds: ['categorization_review']
    });
    expect(result.message.actions.map((action) => action.id)).toEqual([
      'prepare_category_cleanup_draft',
      'compare_before_after_categories'
    ]);
  });

  it('retries once with a validation repair instruction', async () => {
    let attempt = 0;
    const fixture = makeDeps({
      modelClient: {
        chat: async (payload) => {
          fixture.calls.push(payload);
          attempt += 1;
          return { ok: true, text: attempt === 1 ? 'Unsupported answer' : 'Supported answer' };
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-three',
        traceId: 'trace-three',
        message: 'Why was spending higher last week?',
        settings: { provider: 'openai' },
        turn: spendingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('answered');
    expect(result.attempts).toBe(2);
    expect(fixture.calls).toHaveLength(2);
    expect(fixture.calls[1].temperature).toBe(0.05);
    expect(fixture.calls[1].messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Unsupported answer' },
      { role: 'user', content: 'Use only supported numbers.' }
    ]);
    expect(fixture.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'retrying',
          metadata: expect.objectContaining({ reason: 'validation_failed' })
        })
      ])
    );
  });

  it('labels quota and billing fallbacks without scripted advisor text', async () => {
    const fixture = makeDeps({
      modelClient: {
        chat: async (payload) => {
          fixture.calls.push(payload);
          return {
            ok: false,
            error: 'You exceeded your current quota, please check your plan and billing details.'
          };
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-quota',
        traceId: 'trace-quota',
        message: 'Where did my money go?',
        settings: { provider: 'openai' },
        turn: spendingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('fallback');
    expect(result.message.text).toContain('verified built-in review');
    expect(result.message.text).toContain('I checked');
    expect(result.message.text).not.toContain('What I checked');
    expect(result.message.text).not.toContain('I could not produce a verified Advisor answer');
    expect(result.message.text).not.toContain('Rules answer');
    expect(result.message.text).not.toContain('Advisor note');
    expect(result.message.text).not.toContain('Here is what I see');
    expect(result.message.text).not.toContain('Contain budget pressure');
    expect(result.message.text).not.toContain('You exceeded your current quota');
    expect(result.message.advisorMeta).toMatchObject({
      status: 'fallback',
      fallback_reason_code: 'quota_or_billing',
      fallback_reason_label: 'Billing/credits',
      fallback_note: 'The OpenAI/API request appears blocked by quota, credits, or billing limits.'
    });
  });

  it('returns a neutral fallback when model validation fails twice', async () => {
    const fixture = makeDeps({
      modelClient: {
        chat: async (payload) => {
          fixture.calls.push(payload);
          return { ok: true, text: 'Unsupported answer' };
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-four',
        traceId: 'trace-four',
        message: 'Which category should I inspect first?',
        settings: { provider: 'openai' },
        turn: spendingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('fallback');
    expect(result.message.text).toContain('verified built-in review');
    expect(result.message.text).toContain('The useful read is consumption spending');
    expect(result.message.text).not.toContain('I could not produce a verified Advisor answer');
    expect(result.message.text).not.toContain('Rules answer');
    expect(result.message.text).not.toContain('Here is what I see');
    expect(result.message.text).not.toContain('Advisor note');
    expect(result.message.text).not.toContain('Contain budget pressure');
    expect(result.message.text).not.toContain('Model note:');
    expect(result.message.text).not.toContain('grounding checks');
    expect(result.message.advisorMeta).toMatchObject({
      status: 'fallback',
      fallback_reason_code: 'grounding_validation',
      fallback_note: 'The model answer did not pass Cavalry grounding checks.'
    });
    expect(result.traceSummary.validationIssueCodes).toEqual(['unsupported_number']);
    expect(result.message.responseV2.responseVersion).toBe('cavalry.advisor_response.v2');
    expect(fixture.calls).toHaveLength(2);
    expect(fixture.events.map((event) => event.type)).toContain('repairing');
  });

  it('returns cancelled without deterministic fallback when the model request is cancelled', async () => {
    const fixture = makeDeps({
      modelClient: {
        chat: async (payload) => {
          fixture.calls.push(payload);
          return { ok: false, cancelled: true, error: 'Advisor request was cancelled.' };
        }
      }
    });

    const previousState = {
      lastTargetIntent: 'transaction_list',
      lastPacketKind: 'transaction_list'
    };
    const result = await runAdvisorTurn(
      {
        requestId: 'request-cancel',
        traceId: 'trace-cancel',
        message: 'Where did my money go?',
        settings: { provider: 'openai' },
        turn: spendingTurn,
        context: {},
        conversationState: previousState
      },
      fixture.deps
    );

    expect(result.status).toBe('cancelled');
    expect(result.message.text).toBe('Cancelled. No answer was generated.');
    expect(result.message.text).not.toContain('Rules answer');
    expect(result.message.advisorMeta).toMatchObject({
      status: 'cancelled',
      response_mode: 'prose',
      attempts: 1
    });
    expect(result.message.actions).toEqual([]);
    expect(result.nextConversationState).toBe(previousState);
    expect(result.traceSummary).toMatchObject({
      status: 'cancelled',
      requestId: 'request-cancel',
      traceId: 'trace-cancel',
      attempts: 1
    });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toMatchObject({
      requestId: 'request-cancel',
      traceId: 'trace-cancel'
    });
  });

  it('treats thrown abort errors as cancelled turns', async () => {
    const fixture = makeDeps({
      modelClient: {
        chat: async (payload) => {
          fixture.calls.push(payload);
          const error = new Error('The operation was cancelled.');
          error.name = 'AbortError';
          throw error;
        }
      }
    });

    const result = await runAdvisorTurn(
      {
        requestId: 'request-abort',
        traceId: 'trace-abort',
        message: 'Where did my money go?',
        settings: { provider: 'openai' },
        turn: spendingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(result.status).toBe('cancelled');
    expect(result.message.text).toBe('Cancelled. No answer was generated.');
    expect(result.message.text).not.toContain('Rules answer');
    expect(fixture.calls).toHaveLength(1);
  });

  it('uses prose compatibility mode for the legacy custom local model provider', async () => {
    const fixture = makeDeps({
      formatProseResponse: (text) => ({ text, references: [] })
    });

    await runAdvisorTurn(
      {
        requestId: 'request-five',
        traceId: 'trace-five',
        message: 'Where did my money go?',
        settings: { provider: 'custom' },
        turn: spendingTurn,
        context: {}
      },
      fixture.deps
    );

    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0].temperature).toBe(0.25);
    expect(fixture.calls[0].max_tokens).toBe(1800);
    expect(fixture.calls[0].response_format).toBeUndefined();
  });
});
