// Tests for Advisor response builders.

import { describe, expect, it } from 'vitest';
import {
  advisorAnswerReference,
  advisorAnswerReferences,
  CAVALRY_ADVISOR_EMOTIONAL_SUPPORT_RESPONSE,
  CAVALRY_ADVISOR_GREETING_RESPONSE,
  CAVALRY_ADVISOR_SMALL_TALK_RESPONSE,
  CAVALRY_ADVISOR_TRANSACTION_CAPABILITY_RESPONSE,
  buildAccountSnapshotAdvisorResponse,
  buildAdvisorSmallTalkResponse,
  buildBasicFinancialAdvisorResponse,
  buildCategoryInventoryAdvisorResponse,
  buildCategorizationReviewAdvisorResponse,
  buildFallbackFinancialAdvisorResponse,
  buildTransactionAnalysisAdvisorResponse,
  buildTransactionCapabilityAdvisorResponse,
  buildTransactionImpactAdvisorResponse,
  buildTransactionListAdvisorResponse,
  formatAdvisorImpactTransactionLine,
  formatAdvisorTransactionListLine
} from '@cavalry/advisor/domain/advisor/responses.js';

const context = {
  profile: {
    rangeLabel: 'June 2026',
    asOfLabel: 'June 18, 2026',
    currency: 'PHP',
    privacy: 'local'
  },
  snapshot: {
    assets: 10000,
    averageMonthlyOutflow: 1250,
    emergencyMonths: 2.4,
    income: 5000,
    liabilities: 2000,
    liquidAssets: 3000,
    net: 850,
    netWorth: 8000,
    outflow: 4150
  },
  budget: {
    budgetUsedPercent: 82,
    overspentRows: [
      {
        category: { id: 'transport', name: 'Transport' },
        remaining: -250,
        percent: 125
      }
    ],
    topSpendRows: [
      {
        category: { id: 'food', name: 'Food' },
        total: 1200
      }
    ],
    variance: -300,
    watchRows: [
      {
        category: { id: 'utilities', name: 'Utilities' },
        percent: 90
      }
    ]
  },
  ledger: {
    overdueCount: 2,
    recurringCount: 4,
    recurringTotal: 2250,
    topLiabilities: [
      {
        account: { name: 'Card' },
        balance: 2000
      }
    ]
  },
  health: {
    errors: [{ severity: 'error', message: 'Missing account', detail: 'txn-one' }],
    notices: [],
    totalIssues: 2,
    warnings: [{ severity: 'warning', message: 'Unbalanced row', detail: '' }]
  }
};

const basicResponseOptions = {
  formatAdvisorMonths: (value) => Number(value).toFixed(1) + ' months',
  formatAdvisorPercent: (value) => String(Math.round(Number(value) || 0)) + '%',
  formatDeltaMoney: (value) =>
    `${Number(value) >= 0 ? '+' : '-'}PHP ${Math.abs(Number(value)).toFixed(2)}`,
  formatMoney: (value) => 'PHP ' + Number(value).toFixed(2),
  titleCaseLabel: (value, fallback) =>
    String(value || fallback || '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ')
};

