import { describe, expect, it } from 'vitest';
import { submitManualTransactionCommand } from '@cavalry/finance-core/application/transactions/transaction-command-service.js';
import { buildManualLedgerTransaction } from '@cavalry/finance-core/domain/ledger/transactions.js';
import { isTransactionBalanced } from '@cavalry/finance-core/domain/ledger/validation.js';

const LARGE_PHP_AMOUNT = 100_000_000;
const USD_TO_PHP_RATE = 61.75;

function makeMixedCurrencyWorkbook() {
  return {
    id: 'wb-mixed-currency-postings',
    version: 2,
    name: 'Mixed-currency postings',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: USD_TO_PHP_RATE },
    accounts: [
      { id: 'cash-usd', name: 'Cash', group: 'asset', currency: 'USD', isActive: true },
      { id: 'bank-php', name: 'Bank', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'card-usd',
        name: 'Credit Card',
        group: 'liability',
        currency: 'USD',
        isActive: true
      },
      {
        id: 'loan-php',
        name: 'Loan',
        group: 'liability',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'salary-income',
        name: 'Salary Income',
        group: 'income',
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
        id: 'debt-expense',
        name: 'Debt Payment',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'opening_balance_equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      }
    ],
    categories: [
      {
        id: 'salary',
        name: 'Salary',
        type: 'income',
        linkedAccountId: 'salary-income',
        isActive: true
      },
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'debt',
        name: 'Debt Payment',
        type: 'debt',
        linkedAccountId: 'debt-expense',
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

const mixedCurrencyScenarios = [
  {
    name: 'income',
    fields: {
      template: 'income_received',
      categoryId: 'salary',
      primaryAccountId: 'cash-usd'
    }
  },
  {
    name: 'asset-funded expense',
    fields: {
      template: 'expense_paid',
      categoryId: 'food',
      primaryAccountId: 'cash-usd'
    }
  },
  {
    name: 'credit-card expense',
    fields: {
      template: 'expense_charged',
      categoryId: 'food',
      primaryAccountId: 'card-usd'
    }
  },
  {
    name: 'transfer',
    fields: {
      template: 'transfer',
      primaryAccountId: 'bank-php',
      secondaryAccountId: 'cash-usd'
    }
  },
  {
    name: 'debt payment',
    fields: {
      template: 'debt_payment',
      categoryId: 'debt',
      primaryAccountId: 'cash-usd',
      secondaryAccountId: 'loan-php'
    }
  },
  {
    name: 'liability payment',
    fields: {
      template: 'liability_payment',
      categoryId: 'debt',
      primaryAccountId: 'cash-usd',
      secondaryAccountId: 'loan-php'
    }
  },
  {
    name: 'opening balance',
    fields: {
      template: 'opening_balance',
      primaryAccountId: 'cash-usd'
    }
  }
];

function completeFields(fields) {
  return {
    description: 'Large mixed-currency posting',
    amount: LARGE_PHP_AMOUNT,
    currency: 'PHP',
    fxRateToBase: USD_TO_PHP_RATE,
    date: '2026-07-14',
    ...fields
  };
}

describe('mixed-currency manual transaction balancing', () => {
  it.each(mixedCurrencyScenarios)(
    'keeps a large $name transaction balanced in base currency',
    ({ fields }) => {
      const transaction = buildManualLedgerTransaction(
        makeMixedCurrencyWorkbook(),
        completeFields(fields)
      );

      expect(isTransactionBalanced(transaction)).toBe(true);
      expect(transaction.lines).toHaveLength(2);
      expect(transaction.lines.map((line) => line.baseAmount)).toEqual([
        LARGE_PHP_AMOUNT,
        LARGE_PHP_AMOUNT
      ]);
    }
  );

  it('rounds the native USD posting without round-tripping that rounding into base currency', () => {
    const transaction = buildManualLedgerTransaction(
      makeMixedCurrencyWorkbook(),
      completeFields({
        template: 'income_received',
        categoryId: 'salary',
        primaryAccountId: 'cash-usd'
      })
    );

    expect(transaction.lines[0]).toMatchObject({
      accountId: 'cash-usd',
      amount: 1_619_433.2,
      currency: 'USD',
      baseAmount: LARGE_PHP_AMOUNT
    });
    expect(transaction.lines[1]).toMatchObject({
      accountId: 'salary-income',
      amount: LARGE_PHP_AMOUNT,
      currency: 'PHP',
      baseAmount: LARGE_PHP_AMOUNT
    });
  });

  it('posts the screenshot income only after explicit currency-conversion confirmation', () => {
    const workbook = makeMixedCurrencyWorkbook();
    const fields = completeFields({
      template: 'income_received',
      categoryId: 'salary',
      primaryAccountId: 'cash-usd',
      note: 'Lotto Price'
    });
    const confirmation = submitManualTransactionCommand(workbook, fields);

    expect(confirmation.ok).toBe(true);
    expect(confirmation.workbook).toBe(workbook);
    expect(confirmation.warnings).toEqual([
      expect.objectContaining({
        code: 'account_currency_conversion_confirmation_required',
        transactionCurrency: 'PHP',
        fxRateToBase: USD_TO_PHP_RATE
      })
    ]);

    const result = submitManualTransactionCommand(workbook, {
      ...fields,
      allowCurrencyConversion: true
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.transactions).toEqual([]);
    expect(result.transaction.amount).toBe(LARGE_PHP_AMOUNT);
    expect(isTransactionBalanced(result.transaction)).toBe(true);
  });
});
