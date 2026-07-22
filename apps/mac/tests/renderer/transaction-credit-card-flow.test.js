import { describe, expect, it } from 'vitest';

import { submitManualTransactionCommand } from '@cavalry/finance-core/application/transactions/transaction-command-service.js';
import { getLedgerHistoricalBalances } from '@cavalry/finance-core/domain/ledger/balances.js';
import { summarizeLedgerActivity } from '@cavalry/finance-core/domain/ledger/transactions.js';
import {
  createTransactionControllerState,
  reduceTransactionControllerAction
} from '../../src/renderer/features/transactions/transaction-controller.js';
import { buildTransactionFeatureModel } from '../../src/renderer/features/transactions/transaction-model.js';

const SERVICES = { defaultDate: '2026-07-14' };

function makeCreditCardFlowWorkbook() {
  return {
    id: 'wb-credit-card-flow',
    version: 2,
    name: 'Credit Card Flow',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
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
        id: 'bank',
        name: 'BPI Savings',
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'credit-card',
        name: 'BPI Credit Card',
        group: 'liability',
        subtype: 'credit_card',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'personal-loan',
        name: 'Personal Loan',
        group: 'liability',
        subtype: 'loan',
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
        id: 'debt-payment-expense',
        name: 'Debt Payment',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'opening-balance-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        currency: 'PHP',
        isSystem: true,
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
        id: 'credit-card-payment',
        name: 'Credit Card Payment',
        type: 'debt',
        currency: 'PHP',
        linkedAccountId: 'debt-payment-expense',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    sheets: [],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

function dispatch(workbook, state, type, payload = {}) {
  const outcome = reduceTransactionControllerAction(workbook, state, { type, payload }, SERVICES);
  expect(outcome.handled).toBe(true);
  return outcome;
}

function openExpense(workbook) {
  let state = createTransactionControllerState();
  state = dispatch(workbook, state, 'open-ledger-composer').state;
  state = dispatch(workbook, state, 'choose-transaction-type', {
    template: 'expense_paid'
  }).state;
  return state;
}

describe('unified credit-card expense flow', () => {
  it('keeps asset-funded expenses paid and switches card-funded expenses to charged', () => {
    const workbook = makeCreditCardFlowWorkbook();
    let state = openExpense(workbook);
    let model = buildTransactionFeatureModel(workbook, state);

    expect(model.modal.kind).toMatchObject({ kind: 'expense', template: 'expense_paid' });
    expect(model.modal.options.accounts.map((account) => account.value)).toEqual(
      expect.arrayContaining(['cash', 'bank', 'credit-card'])
    );
    expect(model.modal.options.accounts.map((account) => account.value)).not.toContain(
      'personal-loan'
    );

    state = dispatch(workbook, state, 'transaction-composer-change', {
      field: 'primaryAccountId',
      value: 'cash'
    }).state;
    expect(state.modal.draft.template).toBe('expense_paid');

    state = dispatch(workbook, state, 'transaction-composer-change', {
      field: 'primaryAccountId',
      value: 'credit-card'
    }).state;
    expect(state.modal.draft.template).toBe('expense_charged');
    model = buildTransactionFeatureModel(workbook, state);
    expect(model.modal.kind).toMatchObject({ kind: 'expense' });
    expect(model.modal.selection.primaryAccount).toMatchObject({
      value: 'credit-card',
      group: 'liability',
      contextKind: 'credit_card'
    });

    state = dispatch(workbook, state, 'transaction-composer-change', {
      field: 'primaryAccountId',
      value: 'bank'
    }).state;
    expect(state.modal.draft.template).toBe('expense_paid');
  });

  it('posts a card purchase as expense plus liability and keeps its later payment non-expense', () => {
    const workbook = makeCreditCardFlowWorkbook();
    let state = openExpense(workbook);
    for (const [field, value] of Object.entries({
      primaryAccountId: 'credit-card',
      amount: '900',
      categoryId: 'food',
      description: 'Card groceries'
    })) {
      state = dispatch(workbook, state, 'transaction-composer-change', { field, value }).state;
    }

    state = dispatch(workbook, state, 'review-transaction').state;
    expect(state.modal).toMatchObject({
      step: 'review',
      draft: { template: 'expense_charged', primaryAccountId: 'credit-card' }
    });

    const charge = dispatch(workbook, state, 'submit-transaction').commandResult;
    expect(charge).toMatchObject({
      ok: true,
      transaction: {
        template: 'expense_charged',
        categoryId: 'food',
        amount: 900
      }
    });
    expect(charge.transaction.lines).toEqual([
      expect.objectContaining({ accountId: 'food-expense', direction: 'debit', amount: 900 }),
      expect.objectContaining({ accountId: 'credit-card', direction: 'credit', amount: 900 })
    ]);

    const summaryAfterCharge = summarizeLedgerActivity(charge.workbook);
    expect(summaryAfterCharge).toMatchObject({ expense: 900, debt: 0, outflow: 900 });
    expect(getLedgerHistoricalBalances(charge.workbook)).toMatchObject({
      'credit-card': 900,
      cash: 0
    });

    const payment = submitManualTransactionCommand(charge.workbook, {
      template: 'transfer',
      amount: '400',
      currency: 'PHP',
      date: '2026-07-15',
      description: 'BPI Credit Card payment',
      primaryAccountId: 'cash',
      secondaryAccountId: 'credit-card'
    });

    expect(payment.ok).toBe(true);
    expect(payment.transaction.lines).toEqual([
      expect.objectContaining({ accountId: 'credit-card', direction: 'debit', amount: 400 }),
      expect.objectContaining({ accountId: 'cash', direction: 'credit', amount: 400 })
    ]);
    expect(summarizeLedgerActivity(payment.workbook)).toMatchObject({
      expense: 900,
      debt: 0,
      outflow: 900
    });
    expect(getLedgerHistoricalBalances(payment.workbook)).toMatchObject({
      'credit-card': 500,
      cash: -400
    });
  });
});
