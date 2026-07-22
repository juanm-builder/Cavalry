import { describe, expect, it, vi } from 'vitest';

import {
  CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME,
  CAVALRY_ASSISTANT_LOCAL_IMAGE_BATCH_SIZE,
  CAVALRY_ASSISTANT_MAX_IMAGES,
  buildCavalryAssistantInstructions,
  runCavalryAssistantTurn
} from '../../src/renderer/features/assistant/cavalry-assistant-runtime.js';

const SEARCH_TOOL = Object.freeze({
  type: 'function',
  name: 'search_transactions',
  description: 'Search workbook transactions.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false
  },
  strict: true
});

const ADD_TOOL = Object.freeze({
  type: 'function',
  name: 'add_transaction',
  description: 'Add a transaction after confirmation.',
  parameters: {
    type: 'object',
    properties: { amount: { type: 'number' } },
    required: ['amount'],
    additionalProperties: false
  },
  strict: true
});

const CONVERTING_TRANSACTION_TOOL = Object.freeze({
  type: 'function',
  name: 'create_transaction',
  description: 'Create a transaction, with host approval for any currency conversion.',
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      allowCurrencyConversion: { type: 'boolean' }
    },
    required: ['amount'],
    additionalProperties: false
  },
  strict: true
});

function idFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}_${++sequence}`;
}

function makeImages(count) {
  return Array.from({ length: count }, (_item, index) => ({
    id: `image_${index + 1}`,
    filename: `receipt-${index + 1}.jpg`,
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,image-${index + 1}`
  }));
}

