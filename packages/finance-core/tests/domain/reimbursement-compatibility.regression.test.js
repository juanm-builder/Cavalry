import { describe, expect, it } from 'vitest';

import {
  getTransactionContributions,
  replaceLedgerTransactionCommand,
  submitManualTransactionCommand
} from '@cavalry/finance-core';
import { cloneFixture, makeMinimalWorkbook } from '../fixtures/core-workbook-fixtures.js';

function makeWorkbookWithReimbursement() {
  const workbook = makeMinimalWorkbook();
  workbook.accounts.push({
    id: 'reimbursements-income',
    name: 'Reimbursements Income',
    group: 'income',
    currency: 'PHP',
    isActive: true
  });
  workbook.categories.push({
    id: 'reimbursements',
    name: 'Reimbursements',
    type: 'income',
    currency: 'PHP',
    linkedAccountId: 'reimbursements-income',
    isActive: true
  });
  workbook.transactions.push({
    id: 'txn-reimbursement',
    date: '2026-07-15',
    monthKey: '2026-07',
    template: 'income_received',
    eventKind: 'reimbursement',
    description: 'Travel reimbursement',
    categoryId: 'reimbursements',
    originalCurrency: 'PHP',
    amount: 250,
    baseAmount: 250,
    source: 'manual',
    lines: [
      {
        id: 'line-reimbursement-cash',
        accountId: 'cash',
        direction: 'debit',
        amount: 250,
        currency: 'PHP',
        baseAmount: 250
      },
      {
        id: 'line-reimbursement-income',
        accountId: 'reimbursements-income',
        direction: 'credit',
        amount: 250,
        currency: 'PHP',
        baseAmount: 250
      }
    ]
  });
  return workbook;
}

describe('reimbursement compatibility regression', () => {
  it('keeps the existing income contribution contract after unrelated transaction actions', () => {
    const workbook = makeWorkbookWithReimbursement();
    const reimbursementBefore = cloneFixture(workbook.transactions[0]);
    const contributionBefore = getTransactionContributions(workbook, workbook.transactions[0]);

    const expense = submitManualTransactionCommand(workbook, {
      template: 'expense_paid',
      amount: 40,
      currency: 'PHP',
      date: '2026-07-16',
      description: 'Lunch',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });
    const reimbursementAfter = expense.workbook.transactions.find(
      (transaction) => transaction.id === 'txn-reimbursement'
    );

    expect(expense.ok).toBe(true);
    expect(reimbursementAfter).toEqual(reimbursementBefore);
    expect(getTransactionContributions(expense.workbook, reimbursementAfter)).toEqual(
      contributionBefore
    );
    expect(contributionBefore).toMatchObject({
      eventKind: 'reimbursement',
      flowKind: 'inflow',
      metrics: { income: 250, expense: 0, categoryBudget: 0, cashFlow: 250 },
      warnings: [expect.objectContaining({ code: 'reimbursement_treated_as_income' })]
    });
  });

  it('refuses structural replacement instead of reinterpreting reimbursement semantics', () => {
    const workbook = makeWorkbookWithReimbursement();
    const before = cloneFixture(workbook);

    const result = replaceLedgerTransactionCommand(
      workbook,
      'txn-reimbursement',
      [
        {
          template: 'merchant_refund',
          amount: 250,
          currency: 'PHP',
          date: '2026-07-15',
          description: 'Travel refund',
          categoryId: 'food',
          primaryAccountId: 'cash'
        }
      ],
      { operationKey: 'do-not-reinterpret-reimbursement' }
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [
        expect.objectContaining({ code: 'transaction.reimbursement_replacement_unsupported' })
      ]
    });
    expect(result.workbook).toBe(workbook);
    expect(workbook).toEqual(before);
  });
});
