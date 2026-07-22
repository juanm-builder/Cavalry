import { describe, expect, it } from 'vitest';

import { getSheetBudgetMap } from '@cavalry/finance-core/application/budgets/budget-service.js';
import {
  getRecurringOccurrenceDatesForMonth,
  scoreRecurringOccurrenceMatch
} from '@cavalry/finance-core/application/recurring/recurring-analysis-service.js';
import { migrateLegacyRecurringLineItems } from '@cavalry/finance-core/application/recurring/recurring-migration-service.js';
import { normalizeLoadedWorkbook } from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';

function makeLegacyWorkbook() {
  return {
    id: 'legacy-recurring-workbook',
    version: 2,
    name: 'Legacy recurring workbook',
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [
      { id: 'gcash', name: 'GCash', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'subscriptions-expense',
        name: 'Subscriptions',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'subscriptions-expense',
        isActive: true
      }
    ],
    transactions: [],
    recurringItems: [],
    sheets: [
      {
        id: 'june',
        monthIndex: 5,
        budgets: [{ categoryId: 'subscriptions', planned: 549 }],
        budgetLineItems: [
          {
            id: 'netflix-line',
            categoryId: 'subscriptions',
            name: 'Netflix',
            planned: 549,
            currency: 'PHP',
            dueDate: '2026-06-15',
            kind: 'subscription',
            frequency: 'Monthly',
            accountId: 'gcash',
            autoRenew: true,
            isActive: true
          }
        ]
      },
      {
        id: 'july',
        monthIndex: 6,
        budgets: [{ categoryId: 'subscriptions', planned: 700 }],
        budgetLineItems: []
      }
    ]
  };
}

describe('legacy recurring compatibility', () => {
  it('migrates qualifying budget lines during workbook load and keeps budget projections deduplicated', () => {
    const workbook = normalizeLoadedWorkbook(makeLegacyWorkbook(), {
      now: () => new Date('2026-06-20T00:00:00.000Z')
    });

    expect(workbook.recurringItems).toHaveLength(1);
    expect(workbook.recurringItems[0]).toMatchObject({
      kind: 'subscription',
      name: 'Netflix',
      categoryId: 'subscriptions',
      accountId: 'gcash',
      amount: 549,
      anchorDate: '2026-06-15'
    });
    expect(workbook.sheets[0].budgetLineItems[0].recurringItemId).toBe(
      workbook.recurringItems[0].id
    );
    expect(getRecurringOccurrenceDatesForMonth(workbook.recurringItems[0], '2026-07')).toEqual([
      '2026-07-15'
    ]);
    expect(getSheetBudgetMap(workbook, workbook.sheets[0]).subscriptions).toBe(549);
    expect(getSheetBudgetMap(workbook, workbook.sheets[1]).subscriptions).toBe(700);
  });

  it('reuses an equivalent tracker and ignores generated general-plan rows', () => {
    const workbook = makeLegacyWorkbook();
    workbook.recurringItems = [
      {
        id: 'existing-netflix',
        kind: 'subscription',
        name: 'Netflix',
        categoryId: 'subscriptions',
        accountId: 'gcash',
        amount: 549,
        currency: 'PHP',
        frequency: 'Monthly',
        anchorDate: '2026-01-15',
        isActive: true
      }
    ];
    workbook.sheets[0].budgetLineItems.push({
      id: 'general-plan',
      categoryId: 'subscriptions',
      name: 'General plan',
      note: 'Created from category planned amount',
      planned: 549,
      currency: 'PHP',
      isActive: true
    });

    const result = migrateLegacyRecurringLineItems(workbook, { today: '2026-06-20' });

    expect(result).toMatchObject({ created: 0, linked: 1 });
    expect(workbook.recurringItems).toHaveLength(1);
    expect(workbook.sheets[0].budgetLineItems[0].recurringItemId).toBe('existing-netflix');
    expect(workbook.sheets[0].budgetLineItems[1].recurringItemId).toBeUndefined();
  });

  it('scores strong occurrence evidence above the review threshold and unrelated spending below it', () => {
    const workbook = makeLegacyWorkbook();
    const row = {
      categoryId: 'subscriptions',
      categoryName: 'Subscriptions',
      name: 'Netflix',
      amount: 549,
      accountId: 'gcash',
      dueDate: '2026-06-15'
    };
    const matching = {
      id: 'txn-netflix',
      date: '2026-06-16',
      template: 'expense_paid',
      categoryId: 'subscriptions',
      description: 'Netflix',
      baseAmount: 549,
      lines: [{ accountId: 'gcash', direction: 'credit', baseAmount: 549 }]
    };
    const unrelated = {
      id: 'txn-cafe',
      date: '2026-06-30',
      template: 'expense_paid',
      categoryId: 'subscriptions',
      description: 'Cafe',
      baseAmount: 120,
      lines: [{ accountId: 'gcash', direction: 'credit', baseAmount: 120 }]
    };

    expect(scoreRecurringOccurrenceMatch(workbook, row, matching)).toBeGreaterThanOrEqual(60);
    expect(scoreRecurringOccurrenceMatch(workbook, row, unrelated)).toBeLessThan(60);
  });
});
