import { describe, expect, it } from 'vitest';
import { getLedgerHistoricalBalances } from '@cavalry/finance-core/domain/ledger/balances.js';
import { validateLedgerInvariants } from '@cavalry/finance-core/domain/ledger/invariants.js';
import {
  buildManualLedgerTransaction,
  summarizeLedgerActivity
} from '@cavalry/finance-core/domain/ledger/transactions.js';
import {
  cloneFixture,
  makeDraftIsolationWorkbook,
  makeIncomeAndExpenseWorkbook,
  makeMultiCurrencyWorkbook,
  makeRefundWorkbook,
  makeTransferWorkbook
} from '../fixtures/core-workbook-fixtures.js';
import { scenarioBasicExpense, scenarioBasicIncome } from '../fixtures/ledger-scenarios.js';

describe('ledger balances and summaries', () => {
  it('expenses reduce cash/account balances and increase category totals', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const expense = buildManualLedgerTransaction(
      workbook,
      scenarioBasicExpense().fields,
      null,
      workbook.transactions.length
    );
    workbook.transactions.push(expense);

    const balances = getLedgerHistoricalBalances(workbook);
    const summary = summarizeLedgerActivity(workbook);
    expect(balances.cash).toBe(-450);
    expect(summary.expense).toBe(2149);
    expect(summary.categoryTotals.food).toBe(370);
  });

  it('income increases asset balances and income totals', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const income = buildManualLedgerTransaction(
      workbook,
      scenarioBasicIncome().fields,
      null,
      workbook.transactions.length
    );
    workbook.transactions.push(income);

    const balances = getLedgerHistoricalBalances(workbook);
    const summary = summarizeLedgerActivity(workbook);
    expect(balances.bank).toBe(99501);
    expect(summary.income).toBe(100000);
    expect(summary.net).toBe(97971);
  });

  it('credit card expenses increase liability balances according to the current model', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const balances = getLedgerHistoricalBalances(workbook);

    expect(balances['credit-card']).toBe(1200);
    expect(summarizeLedgerActivity(workbook).expense).toBe(2029);
  });

  it('transfers do not count as spending or income', () => {
    const workbook = makeTransferWorkbook();
    const summary = summarizeLedgerActivity(workbook);

    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(0);
    expect(summary.outflow).toBe(0);
  });

  it('pending and rejected drafts do not affect committed totals', () => {
    const workbook = makeDraftIsolationWorkbook();
    const withoutDrafts = cloneFixture(workbook);
    withoutDrafts.aiDrafts = [];
    withoutDrafts.externalDraftGroups = [];

    expect(summarizeLedgerActivity(workbook)).toMatchObject(summarizeLedgerActivity(withoutDrafts));
  });

  it('multi-currency behavior uses stored base amounts and does not invent FX conversion beyond the workbook data', () => {
    const workbook = makeMultiCurrencyWorkbook();
    const result = validateLedgerInvariants(workbook);
    const summary = summarizeLedgerActivity(workbook);

    expect(result.ok).toBe(true);
    expect(summary.expense).toBe(580);
    expect(getLedgerHistoricalBalances(workbook).cash).toBe(-580);
  });

  it('current refund candidates remain a documented decision rather than a summary rule', () => {
    const workbook = makeRefundWorkbook();
    const result = validateLedgerInvariants(workbook);
    const summary = summarizeLedgerActivity(workbook);

    expect(result.warnings.map((warning) => warning.code)).toContain(
      'transaction_unknown_template'
    );
    expect(summary.expense).toBe(2079);
  });

  it('flags malformed negative rows through invariants', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    workbook.transactions.push({
      id: 'txn-negative',
      date: '2026-06-19',
      template: 'expense_paid',
      description: 'Malformed negative',
      categoryId: 'food',
      amount: -10,
      baseAmount: -10,
      lines: [
        { accountId: 'food-expense', direction: 'debit', amount: -10, baseAmount: -10 },
        { accountId: 'cash', direction: 'credit', amount: -10, baseAmount: -10 }
      ]
    });

    const result = validateLedgerInvariants(workbook);
    expect(result.warnings.map((warning) => warning.code)).toContain('transaction_negative_amount');
    expect(result.warnings.map((warning) => warning.code)).toContain('line_non_positive_amount');
  });
});
