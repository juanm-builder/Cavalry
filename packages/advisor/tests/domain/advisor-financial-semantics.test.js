// Tests for Advisor financial semantics.

import { describe, expect, it } from 'vitest';
import {
  buildAdvisorSemanticSummary,
  calculateAdvisorBudgetPercentages,
  calculateAdvisorRunway,
  classifyAdvisorTransactionSemantics
} from '@cavalry/advisor/domain/advisor/financial-semantics.js';

const workbook = {
  currency: 'PHP',
  accounts: [
    { id: 'cash', group: 'asset', name: 'Cash' },
    { id: 'card', group: 'liability', name: 'Credit Card' },
    { id: 'food-account', group: 'expense', name: 'Food Expense' },
    { id: 'salary-account', group: 'income', name: 'Salary Income' }
  ],
  categories: [
    { id: 'food', name: 'Food', type: 'expense' },
    { id: 'software', name: 'Software Tools', type: 'expense' }
  ],
  counterparties: []
};

function transaction(overrides) {
  return Object.assign(
    {
      id: 'txn',
      date: '2026-06-20',
      amount: 100,
      baseAmount: 100,
      lines: []
    },
    overrides
  );
}

describe('advisor financial semantics', () => {
  it('separates consumption, debt principal, transfer, and income classes', () => {
    expect(
      classifyAdvisorTransactionSemantics(
        workbook,
        transaction({
          id: 'expense',
          template: 'expense_paid',
          categoryId: 'food',
          lines: [
            { accountId: 'food-account', direction: 'debit', baseAmount: 100 },
            { accountId: 'cash', direction: 'credit', baseAmount: 100 }
          ]
        })
      )
    ).toMatchObject({
      economicFlow: 'consumption_expense',
      provenance: 'transaction_template'
    });

    expect(
      classifyAdvisorTransactionSemantics(
        workbook,
        transaction({
          id: 'debt',
          template: 'debt_payment',
          lines: [
            { accountId: 'card', direction: 'debit', baseAmount: 500 },
            { accountId: 'cash', direction: 'credit', baseAmount: 500 }
          ]
        })
      )
    ).toMatchObject({
      economicFlow: 'debt_principal',
      provenance: 'transaction_template'
    });

    expect(
      classifyAdvisorTransactionSemantics(
        workbook,
        transaction({
          id: 'transfer',
          template: 'transfer',
          lines: [
            { accountId: 'card', direction: 'debit', baseAmount: 50 },
            { accountId: 'cash', direction: 'credit', baseAmount: 50 }
          ]
        })
      )
    ).toMatchObject({
      economicFlow: 'internal_transfer'
    });

    expect(
      classifyAdvisorTransactionSemantics(
        workbook,
        transaction({
          id: 'income',
          template: 'income_received',
          lines: [
            { accountId: 'cash', direction: 'debit', baseAmount: 1000 },
            { accountId: 'salary-account', direction: 'credit', baseAmount: 1000 }
          ]
        })
      )
    ).toMatchObject({
      economicFlow: 'income'
    });
  });

  it('builds spending definitions without treating debt principal or transfers as consumption', () => {
    const summary = buildAdvisorSemanticSummary(workbook, [
      transaction({ id: 'food', template: 'expense_paid', baseAmount: 200, amount: 200 }),
      transaction({ id: 'debt', template: 'debt_payment', baseAmount: 500, amount: 500 }),
      transaction({ id: 'move', template: 'transfer', baseAmount: 75, amount: 75 }),
      transaction({ id: 'salary', template: 'income_received', baseAmount: 1000, amount: 1000 })
    ]);

    expect(summary.by_economic_flow).toMatchObject({
      consumption_expense: 200,
      debt_principal: 500,
      internal_transfer: 75,
      income: 1000
    });
    expect(summary.spending_definitions.consumption_only.amount).toBe(200);
    expect(summary.spending_definitions.all_cash_outflow.amount).toBe(775);
  });

  it('labels runway denominators and budget percentages precisely', () => {
    expect(
      calculateAdvisorRunway({
        liquidAssets: 12000,
        emergencyLiquidAssets: 9000,
        averageMonthlyTotalCashOutflow: 3000,
        averageMonthlyEssentialExpenses: 1500
      })
    ).toMatchObject({
      cash_flow_runway: {
        months: 4,
        denominator: 'average_monthly_total_cash_outflow'
      },
      emergency_runway: {
        months: 6,
        denominator: 'average_monthly_essential_expenses'
      }
    });

    expect(calculateAdvisorBudgetPercentages(951, 100)).toEqual({
      percent_of_budget: 951,
      percent_over_budget: 851
    });
  });
});
