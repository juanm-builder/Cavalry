import { describe, expect, it } from 'vitest';

import { buildImportPreview } from '@cavalry/finance-core/application/import-export/import-preview-service.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeMinimalWorkbook
} from '../fixtures/core-workbook-fixtures.js';

describe('import preview service', () => {
  it('builds ready transaction previews without mutating the workbook', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    const before = JSON.stringify(workbook);
    const preview = buildImportPreview(
      workbook,
      ['date,description,amount,account,category', '2026-06-02,Coffee,-250,Cash,Food'].join('\n')
    );

    expect(JSON.stringify(workbook)).toBe(before);
    expect(preview.summary.readyRows).toBe(1);
    expect(preview.rows[0].status).toBe('ready');
    expect(preview.rows[0].transaction.template).toBe('expense_paid');
    expect(preview.rows[0].transaction.lines).toHaveLength(2);
  });

  it('requires review for duplicate candidates before apply', () => {
    const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
    const preview = buildImportPreview(
      workbook,
      [
        'date,description,amount,account,category,template',
        '2026-06-01,Salary,50000,Bank,Salary,income_received'
      ].join('\n')
    );

    expect(preview.summary.readyRows).toBe(0);
    expect(preview.summary.needsReviewRows).toBe(1);
    expect(preview.summary.duplicateWarnings).toBe(1);
    expect(preview.rows[0].issues.some((issue) => issue.code === 'duplicate_candidate')).toBe(true);
  });

  it('keeps ambiguous or missing references out of the ready set', () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.accounts.push({
      id: 'cash-2',
      name: 'Cash',
      group: 'asset',
      currency: 'PHP',
      isActive: true
    });
    const preview = buildImportPreview(
      workbook,
      [
        'date,description,amount,account,category',
        '2026-06-03,Snack,-100,Cash,Food',
        '2026-06-04,Unknown,-100,No Match,Food'
      ].join('\n')
    );

    expect(preview.summary.readyRows).toBe(0);
    expect(preview.summary.needsReviewRows).toBe(2);
    expect(preview.rows[0].issues.some((issue) => issue.code === 'account_ambiguous')).toBe(true);
    expect(preview.rows[1].issues.some((issue) => issue.code === 'account_not_found')).toBe(true);
  });

  it('uses debit and credit columns to derive expense and income direction', () => {
    const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
    workbook.transactions = [];
    const preview = buildImportPreview(
      workbook,
      [
        'date,description,debit,credit,account,category',
        '2026-06-05,Lunch,300,,Cash,Food',
        '2026-06-06,Payday,,50000,Bank,Salary'
      ].join('\n')
    );

    expect(preview.summary.readyRows).toBe(2);
    expect(preview.rows.map((row) => row.transaction.template)).toEqual([
      'expense_paid',
      'income_received'
    ]);
  });
});
