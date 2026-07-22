// Locks down browser-safe plain-object normalization before renderer wire-in.

import { describe, expect, it } from 'vitest';

import {
  buildTransactionComposerValidationModel,
  getTransactionComposerDefaults,
  normalizeTransactionComposerInput
} from '@cavalry/finance-core/application/transactions/transaction-composer-form-model.js';

function makeWorkbook() {
  return {
    id: 'wb_composer',
    currency: 'PHP'
  };
}

describe('transaction composer form model', () => {
  it('builds deterministic defaults from workbook currency and caller date', () => {
    expect(
      getTransactionComposerDefaults(makeWorkbook(), { defaultDate: '2026-06-30' })
    ).toMatchObject({
      template: 'expense_paid',
      amount: 0,
      currency: 'PHP',
      date: '2026-06-30',
      counterpartyKind: 'other',
      recurringItemId: ''
    });
  });

  it('normalizes plain form values for the existing legacy composer adapter', () => {
    const normalized = normalizeTransactionComposerInput(
      {
        template: 'expense_paid',
        amount: '120.50',
        currency: 'usd',
        date: '2026-06-20',
        usdExpenseRate: '56.25',
        description: '  Coffee  ',
        categoryId: 'food',
        primaryAccountId: 'cash',
        secondaryAccountId: '',
        counterpartyId: 'merchant_1',
        counterpartyName: '  Cafe Rider  ',
        counterpartyKind: 'MERCHANT',
        note: '  receipt in bag  ',
        recurringItemId: 'rec_1'
      },
      makeWorkbook(),
      { defaultDate: '2026-06-30' }
    );

    expect(normalized).toEqual({
      template: 'expense_paid',
      amount: 120.5,
      currency: 'USD',
      date: '2026-06-20',
      fxRateToBase: 56.25,
      description: 'Coffee',
      categoryId: 'food',
      primaryAccountId: 'cash',
      secondaryAccountId: '',
      counterpartyId: 'merchant_1',
      counterpartyName: 'Cafe Rider',
      counterpartyKind: 'merchant',
      note: 'receipt in bag',
      recurringItemId: 'rec_1'
    });
  });

  it('preserves legacy id whitespace and amount parsing behavior', () => {
    const normalized = normalizeTransactionComposerInput(
      {
        amount: '1,200',
        fxRateToBase: '1,234.50',
        categoryId: ' food ',
        primaryAccountId: ' cash ',
        counterpartyId: ' merchant '
      },
      makeWorkbook(),
      { defaultDate: '2026-06-30' }
    );

    expect(normalized.amount).toBe(0);
    expect(normalized.fxRateToBase).toBe(1234.5);
    expect(normalized.categoryId).toBe(' food ');
    expect(normalized.primaryAccountId).toBe(' cash ');
    expect(normalized.counterpartyId).toBe(' merchant ');
  });

  it('falls back to workbook currency and caller date when fields are missing', () => {
    const normalized = normalizeTransactionComposerInput(
      {
        amount: '88'
      },
      makeWorkbook(),
      { defaultDate: '2026-07-01' }
    );

    expect(normalized).toMatchObject({
      template: 'expense_paid',
      amount: 88,
      currency: 'PHP',
      date: '2026-07-01'
    });
  });

  it('reports validation metadata without mutating the normalized input', () => {
    const raw = {
      template: 'expense_paid',
      amount: '0',
      currency: 'USD',
      usdExpenseRate: '',
      date: '2026-06-20'
    };
    const before = Object.assign({}, raw);
    const model = buildTransactionComposerValidationModel(raw, makeWorkbook(), {
      defaultDate: '2026-06-30'
    });

    expect(model.valid).toBe(false);
    expect(model.isUsdExpenseRateRequired).toBe(true);
    expect(model.hasUsdExpenseRate).toBe(false);
    expect(model.issues).toEqual([
      {
        code: 'invalid_amount',
        field: 'amount',
        message: 'Enter a valid amount.'
      },
      {
        code: 'missing_usd_expense_rate',
        field: 'usdExpenseRate',
        message: 'Set a USD to PHP rate before posting this USD expense.'
      }
    ]);
    expect(raw).toEqual(before);
  });

  it('does not require a USD expense rate for non-USD or transfer templates', () => {
    const nonUsd = buildTransactionComposerValidationModel(
      {
        template: 'expense_paid',
        amount: '120',
        currency: 'PHP'
      },
      makeWorkbook(),
      { defaultDate: '2026-06-30' }
    );
    const transfer = buildTransactionComposerValidationModel(
      {
        template: 'transfer',
        amount: '120',
        currency: 'USD'
      },
      makeWorkbook(),
      { defaultDate: '2026-06-30' }
    );

    expect(nonUsd.valid).toBe(true);
    expect(nonUsd.isUsdExpenseRateRequired).toBe(false);
    expect(transfer.valid).toBe(true);
    expect(transfer.isUsdExpenseRateRequired).toBe(false);
  });
});