describe('Cavalry assistant runtime', () => {
  it('builds concise route-aware instructions without asking for hidden reasoning', () => {
    const instructions = buildCavalryAssistantInstructions({
      activeRouteId: 'ledger',
      today: '2026-07-10'
    });

    expect(instructions).toContain("selected model is Cavalry's in-app assistant");
    expect(instructions).toContain('Use the provided tools');
    expect(instructions).toContain('read_workspace_context');
    expect(instructions).toContain('until hasMore is false');
    expect(instructions).toContain('continuation of the current conversation');
    expect(instructions).toContain('Answer the newest question first');
    expect(instructions).toContain('Silently reuse facts');
    expect(instructions).toContain('do not recap income, balances, goals, card guidance');
    expect(instructions).toContain('shortest natural response');
    expect(instructions).toContain('Do not force headings, a table, a checklist');
    expect(instructions).toContain('Check relevant math, dates, currencies, assumptions');
    expect(instructions).toContain(
      'tool names, calls, progress, and completion logs behind the scenes'
    );
    expect(instructions).toContain('Distinguish recorded facts from inference and unknowns');
    expect(instructions).toContain('use a useful range when evidence is uncertain');
    expect(instructions).toContain('acknowledge the miss directly and briefly');
    expect(instructions).toContain('use analyze_recurring_expenses');
    expect(instructions).toContain('distinguish active trackers');
    expect(instructions).toContain('tracker setting is not proof');
    expect(instructions).toContain('variable usage or top-up spending');
    expect(instructions).toContain("personal, a business tool, supports the user's income");
    expect(instructions).toContain('recent behavior and achievable changes');
    expect(instructions).toContain('paying a card in full only when it is newly relevant');
    expect(instructions).toContain('native balance/currency');
    expect(instructions).toContain('Never relabel a foreign-currency amount');
    expect(instructions).toContain('auto_assign_category_icons');
    expect(instructions).toContain('instead of guessing icon IDs');
    expect(instructions).toContain('Treat returned persisted icon and verified fields as truth');
    expect(instructions).toContain('treat verification_failed as failure');
    expect(instructions).toContain('never narrate a known icon mismatch as success');
    expect(instructions).toContain('Preserve the exact entity name or ID');
    expect(instructions).toContain('end of the searched observation window');
    expect(instructions).toContain('machine markers below are transport metadata');
    expect(instructions).toContain('one machine-only citation marker');
    expect(instructions).toContain('[[source-set:EVIDENCE_SET_ID]]');
    expect(instructions).toContain('Never claim an action succeeded');
    expect(instructions).toContain('require explicit user confirmation');
    expect(instructions).toContain('currency-converting action');
    expect(instructions).toContain(
      'Never set confirmed, allowDuplicate, or allowCurrencyConversion'
    );
    expect(instructions).toContain('call request_clarification');
    expect(instructions).toContain('Current route: ledger. Current date: 2026-07-10.');
    expect(instructions).toContain('Do not reveal chain-of-thought');
    expect(instructions).not.toContain('Present numeric comparisons as a small markdown table');
  });

  it('runs an OpenAI Responses tool loop with continuation output and one request id', async () => {
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          response: {
            id: 'response_1',
            output: [
              {
                type: 'function_call',
                call_id: 'call_1',
                name: 'search_transactions',
                arguments: '{"query":"coffee"}'
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          response: {
            id: 'response_2',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'I found one coffee transaction.' }]
              }
            ]
          }
        })
    };
    const executeTool = vi.fn(async (name, args, context) => ({
      ok: true,
      message: 'Search complete.',
      rows: [{ id: 'transaction_1', description: 'Coffee' }],
      name,
      query: args.query,
      route: context.activeRouteId
    }));

    const answer = await runCavalryAssistantTurn({
      question: 'Find my coffee purchase.',
      history: [
        {
          role: 'assistant',
          text: 'What should I look for? [source](#cavalry-source-previous)'
        }
      ],
      settings: {
        provider: 'openai',
        apiMode: 'responses',
        endpoint: 'https://api.openai.com/v1/responses',
        model: 'gpt-5.4-mini',
        hasApiKey: true
      },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool,
      createId: idFactory(),
      requestId: 'assistant_turn_1',
      activeRouteId: 'ledger',
      today: '2026-07-10'
    });

    expect(answer).toMatchObject({
      ok: true,
      text: 'I found one coffee transaction.',
      error: '',
      cancelled: false
    });
    expect(Object.keys(answer)).toEqual([
      'ok',
      'text',
      'activities',
      'toolResults',
      'references',
      'error',
      'cancelled'
    ]);
    expect(executeTool).toHaveBeenCalledWith(
      'search_transactions',
      { query: 'coffee' },
      expect.objectContaining({
        activeRouteId: 'ledger',
        callId: 'call_1',
        requestId: 'assistant_turn_1',
        today: '2026-07-10'
      })
    );
    expect(advisor.invoke).toHaveBeenCalledTimes(2);
    expect(advisor.invoke.mock.calls[0][0]).toBe('runAgentTurn');
    expect(advisor.invoke.mock.calls[0][1]).toMatchObject({
      requestId: 'assistant_turn_1',
      connection: {
        provider: 'openai',
        apiMode: 'responses',
        endpoint: 'https://api.openai.com/v1/responses',
        model: 'gpt-5.4-mini'
      },
      input: [
        { role: 'assistant', content: 'What should I look for?' },
        { role: 'user', content: 'Find my coffee purchase.' }
      ]
    });
    expect(advisor.invoke.mock.calls[0][1].tools.map((tool) => tool.name)).toEqual([
      'search_transactions',
      CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME
    ]);
    expect(advisor.invoke.mock.calls[1][0]).toBe('runAgentTurn');
    expect(advisor.invoke.mock.calls[1][1]).toMatchObject({
      requestId: 'assistant_turn_1',
      previous_response_id: 'response_1',
      input: [
        {
          type: 'function_call_output',
          call_id: 'call_1'
        }
      ]
    });
    expect(JSON.parse(advisor.invoke.mock.calls[1][1].input[0].output)).toMatchObject({
      ok: true,
      rows: [{ id: 'transaction_1' }]
    });
    expect(answer.toolResults).toEqual([
      expect.objectContaining({
        callId: 'call_1',
        toolName: 'search_transactions',
        arguments: { query: 'coffee' },
        ok: true,
        error: '',
        cancelled: false
      })
    ]);
    expect(answer.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          toolName: 'search_transactions',
          status: 'completed',
          message: 'Search complete.'
        })
      ])
    );
  });

  it('adds grounded references from successful tool data to the final runtime result', async () => {
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          response: {
            id: 'response_reference_tool',
            output: [
              {
                type: 'function_call',
                call_id: 'reference_search',
                name: 'search_transactions',
                arguments: '{"query":"coffee"}'
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          response: {
            id: 'response_reference_answer',
            output_text: 'Coffee was charged to Cash.'
          }
        })
    };
    const executeTool = vi.fn(async () => ({
      ok: true,
      data: {
        transactions: [
          {
            id: 'txn-coffee',
            description: 'Coffee',
            date: '2026-07-11',
            amount: 2000,
            currency: 'PHP'
          }
        ],
        accounts: [{ id: 'cash', name: 'Cash', balance: 5000, currency: 'PHP' }]
      }
    }));

    const answer = await runCavalryAssistantTurn({
      question: 'Find Coffee.',
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool
    });

    expect(answer).toMatchObject({
      ok: true,
      text: 'Coffee was charged to Cash.',
      references: [
        {
          id: 'account:cash',
          token: 'Cash',
          label: 'Cash',
          kind: 'account',
          source_refs: ['account:cash'],
          detail: { accountId: 'cash', balance: 5000, currency: 'PHP' }
        },
        {
          id: 'transaction:txn-coffee',
          token: 'Coffee',
          label: 'Coffee',
          kind: 'transaction',
          source_refs: ['transaction:txn-coffee'],
          detail: {
            transactionId: 'txn-coffee',
            date: '2026-07-11',
            amount: 2000,
            currency: 'PHP'
          }
        }
      ]
    });
  });

  it('replaces a validated model evidence marker with one grouped source anchor', async () => {
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          response: {
            id: 'response_recurring_tool',
            output: [
              {
                type: 'function_call',
                call_id: 'recurring_search',
                name: 'search_transactions',
                arguments: '{"query":"Vercel"}'
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          response: {
            id: 'response_recurring_answer',
            output_text:
              'Search Transactions completed.\n\nVercel looks monthly based on the April and May charges. [[source-set:vercel-pattern]]'
          }
        })
    };
    const executeTool = vi.fn(async () => ({
      ok: true,
      data: {
        evidenceSets: [
          {
            id: 'vercel-pattern',
            label: 'Vercel recurring-pattern evidence',
            kind: 'transaction',
            inference: { evidenceStatus: 'likely_recurring' }
          }
        ]
      },
      referenceData: {
        evidenceSets: [
          {
            id: 'vercel-pattern',
            kind: 'transaction',
            source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
            records: [
              {
                id: 'vercel-apr',
                description: 'Vercel',
                date: '2026-04-08',
                amount: 1276,
                currency: 'PHP'
              },
              {
                id: 'vercel-may',
                description: 'Vercel',
                date: '2026-05-08',
                amount: 1276,
                currency: 'PHP'
              }
            ]
          }
        ]
      }
    }));

    const answer = await runCavalryAssistantTurn({
      question: 'Did I miss any recurring payments?',
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool
    });

    expect(answer.text).toBe(
      'Vercel looks monthly based on the April and May charges. [source](#cavalry-source-1)'
    );
    const modelToolOutput = JSON.parse(advisor.invoke.mock.calls[1][1].input[0].output);
    expect(modelToolOutput).not.toHaveProperty('referenceData');
    expect(modelToolOutput.data.evidenceSets[0]).not.toHaveProperty('source_refs');
    expect(modelToolOutput.data.evidenceSets[0]).not.toHaveProperty('records');
    expect(answer.toolResults[0].result).not.toHaveProperty('referenceData');
    expect(answer.references).toEqual([
      expect.objectContaining({
        anchor: '#cavalry-source-1',
        label: 'Vercel recurring-pattern evidence',
        support: 'inferred',
        source_refs: ['transaction:vercel-apr', 'transaction:vercel-may']
      })
    ]);
    expect(answer.references[0].detail.records).toHaveLength(2);
  });

  it('runs a custom local-model Chat Completions tool loop and converts tool schemas', async () => {
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          response: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'tool_call_1',
                      type: 'function',
                      function: { name: 'add_transaction', arguments: '{"amount":125}' }
                    }
                  ]
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          response: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'The transaction was added and confirmed by Cavalry.'
                }
              }
            ]
          }
        })
    };
    const executeTool = vi.fn(async () => ({
      ok: true,
      message: 'Transaction added.',
      transactionId: 'transaction_125'
    }));

    const answer = await runCavalryAssistantTurn({
      question: 'Yes, add the confirmed transaction.',
      history: [{ role: 'user', content: 'Add a transaction for 125 pesos.' }],
      settings: {
        provider: 'custom',
        apiMode: 'chat_completions',
        endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
        model: 'cavalry-advisor',
        localModelPath: '/models/qwen.gguf'
      },
      advisor,
      tools: [ADD_TOOL],
      executeTool,
      requestId: 'assistant_turn_custom',
      createId: idFactory(),
      activeRouteId: 'ledger',
      today: '2026-07-10'
    });

    expect(answer).toMatchObject({
      ok: true,
      text: 'The transaction was added and confirmed by Cavalry.',
      error: '',
      cancelled: false
    });
    expect(advisor.invoke).toHaveBeenCalledTimes(2);
    expect(advisor.invoke.mock.calls.every(([command]) => command === 'chat')).toBe(true);
    expect(advisor.invoke.mock.calls[0][1].requestId).toBe('assistant_turn_custom');
    expect(advisor.invoke.mock.calls[0][1].connection).toMatchObject({
      provider: 'custom',
      model: 'cavalry-advisor',
      localModelPath: '/models/qwen.gguf'
    });
    expect(advisor.invoke.mock.calls[1][1].requestId).toBe('assistant_turn_custom');
    expect(advisor.invoke.mock.calls[0][1].tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'add_transaction',
        description: 'Add a transaction after confirmation.',
        parameters: ADD_TOOL.parameters,
        strict: true
      }
    });
    expect(advisor.invoke.mock.calls[0][1].tools[1].function.name).toBe(
      CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME
    );
    const continuedMessages = advisor.invoke.mock.calls[1][1].messages;
    expect(continuedMessages.at(-2)).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tool_call_1',
          type: 'function',
          function: { name: 'add_transaction', arguments: '{"amount":125}' }
        }
      ]
    });
    expect(continuedMessages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'tool_call_1',
      name: 'add_transaction'
    });
    expect(JSON.parse(continuedMessages.at(-1).content)).toEqual({
      ok: true,
      message: 'Transaction added.',
      transactionId: 'transaction_125'
    });
  });

  it('returns a direct model answer without executing tools', async () => {
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        response: { id: 'response_direct', output_text: 'Your current route is Budget.' }
      }))
    };
    const executeTool = vi.fn();

    const answer = await runCavalryAssistantTurn({
      question: 'Where am I?',
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool,
      activeRouteId: 'budgets',
      today: '2026-07-10'
    });

    expect(answer).toEqual({
      ok: true,
      text: 'Your current route is Budget.',
      activities: [expect.objectContaining({ type: 'model', status: 'completed', toolName: '' })],
      toolResults: [],
      references: [],
      error: '',
      cancelled: false
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('requires configuration for the old built-in local provider without invoking it', async () => {
    const advisor = { invoke: vi.fn() };

    const answer = await runCavalryAssistantTurn({
      question: 'Show my accounts.',
      settings: { provider: 'local' },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool: vi.fn()
    });

    expect(answer).toEqual({
      ok: false,
      text: '',
      activities: [],
      toolResults: [],
      references: [],
      error: "Choose a local model or API connection in Settings before using Cavalry's assistant.",
      cancelled: false
    });
    expect(advisor.invoke).not.toHaveBeenCalled();
  });

  it('requires a saved API key before invoking an OpenAI model', async () => {
    const advisor = { invoke: vi.fn() };

    const answer = await runCavalryAssistantTurn({
      question: 'Show my accounts.',
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: false },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool: vi.fn()
    });

    expect(answer).toMatchObject({
      ok: false,
      error: 'Add and save an API key before asking Cavalry.',
      cancelled: false
    });
    expect(advisor.invoke).not.toHaveBeenCalled();
  });

  it('stops a repeated Chat Completions tool cycle at the iteration bound', async () => {
    let modelCall = 0;
    const advisor = {
      invoke: vi.fn(async () => {
        modelCall += 1;
        return {
          ok: true,
          response: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: `loop_call_${modelCall}`,
                      type: 'function',
                      function: {
                        name: 'search_transactions',
                        arguments: `{"query":"loop ${modelCall}"}`
                      }
                    }
                  ]
                }
              }
            ]
          }
        };
      })
    };
    const executeTool = vi.fn(async () => ({ ok: true, rows: [] }));

    const answer = await runCavalryAssistantTurn({
      question: 'Keep searching.',
      settings: { provider: 'openai', apiMode: 'chat_completions', hasApiKey: true },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool,
      maxIterations: 2,
      requestId: 'bounded_turn'
    });

    expect(answer).toMatchObject({
      ok: false,
      text: '',
      error: 'Cavalry stopped after 2 model iterations before the request completed.',
      cancelled: false
    });
    expect(advisor.invoke).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(answer.toolResults).toHaveLength(2);
    expect(answer.activities.filter((item) => item.type === 'model')).toHaveLength(2);
    expect(answer.activities.filter((item) => item.type === 'tool')).toHaveLength(2);
  });

  it('normalizes model cancellation for the assistant UI', async () => {
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: false,
        cancelled: true,
        error: 'Stopped by the user.'
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Run a long task.',
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor,
      requestId: 'cancel_this_turn'
    });

    expect(answer).toMatchObject({
      ok: false,
      text: '',
      error: 'Stopped by the user.',
      cancelled: true
    });
    expect(answer.activities).toEqual([
      expect.objectContaining({
        type: 'model',
        status: 'cancelled',
        message: 'Stopped by the user.'
      })
    ]);
    expect(advisor.invoke).toHaveBeenCalledWith(
      'runAgentTurn',
      expect.objectContaining({ requestId: 'cancel_this_turn' })
    );
  });

  it('returns tool failures to the model and exposes failed activity without claiming success', async () => {
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          response: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'failed_call',
                      type: 'function',
                      function: { name: 'add_transaction', arguments: '{"amount":80}' }
                    }
                  ]
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          response: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'I could not add it because the account is missing.'
                }
              }
            ]
          }
        })
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Add it.',
      settings: { provider: 'custom' },
      advisor,
      tools: [ADD_TOOL],
      executeTool: async () => ({ ok: false, error: 'Account is required.' })
    });

    expect(answer.ok).toBe(true);
    expect(answer.text).toBe('I could not add it because the account is missing.');
    expect(answer.toolResults[0]).toMatchObject({
      toolName: 'add_transaction',
      ok: false,
      error: 'Account is required.'
    });
    expect(answer.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          toolName: 'add_transaction',
          status: 'failed',
          message: 'add_transaction failed: Account is required.'
        })
      ])
    );
    const toolMessage = advisor.invoke.mock.calls[1][1].messages.at(-1);
    expect(JSON.parse(toolMessage.content)).toEqual({
      ok: false,
      error: 'Account is required.'
    });
  });

  it('preserves structured confirmation details when a destructive tool is blocked', async () => {
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'delete_call',
                type: 'function',
                function: {
                  name: 'delete_transaction',
                  arguments: '{"transaction":"Rent","confirmed":true}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Please confirm that you want me to permanently delete Rent.',
          message: {
            role: 'assistant',
            content: 'Please confirm that you want me to permanently delete Rent.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi.fn(async () => ({
      ok: false,
      status: 'confirmation_required',
      errors: [{ code: 'confirmation_required', message: 'Explicit confirmation is required.' }],
      confirmation: { required: true, field: 'confirmed', action: 'delete Rent' }
    }));
    const answer = await runCavalryAssistantTurn({
      question: 'Delete Rent.',
      settings: { provider: 'custom' },
      advisor,
      tools: [
        {
          type: 'function',
          name: 'delete_transaction',
          parameters: {
            type: 'object',
            properties: { confirmed: { type: 'boolean' } },
            additionalProperties: false
          }
        }
      ],
      executeTool
    });

    expect(answer).toMatchObject({
      ok: true,
      text: 'Please confirm that you want me to permanently delete Rent.'
    });
    const confirmationOutput = JSON.parse(advisor.invoke.mock.calls[1][1].messages.at(-1).content);
    expect(confirmationOutput).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      error: 'Explicit confirmation is required.',
      confirmation: { required: true, field: 'confirmed', action: 'delete Rent' }
    });
    expect(executeTool).toHaveBeenCalledWith(
      'delete_transaction',
      { transaction: 'Rent', confirmed: false },
      expect.objectContaining({ callId: 'delete_call' })
    );
    expect(answer.toolResults[0].arguments.confirmed).toBe(false);
  });

  it('scrubs model-supplied currency approval and preserves the host confirmation request', async () => {
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'convert_call',
                type: 'function',
                function: {
                  name: 'create_transaction',
                  arguments: '{"amount":20,"allowCurrencyConversion":true}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Please confirm the disclosed PHP to USD conversion.',
          message: {
            role: 'assistant',
            content: 'Please confirm the disclosed PHP to USD conversion.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi.fn(async () => ({
      ok: false,
      status: 'confirmation_required',
      errors: [
        {
          code: 'account_currency_conversion_confirmation_required',
          message: 'Cash is configured in USD, so PHP 20.00 would be converted before posting.'
        }
      ],
      confirmation: {
        required: true,
        field: 'allowCurrencyConversion',
        action: 'post this transaction with the disclosed currency conversion'
      }
    }));

    const answer = await runCavalryAssistantTurn({
      question: 'Add PHP 20 to Cash.',
      settings: { provider: 'custom' },
      advisor,
      tools: [CONVERTING_TRANSACTION_TOOL],
      executeTool
    });

    expect(answer).toMatchObject({
      ok: true,
      text: 'Please confirm the disclosed PHP to USD conversion.'
    });
    expect(executeTool).toHaveBeenCalledWith(
      'create_transaction',
      { amount: 20, allowCurrencyConversion: false },
      expect.objectContaining({ callId: 'convert_call' })
    );
    expect(answer.toolResults[0]).toMatchObject({
      arguments: { amount: 20, allowCurrencyConversion: false },
      result: {
        status: 'confirmation_required',
        confirmation: { required: true, field: 'allowCurrencyConversion' }
      }
    });
  });

  it('stops the whole turn before another tool or model call after abort', async () => {
    const abortController = new AbortController();
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'first_search',
              type: 'function',
              function: { name: 'search_transactions', arguments: '{"query":"one"}' }
            },
            {
              id: 'second_search',
              type: 'function',
              function: { name: 'search_transactions', arguments: '{"query":"two"}' }
            }
          ]
        }
      }))
    };
    const executeTool = vi.fn(async () => {
      abortController.abort();
      return { ok: true, rows: [] };
    });

    const answer = await runCavalryAssistantTurn({
      question: 'Search twice.',
      settings: { provider: 'custom' },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool,
      signal: abortController.signal
    });

    expect(answer).toMatchObject({
      ok: false,
      cancelled: true,
      error: 'Cavalry request was cancelled.'
    });
    expect(advisor.invoke).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('sends fifty ordered images with the OpenAI Responses content contract', async () => {
    const images = makeImages(CAVALRY_ASSISTANT_MAX_IMAGES);
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        response: { id: 'response_images', output_text: 'I reviewed all attached images.' }
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Compare these receipts.',
      images,
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor
    });

    expect(answer).toMatchObject({ ok: true, text: 'I reviewed all attached images.' });
    const payload = advisor.invoke.mock.calls[0][1];
    const userContent = payload.input.at(-1).content;
    expect(userContent[0]).toEqual({ type: 'input_text', text: 'Compare these receipts.' });
    expect(userContent.filter((part) => part.type === 'input_image')).toHaveLength(
      CAVALRY_ASSISTANT_MAX_IMAGES
    );
    expect(userContent.filter((part) => part.type === 'input_image')[0]).toEqual({
      type: 'input_image',
      image_url: images[0].dataUrl
    });
    expect(userContent.filter((part) => part.type === 'input_image').at(-1)).toEqual({
      type: 'input_image',
      image_url: images.at(-1).dataUrl
    });
    expect(payload.tools.at(-1).name).toBe(CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME);
  });

  it('rejects image counts above the Companion limit before invoking a provider', async () => {
    const advisor = { invoke: vi.fn() };

    const answer = await runCavalryAssistantTurn({
      question: 'Review these.',
      images: makeImages(CAVALRY_ASSISTANT_MAX_IMAGES + 1),
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor
    });

    expect(answer).toMatchObject({
      ok: false,
      error: `You can attach up to ${CAVALRY_ASSISTANT_MAX_IMAGES} images per message.`
    });
    expect(advisor.invoke).not.toHaveBeenCalled();
  });

  it('uses the Chat Completions image contract for API chat mode', async () => {
    const images = makeImages(40);
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        text: 'Compared.',
        message: { role: 'assistant', content: 'Compared.', tool_calls: [] }
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Compare these images.',
      attachments: images,
      settings: { provider: 'openai', apiMode: 'chat_completions', hasApiKey: true },
      advisor
    });

    expect(answer).toMatchObject({ ok: true, text: 'Compared.' });
    const payload = advisor.invoke.mock.calls[0][1];
    const userContent = payload.messages.at(-1).content;
    expect(userContent[0]).toEqual({ type: 'text', text: 'Compare these images.' });
    expect(userContent.filter((part) => part.type === 'image_url')).toHaveLength(40);
    expect(userContent.filter((part) => part.type === 'image_url')[0]).toEqual({
      type: 'image_url',
      image_url: { url: images[0].dataUrl }
    });
    expect(payload.tools.at(-1).function.name).toBe(CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME);
  });

  it('preserves prior user images in Responses history for clarification follow-ups', async () => {
    const priorImages = makeImages(2);
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        response: { id: 'response_followup', output_text: 'I used both prior images.' }
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Use both.',
      history: [
        { role: 'user', content: 'Which receipts should be compared?', attachments: priorImages },
        { role: 'assistant', content: 'Should I use the first receipt, second receipt, or both?' }
      ],
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor
    });

    expect(answer).toMatchObject({ ok: true, text: 'I used both prior images.' });
    const input = advisor.invoke.mock.calls[0][1].input;
    expect(input[0].content.filter((part) => part.type === 'input_image')).toEqual([
      { type: 'input_image', image_url: priorImages[0].dataUrl },
      { type: 'input_image', image_url: priorImages[1].dataUrl }
    ]);
    expect(input[1]).toEqual({
      role: 'assistant',
      content: 'Should I use the first receipt, second receipt, or both?'
    });
    expect(input[2]).toEqual({ role: 'user', content: 'Use both.' });
  });

  it('requires a local vision projector before sending image data', async () => {
    const advisor = { invoke: vi.fn() };

    const answer = await runCavalryAssistantTurn({
      question: 'Read this receipt.',
      images: makeImages(1),
      settings: { provider: 'custom', model: 'cavalry-advisor' },
      advisor
    });

    expect(answer).toMatchObject({ ok: false, error: expect.stringMatching(/Vision Projector/) });
    expect(advisor.invoke).not.toHaveBeenCalled();
  });

  it('reads local images in tool-free batches and runs a text-only tool loop', async () => {
    const images = makeImages(CAVALRY_ASSISTANT_LOCAL_IMAGE_BATCH_SIZE * 2 + 1);
    let invocation = 0;
    const advisor = {
      invoke: vi.fn(async () => {
        invocation += 1;
        if (invocation <= 3) {
          return {
            ok: true,
            text: `Observations for batch ${invocation}.`,
            message: {
              role: 'assistant',
              content: `Observations for batch ${invocation}.`,
              tool_calls: []
            }
          };
        }
        return {
          ok: true,
          text: 'The batches are summarized.',
          message: {
            role: 'assistant',
            content: 'The batches are summarized.',
            tool_calls: []
          }
        };
      })
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Summarize every receipt.',
      images,
      settings: {
        provider: 'custom',
        model: 'cavalry-advisor',
        mmprojPath: '/models/mmproj.gguf'
      },
      advisor,
      tools: [SEARCH_TOOL]
    });

    expect(answer).toMatchObject({ ok: true, text: 'The batches are summarized.' });
    expect(advisor.invoke).toHaveBeenCalledTimes(4);
    const batchPayloads = advisor.invoke.mock.calls.slice(0, 3).map((call) => call[1]);
    expect(
      batchPayloads.map(
        (payload) =>
          payload.messages.at(-1).content.filter((part) => part.type === 'image_url').length
      )
    ).toEqual([8, 8, 1]);
    batchPayloads.forEach((payload) => {
      expect(payload).not.toHaveProperty('tools');
      expect(payload).not.toHaveProperty('tool_choice');
    });
    const finalPayload = advisor.invoke.mock.calls[3][1];
    expect(finalPayload.messages.at(-1).content).toContain('Observations for batch 1.');
    expect(finalPayload.messages.at(-1).content).toContain('Observations for batch 3.');
    expect(finalPayload.messages.at(-1).content).not.toContain('data:image');
    expect(finalPayload.tools.map((tool) => tool.function.name)).toEqual([
      'search_transactions',
      CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME
    ]);
  });

  it('re-reads historical images locally before a text-only clarification follow-up', async () => {
    const priorImage = makeImages(1)[0];
    const advisor = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: 'image_1 shows a cash receipt.',
          message: { role: 'assistant', content: 'image_1 shows a cash receipt.', tool_calls: [] }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'I will use Cash.',
          message: { role: 'assistant', content: 'I will use Cash.', tool_calls: [] }
        })
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Use Cash.',
      history: [
        { role: 'user', text: 'Read this receipt.', images: [priorImage] },
        { role: 'assistant', text: 'Which account should I use?' }
      ],
      settings: {
        provider: 'custom',
        model: 'cavalry-advisor',
        mmprojPath: '/models/mmproj.gguf'
      },
      advisor
    });

    expect(answer).toMatchObject({ ok: true, text: 'I will use Cash.' });
    expect(advisor.invoke).toHaveBeenCalledTimes(2);
    expect(
      advisor.invoke.mock.calls[0][1].messages
        .at(-1)
        .content.filter((part) => part.type === 'image_url')
    ).toHaveLength(1);
    const finalPayload = advisor.invoke.mock.calls[1][1];
    expect(finalPayload.messages.at(-1).content).toContain('image_1 shows a cash receipt.');
    expect(JSON.stringify(finalPayload.messages)).not.toContain('data:image');
  });

  it('pauses before every executable tool when Responses requests clarification', async () => {
    const executeTool = vi.fn();
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        response: {
          id: 'response_clarification',
          output: [
            {
              type: 'function_call',
              call_id: 'unsafe_search',
              name: 'search_transactions',
              arguments: '{"query":"all"}'
            },
            {
              type: 'function_call',
              call_id: 'clarify_account',
              name: CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME,
              arguments: JSON.stringify({
                question: 'Which account should I use?',
                options: [
                  'Cash',
                  { id: 'credit-card', label: 'Credit Card', description: 'Use the card account.' }
                ],
                allowFreeText: false
              })
            }
          ]
        }
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Find the transaction and update it.',
      settings: { provider: 'openai', apiMode: 'responses', hasApiKey: true },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool
    });

    expect(answer).toMatchObject({
      ok: true,
      text: 'Which account should I use?',
      clarification: {
        id: 'clarify_account',
        question: 'Which account should I use?',
        options: [
          { id: 'cash', label: 'Cash', description: '' },
          {
            id: 'credit_card',
            label: 'Credit Card',
            description: 'Use the card account.'
          }
        ],
        allowFreeText: false
      }
    });
    expect(answer.toolResults).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
    expect(advisor.invoke).toHaveBeenCalledTimes(1);
  });

  it('normalizes string choices and pauses Chat Completions without a host tool call', async () => {
    const executeTool = vi.fn();
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'clarify_range',
              type: 'function',
              function: {
                name: CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME,
                arguments: JSON.stringify({
                  question: 'Which date range?',
                  choices: ['This month', 'Last month']
                })
              }
            }
          ]
        }
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Review my spending.',
      settings: { provider: 'custom' },
      advisor,
      executeTool
    });

    expect(answer).toMatchObject({
      ok: true,
      clarification: {
        id: 'clarify_range',
        question: 'Which date range?',
        options: [
          { id: 'this_month', label: 'This month', description: '' },
          { id: 'last_month', label: 'Last month', description: '' }
        ],
        allowFreeText: true
      }
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('bounds and deduplicates clarification copy from the model', async () => {
    const longQuestion = 'Question '.repeat(100);
    const longLabel = 'Very long option '.repeat(20);
    const longDescription = 'Description '.repeat(40);
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'bounded_clarification',
              type: 'function',
              function: {
                name: CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME,
                arguments: JSON.stringify({
                  question: longQuestion,
                  options: [
                    { label: longLabel, description: longDescription },
                    { label: longLabel.toUpperCase(), description: 'Duplicate.' },
                    'Two',
                    'Three',
                    'Four',
                    'Five',
                    'Six'
                  ]
                })
              }
            }
          ]
        }
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Continue safely.',
      settings: { provider: 'custom' },
      advisor
    });

    expect(answer.clarification.question.length).toBe(500);
    expect(answer.clarification.options).toHaveLength(5);
    expect(answer.clarification.options[0].label.length).toBe(80);
    expect(answer.clarification.options[0].description.length).toBe(160);
    expect(answer.clarification.options.filter((option) => option.label === 'Two')).toHaveLength(1);
  });

  it('turns malformed clarification arguments into a safe pause without sibling execution', async () => {
    const executeTool = vi.fn();
    const advisor = {
      invoke: vi.fn(async () => ({
        ok: true,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'unsafe_search_chat',
              type: 'function',
              function: { name: 'search_transactions', arguments: '{"query":"all"}' }
            },
            {
              id: 'malformed_clarification',
              type: 'function',
              function: {
                name: CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME,
                arguments: '{not-json'
              }
            }
          ]
        }
      }))
    };

    const answer = await runCavalryAssistantTurn({
      question: 'Update something.',
      settings: { provider: 'custom' },
      advisor,
      tools: [SEARCH_TOOL],
      executeTool
    });

    expect(answer).toMatchObject({
      ok: true,
      clarification: {
        id: 'malformed_clarification',
        question: 'I need a little more information before I can continue. What should I use?',
        options: [],
        allowFreeText: true
      }
    });
    expect(executeTool).not.toHaveBeenCalled();
  });
});
