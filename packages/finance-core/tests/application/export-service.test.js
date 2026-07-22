import { describe, expect, it } from 'vitest';

import {
  exportAccountsCsv,
  exportCategoriesCsv,
  exportTransactionsCsv,
  exportWorkbookCsvBundle,
  formatCsv
} from '@cavalry/finance-core/application/import-export/export-service.js';
import { buildChatGptContextPack } from '@cavalry/finance-core/application/import-export/chatgpt-context-pack-export.js';
import { cloneFixture, makeIncomeAndExpenseWorkbook } from '../fixtures/core-workbook-fixtures.js';

describe('export service', () => {
  it('formats CSV with deterministic quoting', () => {
    expect(
      formatCsv([
        ['name', 'note'],
        ['Lunch, set', 'He said "yes"']
      ])
    ).toBe('name,note\n"Lunch, set","He said ""yes"""\n');
  });

  it('exports transaction rows with roundtrip-friendly account and category columns', () => {
    const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
    const csv = exportTransactionsCsv(workbook);

    expect(csv.split('\n')[0]).toContain(
      'transaction_id,date,description,template,amount,currency,account_id,account,category_id,category'
    );
    expect(csv).toContain(
      'txn-salary,2026-06-01,Salary,income_received,50000,PHP,bank,Bank,salary,Salary'
    );
    expect(csv).toContain(
      'txn-food-cash,2026-06-01,Lunch,expense_paid,250,PHP,cash,Cash,food,Food'
    );
  });

  it('exports accounts and categories without workbook-local save metadata', () => {
    const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
    workbook.nativeWorkbookFile = { path: '/tmp/private.cavalry.html' };
    workbook.settings.apiKey = 'secret';

    const accounts = exportAccountsCsv(workbook);
    const categories = exportCategoriesCsv(workbook);
    const bundle = exportWorkbookCsvBundle(workbook);

    expect(accounts).toContain('account_id,name,group,currency,is_active,is_system');
    expect(categories).toContain('category_id,name,type,currency,linked_account_id,is_active');
    expect(Object.keys(bundle)).toEqual(['transactions.csv', 'accounts.csv', 'categories.csv']);
    expect(accounts + categories + bundle['transactions.csv']).not.toContain('/tmp/private');
    expect(accounts + categories + bundle['transactions.csv']).not.toContain('secret');
  });

  it('includes account balances in ChatGPT context packs outside summary-only mode', () => {
    const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
    const pack = buildChatGptContextPack(workbook, {
      privacyMode: 'redacted_details',
      asOfDate: '2026-06-30'
    });
    const summaryOnly = buildChatGptContextPack(workbook, {
      privacyMode: 'summary_only',
      asOfDate: '2026-06-30'
    });

    expect(pack.files['Accounts_Summary.csv'].split('\n')[0]).toContain(
      'balance,balance_currency,balance_as_of,source_ref'
    );
    expect(pack.files['Accounts_Summary.csv']).toContain('2026-06-30');
    expect(pack.files['Financial_Brief.md']).toContain('Account net worth');
    expect(summaryOnly.files['Accounts_Summary.csv']).toBeUndefined();
    expect(summaryOnly.files['Financial_Brief.md']).toContain('Account assets');
  });
});
