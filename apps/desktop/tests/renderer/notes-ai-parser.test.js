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

function configuredAdvisor(chatResult) {
  return {
    invoke: vi.fn(async (command) => {
      if (command === 'getSettings') {
        return {
          ok: true,
          settings: {
            provider: 'openai',
            model: 'notes-test-model',
            hasApiKey: true
          }
        };
      }
      if (typeof chatResult === 'function') return chatResult();
      return chatResult;
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
  it('uses a configured AI result and normalizes it against the workbook', async () => {
    const workbook = makeWorkbook();
    const advisor = configuredAdvisor({
      ok: true,
      text: JSON.stringify({ transactions: [transaction()] })
    });

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
    expect(advisor.invoke.mock.calls.map(([command]) => command)).toEqual(['getSettings', 'chat']);
  });

  it('sends an exact-line strict schema and only active workbook choices', async () => {
    const advisor = configuredAdvisor({
      ok: true,
      text: JSON.stringify({
        transactions: [
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
        ]
      })
    });

    const result = await parseNotesWithAi(
      'one kay Grab charged to Everyday Visa\n\n₱180 lunch cash',
      makeWorkbook(),
      options(advisor)
    );

    expect(result.mode).toBe('ai');
    const [command, payload] = advisor.invoke.mock.calls[1];
    expect(command).toBe('chat');
    expect(payload).toMatchObject({
      requestId: 'notes_ai_request_test',
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'cavalry_notes_transactions',
          strict: true,
          schema: {
            additionalProperties: false,
            required: ['transactions'],
            properties: {
              transactions: {
                minItems: 2,
                maxItems: 2,
                items: {
                  additionalProperties: false,
                  properties: {
                    lineNumber: { type: 'integer', enum: [1, 3] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 }
                  }
                }
              }
            }
          }
        }
      }
    });

    const packet = JSON.parse(payload.messages[1].content);
    expect(packet.lines).toEqual([
      { lineNumber: 1, text: 'one kay Grab charged to Everyday Visa' },
      { lineNumber: 3, text: '₱180 lunch cash' }
    ]);
    expect(packet.categories).toEqual([
      { id: 'transportation', name: 'Transportation', type: 'expense' },
      { id: 'food', name: 'Food', type: 'expense' }
    ]);
    expect(packet.accounts.map((account) => account.id)).toEqual(['cash', 'card']);
    expect(packet).not.toHaveProperty('transactions');
    expect(payload.messages[0].content).toContain('Never save data');
  });

  it('does not accept inactive or invented workbook entities from the model', async () => {
    const advisor = configuredAdvisor({
      ok: true,
      text: JSON.stringify({
        transactions: [
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
        ]
      })
    });

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

  it('falls back locally for malformed output and provider failures', async () => {
    const scenarios = [
      {
        advisor: configuredAdvisor({ ok: true, text: 'not valid transaction JSON' }),
        notice: 'Cavalry AI returned an incomplete result, so this batch was parsed locally.'
      },
      {
        advisor: configuredAdvisor(() => {
          throw new Error('Model offline');
        }),
        notice: 'Cavalry AI was unavailable, so this batch was parsed locally.'
      },
      {
        advisor: configuredAdvisor({ ok: false, error: 'Rate limited' }),
        notice: 'Cavalry AI was unavailable, so this batch was parsed locally.'
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
    const missingAdvisor = configuredAdvisor({
      ok: true,
      text: JSON.stringify({
        transactions: [
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
        ]
      })
    });
    const text = '₱1,000 transportation credit card\n₱180 food cash';

    const missing = await parseNotesWithAi(text, makeWorkbook(), options(missingAdvisor));

    expect(missing).toMatchObject({
      mode: 'hybrid',
      notice: '1 line used local parsing and need review.'
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

    const duplicateAdvisor = configuredAdvisor({
      ok: true,
      text: JSON.stringify({
        transactions: [
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
        ]
      })
    });

    const duplicate = await parseNotesWithAi(text, makeWorkbook(), options(duplicateAdvisor));

    expect(duplicate.mode).toBe('hybrid');
    expect(duplicate.entries).toHaveLength(2);
    expect(duplicate.entries[0].description).toBe('Transportation');
    expect(duplicate.entries[0].issues.map((item) => item.code)).toContain('ai_line_unresolved');
    expect(duplicate.entries[1].description).toBe('AI Lunch');
    expect(duplicate.entries[1].issues).toEqual([]);
  });
});
