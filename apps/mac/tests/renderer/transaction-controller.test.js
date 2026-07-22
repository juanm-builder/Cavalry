import { describe, expect, it } from 'vitest';

import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import {
  createTransactionControllerState,
  reduceTransactionControllerAction
} from '../../src/renderer/features/transactions/transaction-controller.js';

const SERVICES = { defaultDate: '2026-07-12' };

const CREATE_CASES = [
  {
    label: 'expense',
    template: 'expense_paid',
    expectedIssues: ['invalid_amount', 'invalid_expense_account', 'invalid_expense_category'],
    fields: {
      amount: '850',
      description: 'Lunch at Cafe Mary Grace',
      categoryId: 'food',
      primaryAccountId: 'cash'
    }
  },
  {
    label: 'income',
    template: 'income_received',
    expectedIssues: ['invalid_amount', 'invalid_income_account', 'invalid_income_category'],
    fields: {
      amount: '25000',
      description: 'July salary',
      categoryId: 'salary',
      primaryAccountId: 'bank'
    }
  },
  {
    label: 'transfer',
    template: 'transfer',
    expectedIssues: ['invalid_amount', 'invalid_transfer_accounts'],
    fields: {
      amount: '2000',
      primaryAccountId: 'bank',
      secondaryAccountId: 'cash',
      note: 'Transfer to e-wallet'
    }
  }
];

function dispatch(workbook, state, type, payload = {}) {
  const outcome = reduceTransactionControllerAction(workbook, state, { type, payload }, SERVICES);
  expect(outcome.handled).toBe(true);
  return outcome;
}

function expectNoCommand(outcome, workbook, originalWorkbook) {
  expect(outcome.commandResult).toBeNull();
  expect(workbook).toEqual(originalWorkbook);
  return outcome.state;
}

