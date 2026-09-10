import { describe, expect, it, vi } from 'vitest';

import { parseNotesWithAi } from '../../src/renderer/features/notes/notes-ai-parser.js';

function makeWorkbook(overrides = {}) {
  return {
    id: 'notes-ai-workbook',
    version: 2,
    name: 'Notes AI Test',
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'card',
        name: 'Everyday Visa',
        group: 'liability',
        subtype: 'credit_card',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'inactive-wallet',
        name: 'Old Wallet',
        group: 'asset',
        subtype: 'wallet',
        currency: 'PHP',
        isActive: false
      },
      {
        id: 'opening-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      },
      {
        id: 'transport-expense',
        name: 'Transportation Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'inactive-expense',
        name: 'Inactive Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: false
      }
    ],
    categories: [
      {
        id: 'transportation',
        name: 'Transportation',
        type: 'expense',
        linkedAccountId: 'transport-expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'inactive-category',
        name: 'Inactive',
        type: 'expense',
        linkedAccountId: 'inactive-expense',
        currency: 'PHP',
        isActive: false
      }
    ],
    counterparties: [],
    transactions: [],
    recurringItems: [],
    recurringReconciliations: [],
    sheets: [],
    ...overrides
  };
}

function transaction(overrides = {}) {
  return {
    lineNumber: 1,
    amount: 1000,
    currency: 'PHP',
    date: '2026-07-29',
    description: 'NAIA Grab',
    categoryId: 'transportation',
    categoryName: 'Transportation',
    primaryAccountId: 'card',
    primaryAccountName: 'Everyday Visa',
    confidence: 0.97,
    uncertainFields: [],
    evidence: {
      amount: 'one kay',
      category: 'Grab',
      primaryAccount: 'Everyday Visa',
      date: '',
      description: 'Grab'
    },
    ...overrides
  };
}

function responsesResult(transactions, overrides = {}) {
  return {
    ok: true,
    response: {
      output_text: JSON.stringify({ transactions }),
      ...overrides
    }
  };
}

function configuredAdvisor(modelResult, settings = {}) {
  return {
    invoke: vi.fn(async (command, payload) => {
      if (command === 'getSettings') {
        return {
          ok: true,
          settings: {
            provider: 'openai',
            apiMode: 'responses',
            model: 'notes-test-model',
            hasApiKey: true,
            ...settings
          }
        };
      }
      if (typeof modelResult === 'function') return modelResult(command, payload);
      return modelResult;
    })
  };
}

function options(advisor) {
  return {
    advisor,
    today: () => '2026-07-29',
    createId: () => 'notes_ai_request_test'
  };
}

