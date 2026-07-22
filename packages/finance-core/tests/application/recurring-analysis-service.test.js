import { describe, expect, it } from 'vitest';

import {
  buildRecurringAnalysis,
  buildRecurringCandidates,
  buildRecurringItemRows,
  getRecurringOccurrencesForSheet,
  getRecurringScheduleSummary,
  inferRecurringCadence
} from '@cavalry/finance-core/application/recurring/recurring-analysis-service.js';
import {
  cloneFixture,
  makeBasicSpendingWorkbook,
  makeLine,
  makeTransaction
} from '../fixtures/core-workbook-fixtures.js';

function subscriptionTransaction(id, date, amount = 6490) {
  return makeTransaction({
    id,
    date,
    template: 'expense_paid',
    description: 'ChatGPT Pro subscription',
    categoryId: 'subscriptions',
    amount,
    lines: [makeLine('subscriptions-expense', 'debit', amount), makeLine('bank', 'credit', amount)]
  });
}

describe('recurring analysis service', () => {
  it('detects subscription-like recurring candidates with cadence, variance, and last seen date', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.transactions = [
      subscriptionTransaction('sub-apr', '2026-04-01'),
      subscriptionTransaction('sub-may', '2026-05-01'),
      subscriptionTransaction('sub-jun', '2026-06-01')
    ];

    const candidates = buildRecurringCandidates(workbook);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      classification: 'likely_subscription',
      suggestedFrequency: 'Monthly',
      rhythm: 'monthly',
      amountSpreadPercent: 0,
      lastSeenDate: '2026-06-01',
      transactionCount: 3
    });
  });

  it('treats stable generic merchants as likely recurring while exposing stale evidence', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.transactions = [
      makeTransaction({
        id: 'vercel-apr',
        date: '2026-04-08',
        template: 'expense_paid',
        description: 'Vercel',
        categoryId: 'food',
        amount: 1276,
        lines: [makeLine('food-expense', 'debit', 1276), makeLine('bank', 'credit', 1276)]
      }),
      makeTransaction({
        id: 'vercel-may',
        date: '2026-05-08',
        template: 'expense_paid',
        description: 'Vercel',
        categoryId: 'food',
        amount: 1276,
        lines: [makeLine('food-expense', 'debit', 1276), makeLine('bank', 'credit', 1276)]
      })
    ];

    expect(buildRecurringCandidates(workbook, { asOfDate: '2026-07-10' })[0]).toMatchObject({
      classification: 'likely_subscription',
      confidence: 0.72,
      rhythm: 'monthly',
      activityStatus: 'stale_charge_evidence',
      daysSinceLastSeen: 63,
      staleAfterDays: 62,
      isStale: true
    });
  });

  it('keeps bill-like stable charges uncertain when their dates have no recurring cadence', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.transactions = [
      subscriptionTransaction('netflix-old', '2024-01-05', 500),
      subscriptionTransaction('netflix-new', '2026-01-05', 500)
    ].map((transaction) => ({ ...transaction, description: 'Netflix subscription' }));

    expect(buildRecurringCandidates(workbook, { asOfDate: '2026-07-10' })[0]).toMatchObject({
      classification: 'maybe_subscription',
      confidence: 0.58,
      rhythm: 'irregular'
    });
  });

  it('keeps an already-linked charge as a high-confidence recurring candidate', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.recurringItems = [
      {
        id: 'recurring-chatgpt',
        kind: 'subscription',
        name: 'ChatGPT Pro',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 6490,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-06-01',
        isActive: false
      }
    ];
    workbook.transactions = [
      Object.assign(subscriptionTransaction('sub-linked', '2026-06-01'), {
        recurringItemId: 'recurring-chatgpt'
      })
    ];

    expect(buildRecurringCandidates(workbook)).toEqual([
      expect.objectContaining({
        classification: 'likely_subscription',
        confidence: 0.98,
        alreadyTracked: true,
        existingRecurringItemId: 'recurring-chatgpt',
        linkedTrackerStatus: 'inactive',
        transactionCount: 1,
        transactionIds: ['sub-linked'],
        source_refs: ['transaction:sub-linked']
      })
    ]);
  });

  it('hides ignored candidates by default and restores them when requested', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.transactions = [
      subscriptionTransaction('sub-apr', '2026-04-01'),
      subscriptionTransaction('sub-may', '2026-05-01'),
      subscriptionTransaction('sub-jun', '2026-06-01')
    ];
    const candidate = buildRecurringCandidates(workbook)[0];
    workbook.settings.subscriptionReviewDecisions = {
      [candidate.decisionKey]: { decision: 'ignored', updatedAt: '2026-06-13T00:00:00.000Z' }
    };

    expect(buildRecurringCandidates(workbook)).toEqual([]);
    expect(buildRecurringCandidates(workbook, { includeIgnored: true })).toEqual([
      expect.objectContaining({ id: candidate.id, decision: 'ignored' })
    ]);
  });

  it('resolves an equivalent existing tracker without requiring an existing transaction link', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.transactions = [
      subscriptionTransaction('sub-apr', '2026-04-01'),
      subscriptionTransaction('sub-may', '2026-05-01')
    ];
    workbook.recurringItems = [
      {
        id: 'recurring-chatgpt',
        kind: 'subscription',
        name: 'ChatGPT Pro',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 6490,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-03-01',
        isActive: true
      }
    ];

    expect(buildRecurringCandidates(workbook)[0]).toMatchObject({
      alreadyTracked: false,
      existingRecurringItemId: 'recurring-chatgpt'
    });
  });

  it('aggregates load, top-up, RFID, toll, and parking rows as variable expenses', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.transactions = [
      makeTransaction({
        id: 'rfid-one',
        date: '2026-05-01',
        template: 'expense_paid',
        description: 'RFID top-up',
        categoryId: 'transport',
        amount: 200,
        lines: [makeLine('transport-expense', 'debit', 200), makeLine('cash', 'credit', 200)]
      }),
      makeTransaction({
        id: 'rfid-two',
        date: '2026-06-01',
        template: 'expense_paid',
        description: 'RFID top-up',
        categoryId: 'transport',
        amount: 1200,
        lines: [makeLine('transport-expense', 'debit', 1200), makeLine('cash', 'credit', 1200)]
      })
    ];

    const candidates = buildRecurringCandidates(workbook, { includeFalsePositives: true });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      classification: 'variable_expense',
      transactionCount: 2,
      transactionIds: ['rfid-one', 'rfid-two']
    });
    expect(candidates[0].reason).toContain('known variable expense');
  });

  it('classifies repeated variable grocery spending as ordinary spending', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.transactions = [
      makeTransaction({
        id: 'grocery-may',
        date: '2026-05-05',
        description: 'Metro Supermarket',
        categoryId: 'food',
        amount: 1200,
        lines: [makeLine('food-expense', 'debit', 1200), makeLine('bank', 'credit', 1200)]
      }),
      makeTransaction({
        id: 'grocery-jun',
        date: '2026-06-05',
        description: 'Metro Supermarket',
        categoryId: 'food',
        amount: 1400,
        lines: [makeLine('food-expense', 'debit', 1400), makeLine('bank', 'credit', 1400)]
      })
    ];

    expect(buildRecurringCandidates(workbook, { includeFalsePositives: true })[0]).toMatchObject({
      classification: 'variable_expense',
      transactionIds: ['grocery-may', 'grocery-jun']
    });
  });

  it('projects active recurring item occurrences for a sheet', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.recurringItems = [
      {
        id: 'recurring-gym',
        kind: 'subscription',
        name: 'Gym',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 1500,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-01-31',
        isActive: true
      }
    ];
    const sheet = { id: 'sheet-june', monthIndex: 5 };

    const rows = getRecurringOccurrencesForSheet(workbook, sheet);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Gym',
      dueDate: '2026-06-30',
      amount: 1500,
      frequency: 'Monthly'
    });
  });

  it('uses configured FX rates for projections while preserving the native payment amount', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.fxRates = [{ fromCurrency: 'EUR', toCurrency: 'PHP', rate: 63.5 }];
    workbook.recurringItems = [
      {
        id: 'recurring-euro-hosting',
        kind: 'subscription',
        name: 'Euro hosting',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 20,
        currency: 'EUR',
        frequency: 'Monthly',
        anchorDate: '2026-06-15',
        isActive: true
      }
    ];

    const [occurrence] = getRecurringOccurrencesForSheet(workbook, {
      id: 'sheet-june',
      monthIndex: 5
    });

    expect(occurrence).toMatchObject({
      amount: 1270,
      originalAmount: 20,
      currency: 'EUR'
    });
    expect(buildRecurringItemRows(workbook)[0]).toMatchObject({
      amount: 20,
      currency: 'EUR',
      nativeAmount: 20,
      nativeCurrency: 'EUR',
      baseAmount: 1270,
      baseCurrency: 'PHP',
      baseAmountVerified: true,
      baseConversionStatus: 'converted'
    });
  });

  it('does not invent a base amount when a tracker has no usable FX rate', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.fxRates = [];
    workbook.recurringItems = [
      {
        id: 'recurring-euro-hosting',
        kind: 'subscription',
        name: 'Euro hosting',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 20,
        currency: 'EUR',
        frequency: 'Monthly',
        anchorDate: '2026-06-15',
        isActive: true
      }
    ];

    expect(buildRecurringItemRows(workbook)[0]).toMatchObject({
      amount: 20,
      currency: 'EUR',
      baseAmount: null,
      baseCurrency: 'PHP',
      baseAmountVerified: false,
      baseConversionStatus: 'missing_fx_rate'
    });
  });

  it('reports recurring item last seen dates from linked transactions', () => {
    const workbook = cloneFixture(makeBasicSpendingWorkbook());
    workbook.recurringItems = [
      {
        id: 'recurring-chatgpt',
        kind: 'subscription',
        name: 'ChatGPT Pro',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 6490,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-04-01',
        isActive: true
      }
    ];
    workbook.transactions = [
      Object.assign(subscriptionTransaction('sub-may', '2026-05-01'), {
        recurringItemId: 'recurring-chatgpt'
      }),
      Object.assign(subscriptionTransaction('sub-jun', '2026-06-01'), {
        recurringItemId: 'recurring-chatgpt'
      })
    ];

    workbook.transactions.push(
      Object.assign(subscriptionTransaction('sub-aug', '2026-08-01'), {
        recurringItemId: 'recurring-chatgpt'
      })
    );

    expect(buildRecurringItemRows(workbook, { asOfDate: '2026-07-15' })[0]).toMatchObject({
      id: 'recurring-chatgpt',
      lastSeenDate: '2026-06-01',
      linkedTransactionCount: 2,
      futureLinkedTransactionCount: 1,
      activityStatus: 'recent_charge_evidence',
      daysSinceLastSeen: 44,
      isStale: false
    });
    expect(buildRecurringAnalysis(workbook).recurringItems).toHaveLength(1);
  });

  it('separates a stored schedule anchor from current and next expected occurrences', () => {
    const item = {
      frequency: 'Monthly',
      anchorDate: '2026-06-14',
      isActive: true
    };

    expect(getRecurringScheduleSummary(item, '2026-07-15')).toEqual({
      anchorDate: '2026-06-14',
      currentOccurrenceDate: '2026-07-14',
      nextExpectedDate: '2026-08-14'
    });
  });

  it('infers common cadences from transaction dates', () => {
    expect(inferRecurringCadence(['2026-01-01', '2026-02-01', '2026-03-01']).frequency).toBe(
      'Monthly'
    );
    expect(inferRecurringCadence(['2026-01-01', '2026-01-08', '2026-01-15']).frequency).toBe(
      'Weekly'
    );
  });
});
