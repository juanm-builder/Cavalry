import { describe, expect, it } from 'vitest';

import {
  buildCavalryAssistantCitations,
  buildCavalryAssistantReferences,
  normalizeCavalryAssistantReferences
} from '../../src/renderer/features/assistant/cavalry-assistant-references.js';

function successfulResult(data, argumentsValue = {}) {
  return {
    ok: true,
    arguments: argumentsValue,
    result: { ok: true, data }
  };
}

describe('Cavalry assistant references', () => {
  it('builds all six destination kinds from successful workbook tool data', () => {
    const references = buildCavalryAssistantReferences({
      text: [
        'Review the Cash account and the Coffee transaction.',
        'Food category has a Food budget on the July budget sheet.',
        'Internet subscription renews monthly.'
      ].join(' '),
      toolResults: [
        successfulResult({
          account: {
            id: 'cash',
            name: 'Cash',
            group: 'asset',
            balance: 4000,
            currency: 'PHP'
          },
          transaction: {
            id: 'txn-coffee',
            description: 'Coffee',
            date: '2026-07-11',
            amount: 2000,
            currency: 'PHP'
          },
          category: { id: 'food', name: 'Food', type: 'expense' },
          recurringItem: {
            id: 'internet',
            name: 'Internet',
            kind: 'subscription',
            frequency: 'Monthly',
            amount: 1500,
            currency: 'PHP'
          },
          budgets: [
            {
              sheet: { id: 'july', name: 'July', monthIndex: 6 },
              monthKey: '2026-07',
              currency: 'PHP',
              rows: [
                {
                  categoryId: 'food',
                  categoryName: 'Food',
                  planned: 5000,
                  actual: 2000,
                  remaining: 3000
                }
              ]
            }
          ]
        })
      ]
    });

    expect(new Set(references.map((reference) => reference.kind))).toEqual(
      new Set(['account', 'transaction', 'category', 'budget', 'sheet', 'recurringItem'])
    );
    expect(references.find((reference) => reference.kind === 'account')).toMatchObject({
      id: 'account:cash',
      token: 'Cash account',
      label: 'Cash',
      source_refs: ['account:cash'],
      detail: { balance: 4000, currency: 'PHP' }
    });
    expect(references.find((reference) => reference.kind === 'transaction')).toMatchObject({
      id: 'transaction:txn-coffee',
      token: 'Coffee transaction',
      source_refs: ['transaction:txn-coffee'],
      detail: { date: '2026-07-11', amount: 2000, currency: 'PHP' }
    });
    expect(references.find((reference) => reference.kind === 'category')).toMatchObject({
      id: 'category:food',
      token: 'Food category',
      source_refs: ['category:food']
    });
    expect(references.find((reference) => reference.kind === 'budget')).toMatchObject({
      id: 'budget:july:food',
      token: 'Food budget',
      source_refs: ['budget:july:food'],
      detail: {
        sheetId: 'july',
        sheetName: 'July',
        monthKey: '2026-07',
        categoryId: 'food',
        planned: 5000,
        actual: 2000,
        remaining: 3000
      }
    });
    expect(references.find((reference) => reference.kind === 'sheet')).toMatchObject({
      id: 'sheet:july',
      token: 'July budget sheet',
      source_refs: ['sheet:july'],
      detail: { sheetId: 'july', monthKey: '2026-07', monthIndex: 6 }
    });
    expect(references.find((reference) => reference.kind === 'recurringItem')).toMatchObject({
      id: 'recurringItem:internet',
      token: 'Internet subscription',
      source_refs: ['recurringItem:internet'],
      detail: {
        kind: 'subscription',
        frequency: 'Monthly',
        amount: 1500,
        currency: 'PHP'
      }
    });
  });

  it('uses successful singular mutation results and their resolved budget names', () => {
    const references = buildCavalryAssistantReferences({
      text: 'The Food budget in July is now 6000, and txn-created was recorded.',
      toolResults: [
        successfulResult(
          { budget: { sheetId: 'july', categoryId: 'food', planned: 6000 } },
          { sheet: 'July', category: 'Food', planned: 6000 }
        ),
        successfulResult({
          transaction: {
            id: 'txn-created',
            description: 'Team Lunch',
            date: '2026-07-14',
            amount: 750,
            currency: 'PHP'
          }
        })
      ]
    });

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'budget',
          token: 'Food budget',
          label: 'Food',
          source_refs: ['budget:july:food']
        }),
        expect.objectContaining({
          kind: 'transaction',
          token: 'txn-created',
          source_refs: ['transaction:txn-created']
        })
      ])
    );
  });

  it('builds related account and category references from focused result rows', () => {
    const references = buildCavalryAssistantReferences({
      text: 'Coffee was charged to Cash in Food. Internet is also paid from Cash.',
      toolResults: [
        successfulResult({
          transactions: [
            {
              id: 'txn-coffee',
              description: 'Coffee',
              accountId: 'cash',
              accountName: 'Cash',
              categoryId: 'food',
              categoryName: 'Food'
            }
          ],
          recurringItems: [
            {
              id: 'internet',
              name: 'Internet',
              accountId: 'cash',
              accountName: 'Cash',
              categoryId: 'utilities',
              categoryName: 'Utilities'
            }
          ]
        })
      ]
    });

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'transaction', source_refs: ['transaction:txn-coffee'] }),
        expect.objectContaining({ kind: 'account', source_refs: ['account:cash'] }),
        expect.objectContaining({ kind: 'category', source_refs: ['category:food'] }),
        expect.objectContaining({
          kind: 'recurringItem',
          source_refs: ['recurringItem:internet']
        })
      ])
    );
  });

  it('does not link unplanned, missing-category, or archived budget rows as existing budgets', () => {
    const references = buildCavalryAssistantReferences({
      text: 'Food budget, Missing category budget, and the July budget sheet were reviewed.',
      toolResults: [
        successfulResult({
          budgets: [
            {
              sheet: { id: 'july', name: 'July', monthIndex: 6 },
              monthKey: '2026-07',
              rows: [
                { categoryId: 'food', categoryName: 'Food', planned: 0, actual: 1200 },
                {
                  categoryId: 'deleted',
                  categoryName: 'Missing category',
                  isMissing: true,
                  planned: 500,
                  actual: 0
                }
              ]
            }
          ],
          budget: { sheetId: 'july', categoryId: 'food', archived: true }
        })
      ]
    });

    expect(references.map((reference) => reference.kind)).toEqual(['sheet']);
    expect(references[0].source_refs).toEqual(['sheet:july']);
  });

  it('ignores failed tools, failed envelopes, data outside the envelope, and malformed entities', () => {
    const references = buildCavalryAssistantReferences({
      text: 'Cash, Food, Coffee, July, and Internet were mentioned.',
      toolResults: [
        {
          ok: false,
          result: { ok: true, data: { account: { id: 'cash', name: 'Cash' } } }
        },
        {
          ok: true,
          result: { ok: false, data: { category: { id: 'food', name: 'Food' } } }
        },
        {
          ok: true,
          result: { data: { category: { id: 'food', name: 'Food' } } }
        },
        { ok: true, result: { ok: true, account: { id: 'cash', name: 'Cash' } } },
        successfulResult({
          accounts: [{ name: 'Cash' }, null],
          transactions: [{ id: {}, description: 'Coffee' }],
          categories: 'not-an-array',
          budget: { sheet: { name: 'July' }, categoryName: 'Food' },
          recurringItems: [{ id: '', name: 'Internet' }]
        }),
        null
      ]
    });

    expect(references).toEqual([]);
  });

  it('uses explicit kind words to disambiguate categories from budgets', () => {
    const toolResults = [
      successfulResult({
        category: { id: 'food', name: 'Food', type: 'expense' },
        budgets: [
          {
            sheet: { id: 'july', name: 'July' },
            rows: [{ categoryId: 'food', categoryName: 'Food', planned: 1000 }]
          }
        ]
      })
    ];

    expect(
      buildCavalryAssistantReferences({ text: 'Review the Food category.', toolResults }).map(
        (reference) => reference.kind
      )
    ).toEqual(['category']);
    expect(
      buildCavalryAssistantReferences({ text: 'Review the Food budget.', toolResults }).map(
        (reference) => reference.kind
      )
    ).toEqual(['budget']);
  });

  it('groups repeated transaction evidence with the same merchant label', () => {
    const references = buildCavalryAssistantReferences({
      text: 'Coffee appears to be duplicated.',
      toolResults: [
        successfulResult({
          transactions: [
            {
              id: 'txn-one',
              description: 'Coffee',
              date: '2026-07-11',
              amount: 100,
              currency: 'PHP'
            },
            {
              id: 'txn-two',
              description: 'Coffee',
              date: '2026-07-11',
              amount: 100,
              currency: 'PHP'
            }
          ]
        }),
        successfulResult({
          transaction: {
            id: 'txn-one',
            description: 'Coffee',
            date: '2026-07-12',
            amount: 125,
            currency: 'PHP'
          }
        })
      ]
    });

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      kind: 'transaction',
      label: 'Coffee',
      source_refs: ['transaction:txn-one', 'transaction:txn-two'],
      detail: { transactionCount: 2 }
    });
    expect(references[0].detail.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_ref: 'transaction:txn-one',
          detail: expect.objectContaining({ date: '2026-07-12', amount: 125 })
        }),
        expect.objectContaining({ source_ref: 'transaction:txn-two' })
      ])
    );
  });

  it('matches case-insensitively at entity boundaries and permits an exact stable ID alias', () => {
    const partial = buildCavalryAssistantReferences({
      text: 'Cashback is not the same record.',
      toolResults: [successfulResult({ account: { id: 'acct-1', name: 'Cash' } })]
    });
    const byId = buildCavalryAssistantReferences({
      text: 'Open ACCT-1 for me.',
      toolResults: [successfulResult({ account: { id: 'acct-1', name: 'Cash' } })]
    });

    expect(partial).toEqual([]);
    expect(byId).toEqual([
      expect.objectContaining({
        id: 'account:acct-1',
        token: 'ACCT-1',
        aliases: expect.arrayContaining(['acct-1']),
        source_refs: ['account:acct-1']
      })
    ]);
  });

  it('encodes delimiter characters in stable IDs without losing raw ID aliases', () => {
    const references = buildCavalryAssistantReferences({
      text: 'Open Reserve and the Food budget.',
      toolResults: [
        successfulResult(
          {
            account: { id: 'cash:reserve', name: 'Reserve' },
            budget: {
              sheetId: 'sheet:july',
              categoryId: 'food:takeout',
              planned: 1000
            }
          },
          { sheet: 'July', category: 'Food' }
        )
      ]
    });

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_refs: ['account:cash%3Areserve'] }),
        expect.objectContaining({ source_refs: ['budget:sheet%3Ajuly:food%3Atakeout'] })
      ])
    );
    expect(references.find((reference) => reference.kind === 'account')?.aliases).toContain(
      'cash:reserve'
    );
  });

  it('normalizes only supported, stable reference records', () => {
    expect(
      normalizeCavalryAssistantReferences([
        {
          id: 'custom-id',
          token: 'Cash',
          aliases: ['Cash', '', 'cash'],
          label: 'Cash',
          kind: 'account',
          source_refs: ['account:cash', '', 'category:food'],
          detail: { balance: 10 }
        },
        { token: 'Unknown', kind: 'unknown', source_refs: ['unknown:one'] },
        { token: '', kind: 'transaction', source_refs: ['transaction:txn-one'] },
        { token: 'Broken', kind: 'budget', source_refs: ['budget:missing-category'] },
        { token: 'Food', source_refs: ['category:food'], aliases: {} }
      ])
    ).toEqual([
      {
        id: 'custom-id',
        token: 'Cash',
        aliases: ['Cash'],
        label: 'Cash',
        kind: 'account',
        source_refs: ['account:cash'],
        detail: { balance: 10 }
      },
      {
        id: 'category:food',
        token: 'Food',
        aliases: ['Food'],
        label: 'Food',
        kind: 'category',
        source_refs: ['category:food'],
        detail: {}
      }
    ]);
  });

  it('preserves a legacy multi-record reference as one evidence group', () => {
    expect(
      normalizeCavalryAssistantReferences([
        {
          token: 'Cash and Food',
          source_refs: ['account:cash', 'category:food']
        }
      ])
    ).toEqual([
      expect.objectContaining({
        kind: 'evidence',
        source_refs: ['account:cash', 'category:food']
      })
    ]);
  });

  it('turns a validated evidence-set marker into one quiet claim citation', () => {
    const citations = buildCavalryAssistantCitations({
      text: 'Vercel looks monthly based on charges in April and May. [[source-set:vercel-pattern]]',
      toolResults: [
        successfulResult({
          evidenceSets: [
            {
              id: 'vercel-pattern',
              label: 'Vercel recurring-pattern evidence',
              kind: 'transaction',
              source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
              records: [
                {
                  id: 'vercel-apr',
                  description: 'Vercel',
                  date: '2026-04-03',
                  amount: 1276,
                  currency: 'PHP'
                },
                {
                  id: 'vercel-may',
                  description: 'Vercel',
                  date: '2026-05-03',
                  amount: 1276,
                  currency: 'PHP'
                }
              ],
              inference: {
                evidenceStatus: 'likely_recurring',
                firstSeenDate: '2026-04-03',
                lastSeenDate: '2026-05-03'
              }
            }
          ]
        })
      ]
    });

    expect(citations.text).toBe(
      'Vercel looks monthly based on charges in April and May. [source](#cavalry-source-1)'
    );
    expect(citations.references).toEqual([
      expect.objectContaining({
        id: 'cavalry-citation-1',
        anchor: '#cavalry-source-1',
        label: 'Vercel recurring-pattern evidence',
        kind: 'transaction',
        support: 'inferred',
        source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
        detail: expect.objectContaining({
          records: expect.arrayContaining([
            expect.objectContaining({ source_ref: 'transaction:vercel-apr' }),
            expect.objectContaining({ source_ref: 'transaction:vercel-may' })
          ])
        })
      })
    ]);
  });

  it('keeps an exact private evidence set when only a bounded record preview is available', () => {
    const citations = buildCavalryAssistantCitations({
      text: 'The filtered total covers three charges. [[source-set:filtered-total]]',
      toolResults: [
        {
          ok: true,
          result: {
            ok: true,
            data: {
              evidenceSets: [
                {
                  id: 'filtered-total',
                  label: 'Filtered transaction results',
                  kind: 'transaction',
                  calculation: { transactionCount: 3, recordPreviewCount: 1 }
                }
              ]
            },
            referenceData: {
              evidenceSets: [
                {
                  id: 'filtered-total',
                  kind: 'transaction',
                  source_refs: [
                    'transaction:charge-1',
                    'transaction:charge-2',
                    'transaction:charge-3'
                  ],
                  records: [{ id: 'charge-1', description: 'Charge 1', amount: 100 }]
                }
              ]
            }
          }
        }
      ]
    });

    expect(citations.references).toEqual([
      expect.objectContaining({
        label: 'Filtered transaction results',
        source_refs: ['transaction:charge-1', 'transaction:charge-2', 'transaction:charge-3'],
        detail: expect.objectContaining({
          sourceCount: 3,
          records: [expect.objectContaining({ source_ref: 'transaction:charge-1' })],
          calculation: expect.objectContaining({ transactionCount: 3, recordPreviewCount: 1 })
        })
      })
    ]);
  });

  it('validates every direct source marker record before linking the claim', () => {
    const toolResults = [
      successfulResult({
        transaction: {
          id: 'txn-coffee',
          description: 'Coffee',
          date: '2026-07-11',
          amount: 200,
          currency: 'PHP'
        },
        account: { id: 'cash', name: 'Cash', balance: 5000, currency: 'PHP' }
      })
    ];
    const valid = buildCavalryAssistantCitations({
      text: 'Coffee was charged to Cash. [[source:transaction:txn-coffee|account:cash]]',
      toolResults
    });
    const partiallyMissing = buildCavalryAssistantCitations({
      text: 'Coffee was charged to Cash. [[source:transaction:txn-coffee|account:not-found]]',
      toolResults
    });

    expect(valid.text).toBe('Coffee was charged to Cash. [source](#cavalry-source-1)');
    expect(valid.references).toEqual([
      expect.objectContaining({
        kind: 'evidence',
        source_refs: ['transaction:txn-coffee', 'account:cash']
      })
    ]);
    expect(partiallyMissing).toEqual({
      text: "I couldn't verify “Coffee was charged to Cash” from the workbook.",
      references: []
    });
  });

  it('rewrites an unsupported assertion as a natural verification failure', () => {
    expect(
      buildCavalryAssistantCitations({
        text: 'Supabase is active. [[source:transaction:not-found]]',
        toolResults: [successfulResult({ transactions: [] })]
      })
    ).toEqual({
      text: "I couldn't verify “Supabase is active” from the workbook.",
      references: []
    });
  });

  it('rejects an entire source-set marker when any requested set is missing', () => {
    expect(
      buildCavalryAssistantCitations({
        text: 'Vercel looks monthly. [[source-set:vercel-pattern|missing-pattern]]',
        toolResults: [
          successfulResult({
            evidenceSets: [
              {
                id: 'vercel-pattern',
                source_refs: ['transaction:vercel-apr'],
                records: [
                  {
                    id: 'vercel-apr',
                    description: 'Vercel',
                    date: '2026-04-03',
                    amount: 1276,
                    currency: 'PHP'
                  }
                ]
              }
            ]
          })
        ]
      })
    ).toEqual({
      text: "I couldn't verify “Vercel looks monthly” from the workbook.",
      references: []
    });
  });

  it('keeps fallback traceability for a distinct claim beside an explicit citation', () => {
    const citations = buildCavalryAssistantCitations({
      text: [
        'Coffee was recorded. [[source:transaction:txn-coffee]]',
        'Cash has a balance of ₱5,000.'
      ].join(' '),
      toolResults: [
        successfulResult({
          transaction: {
            id: 'txn-coffee',
            description: 'Coffee',
            date: '2026-07-11',
            amount: 200,
            currency: 'PHP'
          },
          account: { id: 'cash', name: 'Cash', balance: 5000, currency: 'PHP' }
        })
      ]
    });

    expect(citations.text).toBe(
      'Coffee was recorded. [source](#cavalry-source-1) Cash has a balance of ₱5,000.'
    );
    expect(citations.references).toEqual([
      expect.objectContaining({
        anchor: '#cavalry-source-1',
        source_refs: ['transaction:txn-coffee']
      }),
      expect.objectContaining({ source_refs: ['account:cash'] })
    ]);
  });

  it('does not let April and May records support a claim extending through June', () => {
    const citations = buildCavalryAssistantCitations({
      text: 'Vercel charges ran from April through June. [[source-set:vercel-pattern]]',
      toolResults: [
        successfulResult({
          evidenceSets: [
            {
              id: 'vercel-pattern',
              source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
              records: [
                { id: 'vercel-apr', description: 'Vercel', date: '2026-04-03' },
                { id: 'vercel-may', description: 'Vercel', date: '2026-05-03' }
              ],
              inference: {
                firstSeenDate: '2026-04-03',
                lastSeenDate: '2026-05-03'
              }
            }
          ]
        })
      ]
    });

    expect(citations).toEqual({
      text: "I couldn't verify “Vercel charges ran from April through June” from the workbook.",
      references: []
    });
  });

  it('requires a later observation date before supporting an absence after May', () => {
    const evidenceSet = (asOfDate) => ({
      id: 'vercel-pattern',
      source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
      records: [
        { id: 'vercel-apr', description: 'Vercel', date: '2026-04-03' },
        { id: 'vercel-may', description: 'Vercel', date: '2026-05-03' }
      ],
      inference: {
        firstSeenDate: '2026-04-03',
        lastSeenDate: '2026-05-03',
        asOfDate
      }
    });
    const text = 'No Vercel charge was found after May. [[source-set:vercel-pattern]]';
    const observedThroughJuly = buildCavalryAssistantCitations({
      text,
      toolResults: [successfulResult({ evidenceSets: [evidenceSet('2026-07-10')] })]
    });
    const observedOnlyThroughMay = buildCavalryAssistantCitations({
      text,
      toolResults: [successfulResult({ evidenceSets: [evidenceSet('2026-05-31')] })]
    });

    expect(observedThroughJuly.text).toBe(
      'No Vercel charge was found after May. [source](#cavalry-source-1)'
    );
    expect(observedThroughJuly.references).toHaveLength(1);
    expect(observedOnlyThroughMay).toEqual({
      text: "I couldn't verify “No Vercel charge was found after May” from the workbook.",
      references: []
    });
  });

  it('uses an exact date or unique amount to select one repeated-merchant transaction', () => {
    const toolResults = [
      successfulResult({
        transactions: [
          { id: 'coffee-one', description: 'Coffee', date: '2026-07-11', amount: 100 },
          { id: 'coffee-two', description: 'Coffee', date: '2026-07-12', amount: 125 }
        ]
      })
    ];

    expect(
      buildCavalryAssistantReferences({
        text: 'The Coffee transaction on 2026-07-12 was ₱125.',
        toolResults
      })
    ).toEqual([expect.objectContaining({ source_refs: ['transaction:coffee-two'] })]);
  });

  it('does not decorate an opinion-only merchant mention with a fallback source', () => {
    expect(
      buildCavalryAssistantReferences({
        text: "I'd keep Vercel.",
        toolResults: [
          successfulResult({
            transaction: {
              id: 'vercel-apr',
              description: 'Vercel',
              date: '2026-04-03',
              amount: 1276
            }
          })
        ]
      })
    ).toEqual([]);
  });
});