describe('notes AI parser', () => {
  it('uses OpenAI Responses output_text and normalizes it against the workbook', async () => {
    const workbook = makeWorkbook();
    const advisor = configuredAdvisor(responsesResult([transaction()]));

    const result = await parseNotesWithAi(
      'one kay for a Grab home from NAIA, charged to Everyday Visa',
      workbook,
      options(advisor)
    );

    expect(result).toMatchObject({
      mode: 'ai',
      notice: '',
      canConfigure: false
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      lineNumber: 1,
      amount: 1000,
      currency: 'PHP',
      date: '2026-07-29',
      description: 'NAIA Grab',
      categoryId: 'transportation',
      categoryName: 'Transportation',
      primaryAccountId: 'card',
      paymentLabel: 'Credit card',
      template: 'expense_charged',
      issues: []
    });
    expect(workbook.transactions).toEqual([]);
    expect(advisor.invoke.mock.calls.map(([command]) => command)).toEqual([
      'getSettings',
      'runAgentTurn'
    ]);
  });

  it('sends a source-group Responses schema with enum IDs and recent examples', async () => {
    const candidates = [
      transaction(),
      transaction({
        lineNumber: 3,
        amount: 180,
        description: 'Lunch',
        categoryId: 'food',
        categoryName: 'Food',
        primaryAccountId: 'cash',
        primaryAccountName: 'Cash',
        evidence: {
          amount: '₱180',
          category: 'lunch',
          primaryAccount: 'cash',
          date: '',
          description: 'lunch'
        }
      })
    ];
    const advisor = configuredAdvisor(responsesResult(candidates));
    const workbook = makeWorkbook({
      transactions: [
        { description: 'Older lunch', categoryId: 'food' },
        { description: 'Inactive example', categoryId: 'inactive-category' },
        { description: 'Recent airport ride', categoryId: 'transportation' },
        { description: '', categoryId: 'food' }
      ]
    });

    const result = await parseNotesWithAi(
      'one kay Grab charged to Everyday Visa\n\n₱180 lunch cash',
      workbook,
      options(advisor)
    );

    expect(result.mode).toBe('ai');
    const [command, payload] = advisor.invoke.mock.calls[1];
    expect(command).toBe('runAgentTurn');
    expect(payload).toMatchObject({
      requestId: 'notes_ai_request_test',
      max_output_tokens: 1400,
      text: {
        format: {
          type: 'json_schema',
          name: 'cavalry_notes_transactions',
          strict: true,
          schema: {
            additionalProperties: false,
            required: ['transactions'],
            properties: {
              transactions: {
                minItems: 0,
                maxItems: 2,
                items: {
                  additionalProperties: false,
                  properties: {
                    lineNumber: { type: 'integer', enum: [1, 3] },
                    categoryId: {
                      type: 'string',
                      enum: ['', 'transportation', 'food']
                    },
                    primaryAccountId: { type: 'string', enum: ['', 'cash', 'card'] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                  }
                }
              }
            }
          }
        }
      }
    });
    expect(payload).not.toHaveProperty('temperature');
    expect(payload).not.toHaveProperty('response_format');

    const packet = JSON.parse(payload.input);
    expect(packet.lines).toEqual([
      { lineNumber: 1, text: 'one kay Grab charged to Everyday Visa' },
      { lineNumber: 3, text: '₱180 lunch cash' }
    ]);
    expect(packet.categories).toEqual([
      { id: 'transportation', name: 'Transportation', type: 'expense' },
      { id: 'food', name: 'Food', type: 'expense' }
    ]);
    expect(packet.accounts.map((account) => account.id)).toEqual(['cash', 'card']);
    expect(packet.recentCategoryExamples).toEqual([
      { description: 'Recent airport ride', categoryId: 'transportation' },
      { description: 'Older lunch', categoryId: 'food' }
    ]);
    expect(packet).not.toHaveProperty('transactions');
    expect(payload.instructions).toContain('Never save data');
    expect(payload.instructions).toContain('untrusted data');
  });

  it('extracts nested Responses output text and keeps grounding checks', async () => {
    const candidate = transaction({
      amount: 180,
      description: 'Lunch',
      categoryId: 'food',
      categoryName: 'Food',
      primaryAccountId: 'cash',
      primaryAccountName: 'Cash',
      confidence: 0.4,
      uncertainFields: ['categoryId'],
      evidence: {
        amount: 'missing amount evidence',
        category: 'missing category evidence',
        primaryAccount: 'missing account evidence',
        date: '',
        description: 'missing description evidence'
      }
    });
    const advisor = configuredAdvisor({
      ok: true,
      data: {
        response: {
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ transactions: [candidate] })
                }
              ]
            }
          ]
        }
      }
    });

    const result = await parseNotesWithAi('₱180 food cash', makeWorkbook(), options(advisor));

    expect(result.mode).toBe('ai');
    expect(result.entries[0]).toMatchObject({
      amount: 180,
      categoryId: 'food',
      primaryAccountId: 'cash'
    });
    expect(result.entries[0].issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'ai_amount_ungrounded',
        'ai_description_ungrounded',
        'ai_category_ungrounded',
        'ai_payment_ungrounded',
        'ai_categoryId_uncertain',
        'ai_low_confidence'
      ])
    );
  });

  it('keeps custom models on Chat Completions with response_format', async () => {
    const advisor = configuredAdvisor(
      {
        ok: true,
        text: JSON.stringify({ transactions: [transaction()] })
      },
      {
        provider: 'custom',
        apiMode: 'chat_completions',
        hasApiKey: false
      }
    );

    const result = await parseNotesWithAi(
      'one kay Grab charged to Everyday Visa',
      makeWorkbook(),
      options(advisor)
    );

    expect(result.mode).toBe('ai');
    const [command, payload] = advisor.invoke.mock.calls[1];
    expect(command).toBe('chat');
    expect(payload).toMatchObject({
      requestId: 'notes_ai_request_test',
      temperature: 0,
      top_p: 0.8,
      max_tokens: 1400,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'cavalry_notes_transactions',
          strict: true,
          schema: {
            properties: {
              transactions: {
                items: {
                  properties: {
                    categoryId: {
                      enum: ['', 'transportation', 'food']
                    },
                    primaryAccountId: {
                      enum: ['', 'cash', 'card']
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    expect(JSON.parse(payload.messages[1].content).lines).toEqual([
      { lineNumber: 1, text: 'one kay Grab charged to Everyday Visa' }
    ]);
    expect(payload).not.toHaveProperty('text');
  });

  it('does not accept inactive or invented workbook entities from the model', async () => {
    const advisor = configuredAdvisor(
      responsesResult([
        transaction({
          amount: 200,
          description: 'Bus fare',
          categoryId: 'inactive-category',
          categoryName: 'Invented Category',
          primaryAccountId: 'inactive-wallet',
          primaryAccountName: 'Invented Wallet',
          confidence: 0.99,
          evidence: {
            amount: '₱200',
            category: 'transportation',
            primaryAccount: 'cash',
            date: '',
            description: 'transportation'
          }
        })
      ])
    );

    const result = await parseNotesWithAi(
      '₱200 transportation cash',
      makeWorkbook(),
      options(advisor)
    );

    expect(result.mode).toBe('ai');
    expect(result.entries[0]).toMatchObject({
      categoryId: 'transportation',
      primaryAccountId: 'cash'
    });
    expect(result.entries[0].issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['ai_category_unresolved', 'ai_payment_unresolved'])
    );
    expect(result.entries[0].categoryId).not.toBe('inactive-category');
    expect(result.entries[0].primaryAccountId).not.toBe('inactive-wallet');
  });

  it('distinguishes built-in local, missing-key, missing-model, and settings failures', async () => {
    const scenarios = [
      {
        advisor: undefined,
        notice: '',
        canConfigure: false
      },
      {
        advisor: {
          invoke: vi.fn(async () => ({
            ok: true,
            settings: { provider: 'local' }
          }))
        },
        notice: '',
        canConfigure: false
      },
      {
        advisor: configuredAdvisor(null, { hasApiKey: false }),
        notice: 'OpenAI is selected, but no API key is saved. Smart local parsing was used.',
        canConfigure: true
      },
      {
        advisor: configuredAdvisor(null, { model: '' }),
        notice: 'Choose an AI model in Settings. Smart local parsing was used.',
        canConfigure: true
      },
      {
        advisor: {
          invoke: vi.fn(async () => ({ ok: false, error: 'Settings storage unavailable' }))
        },
        notice: 'Cavalry could not read the AI connection. Smart local parsing was used.',
        canConfigure: false
      },
      {
        advisor: {
          invoke: vi.fn(async () => {
            throw new Error('Settings bridge unavailable');
          })
        },
        notice: 'Cavalry could not read the AI connection. Smart local parsing was used.',
        canConfigure: false
      }
    ];

    for (const scenario of scenarios) {
      const result = await parseNotesWithAi(
        '₱180 food cash',
        makeWorkbook(),
        options(scenario.advisor)
      );

      expect(result).toMatchObject({
        mode: 'local',
        notice: scenario.notice,
        canConfigure: scenario.canConfigure,
        entries: [
          expect.objectContaining({
            amount: 180,
            categoryId: 'food',
            primaryAccountId: 'cash',
            issues: []
          })
        ]
      });
    }
  });

  it('falls back locally for malformed output and provider failures', async () => {
    const scenarios = [
      {
        advisor: configuredAdvisor({
          ok: true,
          response: { output_text: 'not valid transaction JSON' }
        }),
        notice: 'Cavalry AI returned an incomplete result. Smart local parsing was used.'
      },
      {
        advisor: configuredAdvisor(() => {
          throw new Error('Model offline');
        }),
        notice: 'Cavalry AI was unavailable. Smart local parsing was used.'
      },
      {
        advisor: configuredAdvisor({ ok: false, error: 'Rate limited' }),
        notice: 'Cavalry AI was unavailable. Smart local parsing was used.'
      }
    ];

    for (const scenario of scenarios) {
      const result = await parseNotesWithAi(
        '₱180 food cash',
        makeWorkbook(),
        options(scenario.advisor)
      );

      expect(result).toMatchObject({
        mode: 'local',
        notice: scenario.notice,
        canConfigure: false
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        amount: 180,
        categoryId: 'food',
        primaryAccountId: 'cash',
        issues: []
      });
    }
  });

  it('uses flagged local parsing when the model omits or duplicates source lines', async () => {
    const missingAdvisor = configuredAdvisor(
      responsesResult([
        transaction({
          description: 'Transportation',
          evidence: {
            amount: '₱1,000',
            category: 'transportation',
            primaryAccount: 'credit card',
            date: '',
            description: 'transportation'
          }
        })
      ])
    );
    const text = '₱1,000 transportation credit card\n₱180 food cash';

    const missing = await parseNotesWithAi(text, makeWorkbook(), options(missingAdvisor));

    expect(missing).toMatchObject({
      mode: 'hybrid',
      notice: '1 line used smart local parsing.'
    });
    expect(missing.entries).toHaveLength(2);
    expect(missing.entries[0].description).toBe('Transportation');
    expect(missing.entries[1]).toMatchObject({
      lineNumber: 2,
      amount: 180,
      categoryId: 'food',
      primaryAccountId: 'cash'
    });
    expect(missing.entries[1].issues.map((item) => item.code)).toContain('ai_line_unresolved');

    const duplicateAdvisor = configuredAdvisor(
      responsesResult([
        transaction({ description: 'First AI candidate' }),
        transaction({ description: 'Conflicting AI candidate' }),
        transaction({
          lineNumber: 2,
          amount: 180,
          description: 'AI Lunch',
          categoryId: 'food',
          categoryName: 'Food',
          primaryAccountId: 'cash',
          primaryAccountName: 'Cash',
          evidence: {
            amount: '₱180',
            category: 'food',
            primaryAccount: 'cash',
            date: '',
            description: 'food'
          }
        })
      ])
    );

    const duplicate = await parseNotesWithAi(text, makeWorkbook(), options(duplicateAdvisor));

    expect(duplicate.mode).toBe('hybrid');
    expect(duplicate.entries).toHaveLength(2);
    expect(duplicate.entries[0].description).toBe('Transportation');
    expect(duplicate.entries[0].issues.map((item) => item.code)).toContain('ai_line_unresolved');
    expect(duplicate.entries[1].description).toBe('AI Lunch');
    expect(duplicate.entries[1].issues).toEqual([]);
  });
});

describe('messy AI note intake safeguards', () => {
  it('sends multiline groups with heading context and does not force every line into a transaction', async () => {
    const advisor = configuredAdvisor(
      responsesResult([
        transaction({
          sourceId: 'notes-line-2',
          lineNumber: 2,
          amount: 180,
          date: '2026-07-28',
          description: 'Lunch',
          categoryId: 'food',
          primaryAccountId: 'cash',
          evidence: {
            amount: '180',
            category: 'Lunch',
            primaryAccount: 'cash',
            date: 'July 28, 2026',
            description: 'Lunch'
          }
        })
      ])
    );
    const result = await parseNotesWithAi(
      'July 28, 2026\nLunch\namount: 180\npaid with cash\nTotal: 180',
      makeWorkbook(),
      options(advisor)
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      amount: 180,
      date: '2026-07-28',
      sourceLineNumbers: [2, 3, 4],
      issues: []
    });
    const packet = JSON.parse(advisor.invoke.mock.calls[1][1].input);
    expect(packet.noteGroups).toHaveLength(1);
    expect(packet.noteGroups[0]).toMatchObject({
      sourceId: 'notes-line-2',
      sourceLineNumbers: [2, 3, 4],
      dateContext: { date: '2026-07-28' }
    });
    expect(
      advisor.invoke.mock.calls[1][1].text.format.schema.properties.transactions
    ).toMatchObject({ minItems: 0, maxItems: 1 });
  });

  it.each([
    [{ amount: 1800 }, 'ai_amount_mismatch'],
    [{ date: '2026-07-01' }, 'ai_date_mismatch'],
    [{ currency: 'USD' }, 'ai_currency_mismatch'],
    [{ primaryAccountId: 'card', primaryAccountName: 'Everyday Visa' }, 'ai_payment_mismatch']
  ])(
    'flags values inconsistent with the source even when evidence exists: %s',
    async (changes, code) => {
      const advisor = configuredAdvisor(
        responsesResult([
          transaction({
            amount: 180,
            description: 'Lunch',
            categoryId: 'food',
            primaryAccountId: 'cash',
            evidence: {
              amount: '180',
              category: 'lunch',
              primaryAccount: 'cash',
              date: '',
              description: 'lunch'
            },
            ...changes
          })
        ])
      );
      const result = await parseNotesWithAi('lunch 180 cash', makeWorkbook(), options(advisor));
      expect(result.entries[0].issues.map((item) => item.code)).toContain(code);
    }
  );

  it('does not let model confidence erase local correction and ambiguous-date safeguards', async () => {
    const advisor = configuredAdvisor(
      responsesResult([
        transaction({
          amount: 160,
          description: 'Lunch',
          categoryId: 'food',
          primaryAccountId: 'cash',
          evidence: {
            amount: '160',
            category: 'lunch',
            primaryAccount: 'cash',
            date: '07/08',
            description: 'lunch'
          }
        })
      ])
    );
    const result = await parseNotesWithAi(
      '07/08 lunch 180 cash, actually 160',
      makeWorkbook(),
      options(advisor)
    );
    expect(result.entries[0].issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['date_ambiguous', 'correction_review', 'amount_ambiguous'])
    );
  });

  it('keeps two same-line purchases separate by source identity', async () => {
    const candidate = {
      amount: 180,
      description: 'Food',
      categoryId: 'food',
      primaryAccountId: 'cash',
      evidence: {
        amount: '180',
        category: 'food',
        primaryAccount: 'cash',
        date: '',
        description: 'food'
      }
    };
    const advisor = configuredAdvisor(
      responsesResult([
        transaction({ ...candidate, sourceId: 'notes-line-1' }),
        transaction({
          ...candidate,
          sourceId: 'notes-line-1-2',
          amount: 250,
          evidence: { ...candidate.evidence, amount: '250' }
        })
      ])
    );
    const result = await parseNotesWithAi(
      'food 180 cash; food 250 cash',
      makeWorkbook(),
      options(advisor)
    );
    expect(result.entries.map((entry) => entry.amount)).toEqual([180, 250]);
    expect(result.entries.every((entry) => entry.issues.length === 0)).toBe(true);
    expect(new Set(result.entries.map((entry) => entry.id)).size).toBe(2);
  });

  it('ignores fabricated header transactions and retains omitted supported notes for review', async () => {
    const advisor = configuredAdvisor(
      responsesResult([transaction({ lineNumber: 1, sourceId: 'invented', amount: 2026 })])
    );
    const result = await parseNotesWithAi(
      'July 28, 2026\nfood 180 cash',
      makeWorkbook(),
      options(advisor)
    );
    expect(result.mode).toBe('hybrid');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ amount: 180, lineNumber: 2 });
    expect(result.entries[0].issues.map((item) => item.code)).toContain('ai_line_unresolved');
  });

  it('does not call a provider for prose-only notes or summary totals', async () => {
    const advisor = configuredAdvisor(responsesResult([transaction()]));
    const result = await parseNotesWithAi(
      'Notes\nTotal: 200\nReminder: pay rent 500\nI would like to save more.',
      makeWorkbook(),
      options(advisor)
    );
    expect(result).toMatchObject({ mode: 'none', entries: [] });
    expect(advisor.invoke).not.toHaveBeenCalled();
  });
});

describe('AI Notes admission limits', () => {
  it('retains all candidates locally when more than100 source groups are supplied', async () => {
    const text = Array.from({ length: 101 }, (_, index) => `food ${index + 1} cash`).join('\n');
    const advisor = configuredAdvisor(responsesResult([transaction()]));
    const result = await parseNotesWithAi(text, makeWorkbook(), options(advisor));
    expect(result.mode).toBe('local');
    expect(result.notice).toContain('Split this large note');
    expect(result.entries).toHaveLength(101);
    expect(result.entries.at(-1)).toMatchObject({ amount: 101, sourceText: 'food 101 cash' });
    expect(advisor.invoke).not.toHaveBeenCalled();
  });

  it('keeps the complete source for an oversized note without sending it to a provider', async () => {
    const source = `food 180 cash ${'receipt detail '.repeat(1500)}`;
    const advisor = configuredAdvisor(responsesResult([transaction()]));
    const result = await parseNotesWithAi(source, makeWorkbook(), options(advisor));
    expect(result.mode).toBe('local');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sourceText).toBe(source.trim());
    expect(result.notice).toContain('Local review is complete');
    expect(advisor.invoke).not.toHaveBeenCalled();
  });
});