describe('advisor response builders', () => {
  it('normalizes answer references', () => {
    expect(advisorAnswerReference(' PHP 150 ', 'transaction:txn-one')).toEqual({
      token: 'PHP 150',
      source_refs: ['transaction:txn-one']
    });
    expect(
      advisorAnswerReferences([
        { token: 'Food', sourceRef: 'category:food' },
        { token: '', sourceRef: 'category:empty' },
        { token: 'Missing ref', source_refs: [] }
      ])
    ).toEqual([{ token: 'Food', source_refs: ['category:food'] }]);
  });

  it('builds simple local financial responses', () => {
    expect(buildBasicFinancialAdvisorResponse('hello', context, basicResponseOptions)).toEqual({
      text: CAVALRY_ADVISOR_GREETING_RESPONSE,
      references: []
    });
    expect(
      buildBasicFinancialAdvisorResponse('hello', context, {
        ...basicResponseOptions,
        mode: 'financial'
      })
    ).toBeNull();

    const assets = buildBasicFinancialAdvisorResponse(
      'how much are my assets?',
      context,
      basicResponseOptions
    );
    expect(assets.text).toBe(
      'Your total assets are **PHP 10000.00** as of June 18, 2026.\n\nI also see **PHP 3000.00** in estimated liquid assets. That is about **2.4 months** of average monthly outflows.'
    );
    expect(assets.references).toEqual([
      { token: 'PHP 10000.00', source_refs: ['computed.totals.assets'] },
      { token: 'PHP 3000.00', source_refs: ['computed.liquidity.liquid_assets'] },
      { token: '2.4 months', source_refs: ['computed.liquidity.emergency_fund_months'] }
    ]);

    const netWorth = buildBasicFinancialAdvisorResponse(
      'net worth?',
      context,
      basicResponseOptions
    );
    expect(netWorth.text).toContain('Your net worth is **PHP 8000.00** as of June 18, 2026.');
    expect(netWorth.references).toEqual([
      { token: 'PHP 8000.00', source_refs: ['computed.totals.net_worth'] },
      { token: 'PHP 10000.00', source_refs: ['computed.totals.assets'] },
      { token: 'PHP 2000.00', source_refs: ['computed.totals.liabilities'] }
    ]);

    const liabilities = buildBasicFinancialAdvisorResponse(
      'show liabilities',
      context,
      basicResponseOptions
    );
    expect(liabilities.text).toContain('Largest liability balances:\n- Card: PHP 2000.00');
    expect(liabilities.references).toEqual([
      { token: 'PHP 2000.00', source_refs: ['computed.totals.liabilities'] }
    ]);

    const income = buildBasicFinancialAdvisorResponse('income', context, basicResponseOptions);
    expect(income.text).toBe(
      'Your total inflows for June 2026 are **PHP 5000.00**.\n\nFor the same range, outflows are **PHP 4150.00**, so net flow is **PHP 850.00**.'
    );
    expect(income.references).toEqual([
      { token: 'PHP 5000.00', source_refs: ['computed.cashflow_period.income'] },
      { token: 'PHP 4150.00', source_refs: ['computed.cashflow_period.spending'] },
      { token: 'PHP 850.00', source_refs: ['computed.cashflow_period.net_cashflow'] }
    ]);

    const expenses = buildBasicFinancialAdvisorResponse('expenses', context, basicResponseOptions);
    expect(expenses.text).toContain('Top expense categories:\n- **Food**: **PHP 1200.00**');
    expect(expenses.references).toEqual([
      { token: 'PHP 4150.00', source_refs: ['computed.cashflow_period.spending'] },
      { token: 'Food', source_refs: ['category_spend:food'] },
      { token: 'PHP 1200.00', source_refs: ['category_spend:food'] }
    ]);

    const liquidity = buildBasicFinancialAdvisorResponse(
      'cash buffer',
      context,
      basicResponseOptions
    );
    expect(liquidity.text).toBe(
      'I estimate **PHP 3000.00** in liquid assets.\n\nBased on average monthly outflows of **PHP 1250.00**, that covers about **2.4 months**.'
    );
    expect(liquidity.references).toEqual([
      { token: 'PHP 3000.00', source_refs: ['computed.liquidity.liquid_assets'] },
      { token: 'PHP 1250.00', source_refs: ['computed.liquidity.average_monthly_outflow'] },
      { token: '2.4 months', source_refs: ['computed.liquidity.emergency_fund_months'] }
    ]);

    expect(
      buildBasicFinancialAdvisorResponse(
        'tell me something thoughtful',
        context,
        basicResponseOptions
      )
    ).toBeNull();
  });

  it('builds account snapshot answers with account references', () => {
    const response = buildAccountSnapshotAdvisorResponse(
      {
        totals: {
          assets: { amount: '10000.00', currency: 'PHP', source_refs: ['account_snapshot:assets'] },
          liabilities: {
            amount: '2000.00',
            currency: 'PHP',
            source_refs: ['account_snapshot:liabilities']
          },
          net_worth: {
            amount: '8000.00',
            currency: 'PHP',
            source_refs: ['account_snapshot:net_worth']
          }
        },
        accounts: [
          {
            account_id: 'cash',
            name: 'Cash',
            group: 'asset',
            balance: '10000.00',
            balance_display: 'PHP 10000.00',
            source_ref: 'account:cash',
            source_refs: ['account:cash']
          },
          {
            account_id: 'card',
            name: 'Card',
            group: 'liability',
            balance: '2000.00',
            balance_display: 'PHP 2000.00',
            source_ref: 'account:card',
            source_refs: ['account:card']
          }
        ]
      },
      context,
      {
        ...basicResponseOptions,
        disclaimer: 'Educational only.'
      }
    );

    expect(response.text).toContain('Cash');
    expect(response.text).toContain('Card');
    expect(response.text).toContain('Best next step');
    expect(response.references).toContainEqual({ token: 'Cash', source_refs: ['account:cash'] });
  });

  it('builds category inventory answers with zero-use categories', () => {
    const response = buildCategoryInventoryAdvisorResponse(
      {
        period: { label: 'June 2026' },
        counts: {
          categories_total: 3,
          active_categories: 2,
          archived_categories: 1,
          selected_period_categories_without_transactions: 1
        },
        categories: [
          {
            category_id: 'food',
            name: 'Food',
            type: 'expense',
            is_active: true,
            selected_period_transaction_count: 2,
            selected_period_amount_display: 'PHP 1200.00',
            source_ref: 'category:food',
            source_refs: ['category:food']
          },
          {
            category_id: 'transport',
            name: 'Transport',
            type: 'expense',
            is_active: true,
            selected_period_transaction_count: 0,
            selected_period_amount_display: 'PHP 0.00',
            source_ref: 'category:transport',
            source_refs: ['category:transport']
          },
          {
            category_id: 'old-debt',
            name: 'Old Debt',
            type: 'debt',
            is_active: false,
            selected_period_transaction_count: 0,
            selected_period_amount_display: 'PHP 0.00',
            source_ref: 'category:old-debt',
            source_refs: ['category:old-debt']
          }
        ]
      },
      context
    );

    expect(response.text).toContain('I found the full category inventory for June 2026.');
    expect(response.text).toContain('Zero selected-period usage means no rows used that category');
    expect(response.text).toContain(
      '- **Transport** (expense, active): 0 selected-period transactions, **PHP 0.00**.'
    );
    expect(response.text).not.toMatch(
      /educational summary|not financial|tax, legal, or investment advice/i
    );
    expect(response.references).toContainEqual({
      token: 'Transport',
      source_refs: ['category:transport']
    });
  });

  it('builds transaction capability responses without dumping rows', () => {
    const response = buildTransactionCapabilityAdvisorResponse();
    expect(response.text).toBe(CAVALRY_ADVISOR_TRANSACTION_CAPABILITY_RESPONSE);
    expect(response.text).toContain("I won't list rows unless you ask me to");
    expect(response.text).not.toContain('| Date |');
    expect(response.references).toEqual([]);
  });

  it('formats transfer rows as internal moves instead of uncategorized expenses', () => {
    expect(
      formatAdvisorTransactionListLine(
        {
          date: '2026-06-21',
          description: 'Transfer: Cash -> Piggy Bank',
          template: 'transfer',
          category_name: 'Uncategorized',
          account_label: 'Cash -> Piggy Bank',
          amount_display: 'PHP 25.00'
        },
        0
      )
    ).toBe(
      '1. 2026-06-21 - **Transfer: Cash -> Piggy Bank** - Transfer - Cash -> Piggy Bank - **PHP 25.00**'
    );
  });

  it('builds small-talk fallback responses without finance details', () => {
    const response = buildAdvisorSmallTalkResponse();
    expect(response.text).toBe(CAVALRY_ADVISOR_SMALL_TALK_RESPONSE);
    expect(response.text).not.toMatch(/budget|bill|transaction|subscription|disclaimer/i);
    expect(response.references).toEqual([]);
  });

  it('builds emotional small-talk responses without dashboard metrics', () => {
    const response = buildAdvisorSmallTalkResponse('I feel sad');
    expect(response.text).toBe(CAVALRY_ADVISOR_EMOTIONAL_SUPPORT_RESPONSE);
    expect(response.text).toContain("I'm sorry");
    expect(response.text).not.toMatch(
      /money|saving|spending|budget|bill|transaction|subscription|disclaimer|net flow/i
    );
    expect(response.references).toEqual([]);
  });

  it('builds calm transaction analysis responses', () => {
    const response = buildTransactionAnalysisAdvisorResponse(
      {
        period: { label: 'June 2026' },
        totals: {
          selected_period_total_outflow: {
            display: 'PHP 4150.00',
            source_refs: ['computed.cashflow_period.total_outflow']
          },
          selected_period_spending: {
            display: 'PHP 4150.00',
            source_refs: ['computed.cashflow_period.spending']
          },
          selected_period_expenses_only: {
            display: 'PHP 3200.00',
            source_refs: ['computed.cashflow_period.expenses_only']
          },
          selected_period_debt_payments: {
            display: 'PHP 800.00',
            source_refs: ['computed.cashflow_period.debt_payments']
          },
          selected_period_transfers_or_internal_moves: {
            display: 'PHP 150.00',
            source_refs: ['computed.cashflow_period.transfers_or_internal_moves']
          },
          selected_period_net_cashflow: {
            display: '+PHP 850.00',
            source_refs: ['computed.cashflow_period.net_cashflow']
          }
        },
        budget_reliability: {
          status: 'extreme_or_mismatched'
        },
        top_spending_categories: [
          {
            name: 'Food',
            amount_display: 'PHP 1200.00',
            source_refs: ['category_spend:food']
          }
        ],
        over_budget_categories: [
          {
            name: 'Transport',
            over_by_display: 'PHP 250.00',
            source_refs: ['budget:transport']
          }
        ],
        recurring_or_subscription_rows: [
          {
            date: '2026-06-14',
            description: 'ChatGPT Pro',
            amount_display: 'PHP 6490.00',
            source_ref: 'transaction:chatgpt'
          }
        ],
        vague_category_rows: [
          {
            category_name: 'For Others',
            description: 'Dad Tip',
            amount_display: 'PHP 500.00',
            source_ref: 'transaction:dad-tip',
            source_refs: ['category_spend:for_others']
          }
        ],
        transfer_like_rows: [
          {
            description: 'Transfer: Freedom Fund -> GCash',
            amount_display: 'PHP 850.00',
            source_ref: 'transaction:transfer'
          }
        ],
        largest_real_expense_rows: [
          {
            date: '2026-06-16',
            description: 'Food Payment to SJ',
            category_name: 'Food',
            amount_display: 'PHP 750.00',
            source_ref: 'transaction:food'
          }
        ]
      },
      context,
      {
        disclaimer: 'Educational only.'
      }
    );

    expect(response.text).toContain('A few things stand out from June 2026.');
    expect(response.text).toContain('Cavalry separates that into expenses only');
    expect(response.text).toContain('possible transfers or non-expense movements');
    expect(response.text).toContain('I would be careful with the budget percentage here.');
    expect(response.text).not.toMatch(/\b(Critical|critical|extreme|Extreme|severely|Severely)\b/);
    expect(response.text).not.toContain('| Date |');
    expect(response.text.endsWith('Educational only.')).toBe(true);
    expect(response.text.match(/Educational only\./g)).toHaveLength(1);
    expect(response.references).toContainEqual({
      token: 'Food',
      source_refs: ['category_spend:food']
    });
    expect(response.references).toContainEqual({
      token: 'ChatGPT Pro',
      source_refs: ['transaction:chatgpt']
    });
  });

  it('builds fallback financial review responses', () => {
    const priorities = [
      { title: 'Cash buffer', detail: 'Keep a short-term reserve.' },
      { title: 'Budget pressure', detail: 'Watch transport.' }
    ];

    const budget = buildFallbackFinancialAdvisorResponse(
      'budget pressure',
      context,
      priorities,
      basicResponseOptions
    );
    expect(budget.text).toContain(
      'Here is what I see:\n\n1. Cash buffer: Keep a short-term reserve.\n2. Budget pressure: Watch transport.'
    );
    expect(budget.text).toContain(
      'Budget readout: outflows are at 82% of planned outflow, with a variance of -PHP 300.00.'
    );
    expect(budget.text).toContain('- **Transport**: over by **PHP 250.00** (125% used).');
    expect(budget.text).toContain(
      'Context used: June 2026, balances as of June 18, 2026, privacy local.'
    );
    expect(budget.text).not.toMatch(/not tax, legal, or investment advice|educational summary/i);
    expect(budget.references).toEqual([
      { token: 'PHP 850.00', source_refs: ['computed.cashflow_period.net_cashflow'] },
      { token: 'PHP 3000.00', source_refs: ['computed.liquidity.liquid_assets'] },
      { token: '2.4 months', source_refs: ['computed.liquidity.emergency_fund_months'] },
      { token: 'PHP 2000.00', source_refs: ['computed.totals.liabilities'] },
      { token: 'PHP 10000.00', source_refs: ['computed.totals.assets'] },
      { token: 'Transport', source_refs: ['budget:transport'] },
      { token: 'PHP 250.00', source_refs: ['budget:transport'] }
    ]);

    const bills = buildFallbackFinancialAdvisorResponse(
      'subscriptions',
      context,
      priorities,
      basicResponseOptions
    );
    expect(bills.text).toContain(
      'Bills and subscriptions readout: Cavalry sees 4 recurring items totaling PHP 2250.00.'
    );
    expect(bills.text).toContain(
      'Start with the 2 overdue items, then review recurring items that are no longer essential.'
    );

    const debt = buildFallbackFinancialAdvisorResponse(
      'debt plan',
      context,
      priorities,
      basicResponseOptions
    );
    expect(debt.text).toContain(
      'Liability readout: total liabilities are **PHP 2000.00** against assets of **PHP 10000.00**.'
    );
    expect(debt.text).toContain('Largest liability balances:\n- Card: PHP 2000.00.');
    expect(debt.text).toContain('Prioritize high-interest balances first');

    const health = buildFallbackFinancialAdvisorResponse(
      'data health',
      context,
      priorities,
      basicResponseOptions
    );
    expect(health.text).toContain('Data health readout: 1 errors, 1 warnings, and 0 notices.');
    expect(health.text).toContain('- Error: Missing account (txn-one)');
    expect(health.text).toContain('- Warning: Unbalanced row');

    const general = buildFallbackFinancialAdvisorResponse(
      'what do you think?',
      context,
      priorities,
      basicResponseOptions
    );
    expect(general.text).toContain(
      'What stands out: net flow is **PHP 850.00**, budget use is 82%, and the estimated cash buffer is **2.4 months**.'
    );
    expect(general.text).toContain('Top expense pressure: **Food** at **PHP 1200.00**.');
    expect(general.references).toContainEqual({
      token: 'Food',
      source_refs: ['category_spend:food']
    });
    expect(general.references).toContainEqual({
      token: 'PHP 1200.00',
      source_refs: ['category_spend:food']
    });
  });

  it('builds categorization review responses from packets', () => {
    const response = buildCategorizationReviewAdvisorResponse(
      {
        period: { label: 'June 2026' },
        counts: {
          transactions_in_vague_or_missing_categories: 2,
          transactions_reviewed: 5,
          vague_categories: 1,
          duplicate_category_label_groups: 1,
          duplicate_counterparty_label_groups: 0
        },
        candidate_improvements: [
          {
            title: 'Rename Misc',
            detail: 'Misc can become Needs Review',
            source_refs: ['category:misc']
          }
        ],
        sample_transactions_needing_review: []
      },
      context,
      {
        disclaimer: 'Educational only.'
      }
    );

    expect(response.text).toContain('I reviewed the categorization signals for June 2026.');
    expect(response.text).toContain('Safe candidate improvements I can see:');
    expect(response.text).toContain('1. **Rename Misc**: Misc can become Needs Review.');
    expect(response.text.endsWith('Educational only.')).toBe(true);
    expect(response.references).toEqual([
      { token: 'Misc can become Needs Review', source_refs: ['category:misc'] }
    ]);
  });

  it('builds categorization review sample responses when no suggestions exist', () => {
    const response = buildCategorizationReviewAdvisorResponse(
      {
        counts: {},
        candidate_improvements: [],
        sample_transactions_needing_review: [
          {
            transaction_id: 'txn-one',
            date: '2026-06-18',
            description: 'Transport',
            currency: 'PHP',
            amount: '150.00',
            current_category: 'Missing category',
            source_refs: ['transaction:txn-one']
          }
        ]
      },
      context,
      {
        responseStyle: 'brief',
        disclaimer: 'Educational only.'
      }
    );

    expect(response.text).toContain('Examples I would manually review:');
    expect(response.text).toContain(
      '2026-06-18 - Transport - PHP 150.00 currently in Missing category.'
    );
    expect(response.references).toEqual([
      { token: 'Transport', source_refs: ['transaction:txn-one'] }
    ]);
  });

  it('builds latest transaction list responses', () => {
    const row = {
      date: '2026-06-18',
      description: 'Transport',
      category_name: 'Transport',
      account_label: 'Cash',
      amount_display: 'PHP 150.00',
      note: 'Toll fee',
      source_ref: 'transaction:txn-one'
    };
    const response = buildTransactionListAdvisorResponse(
      {
        mode: 'last',
        transactions: [row]
      },
      context,
      {
        disclaimer: 'Educational only.'
      }
    );

    expect(formatAdvisorTransactionListLine(row, 0)).toBe(
      '1. 2026-06-18 - **Transport** - Transport - Cash - **PHP 150.00**'
    );
    expect(response.text).toContain('Your latest transaction in June 2026 is:');
    expect(response.text).toContain('Note: Toll fee');
    expect(response.references).toEqual([
      { token: 'Transport', source_refs: ['transaction:txn-one'] },
      { token: 'PHP 150.00', source_refs: ['transaction:txn-one'] }
    ]);
  });

  it('builds transaction impact responses from packets', () => {
    const negativeRow = {
      date_label: 'June 18, 2026',
      description: 'Transport',
      category: 'Transport',
      net_worth_impact_display: '-PHP 150.00',
      impact_type: 'expense',
      source_ref: 'transaction:txn-transport'
    };
    const response = buildTransactionImpactAdvisorResponse(
      {
        totals: {
          estimated_transaction_net_worth_impact: { amount: '850.00' }
        },
        category_impact_summary: [
          {
            category_id: 'transport',
            name: 'Transport',
            total_impact: '-150.00',
            total_impact_display: '-PHP 150.00',
            transaction_count: 1
          }
        ],
        top_negative_impact_transactions: [negativeRow],
        top_positive_impact_transactions: [
          {
            date_label: 'June 19, 2026',
            description: 'Salary',
            category: 'Salary',
            net_worth_impact_display: '+PHP 1000.00',
            impact_type: 'income',
            source_ref: 'transaction:txn-salary'
          }
        ],
        excluded_neutral_transactions: [
          {
            date_label: 'June 17, 2026',
            description: 'Transfer',
            amount_display: 'PHP 75.00',
            impact_type: 'transfer_excluded'
          }
        ]
      },
      context,
      {
        responseStyle: 'breakdown',
        disclaimer: 'Educational only.',
        formatDeltaMoney: (value) =>
          `${Number(value) >= 0 ? '+' : '-'}PHP ${Math.abs(Number(value)).toFixed(2)}`
      }
    );

    expect(formatAdvisorImpactTransactionLine(negativeRow, 0)).toBe(
      '1. June 18, 2026 - **Transport** - Transport - **-PHP 150.00** (expense)'
    );
    expect(response.text).toContain('Estimated transaction net-worth impact: **+PHP 850.00**.');
    expect(response.text).toContain('Selected-period net flow: **+PHP 850.00**.');
    expect(response.text).toContain('Biggest categories by impact:');
    expect(response.text).toContain('Largest net-worth reducers:');
    expect(response.text).toContain('Largest net-worth increasers:');
    expect(response.text).toContain(
      'Neutral or excluded movements I would not count as net-worth changes:'
    );
    expect(response.text).toContain('My read: the pressure is concentrated in Transport.');
    expect(response.text).toContain(
      'Context used: June 2026, balances as of June 18, 2026. Educational only.'
    );
    expect(response.references).toEqual([
      {
        token: '+PHP 850.00',
        source_refs: ['computed.transaction_impact.estimated_net_worth_impact']
      },
      { token: '+PHP 850.00', source_refs: ['computed.cashflow_period.net_cashflow'] },
      { token: 'Transport', source_refs: ['category_spend:transport'] },
      { token: '-PHP 150.00', source_refs: ['category_spend:transport'] },
      { token: 'Transport', source_refs: ['transaction:txn-transport'] },
      { token: '-PHP 150.00', source_refs: ['transaction:txn-transport'] },
      { token: 'Salary', source_refs: ['transaction:txn-salary'] },
      { token: '+PHP 1000.00', source_refs: ['transaction:txn-salary'] }
    ]);
  });

  it('builds empty transaction impact responses', () => {
    const response = buildTransactionImpactAdvisorResponse(
      {
        totals: {
          estimated_transaction_net_worth_impact: { amount: '0.00' }
        },
        top_negative_impact_transactions: [],
        top_positive_impact_transactions: []
      },
      context,
      {
        disclaimer: 'Educational only.'
      }
    );

    expect(response.text).toBe(
      'I do not see selected-period transactions that clearly changed net worth.\n\nI am excluding transfers, opening balances, savings moves, and principal-only debt payments because those usually move value between accounts rather than changing total net worth.\n\nContext used: June 2026. Educational only.'
    );
    expect(response.references).toEqual([]);
  });

  it('builds table transaction list responses', () => {
    const response = buildTransactionListAdvisorResponse(
      {
        mode: 'recent',
        counts: {
          included_transactions: 1,
          selected_period_transactions: 3
        },
        transactions: [
          {
            date: '2026-06-18',
            description: 'Transport | toll',
            category_name: 'Transport | fees',
            account_label: 'Cash | wallet',
            amount_display: 'PHP 150.00',
            source_ref: 'transaction:txn-one'
          }
        ]
      },
      context,
      {
        disclaimer: 'Educational only.'
      }
    );

    expect(response.text).toContain(
      '| 2026-06-18 | **Transport / toll** | Transport / fees | Cash / wallet | **PHP 150.00** |'
    );
    expect(response.text).toContain('Showing 1 of 3 selected-period transactions.');
    expect(response.references).toEqual([
      { token: 'Transport | toll', source_refs: ['transaction:txn-one'] },
      { token: 'PHP 150.00', source_refs: ['transaction:txn-one'] }
    ]);
  });

  it('builds empty transaction list responses', () => {
    expect(buildTransactionListAdvisorResponse({ transactions: [] }, context).text).toBe(
      'I do not see transactions in the selected range: June 2026.'
    );
  });
});
