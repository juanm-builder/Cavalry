import { describe, expect, it } from 'vitest';

import {
  buildTransactionRows,
  previewTransactionTableInlineEdit
} from '@cavalry/finance-core/application/transactions/transaction-table-service.js';
import { validateLedgerInvariants } from '@cavalry/finance-core/domain/ledger/invariants.js';
import { cloneFixture } from '../fixtures/core-workbook-fixtures.js';
import { makeTransactionTableWorkbook } from '../fixtures/transaction-table-scenarios.js';

function createId(prefix, index) {
  return `${prefix}_inline_${index}`;
}

describe('transaction table inline edit safety', () => {
  it('marks standard manual rows as inline editable and manual journals as non-editable', () => {
    const rows = buildTransactionRows(makeTransactionTableWorkbook());

    expect(rows.find((row) => row.id === 'txn-coffee').inlineEditable).toBe(true);
    expect(rows.find((row) => row.id === 'txn-uncategorized').inlineEditable).toBe(false);
  });

  it('previews description, amount, date, category, account, and template edits without mutating workbook', () => {
    const workbook = makeTransactionTableWorkbook();
    const before = cloneFixture(workbook);
    const description = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'description', value: 'Better coffee' },
      { createId }
    );
    const amount = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'amount', value: '300' },
      { createId }
    );
    const date = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'date', value: '2026-06-10' },
      { createId }
    );
    const category = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'categoryId', value: 'transport' },
      { createId }
    );
    const account = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'primaryAccountId', value: 'bank' },
      { createId }
    );
    const template = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'template', value: 'expense_paid' },
      { createId }
    );

    expect(description.transaction).toMatchObject({
      id: 'txn-coffee',
      description: 'Better coffee'
    });
    expect(amount.transaction).toMatchObject({ id: 'txn-coffee', amount: 300 });
    expect(date.transaction).toMatchObject({ id: 'txn-coffee', date: '2026-06-10' });
    expect(category.transaction).toMatchObject({ id: 'txn-coffee', categoryId: 'transport' });
    expect(account.transaction.lines.some((line) => line.accountId === 'bank')).toBe(true);
    expect(template.transaction).toMatchObject({ id: 'txn-coffee', template: 'expense_paid' });
    expect(workbook).toEqual(before);
  });

  it('returns safe failures for invalid inline edits and preserves IDs on success', () => {
    const workbook = makeTransactionTableWorkbook();
    const invalidAmount = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'amount', value: '0' },
      { createId }
    );
    const invalidField = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'note', value: 'Nope' },
      { createId }
    );
    const missingTransaction = previewTransactionTableInlineEdit(
      workbook,
      'missing',
      { field: 'amount', value: '1' },
      { createId }
    );
    const valid = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'amount', value: '350' },
      { createId }
    );

    expect(invalidAmount).toMatchObject({ ok: false, error: 'Enter a valid amount.' });
    expect(invalidField).toMatchObject({
      ok: false,
      error: 'This transaction field cannot be edited inline.'
    });
    expect(missingTransaction.ok).toBe(false);
    expect(valid.transaction.id).toBe('txn-coffee');
  });

  it('does not create drafts and can keep workbook invariants passing after committed replacement', () => {
    const workbook = makeTransactionTableWorkbook();
    workbook.transactions = workbook.transactions.filter(
      (transaction) => transaction.id !== 'txn-missing'
    );
    const beforeDrafts = cloneFixture({
      aiDrafts: workbook.aiDrafts || [],
      externalDraftGroups: workbook.externalDraftGroups || []
    });
    const index = workbook.transactions.findIndex((transaction) => transaction.id === 'txn-coffee');
    const preview = previewTransactionTableInlineEdit(
      workbook,
      'txn-coffee',
      { field: 'amount', value: '275' },
      { createId }
    );

    workbook.transactions[index] = preview.transaction;

    expect(preview.ok).toBe(true);
    expect({
      aiDrafts: workbook.aiDrafts || [],
      externalDraftGroups: workbook.externalDraftGroups || []
    }).toEqual(beforeDrafts);
    expect(validateLedgerInvariants(workbook).ok).toBe(true);
  });
});
