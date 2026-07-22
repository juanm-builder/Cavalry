import { describe, expect, it } from 'vitest';
import { getLedgerHistoricalBalances } from '@cavalry/finance-core/domain/ledger/balances.js';
import {
  buildManualLedgerTransaction,
  summarizeLedgerActivity
} from '@cavalry/finance-core/domain/ledger/transactions.js';
import { cloneFixture, makeIncomeAndExpenseWorkbook } from '../fixtures/core-workbook-fixtures.js';
import { makeCategoryEditWorkbook } from '../fixtures/ledger-scenarios.js';

describe('manual transaction editing model', () => {
  it('edits description while preserving transaction identity and totals', () => {
    const workbook = makeCategoryEditWorkbook();
    const existing = workbook.transactions[0];
    const edited = buildManualLedgerTransaction(
      workbook,
      {
        template: existing.template,
        description: 'Updated food',
        amount: existing.amount,
        date: existing.date,
        categoryId: existing.categoryId,
        primaryAccountId: 'cash'
      },
      existing,
      0
    );

    expect(edited.id).toBe(existing.id);
    expect(edited.description).toBe('Updated food');
    expect(summarizeLedgerActivity({ ...workbook, transactions: [edited] }).expense).toBe(300);
  });

  it('edits amount and updates category/account totals for the same transaction ID', () => {
    const workbook = makeCategoryEditWorkbook();
    const existing = workbook.transactions[0];
    const edited = buildManualLedgerTransaction(
      workbook,
      {
        template: existing.template,
        description: existing.description,
        amount: 450,
        date: existing.date,
        categoryId: existing.categoryId,
        primaryAccountId: 'cash'
      },
      existing,
      0
    );

    workbook.transactions[0] = edited;
    expect(edited.id).toBe('txn-edit');
    expect(summarizeLedgerActivity(workbook).expense).toBe(450);
    expect(getLedgerHistoricalBalances(workbook).cash).toBe(-450);
  });

  it('edits date and category while preserving ID and moving category totals', () => {
    const workbook = makeCategoryEditWorkbook();
    const existing = workbook.transactions[0];
    const edited = buildManualLedgerTransaction(
      workbook,
      {
        template: existing.template,
        description: existing.description,
        amount: existing.amount,
        date: '2026-07-01',
        categoryId: 'transport',
        primaryAccountId: 'cash'
      },
      existing,
      0
    );

    workbook.transactions[0] = edited;
    const june = summarizeLedgerActivity(workbook, { start: '2026-06-01', end: '2026-06-30' });
    const july = summarizeLedgerActivity(workbook, { start: '2026-07-01', end: '2026-07-31' });
    expect(edited.id).toBe(existing.id);
    expect(edited.date).toBe('2026-07-01');
    expect(june.expense).toBe(0);
    expect(july.categoryTotals.transport).toBe(300);
    expect(july.categoryTotals.food).toBeUndefined();
  });

  it('edits account and direction/template with consistent balances', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const existing = workbook.transactions.find(
      (transaction) => transaction.id === 'txn-food-cash'
    );
    const bankFunded = buildManualLedgerTransaction(
      workbook,
      {
        template: 'expense_paid',
        description: existing.description,
        amount: existing.amount,
        date: existing.date,
        categoryId: existing.categoryId,
        primaryAccountId: 'bank'
      },
      existing,
      1
    );
    const income = buildManualLedgerTransaction(
      workbook,
      {
        template: 'income_received',
        description: 'Corrected as income',
        amount: existing.amount,
        date: existing.date,
        categoryId: 'salary',
        primaryAccountId: 'bank'
      },
      existing,
      1
    );

    expect(bankFunded.id).toBe(existing.id);
    expect(bankFunded.lines[1].accountId).toBe('bank');
    expect(income.id).toBe(existing.id);
    expect(income.template).toBe('income_received');
    expect(income.lines[0]).toMatchObject({ accountId: 'bank', direction: 'debit' });
    expect(income.lines[1]).toMatchObject({ accountId: 'salary-income', direction: 'credit' });
  });

  it('rejects invalid edits without leaving partial corrupt state', () => {
    const workbook = makeCategoryEditWorkbook();
    const before = cloneFixture(workbook);
    const existing = workbook.transactions[0];

    expect(() =>
      buildManualLedgerTransaction(
        workbook,
        {
          template: existing.template,
          amount: Number.NaN,
          date: existing.date,
          categoryId: existing.categoryId,
          primaryAccountId: 'cash'
        },
        existing,
        0
      )
    ).toThrow('valid amount');
    expect(() =>
      buildManualLedgerTransaction(
        workbook,
        {
          template: 'expense_paid',
          amount: 300,
          date: 'not-a-date',
          categoryId: existing.categoryId,
          primaryAccountId: 'cash'
        },
        existing,
        0
      )
    ).toThrow('transaction date');
    expect(() =>
      buildManualLedgerTransaction(
        workbook,
        {
          template: 'expense_paid',
          amount: 300,
          date: existing.date,
          categoryId: 'archived-shopping',
          primaryAccountId: 'cash'
        },
        existing,
        0
      )
    ).not.toThrow();
    expect(workbook).toEqual(before);
  });

  it('documents undo/history and currency edit limitations', () => {
    const workbook = makeCategoryEditWorkbook();
    workbook.settings.usdToBaseRate = 0;
    const existing = workbook.transactions[0];

    expect(existing.history).toBeUndefined();
    expect(() =>
      buildManualLedgerTransaction(
        workbook,
        {
          template: existing.template,
          amount: 10,
          date: existing.date,
          categoryId: existing.categoryId,
          primaryAccountId: 'cash',
          currency: 'USD'
        },
        existing,
        0
      )
    ).toThrow('USD rate');
  });
});
