import { describe, expect, it, vi } from 'vitest';

import {
  CAVALRY_ASSISTANT_TOOLS,
  executeCavalryAssistantTool,
  getCavalryAssistantToolDefinitions
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';
import {
  commitCommand,
  transactionArguments
} from '../../src/renderer/features/assistant/cavalry-assistant-tool-support.js';

function makeWorkbook() {
  return {
    id: 'assistant-tools-workbook',
    version: 2,
    name: 'Assistant Tools',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'opening-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      },
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'bank',
        name: 'Main Bank',
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        openedDate: '2026-01-01',
        note: 'Primary account',
        isActive: true
      },
      {
        id: 'card',
        name: 'Credit Card',
        group: 'liability',
        subtype: 'credit_card',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'salary-income',
        name: 'Salary Income',
        group: 'income',
        subtype: 'income',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'salary',
        name: 'Salary',
        type: 'income',
        currency: 'PHP',
        linkedAccountId: 'salary-income',
        isActive: true
      }
    ],
    counterparties: [{ id: 'market', name: 'Market', kind: 'merchant', isActive: true }],
    transactions: [
      {
        id: 'txn-groceries',
        date: '2026-07-01',
        monthKey: '2026-07',
        template: 'expense_paid',
        description: 'Groceries',
        categoryId: 'food',
        counterpartyId: 'market',
        originalCurrency: 'PHP',
        amount: 100,
        baseAmount: 100,
        source: 'manual',
        note: 'Weekly shop',
        lines: [
          {
            id: 'line-groceries-food',
            accountId: 'food-expense',
            direction: 'debit',
            amount: 100,
            currency: 'PHP',
            baseAmount: 100
          },
          {
            id: 'line-groceries-cash',
            accountId: 'cash',
            direction: 'credit',
            amount: 100,
            currency: 'PHP',
            baseAmount: 100
          }
        ]
      }
    ],
    recurringItems: [
      {
        id: 'internet',
        kind: 'bill',
        name: 'Internet',
        categoryId: 'food',
        accountId: 'bank',
        amount: 1500,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-07-15',
        autoRenew: false,
        isActive: true,
        note: ''
      }
    ],
    sheets: [
      {
        id: 'july',
        name: 'July',
        monthIndex: 6,
        budgets: [{ categoryId: 'food', planned: 5000 }],
        budgetLineItems: []
      }
    ],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

function makeInternetTransaction({
  id = 'txn-internet-existing',
  amount = 1500,
  baseAmount = amount,
  currency = 'PHP',
  description = 'Internet',
  date = '2026-07-15',
  recurringItemId = ''
} = {}) {
  return {
    id,
    date,
    monthKey: date.slice(0, 7),
    template: 'expense_paid',
    description,
    categoryId: 'food',
    counterpartyId: '',
    recurringItemId,
    originalCurrency: currency,
    amount,
    baseAmount,
    source: 'manual',
    note: '',
    lines: [
      {
        id: `line-${id}-food`,
        accountId: 'food-expense',
        direction: 'debit',
        amount,
        currency,
        baseAmount
      },
      {
        id: `line-${id}-bank`,
        accountId: 'bank',
        direction: 'credit',
        amount,
        currency,
        baseAmount
      }
    ]
  };
}

function makeHarness(initialWorkbook = makeWorkbook()) {
  let workbook = initialWorkbook;
  let sequence = 0;
  const commitCommandResult = vi.fn((result) => {
    workbook = result.workbook;
    return result;
  });
  const navigate = vi.fn();
  const saveWorkbook = vi.fn(() => ({ ok: true, savedAt: '2026-07-10T12:00:00.000Z' }));
  return {
    context: {
      getWorkbook: vi.fn(() => workbook),
      services: {
        createId(prefix = 'id') {
          sequence += 1;
          return `${prefix}_${sequence}`;
        },
        defaultDate: () => '2026-07-10',
        today: () => '2026-07-10',
        clock: {
          today: () => '2026-07-10',
          now: () => '2026-07-10T12:00:00.000Z'
        }
      },
      commitCommandResult,
      navigate,
      saveWorkbook
    },
    commitCommandResult,
    navigate,
    saveWorkbook,
    get workbook() {
      return workbook;
    }
  };
}

describe('Cavalry assistant tool catalog', () => {
  it('blocks a command result that would introduce a ledger invariant error', async () => {
    const workbook = makeWorkbook();
    const nextWorkbook = structuredClone(workbook);
    nextWorkbook.transactions.push({
      id: 'broken-journal',
      date: '2026-07-12',
      template: 'expense_paid',
      description: 'Broken journal',
      amount: 50,
      baseAmount: 50,
      lines: [
        {
          id: 'broken-line',
          accountId: 'cash',
          direction: 'credit',
          amount: 50,
          baseAmount: 50,
          currency: 'PHP'
        }
      ]
    });
    const commitCommandResult = vi.fn();

    const result = await commitCommand(
      {
        toolName: 'test_mutation',
        toolCallId: 'test-call',
        workbook,
        context: { commitCommandResult }
      },
      { ok: true, workbook: nextWorkbook, events: [], warnings: [], errors: [] },
      'test_mutation'
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'verification_failed',
      changed: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'transaction_too_few_lines' })
      ])
    });
    expect(commitCommandResult).not.toHaveBeenCalled();
  });

  it('pauses a currency-converting command until the user explicitly approves it', async () => {
    const workbook = makeWorkbook();
    const nextWorkbook = structuredClone(workbook);
    const commitCommandResult = vi.fn();
    const warning = {
      code: 'account_currency_conversion_confirmation_required',
      message: 'Cash is configured in USD, so PHP 20.00 would be converted before posting.'
    };

    const result = await commitCommand(
      {
        toolName: 'create_transaction',
        toolCallId: 'conversion-call',
        arguments: { allowCurrencyConversion: false },
        workbook,
        context: { commitCommandResult }
      },
      { ok: true, workbook: nextWorkbook, events: [], warnings: [warning], errors: [] },
      'assistant_transaction_created'
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      changed: false,
      errors: [
        expect.objectContaining({
          code: 'account_currency_conversion_confirmation_required',
          field: 'allowCurrencyConversion'
        })
      ],
      confirmation: {
        required: true,
        field: 'allowCurrencyConversion'
      }
    });
    expect(result.confirmation.message).toContain(warning.message);
    expect(commitCommandResult).not.toHaveBeenCalled();
  });

  it('propagates renderer-approved currency conversion into the transaction command payload', () => {
    const prepared = transactionArguments(
      makeWorkbook(),
      { amount: 20, allowCurrencyConversion: true },
      { currency: 'PHP' }
    );

    expect(prepared).toMatchObject({
      ok: true,
      payload: { amount: 20, currency: 'PHP', allowCurrencyConversion: true }
    });
  });

  it('preserves actionable account-currency repair details from validation failures', async () => {
    const workbook = makeWorkbook();
    const commitCommandResult = vi.fn();

    const result = await commitCommand(
      {
        toolName: 'create_transaction',
        toolCallId: 'inconsistent-account-call',
        arguments: {},
        workbook,
        context: { commitCommandResult }
      },
      {
        ok: false,
        workbook,
        events: [],
        warnings: [],
        errors: [
          {
            code: 'account_currency_repair_required',
            field: 'primaryAccountId',
            message: 'Repair this account currency before posting another transaction to it.',
            accountId: 'cash',
            accountName: 'Cash',
            configuredCurrency: 'USD',
            postingCurrencies: ['PHP', 'USD'],
            affectedTransactionIds: ['cash-opening', 'found-cash']
          }
        ]
      },
      'assistant_transaction_created'
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'validation_failed',
      errors: [
        {
          code: 'account_currency_repair_required',
          field: 'primaryAccountId',
          accountId: 'cash',
          accountName: 'Cash',
          configuredCurrency: 'USD',
          postingCurrencies: ['PHP', 'USD'],
          affectedTransactionIds: ['cash-opening', 'found-cash'],
          message: 'Repair this account currency before posting another transaction to it.'
        }
      ]
    });
    expect(result).not.toHaveProperty('confirmation');
    expect(commitCommandResult).not.toHaveBeenCalled();
  });

  it('exports Responses-style function definitions, including explicit confirmations', () => {
    const definitions = getCavalryAssistantToolDefinitions();
    const names = definitions.map((definition) => definition.name);

    expect(definitions).toEqual(CAVALRY_ASSISTANT_TOOLS);
    expect(names).toEqual(
      expect.arrayContaining([
        'read_workspace_context',
        'read_workspace_summary',
        'search_transactions',
        'list_accounts',
        'list_categories',
        'read_budgets',
        'list_recurring_bills',
        'analyze_recurring_expenses',
        'list_counterparties',
        'create_transaction',
        'update_transaction',
        'delete_transaction',
        'create_account',
        'update_account',
        'update_category',
        'auto_assign_category_icons',
        'set_budget',
        'create_bill',
        'pay_bill',
        'create_counterparty',
        'set_exchange_rate',
        'navigate_app',
        'save_workbook'
      ])
    );
    definitions.forEach((definition) => {
      expect(definition).toMatchObject({
        type: 'function',
        strict: false,
        parameters: { type: 'object', additionalProperties: false }
      });
    });
    const destructive = definitions.find((definition) => definition.name === 'delete_transaction');
    expect(destructive.description).toMatch(/confirmation is required/i);
    expect(destructive.parameters.properties.confirmed.description).toMatch(
      /user explicitly confirms/i
    );
    const navigation = definitions.find((definition) => definition.name === 'navigate_app');
    expect(navigation.parameters.properties.routeId.enum).not.toContain('advisor');
    expect(navigation.parameters.properties.routeId.enum).not.toContain('ai-drafts');
    const categoryUpdate = definitions.find((definition) => definition.name === 'update_category');
    expect(categoryUpdate.parameters.properties.icon.enum).toEqual(
      expect.arrayContaining(['shopping_cart', 'restaurant', 'payments'])
    );
    const accountUpdate = definitions.find((definition) => definition.name === 'update_account');
    expect(accountUpdate.parameters.properties).toHaveProperty('institution');
    expect(accountUpdate.parameters.properties).not.toHaveProperty('openingBalance');
    const createBill = definitions.find((definition) => definition.name === 'create_bill');
    expect(createBill.parameters.required).toEqual(
      expect.arrayContaining(['name', 'category', 'dueDate'])
    );
    expect(createBill.parameters.properties.dueDate.description).toMatch(
      /schedule anchor.*not necessarily the next expected occurrence/i
    );
    const transactionCreate = definitions.find(
      (definition) => definition.name === 'create_transaction'
    );
    expect(transactionCreate.parameters.properties.allowCurrencyConversion.description).toMatch(
      /user explicitly confirms/i
    );
  });
});