describe('transaction create wizard controller', () => {
  it('opens a bill-originated transaction with the reconciliation details prefilled', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const originalWorkbook = cloneFixture(workbook);
    const state = createTransactionControllerState();

    const outcome = dispatch(workbook, state, 'open-ledger-composer', {
      template: 'expense_paid',
      amount: 6490,
      currency: 'PHP',
      date: '2026-07-14',
      description: 'ChatGPT Pro',
      categoryId: 'food',
      primaryAccountId: 'bank',
      recurringItemId: 'recurring-chatgpt',
      recurringOccurrenceDate: '2026-07-14',
      recurringTrackingMode: 'link',
      sourceRoute: 'bills'
    });

    expectNoCommand(outcome, workbook, originalWorkbook);
    expect(outcome.state.modal).toMatchObject({
      type: 'composer',
      step: 'details',
      draft: {
        template: 'expense_paid',
        amount: 6490,
        date: '2026-07-14',
        description: 'ChatGPT Pro',
        categoryId: 'food',
        primaryAccountId: 'bank',
        recurringItemId: 'recurring-chatgpt',
        recurringOccurrenceDate: '2026-07-14',
        recurringTrackingMode: 'link',
        sourceRoute: 'bills'
      }
    });
  });

  for (const transactionCase of CREATE_CASES) {
    it(`stages ${transactionCase.label} details and review without committing before final submit`, () => {
      const workbook = makeIncomeAndExpenseWorkbook();
      const originalWorkbook = cloneFixture(workbook);
      const originalTransactionCount = workbook.transactions.length;
      let state = createTransactionControllerState();

      let outcome = dispatch(workbook, state, 'open-ledger-composer');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal).toMatchObject({
        type: 'composer',
        step: 'type',
        draft: { template: '', transactionId: '' }
      });

      outcome = dispatch(workbook, state, 'choose-transaction-type', {
        template: transactionCase.template
      });
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal).toMatchObject({
        step: 'details',
        draft: { template: transactionCase.template }
      });

      outcome = dispatch(workbook, state, 'submit-transaction');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal.step).toBe('details');

      outcome = dispatch(workbook, state, 'review-transaction');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal.step).toBe('details');
      expect(state.modal.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(transactionCase.expectedIssues)
      );

      for (const [field, value] of Object.entries(transactionCase.fields)) {
        outcome = dispatch(workbook, state, 'transaction-composer-change', { field, value });
        state = expectNoCommand(outcome, workbook, originalWorkbook);
      }

      outcome = dispatch(workbook, state, 'review-transaction');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal).toMatchObject({ step: 'review', errors: [], warnings: [] });

      outcome = dispatch(workbook, state, 'transaction-composer-back');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal.step).toBe('details');

      outcome = dispatch(workbook, state, 'review-transaction');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal.step).toBe('review');

      outcome = dispatch(workbook, state, 'edit-transaction-details');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal.step).toBe('details');

      outcome = dispatch(workbook, state, 'review-transaction');
      state = expectNoCommand(outcome, workbook, originalWorkbook);
      expect(state.modal.step).toBe('review');

      outcome = dispatch(workbook, state, 'submit-transaction');
      expect(outcome.commandResult).toMatchObject({
        ok: true,
        transaction: { template: transactionCase.template }
      });
      expect(outcome.commandResult.workbook).not.toBe(workbook);
      expect(outcome.commandResult.workbook.transactions).toHaveLength(
        originalTransactionCount + 1
      );
      expect(outcome.state.modal).toBeNull();
      expect(workbook).toEqual(originalWorkbook);
    });
  }

  it('rejects unsupported create templates without advancing or producing a command', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const originalWorkbook = cloneFixture(workbook);
    let state = createTransactionControllerState();

    let outcome = dispatch(workbook, state, 'open-ledger-composer');
    state = expectNoCommand(outcome, workbook, originalWorkbook);

    outcome = dispatch(workbook, state, 'choose-transaction-type', {
      template: 'expense_charged'
    });
    state = expectNoCommand(outcome, workbook, originalWorkbook);

    expect(state.modal).toMatchObject({
      type: 'composer',
      step: 'type',
      draft: { template: '' },
      errors: [
        {
          code: 'invalid_transaction_type',
          field: 'template',
          message: 'Choose Income, Expense, or Transfer.'
        }
      ]
    });
  });

  it('requires an explicit rate and confirmation before posting PHP into a USD account', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    workbook.accounts.push({
      id: 'usd-wallet',
      name: 'USD Wallet',
      group: 'asset',
      subtype: 'wallet',
      currency: 'USD',
      isActive: true
    });
    const originalWorkbook = cloneFixture(workbook);
    let state = createTransactionControllerState();

    state = dispatch(workbook, state, 'open-ledger-composer').state;
    state = dispatch(workbook, state, 'choose-transaction-type', {
      template: 'income_received'
    }).state;
    for (const [field, value] of Object.entries({
      amount: '20',
      description: 'Found cash',
      categoryId: 'salary',
      primaryAccountId: 'usd-wallet',
      currency: 'PHP'
    })) {
      state = dispatch(workbook, state, 'transaction-composer-change', { field, value }).state;
    }

    let outcome = dispatch(workbook, state, 'review-transaction');
    state = outcome.state;
    expect(state.modal.errors).toEqual([
      expect.objectContaining({ code: 'account_currency_conversion_rate_required' })
    ]);
    expect(workbook).toEqual(originalWorkbook);

    state = dispatch(workbook, state, 'transaction-composer-change', {
      field: 'fxRateToBase',
      value: '61.75'
    }).state;
    state = dispatch(workbook, state, 'review-transaction').state;
    expect(state.modal.step).toBe('review');

    outcome = dispatch(workbook, state, 'submit-transaction');
    state = outcome.state;
    expect(outcome.commandResult.workbook).toBe(workbook);
    expect(state.modal.warnings).toEqual([
      expect.objectContaining({ code: 'account_currency_conversion_confirmation_required' })
    ]);

    outcome = dispatch(workbook, state, 'confirm-transaction-warnings');
    expect(outcome.commandResult.ok).toBe(true);
    expect(outcome.state.modal).toBeNull();
    const transaction = outcome.commandResult.transaction;
    expect(transaction).toMatchObject({
      originalCurrency: 'PHP',
      amount: 20,
      baseAmount: 20,
      fxRateToBase: 61.75
    });
    expect(transaction.lines.find((line) => line.accountId === 'usd-wallet')).toMatchObject({
      amount: 0.32,
      currency: 'USD',
      baseAmount: 20
    });
    expect(workbook).toEqual(originalWorkbook);
  });
});
