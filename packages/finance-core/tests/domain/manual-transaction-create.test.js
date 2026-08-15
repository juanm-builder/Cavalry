import { describe, expect, it } from 'vitest';
import { getLedgerHistoricalBalances } from '@cavalry/finance-core/domain/ledger/balances.js';
import {
  buildManualLedgerTransaction,
  summarizeLedgerActivity
} from '@cavalry/finance-core/domain/ledger/transactions.js';
import { isTransactionBalanced } from '@cavalry/finance-core/domain/ledger/validation.js';
import { cloneFixture, makeIncomeAndExpenseWorkbook } from '../fixtures/core-workbook-fixtures.js';
import {
  scenarioBasicExpense,
  scenarioBasicIncome,
  scenarioCreditCardExpense,
  scenarioTransfer,
  scenarioUsdExpense
} from '../fixtures/ledger-scenarios.js';

function expectScenarioTransaction(workbook, scenario) {
  const transaction = buildManualLedgerTransaction(
    workbook,
    scenario.fields,
    null,
    workbook.transactions.length
  );
  expect(transaction).toMatchObject({
    template: scenario.expected.template,
    categoryId: scenario.expected.categoryId,
    description: scenario.fields.description,
    amount: scenario.fields.amount,
    baseAmount: scenario.expected.baseAmount,
    source: 'manual'
  });
  expect(transaction.lines[0].accountId).toBe(scenario.expected.debitAccountId);
  expect(transaction.lines[0].direction).toBe('debit');
  expect(transaction.lines[1].accountId).toBe(scenario.expected.creditAccountId);
  expect(transaction.lines[1].direction).toBe('credit');
  expect(isTransactionBalanced(transaction)).toBe(true);
  return transaction;
}

describe('manual transaction creation model', () => {
  it('creates a basic expense that affects committed spending totals', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = expectScenarioTransaction(workbook, scenarioBasicExpense());

    workbook.transactions.push(transaction);
    const summary = summarizeLedgerActivity(workbook);
    expect(summary.expense).toBe(2149);
    expect(summary.categoryTotals.food).toBe(370);
  });

  it('creates income without inflating expense category totals', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = expectScenarioTransaction(workbook, scenarioBasicIncome());

    workbook.transactions.push(transaction);
    const summary = summarizeLedgerActivity(workbook);
    expect(summary.income).toBe(100000);
    expect(summary.expense).toBe(2029);
    expect(summary.categoryTotals.salary).toBe(100000);
  });

  it('creates transfers without counting them as spending or income', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = expectScenarioTransaction(workbook, scenarioTransfer());

    workbook.transactions.push(transaction);
    const summary = summarizeLedgerActivity(workbook);
    const balances = getLedgerHistoricalBalances(workbook);
    expect(summary.income).toBe(50000);
    expect(summary.expense).toBe(2029);
    expect(summary.categoryTotals.__uncategorized).toBeUndefined();
    expect(balances.cash).toBe(-1330);
    expect(balances.bank).toBe(50501);
  });

  it('creates credit card expenses as liability-funded expense transactions', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = expectScenarioTransaction(workbook, scenarioCreditCardExpense());

    workbook.transactions.push(transaction);
    const summary = summarizeLedgerActivity(workbook);
    const balances = getLedgerHistoricalBalances(workbook);
    expect(summary.expense).toBe(2929);
    expect(balances['credit-card']).toBe(2100);
  });

  it('creates USD expenses only when an FX rate is available', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const transaction = expectScenarioTransaction(workbook, scenarioUsdExpense());

    expect(transaction.originalCurrency).toBe('USD');
    expect(transaction.fxRateToBase).toBe(58);
    expect(transaction.lines[0]).toMatchObject({ amount: 10, currency: 'USD', baseAmount: 580 });
    expect(transaction.lines[1]).toMatchObject({ amount: 580, currency: 'PHP', baseAmount: 580 });
  });

  it('rejects missing or invalid required fields before mutating the workbook', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const before = cloneFixture(workbook);

    expect(() =>
      buildManualLedgerTransaction(workbook, { ...scenarioBasicExpense().fields, amount: 0 })
    ).toThrow('valid amount');
    expect(() =>
      buildManualLedgerTransaction(workbook, {
        ...scenarioBasicExpense().fields,
        date: 'June 30 2026'
      })
    ).toThrow('transaction date');
    expect(() =>
      buildManualLedgerTransaction(workbook, {
        ...scenarioBasicExpense().fields,
        primaryAccountId: 'missing'
      })
    ).toThrow('asset account');
    expect(() =>
      buildManualLedgerTransaction(workbook, {
        ...scenarioBasicExpense().fields,
        categoryId: 'missing'
      })
    ).toThrow('expense category');
    expect(workbook).toEqual(before);
  });

  it('creates merchant refunds that reduce the original expense category', () => {
    const workbook = makeIncomeAndExpenseWorkbook();

    expect(workbook.transactions.some((transaction) => transaction.description === 'Lunch')).toBe(
      true
    );
    const refund = buildManualLedgerTransaction(workbook, {
      template: 'refund',
      description: 'Refund candidate',
      amount: 50,
      date: '2026-06-19',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });

    expect(refund).toMatchObject({
      template: 'merchant_refund',
      eventKind: 'merchant_refund',
      amount: 50,
      categoryId: 'food'
    });
    expect(refund.lines[0]).toMatchObject({ accountId: 'cash', direction: 'debit' });
    expect(refund.lines[1]).toMatchObject({ accountId: 'food-expense', direction: 'credit' });
    expect(isTransactionBalanced(refund)).toBe(true);

    workbook.transactions.push(refund);
    const summary = summarizeLedgerActivity(workbook);
    expect(summary.expense).toBe(1979);
    expect(summary.categoryTotals.food).toBe(200);
  });
});