describe('Cavalry assistant reads', () => {
  it('reads fresh workspace, transaction, account, category, budget, and recurring projections', async () => {
    const harness = makeHarness();
    const calls = [
      ['read_workspace_context', { transactionLimit: 100 }],
      ['read_workspace_summary', { start: '2026-07-01', end: '2026-07-31' }],
      ['search_transactions', { query: 'groceries', account: 'CASH' }],
      ['list_accounts', {}],
      ['list_categories', {}],
      ['read_budgets', { sheet: 'jULy' }],
      ['list_recurring_bills', {}],
      ['analyze_recurring_expenses', {}],
      ['list_counterparties', {}]
    ];
    const results = [];
    for (const [name, argumentsValue] of calls) {
      results.push(
        await executeCavalryAssistantTool(
          { type: 'function_call', name, arguments: JSON.stringify(argumentsValue) },
          harness.context
        )
      );
    }

    expect(results.every((result) => result.ok && result.changed === false)).toBe(true);
    expect(results[0].data).toMatchObject({
      workbook: { id: 'assistant-tools-workbook', currency: 'PHP' },
      safeSettings: { usdToBaseRate: 58 },
      counts: { transactions: 1, accounts: 6, categories: 2, counterparties: 1 },
      transactionPagination: { total: 1, returned: 1, hasMore: false }
    });
    expect(results[0].data.transactions[0].lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: 'cash', accountName: 'Cash' })])
    );
    expect(results[1].data).toMatchObject({
      workbook: { id: 'assistant-tools-workbook', currency: 'PHP' },
      cashFlow: { expense: 100 },
      counts: { transactions: 1, accounts: 6, categories: 2, recurringItems: 1 },
      evidenceSetIds: {
        cashFlow: expect.stringMatching(/^cash-flow-/),
        position: expect.stringMatching(/^financial-position-/)
      }
    });
    expect(results[1].data.evidenceSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'transaction',
          calculation: expect.objectContaining({ operation: 'cash_flow_summary' })
        }),
        expect.objectContaining({
          kind: 'account',
          calculation: expect.objectContaining({ operation: 'asset_liability_summary' })
        })
      ])
    );
    expect(results[1].data.evidenceSets.every((evidenceSet) => !evidenceSet.source_refs)).toBe(
      true
    );
    expect(results[1].referenceData.evidenceSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'transaction',
          source_refs: ['transaction:txn-groceries']
        }),
        expect.objectContaining({
          kind: 'account',
          source_refs: expect.arrayContaining(['account:cash', 'account:bank', 'account:card'])
        })
      ])
    );
    expect(results[2].data.transactions).toEqual([
      expect.objectContaining({ id: 'txn-groceries', accountId: 'cash', categoryId: 'food' })
    ]);
    expect(results[2].data.evidenceSets).toEqual([
      expect.objectContaining({
        kind: 'transaction',
        calculation: expect.objectContaining({
          operation: 'filtered_transaction_totals',
          transactionCount: 1
        })
      })
    ]);
    expect(results[2].referenceData.evidenceSets).toEqual([
      expect.objectContaining({
        kind: 'transaction',
        source_refs: ['transaction:txn-groceries']
      })
    ]);
    expect(results[3].data.accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'cash', transactionCount: 1 })])
    );
    expect(results[4].data.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'food', icon: '', transactionCount: 1 })
      ])
    );
    expect(results[5].data.budgets[0]).toMatchObject({
      sheet: { id: 'july' },
      rows: expect.arrayContaining([expect.objectContaining({ categoryId: 'food', planned: 5000 })])
    });
    expect(results[6].data.recurringItems).toEqual([
      expect.objectContaining({
        id: 'internet',
        name: 'Internet',
        anchorDate: '2026-07-15',
        currentOccurrenceDate: '',
        nextExpectedDate: '2026-07-15',
        note: '',
        autoRenew: false
      })
    ]);
    expect(results[6].data.asOfDate).toBe('2026-07-10');
    expect(results[7].data.recurringItems).toEqual([
      expect.objectContaining({
        id: 'internet',
        trackerStatus: 'active',
        activityStatus: 'no_charge_evidence',
        evidenceStatus: 'active_tracker_no_linked_charge'
      })
    ]);
    expect(results[7].data).toMatchObject({
      asOfDate: '2026-07-10',
      counts: {
        activeTrackers: 1,
        inactiveTrackers: 0,
        confirmedLinkedCharges: 0,
        byEvidenceStatus: { active_tracker_no_linked_charge: 1 }
      }
    });
    expect(results[8].data.counterparties).toEqual([
      expect.objectContaining({ id: 'market', transactionCount: 1 })
    ]);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();
    results.forEach((result) => expect(result).not.toHaveProperty('workbook'));
  });

  it('keeps full evidence private while bounding record previews to the requested page', async () => {
    const workbook = makeWorkbook();
    workbook.transactions = Array.from({ length: 75 }, (_, index) =>
      makeInternetTransaction({
        id: `batch-${index + 1}`,
        description: 'Batch expense',
        amount: index + 1,
        date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`
      })
    );
    const harness = makeHarness(workbook);

    const search = await executeCavalryAssistantTool(
      {
        id: 'bounded-search',
        name: 'search_transactions',
        arguments: { query: 'Batch', limit: 5 }
      },
      harness.context
    );
    const summary = await executeCavalryAssistantTool(
      {
        id: 'bounded-summary',
        name: 'read_workspace_summary',
        arguments: { start: '2026-07-01', end: '2026-07-31' }
      },
      harness.context
    );

    expect(search.data.transactions).toHaveLength(5);
    expect(search.data.evidenceSets[0]).not.toHaveProperty('source_refs');
    expect(search.data.evidenceSets[0]).not.toHaveProperty('records');
    expect(search.referenceData.evidenceSets[0].source_refs).toHaveLength(75);
    expect(search.referenceData.evidenceSets[0]).not.toHaveProperty('records');
    expect(search.data.evidenceSets[0].calculation).toMatchObject({
      transactionCount: 75,
      recordPreviewCount: 5,
      recordPreviewOmitted: 70
    });

    const cashFlowMetadata = summary.data.evidenceSets.find(
      (evidenceSet) => evidenceSet.kind === 'transaction'
    );
    const cashFlowEvidence = summary.referenceData.evidenceSets.find(
      (evidenceSet) => evidenceSet.kind === 'transaction'
    );
    expect(cashFlowMetadata).not.toHaveProperty('source_refs');
    expect(cashFlowMetadata).not.toHaveProperty('records');
    expect(cashFlowEvidence.source_refs).toHaveLength(75);
    expect(cashFlowEvidence.records).toHaveLength(50);
    expect(cashFlowMetadata.calculation).toMatchObject({
      transactionCount: 75,
      recordPreviewCount: 50,
      recordPreviewOmitted: 25
    });
  });

  it('classifies recurring evidence and returns exact source sets for each pattern', async () => {
    const workbook = makeWorkbook();
    workbook.recurringItems.push({
      ...workbook.recurringItems[0],
      id: 'old-hosting',
      name: 'Old Hosting',
      isActive: false
    });
    workbook.transactions = [
      makeInternetTransaction({
        id: 'chatgpt-apr',
        description: 'ChatGPT Subscription',
        amount: 6490,
        date: '2026-04-05'
      }),
      makeInternetTransaction({
        id: 'chatgpt-may',
        description: 'ChatGPT Subscription',
        amount: 6490,
        date: '2026-05-05'
      }),
      makeInternetTransaction({
        id: 'vercel-apr',
        description: 'Vercel',
        amount: 1276,
        date: '2026-04-08'
      }),
      makeInternetTransaction({
        id: 'vercel-may',
        description: 'Vercel',
        amount: 1276,
        date: '2026-05-08'
      }),
      makeInternetTransaction({
        id: 'globe-apr',
        description: 'Globe Load',
        amount: 200,
        date: '2026-04-12'
      }),
      makeInternetTransaction({
        id: 'globe-may',
        description: 'Globe Load',
        amount: 1200,
        date: '2026-05-12'
      })
    ];
    const harness = makeHarness(workbook);

    const result = await executeCavalryAssistantTool(
      { id: 'recurring-audit', name: 'analyze_recurring_expenses', arguments: {} },
      harness.context
    );

    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.data.recurringItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'internet',
          trackerStatus: 'active',
          evidenceStatus: 'active_tracker_no_linked_charge'
        }),
        expect.objectContaining({
          id: 'old-hosting',
          trackerStatus: 'inactive',
          evidenceStatus: 'inactive_tracker'
        })
      ])
    );
    expect(result.data.recurringCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ChatGPT Subscription',
          evidenceStatus: 'likely_recurring',
          source_refs: ['transaction:chatgpt-apr', 'transaction:chatgpt-may']
        }),
        expect.objectContaining({
          name: 'Vercel',
          evidenceStatus: 'likely_recurring',
          activityStatus: 'stale_charge_evidence',
          daysSinceLastSeen: 63,
          source_refs: ['transaction:vercel-apr', 'transaction:vercel-may']
        }),
        expect.objectContaining({
          name: 'Globe Load',
          evidenceStatus: 'variable_expense',
          amountRange: { minimum: 200, maximum: 1200 },
          source_refs: ['transaction:globe-apr', 'transaction:globe-may']
        })
      ])
    );
    expect(result.data.evidenceSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Vercel recurring-pattern evidence',
          source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
          inference: expect.objectContaining({
            evidenceStatus: 'likely_recurring',
            activityStatus: 'stale_charge_evidence',
            firstSeenDate: '2026-04-08',
            lastSeenDate: '2026-05-08'
          })
        })
      ])
    );
    expect(result.data.counts).toMatchObject({
      activeTrackers: 1,
      inactiveTrackers: 1,
      confirmedLinkedCharges: 0,
      likelyRecurring: 2,
      uncertainRecurring: 0,
      variableExpenses: 1,
      nonRecurring: 0,
      staleCandidateEvidence: 2,
      byEvidenceStatus: {
        active_tracker_no_linked_charge: 1,
        inactive_tracker: 1,
        likely_recurring: 2,
        variable_expense: 1
      }
    });
  });

  it('keeps tracker currency and charge recency separate from tracker status', async () => {
    const workbook = makeWorkbook();
    workbook.recurringItems[0] = {
      ...workbook.recurringItems[0],
      amount: 20,
      currency: 'USD'
    };
    workbook.transactions = [
      makeInternetTransaction({
        id: 'internet-june',
        amount: 20,
        baseAmount: 1160,
        currency: 'USD',
        date: '2026-06-15',
        recurringItemId: 'internet'
      })
    ];
    const harness = makeHarness(workbook);

    const result = await executeCavalryAssistantTool(
      { id: 'recurring-currency', name: 'analyze_recurring_expenses', arguments: {} },
      harness.context
    );

    expect(result.data.recurringItems).toEqual([
      expect.objectContaining({
        id: 'internet',
        amount: 20,
        currency: 'USD',
        nativeAmount: 20,
        nativeCurrency: 'USD',
        baseAmount: 1160,
        baseCurrency: 'PHP',
        baseAmountVerified: true,
        baseConversionStatus: 'converted',
        trackerStatus: 'active',
        activityStatus: 'recent_charge_evidence',
        daysSinceLastSeen: 25,
        evidenceStatus: 'active_tracker_recent_charge'
      })
    ]);
    expect(result.data.recurringCandidates).toEqual([
      expect.objectContaining({
        name: 'Internet',
        evidenceStatus: 'confirmed_linked_charges',
        activityStatus: 'recent_charge_evidence',
        source_refs: ['transaction:internet-june']
      })
    ]);
    expect(result.data.counts).toMatchObject({
      activeTrackers: 1,
      confirmedLinkedCharges: 1,
      byEvidenceStatus: {
        active_tracker_recent_charge: 1,
        confirmed_linked_charges: 1
      }
    });
  });

  it('labels linked charges without implying that an inactive tracker is an active service', async () => {
    const workbook = makeWorkbook();
    workbook.recurringItems[0].isActive = false;
    workbook.transactions = [
      makeInternetTransaction({
        id: 'internet-linked-after-disable',
        date: '2026-06-15',
        recurringItemId: 'internet'
      })
    ];
    const harness = makeHarness(workbook);

    const result = await executeCavalryAssistantTool(
      { id: 'recurring-inactive-link', name: 'analyze_recurring_expenses', arguments: {} },
      harness.context
    );

    expect(result.data.recurringItems).toEqual([
      expect.objectContaining({
        id: 'internet',
        trackerStatus: 'inactive',
        evidenceStatus: 'inactive_tracker'
      })
    ]);
    expect(result.data.recurringCandidates).toEqual([
      expect.objectContaining({
        evidenceStatus: 'confirmed_linked_charges',
        linkedTrackerStatus: 'inactive'
      })
    ]);
  });

  it('reports user-confirmed non-recurring decisions separately from variable expenses', async () => {
    const workbook = makeWorkbook();
    workbook.transactions = [
      makeInternetTransaction({ id: 'vercel-apr', description: 'Vercel', date: '2026-04-08' }),
      makeInternetTransaction({ id: 'vercel-may', description: 'Vercel', date: '2026-05-08' })
    ];
    const harness = makeHarness(workbook);
    const first = await executeCavalryAssistantTool(
      { id: 'recurring-first', name: 'analyze_recurring_expenses', arguments: {} },
      harness.context
    );
    const decisionKey = first.data.recurringCandidates[0].decisionKey;
    workbook.settings.subscriptionReviewDecisions = {
      [decisionKey]: { decision: 'not_subscription' }
    };

    const result = await executeCavalryAssistantTool(
      {
        id: 'recurring-decided',
        name: 'analyze_recurring_expenses',
        arguments: { includeIgnored: true }
      },
      harness.context
    );

    expect(result.data.recurringCandidates).toEqual([
      expect.objectContaining({
        name: 'Vercel',
        decision: 'not_subscription',
        evidenceStatus: 'non_recurring'
      })
    ]);
    expect(result.data.counts).toMatchObject({
      variableExpenses: 0,
      nonRecurring: 1,
      byEvidenceStatus: { non_recurring: 1 }
    });
  });

  it('reports native account currencies while valuing net worth in workbook currency', async () => {
    const workbook = makeWorkbook();
    workbook.settings.usdToBaseRate = 61.75;
    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';
    workbook.accounts.push({
      id: 'usd-account',
      name: 'USD Account',
      group: 'asset',
      subtype: 'bank',
      currency: 'USD',
      isActive: true
    });
    workbook.transactions = [
      {
        id: 'cash-opening',
        date: '2026-07-01',
        template: 'opening_balance',
        description: 'Cash opening',
        amount: 112,
        baseAmount: 112,
        lines: [
          {
            accountId: 'cash',
            direction: 'debit',
            amount: 112,
            baseAmount: 112,
            currency: 'PHP'
          },
          {
            accountId: 'opening-equity',
            direction: 'credit',
            amount: 112,
            baseAmount: 112,
            currency: 'PHP'
          }
        ]
      },
      {
        id: 'usd-opening',
        date: '2026-07-01',
        template: 'opening_balance',
        description: 'USD opening',
        amount: 252.15,
        baseAmount: 252.15,
        lines: [
          {
            accountId: 'usd-account',
            direction: 'debit',
            amount: 252.15,
            baseAmount: 252.15,
            currency: 'USD'
          },
          {
            accountId: 'opening-equity',
            direction: 'credit',
            amount: 252.15,
            baseAmount: 252.15,
            currency: 'USD'
          }
        ]
      }
    ];
    const harness = makeHarness(workbook);

    const accounts = await executeCavalryAssistantTool(
      { name: 'list_accounts', arguments: { asOfDate: '2026-07-12' } },
      harness.context
    );
    const summary = await executeCavalryAssistantTool(
      { name: 'read_workspace_summary', arguments: { end: '2026-07-12' } },
      harness.context
    );

    expect(accounts.data.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cash',
          currency: 'PHP',
          configuredCurrency: 'USD',
          balance: 112,
          baseBalance: 112,
          baseCurrency: 'PHP',
          currencyMismatch: true
        }),
        expect.objectContaining({
          id: 'usd-account',
          currency: 'USD',
          configuredCurrency: 'USD',
          balance: 252.15,
          baseBalance: 15570.26,
          baseCurrency: 'PHP',
          currencyMismatch: false
        })
      ])
    );
    expect(summary.data.position).toEqual({
      assets: 15682.26,
      liabilities: 0,
      netWorth: 15682.26,
      currency: 'PHP'
    });
  });

  it('paginates every transaction without truncating large workbooks', async () => {
    const workbook = makeWorkbook();
    const template = workbook.transactions[0];
    workbook.transactions = Array.from({ length: 205 }, (_item, index) => ({
      ...structuredClone(template),
      id: `txn-${String(index + 1).padStart(3, '0')}`,
      date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
      description: `Transaction ${index + 1}`
    }));
    const harness = makeHarness(workbook);

    const searchPage = await executeCavalryAssistantTool(
      {
        name: 'search_transactions',
        arguments: { page: 3, limit: 100, sortDirection: 'asc' }
      },
      harness.context
    );
    const contextPage = await executeCavalryAssistantTool(
      {
        name: 'read_workspace_context',
        arguments: { transactionPage: 2, transactionLimit: 200 }
      },
      harness.context
    );

    expect(searchPage.data).toMatchObject({
      page: 3,
      pageSize: 100,
      total: 205,
      totalPages: 3,
      returned: 5,
      hasMore: false,
      nextPage: null
    });
    expect(contextPage.data.transactionPagination).toMatchObject({
      page: 2,
      total: 205,
      returned: 5,
      hasMore: false
    });
    expect(new Set(contextPage.data.transactions.map((transaction) => transaction.id)).size).toBe(
      5
    );
  });
});

describe('Cavalry assistant mutations', () => {
  it('requires host approval before posting a transaction across account currencies', async () => {
    const workbook = makeWorkbook();
    workbook.accounts.push({
      id: 'usd-wallet',
      name: 'USD Wallet',
      group: 'asset',
      subtype: 'wallet',
      currency: 'USD',
      openedDate: '2026-01-01',
      isActive: true
    });
    const harness = makeHarness(workbook);
    const transactionArgumentsValue = {
      template: 'income_received',
      amount: 20,
      currency: 'PHP',
      fxRateToBase: 58,
      date: '2026-07-15',
      description: 'Found cash',
      category: 'Salary',
      primaryAccount: 'USD Wallet'
    };

    const blocked = await executeCavalryAssistantTool(
      {
        id: 'found-cash-conversion',
        name: 'create_transaction',
        arguments: transactionArgumentsValue
      },
      harness.context
    );

    expect(blocked).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      changed: false,
      confirmation: { required: true, field: 'allowCurrencyConversion' },
      warnings: [
        expect.objectContaining({
          code: 'account_currency_conversion_confirmation_required',
          transactionCurrency: 'PHP',
          accounts: [expect.objectContaining({ accountName: 'USD Wallet', accountCurrency: 'USD' })]
        })
      ]
    });
    expect(blocked.confirmation.message).toContain('USD Wallet (USD)');
    expect(harness.workbook.transactions).toHaveLength(1);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();

    const approved = await executeCavalryAssistantTool(
      {
        id: 'found-cash-conversion',
        name: 'create_transaction',
        arguments: { ...transactionArgumentsValue, allowCurrencyConversion: true }
      },
      harness.context
    );

    expect(approved).toMatchObject({ ok: true, changed: true });
    expect(harness.workbook.transactions).toHaveLength(2);
    expect(harness.commitCommandResult).toHaveBeenCalledTimes(1);
  });

  it('creates then partially updates a transaction using case-insensitive names and fresh state', async () => {
    const harness = makeHarness();
    const created = await executeCavalryAssistantTool(
      {
        id: 'call_create_lunch',
        name: 'create_transaction',
        arguments: {
          template: 'expense_paid',
          amount: 75,
          currency: 'PHP',
          date: '2026-07-02',
          description: 'Lunch',
          category: 'fOoD',
          primaryAccount: 'cAsH'
        }
      },
      harness.context
    );
    const createdTransaction = harness.workbook.transactions.find(
      (transaction) => transaction.description === 'Lunch'
    );
    const updated = await executeCavalryAssistantTool(
      {
        name: 'update_transaction',
        arguments: { transaction: 'lUnCh', description: 'Team Lunch' }
      },
      harness.context
    );
    const updatedTransaction = harness.workbook.transactions.find(
      (transaction) => transaction.description === 'Team Lunch'
    );

    expect(created).toMatchObject({
      ok: true,
      changed: true,
      data: { transaction: { description: 'Lunch', categoryId: 'food' } }
    });
    expect(createdTransaction.lines.some((line) => line.accountId === 'cash')).toBe(true);
    expect(createdTransaction).toMatchObject({
      source: 'advisor',
      reference: 'advisor:companion:call_create_lunch'
    });
    expect(updated).toMatchObject({
      ok: true,
      changed: true,
      data: { transaction: { description: 'Team Lunch', amount: 75, categoryId: 'food' } }
    });
    expect(updatedTransaction.id).toBe(createdTransaction.id);
    expect(updatedTransaction.lines).toEqual(createdTransaction.lines);
    expect(harness.context.getWorkbook).toHaveBeenCalledTimes(2);
    expect(harness.commitCommandResult).toHaveBeenCalledTimes(2);
    expect(harness.commitCommandResult.mock.calls[0][1]).toEqual({
      reason: 'assistant_transaction_created'
    });
  });

  it('resolves an account by name and preserves unspecified fields during partial update', async () => {
    const harness = makeHarness();
    const result = await executeCavalryAssistantTool(
      {
        name: 'update_account',
        arguments: {
          account: 'MAIN BANK',
          name: 'Household Bank',
          institution: 'Cavalry Bank'
        }
      },
      harness.context
    );
    const account = harness.workbook.accounts.find((item) => item.id === 'bank');

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      data: { account: { id: 'bank', name: 'Household Bank', subtype: 'bank' } }
    });
    expect(account).toMatchObject({
      currency: 'PHP',
      openedDate: '2026-01-01',
      institution: 'Cavalry Bank',
      note: 'Primary account'
    });
  });

  it('updates category appearance and auto-matches every category in one commit', async () => {
    const workbook = makeWorkbook();
    workbook.categories.push(
      {
        id: 'telecom',
        name: 'Telecommunications',
        type: 'expense',
        currency: 'PHP',
        icon: 'pets',
        isActive: true
      },
      {
        id: 'personal-care',
        name: 'Personal Care',
        type: 'expense',
        currency: 'PHP',
        icon: 'directions_car',
        isActive: true
      }
    );
    const harness = makeHarness(workbook);
    const updated = await executeCavalryAssistantTool(
      {
        name: 'update_category',
        arguments: {
          category: 'Food',
          icon: 'shopping_cart',
          color: '#5ba1df',
          description: 'Groceries and meals'
        }
      },
      harness.context
    );
    const matched = await executeCavalryAssistantTool(
      {
        name: 'auto_assign_category_icons',
        arguments: { scope: 'all' }
      },
      harness.context
    );

    expect(updated).toMatchObject({
      ok: true,
      changed: true,
      data: {
        requestedIcon: 'shopping_cart',
        iconVerified: true,
        category: {
          id: 'food',
          icon: 'shopping_cart',
          color: '#5ba1df',
          description: 'Groceries and meals'
        }
      }
    });
    expect(matched).toMatchObject({
      ok: true,
      changed: true,
      data: {
        scope: 'all',
        updatedCount: 4,
        verifiedCount: 4,
        updates: expect.arrayContaining([
          expect.objectContaining({
            categoryId: 'telecom',
            previousIcon: 'pets',
            requestedIcon: 'phone_iphone',
            icon: 'phone_iphone',
            verified: true
          }),
          expect.objectContaining({
            categoryId: 'personal-care',
            previousIcon: 'directions_car',
            requestedIcon: 'favorite',
            icon: 'favorite',
            verified: true
          })
        ])
      }
    });
    expect(harness.workbook.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'food', icon: 'restaurant' }),
        expect.objectContaining({ id: 'salary', icon: 'payments' }),
        expect.objectContaining({ id: 'telecom', icon: 'phone_iphone' }),
        expect.objectContaining({ id: 'personal-care', icon: 'favorite' })
      ])
    );
    expect(harness.commitCommandResult).toHaveBeenCalledTimes(2);
  });

  it('rejects icon IDs outside the catalog without committing them', async () => {
    const harness = makeHarness();
    const result = await executeCavalryAssistantTool(
      {
        name: 'update_category',
        arguments: { category: 'Food', icon: 'paw' }
      },
      harness.context
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'validation_failed',
      changed: false,
      errors: [expect.objectContaining({ code: 'category.icon_invalid', field: 'icon' })]
    });
    expect(harness.workbook.categories.find((category) => category.id === 'food').icon).toBe(
      undefined
    );
    expect(harness.commitCommandResult).not.toHaveBeenCalled();
  });

  it('reports the actual persisted icon when post-commit read-back differs', async () => {
    let persistedWorkbook = makeWorkbook();
    const context = {
      getWorkbook: vi.fn(() => persistedWorkbook),
      services: {},
      commitCommandResult: vi.fn((result) => {
        persistedWorkbook = structuredClone(result.workbook);
        persistedWorkbook.categories.find((category) => category.id === 'food').icon = 'restaurant';
        return result;
      })
    };

    const result = await executeCavalryAssistantTool(
      {
        name: 'update_category',
        arguments: { category: 'Food', icon: 'shopping_cart' }
      },
      context
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'verification_failed',
      changed: true,
      data: {
        requestedIcon: 'shopping_cart',
        iconVerified: false,
        category: { id: 'food', icon: 'restaurant' }
      },
      errors: [expect.objectContaining({ code: 'category_icon_verification_failed' })]
    });
  });

  it('keeps bulk icon assignment atomic and identifies a category that cannot be updated', async () => {
    const workbook = makeWorkbook();
    workbook.categories.push({
      name: 'Telecommunications',
      type: 'expense',
      currency: 'PHP',
      icon: 'pets',
      isActive: true
    });
    const harness = makeHarness(workbook);

    const result = await executeCavalryAssistantTool(
      {
        name: 'auto_assign_category_icons',
        arguments: { scope: 'all' }
      },
      harness.context
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'validation_failed',
      changed: false,
      errors: [expect.objectContaining({ code: 'category_icon_assignment_failed', field: 'icon' })]
    });
    expect(result.errors[0].message).toContain('Telecommunications');
    expect(result.errors[0].message).toContain('phone_iphone');
    expect(harness.workbook.categories.find((category) => category.id === 'food').icon).toBe(
      undefined
    );
    expect(harness.commitCommandResult).not.toHaveBeenCalled();
  });

  it('saves budgets with required metadata and can create a missing month', async () => {
    const harness = makeHarness();
    const existing = await executeCavalryAssistantTool(
      {
        name: 'set_budget',
        arguments: { sheet: 'July', category: 'Food', planned: 6000 }
      },
      harness.context
    );
    const created = await executeCavalryAssistantTool(
      {
        name: 'set_budget',
        arguments: { month: '2026-08', category: 'Food', planned: 7000 }
      },
      harness.context
    );

    expect(existing).toMatchObject({
      ok: true,
      changed: true,
      data: { budget: { sheetId: 'july', categoryId: 'food', planned: 6000 } }
    });
    expect(harness.workbook.sheets.find((sheet) => sheet.id === 'july').budgets[0]).toMatchObject({
      planned: 6000,
      createdAt: '2026-07-10'
    });
    expect(created).toMatchObject({
      ok: true,
      changed: true,
      data: { budget: { categoryId: 'food', planned: 7000 } }
    });
    const august = harness.workbook.sheets.find((sheet) => sheet.monthIndex === 7);
    expect(august).toMatchObject({ monthKey: '2026-08' });
    expect(august.budgets[0]).toMatchObject({
      categoryId: 'food',
      planned: 7000,
      createdAt: '2026-07-10'
    });
  });

  it('requires explicit confirmation before destructive commands and commits only after retry', async () => {
    const harness = makeHarness();
    const blocked = await executeCavalryAssistantTool(
      { name: 'delete_transaction', arguments: { transaction: 'GROCERIES' } },
      harness.context
    );

    expect(blocked).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      changed: false,
      confirmation: { required: true, field: 'confirmed' }
    });
    expect(harness.workbook.transactions).toHaveLength(1);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();

    const deleted = await executeCavalryAssistantTool(
      {
        name: 'delete_transaction',
        arguments: { transaction: 'GROCERIES', confirmed: true }
      },
      harness.context
    );
    expect(deleted).toMatchObject({ ok: true, status: 'completed', changed: true });
    expect(harness.workbook.transactions).toHaveLength(0);
    expect(harness.commitCommandResult).toHaveBeenCalledTimes(1);
  });

  it('records a bill payment against the nearest occurrence and reuses it on retry', async () => {
    const harness = makeHarness();
    const paid = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { bill: 'INTERNET', date: '2026-07-10' }
      },
      harness.context
    );
    const transaction = harness.workbook.transactions.find(
      (item) => item.recurringItemId === 'internet'
    );

    expect(paid).toMatchObject({
      ok: true,
      changed: true,
      data: {
        recurringItem: { id: 'internet', name: 'Internet' },
        transaction: {
          date: '2026-07-10',
          description: 'Internet',
          amount: 1500,
          categoryId: 'food',
          recurringItemId: 'internet',
          recurringOccurrenceDate: '2026-07-15'
        },
        occurrenceDate: '2026-07-15'
      }
    });
    expect(transaction).toMatchObject({
      template: 'expense_paid',
      categoryId: 'food',
      recurringItemId: 'internet',
      recurringOccurrenceDate: '2026-07-15'
    });
    expect(harness.workbook.recurringReconciliations).toEqual([
      expect.objectContaining({
        recurringItemId: 'internet',
        occurrenceDate: '2026-07-15',
        transactionId: transaction.id,
        decision: 'matched',
        method: 'explicit'
      })
    ]);
    expect(transaction.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: 'bank', direction: 'credit' })])
    );
    expect(harness.commitCommandResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      { reason: 'assistant_bill_paid' }
    );

    const duplicate = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { recurringItemId: 'internet', date: '2026-07-10' }
      },
      harness.context
    );
    expect(duplicate).toMatchObject({
      ok: true,
      status: 'completed',
      changed: false,
      data: {
        alreadyRecorded: true,
        occurrenceDate: '2026-07-15',
        transaction: { id: transaction.id }
      }
    });
    expect(harness.commitCommandResult).toHaveBeenCalledTimes(1);
  });

  it('links a payment to the nearest weekly occurrence across a month boundary', async () => {
    const workbook = makeWorkbook();
    workbook.recurringItems[0] = {
      ...workbook.recurringItems[0],
      frequency: 'Weekly',
      anchorDate: '2026-06-30'
    };
    const harness = makeHarness(workbook);

    const paid = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { bill: 'Internet', date: '2026-07-01' }
      },
      harness.context
    );
    const transaction = harness.workbook.transactions.find(
      (item) => item.recurringItemId === 'internet'
    );

    expect(paid).toMatchObject({
      ok: true,
      changed: true,
      data: { occurrenceDate: '2026-06-30' }
    });
    expect(transaction).toMatchObject({
      date: '2026-07-01',
      recurringOccurrenceDate: '2026-06-30'
    });
    expect(harness.workbook.recurringReconciliations).toEqual([
      expect.objectContaining({
        recurringItemId: 'internet',
        occurrenceDate: '2026-06-30',
        transactionId: transaction.id
      })
    ]);
  });

  it('reconciles an existing high-confidence ledger match instead of posting it twice', async () => {
    const workbook = makeWorkbook();
    workbook.transactions.push(makeInternetTransaction());
    const harness = makeHarness(workbook);

    const paid = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { bill: 'Internet', date: '2026-07-15' }
      },
      harness.context
    );

    expect(paid).toMatchObject({
      ok: true,
      changed: true,
      data: {
        alreadyRecorded: true,
        occurrenceDate: '2026-07-15',
        transaction: { id: 'txn-internet-existing' },
        reconciliation: { decision: 'matched', method: 'automatic', confidence: 100 }
      }
    });
    expect(harness.workbook.transactions).toHaveLength(2);
    expect(harness.workbook.recurringReconciliations).toEqual([
      expect.objectContaining({
        recurringItemId: 'internet',
        occurrenceDate: '2026-07-15',
        transactionId: 'txn-internet-existing',
        method: 'automatic',
        confidence: 100
      })
    ]);
    expect(harness.commitCommandResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      { reason: 'assistant_bill_reconciled' }
    );
  });

  it('pauses before posting when an occurrence has a review candidate', async () => {
    const workbook = makeWorkbook();
    workbook.transactions.push(
      makeInternetTransaction({ id: 'txn-possible-internet', description: 'ISP card charge' })
    );
    const harness = makeHarness(workbook);

    const paid = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { bill: 'Internet', date: '2026-07-15' }
      },
      harness.context
    );

    expect(paid).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      changed: false,
      confirmation: { required: true, field: 'allowDuplicate' },
      data: {
        occurrenceDate: '2026-07-15',
        candidateTransaction: { id: 'txn-possible-internet' },
        reconciliation: { decision: 'review' }
      }
    });
    expect(harness.workbook.transactions).toHaveLength(2);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();
  });

  it('does not auto-claim a transaction that is ambiguous between weekly occurrences', async () => {
    const workbook = makeWorkbook();
    workbook.recurringItems[0] = {
      ...workbook.recurringItems[0],
      frequency: 'Weekly',
      anchorDate: '2026-07-01'
    };
    workbook.transactions.push(
      makeInternetTransaction({ id: 'txn-weekly-ambiguous', date: '2026-07-04' })
    );
    const harness = makeHarness(workbook);

    const paid = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { bill: 'Internet', date: '2026-07-01' }
      },
      harness.context
    );

    expect(paid).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      confirmation: { required: true, field: 'allowDuplicate' },
      data: {
        occurrenceDate: '2026-07-01',
        candidateTransaction: { id: 'txn-weekly-ambiguous' },
        reconciliation: { decision: 'review' }
      }
    });
    expect(harness.workbook.recurringReconciliations || []).toEqual([]);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();
  });

  it('pauses before posting when a partly paid occurrence has another candidate', async () => {
    const workbook = makeWorkbook();
    workbook.transactions.push(
      makeInternetTransaction({ id: 'txn-internet-first', amount: 500 }),
      makeInternetTransaction({ id: 'txn-internet-remainder', amount: 1000 })
    );
    workbook.recurringReconciliations = [
      {
        id: 'match-internet-first',
        recurringItemId: 'internet',
        occurrenceDate: '2026-07-15',
        transactionId: 'txn-internet-first',
        decision: 'matched',
        method: 'manual',
        allocatedBaseAmount: 500,
        confidence: 100
      }
    ];
    const harness = makeHarness(workbook);

    const paid = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { bill: 'Internet', date: '2026-07-15' }
      },
      harness.context
    );

    expect(paid).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      confirmation: { required: true, field: 'allowDuplicate' },
      data: {
        candidateTransaction: { id: 'txn-internet-remainder' },
        reconciliation: { decision: 'partial', remainingAmount: 1000 }
      }
    });
    expect(harness.workbook.transactions).toHaveLength(3);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'defaults to', arguments: {}, expectedAmount: 50, expectedBaseAmount: 2900 },
    {
      label: 'preserves an explicit override instead of',
      arguments: { amount: 25 },
      expectedAmount: 25,
      expectedBaseAmount: 1450
    }
  ])('$label the remaining native amount for a partial occurrence', async (scenario) => {
    const workbook = makeWorkbook();
    workbook.accounts.find((account) => account.id === 'bank').currency = 'USD';
    workbook.recurringItems[0] = {
      ...workbook.recurringItems[0],
      amount: 100,
      currency: 'USD'
    };
    workbook.transactions.push(
      makeInternetTransaction({
        id: 'txn-internet-usd-partial',
        amount: 50,
        baseAmount: 2900,
        currency: 'USD',
        date: '2026-07-14'
      })
    );
    workbook.recurringReconciliations = [
      {
        id: 'match-internet-usd-partial',
        recurringItemId: 'internet',
        occurrenceDate: '2026-07-15',
        transactionId: 'txn-internet-usd-partial',
        decision: 'matched',
        method: 'manual',
        allocatedBaseAmount: 2900,
        confidence: 100
      }
    ];
    const harness = makeHarness(workbook);

    const paid = await executeCavalryAssistantTool(
      {
        name: 'pay_bill',
        arguments: { bill: 'Internet', date: '2026-07-15', ...scenario.arguments }
      },
      harness.context
    );
    const posted = harness.workbook.transactions.find(
      (transaction) => transaction.recurringItemId === 'internet'
    );

    expect(paid).toMatchObject({ ok: true, changed: true });
    expect(posted).toMatchObject({
      amount: scenario.expectedAmount,
      baseAmount: scenario.expectedBaseAmount,
      originalCurrency: 'USD',
      recurringOccurrenceDate: '2026-07-15'
    });
    expect(harness.workbook.recurringReconciliations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: posted.id,
          occurrenceDate: '2026-07-15',
          allocatedBaseAmount: scenario.expectedBaseAmount
        })
      ])
    );
  });

  it('requires confirmation when update_bill deactivates an active tracker', async () => {
    const harness = makeHarness();
    const blocked = await executeCavalryAssistantTool(
      {
        name: 'update_bill',
        arguments: { bill: 'Internet', isActive: false }
      },
      harness.context
    );

    expect(blocked).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      confirmation: { required: true, field: 'confirmed' }
    });
    expect(harness.workbook.recurringItems[0].isActive).toBe(true);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();

    const updated = await executeCavalryAssistantTool(
      {
        name: 'update_bill',
        arguments: { bill: 'Internet', isActive: false, confirmed: true }
      },
      harness.context
    );
    expect(updated).toMatchObject({
      ok: true,
      changed: true,
      data: { recurringItem: { id: 'internet', isActive: false } }
    });
    expect(harness.workbook.recurringItems[0].isActive).toBe(false);
    expect(harness.commitCommandResult).toHaveBeenCalledTimes(1);
  });

  it('returns failed validation without committing or leaking the workbook', async () => {
    const harness = makeHarness();
    const result = await executeCavalryAssistantTool(
      {
        name: 'create_transaction',
        arguments: {
          template: 'expense_paid',
          amount: -10,
          date: 'not-a-date',
          description: 'Invalid'
        }
      },
      harness.context
    );

    expect(result).toMatchObject({ ok: false, status: 'validation_failed', changed: false });
    expect(result.errors[0]).toEqual(
      expect.objectContaining({ code: expect.any(String), message: expect.any(String) })
    );
    expect(result).not.toHaveProperty('workbook');
    expect(harness.workbook.transactions).toHaveLength(1);
    expect(harness.commitCommandResult).not.toHaveBeenCalled();
  });
});
