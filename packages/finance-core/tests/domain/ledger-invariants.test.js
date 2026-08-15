import { describe, expect, it } from 'vitest';
import { validateLedgerInvariants } from '@cavalry/finance-core/domain/ledger/invariants.js';
import {
  cloneFixture,
  makeDirtyLegacyWorkbook,
  makeDraftIsolationWorkbook,
  makeIncomeAndExpenseWorkbook,
  makeRefundWorkbook,
  makeTransferWorkbook
} from '../fixtures/core-workbook-fixtures.js';

function codes(list) {
  return list.map((item) => item.code);
}

describe('ledger invariants', () => {
  it('passes a balanced income and expense workbook with committed transactions', () => {
    const result = validateLedgerInvariants(makeIncomeAndExpenseWorkbook());

    expect(result.ok).toBe(true);
    expect(result.summary.transactionCount).toBe(5);
    expect(result.summary.income).toBe(50000);
    expect(result.summary.expense).toBe(2029);
    expect(result.summary.outflow).toBe(2029);
    expect(result.summary.net).toBe(47971);
    expect(result.summary.categoryTotals.food).toBe(250);
  });

  it('keeps transfers out of income and expense totals', () => {
    const result = validateLedgerInvariants(makeTransferWorkbook());

    expect(result.ok).toBe(true);
    expect(result.summary.income).toBe(0);
    expect(result.summary.expense).toBe(0);
    expect(result.summary.net).toBe(0);
    expect(result.summary.balances).toMatchObject({
      cash: -1000,
      bank: 1000
    });
  });

  it('reports identity, balance, date, category, and account problems without mutating input', () => {
    const workbook = makeDirtyLegacyWorkbook();
    const before = cloneFixture(workbook);
    const result = validateLedgerInvariants(workbook);

    expect(workbook).toEqual(before);
    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain('transaction_missing_category');
    expect(codes(result.errors)).toContain('transaction_invalid_date');
    expect(codes(result.warnings)).toContain('transaction_unknown_template');
  });

  it('flags duplicate transaction IDs and missing account references', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    workbook.transactions.push({
      ...cloneFixture(workbook.transactions[0]),
      categoryId: 'food',
      lines: [
        { accountId: 'food-expense', direction: 'debit', amount: 1, baseAmount: 1 },
        { accountId: 'missing-account', direction: 'credit', amount: 1, baseAmount: 1 }
      ]
    });

    const result = validateLedgerInvariants(workbook);
    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain('transaction_duplicate_id');
    expect(codes(result.errors)).toContain('line_missing_account');
  });

  it('keeps pending and rejected drafts isolated from committed totals', () => {
    const result = validateLedgerInvariants(makeDraftIsolationWorkbook());

    expect(result.ok).toBe(true);
    expect(result.summary.draftCount).toBe(3);
    expect(result.summary.expense).toBe(2029);
    expect(result.summary.categoryTotals.food).toBe(250);
  });

  it('recognizes merchant refunds as deliberate expense reversals', () => {
    const result = validateLedgerInvariants(makeRefundWorkbook());

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).not.toContain('transaction_unknown_template');
    expect(result.summary.expense).toBe(1979);
    expect(result.summary.categoryTotals.food).toBe(200);
  });
});
