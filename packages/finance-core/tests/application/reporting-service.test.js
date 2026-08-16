import { describe, expect, it } from 'vitest';

import {
  buildAccountBalanceSummary,
  buildCategorySpendingReport,
  buildIncomeExpenseBreakdown,
  buildMonthlyCashFlowReport,
  buildTopDescriptionReport
} from '@cavalry/finance-core/application/reports/reporting-service.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeLine,
  makeMultiCurrencyWorkbook,
  makeRefundWorkbook,
  makeTransaction
} from '../fixtures/core-workbook-fixtures.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

describe('reporting service', () => {
  it('builds monthly cash flow while excluding transfers from income and spending', () => {
    const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
    workbook.transactions.push(
      makeTransaction({
        id: 'txn-transfer-report',
        date: '2026-06-12',
        template: 'transfer',
        description: 'Move cash',
        amount: 1000,
        lines: [makeLine('bank', 'debit', 1000), makeLine('cash', 'credit', 1000)]
      })
    );

    const report = buildMonthlyCashFlowReport(workbook);

    expect(report.summary.income).toBe(50000);
    expect(report.summary.expense).toBe(2029);
    expect(report.summary.net).toBe(47971);
    expect(report.summary.transferCount).toBe(1);
    expect(report.months).toHaveLength(1);
  });

  it('filters reports by date range', () => {
    const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
    const report = buildIncomeExpenseBreakdown(workbook, {
      start: '2026-06-02',
      end: '2026-06-03'
    });

    expect(report.income).toBe(0);
    expect(report.expense).toBe(1280);
    expect(report.net).toBe(-1280);
  });

  it('nets merchant refunds across cash flow, categories, and descriptions', () => {
    const workbook = makeRefundWorkbook();
    const cashFlow = buildMonthlyCashFlowReport(workbook);
    const spending = buildCategorySpendingReport(workbook);
    const descriptions = buildTopDescriptionReport(workbook);
    const food = spending.rows.find((row) => row.categoryId === 'food');
    const refund = descriptions.rows.find((row) => row.description === 'Store refund candidate');

    expect(cashFlow.summary).toMatchObject({
      expense: 1979,
      outflow: 1979,
      net: -1979,
      transactionCount: 5
    });
    expect(spending).toMatchObject({ total: 1979, transactionCount: 5 });
    expect(food).toMatchObject({ total: 200, transactionCount: 2 });
    expect(refund).toMatchObject({ kind: 'expense', total: -50, transactionCount: 1 });
    expect(cashFlow.limitations).not.toContain('refunds_are_not_separately_modeled');
    expect(spending.limitations).not.toContain('refunds_are_not_separately_modeled');
  });

  it('reports category spending with archived and missing references visible', () => {
    const workbook = makeTransactionTableWorkbook();
    const report = buildCategorySpendingReport(workbook);

    expect(report.rows.find((row) => row.categoryId === 'archived-shopping').isArchived).toBe(true);
    expect(report.rows.find((row) => row.categoryId === 'missing-category').isMissing).toBe(true);
    expect(report.limitations).toContain('missing_category_references');
    expect(report.limitations).toContain('missing_account_references');
  });

  it('summarizes account balances including archived accounts and missing line references', () => {
    const workbook = makeTransactionTableWorkbook();
    const summary = buildAccountBalanceSummary(workbook);

    expect(summary.accounts.find((account) => account.accountId === 'wallet-usd').isArchived).toBe(
      true
    );
    expect(summary.missingAccountIds).toEqual(['missing-account']);
    expect(summary.limitations).toContain('missing_account_references');
  });

  it('builds top description rows and flags multi-currency base amount limitations', () => {
    const workbook = cloneFixture(makeMultiCurrencyWorkbook());
    const descriptions = buildTopDescriptionReport(workbook);
    const spending = buildCategorySpendingReport(workbook);

    expect(descriptions.rows[0]).toMatchObject({
      description: 'USD software',
      total: 580,
      transactionCount: 1
    });
    expect(spending.limitations).toContain('multi_currency_base_amounts');
  });
});
