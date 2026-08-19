import { describe, expect, it } from 'vitest';

import { submitManualTransactionCommand } from '@cavalry/finance-core/application/transactions/transaction-command-service.js';
import { summarizeLedgerActivity } from '@cavalry/finance-core/domain/ledger/transactions.js';
import {
  cloneFixture,
  makeDraftIsolationWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

describe('manual transaction integration', () => {
  it('commits manual creation to transactions without creating or applying drafts', () => {
    const workbook = makeDraftIsolationWorkbook();
    const beforeDrafts = {
      aiDrafts: cloneFixture(workbook.aiDrafts),
      externalDraftGroups: cloneFixture(workbook.externalDraftGroups),
      advisorDraftGroups: cloneFixture(workbook.advisorDraftGroups || [])
    };
    const result = submitManualTransactionCommand(workbook, {
      template: 'expense_paid',
      description: 'Manual coffee',
      amount: 120,
      currency: 'PHP',
      date: '2026-06-30',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(result.workbook.transactions).toHaveLength(workbook.transactions.length + 1);
    expect(result.workbook.transactions.at(-1)).toMatchObject({
      description: 'Manual coffee',
      source: 'manual',
      template: 'expense_paid'
    });
    expect(workbook.aiDrafts).toEqual(beforeDrafts.aiDrafts);
    expect(workbook.externalDraftGroups).toEqual(beforeDrafts.externalDraftGroups);
    expect(workbook.advisorDraftGroups || []).toEqual(beforeDrafts.advisorDraftGroups);
    expect(result.workbook.aiDrafts).toEqual(beforeDrafts.aiDrafts);
    expect(result.workbook.externalDraftGroups).toEqual(beforeDrafts.externalDraftGroups);
    expect(result.workbook.advisorDraftGroups || []).toEqual(beforeDrafts.advisorDraftGroups);
    expect(summarizeLedgerActivity(result.workbook).categoryTotals.food).toBe(370);
  });

  it('edits a committed transaction while preserving ID and replacing only the committed row', () => {
    const workbook = makeDraftIsolationWorkbook();
    const index = workbook.transactions.findIndex(
      (transaction) => transaction.id === 'txn-food-cash'
    );
    const existing = workbook.transactions[index];
    const beforeDrafts = cloneFixture(workbook.aiDrafts);
    const result = submitManualTransactionCommand(workbook, {
      transactionId: existing.id,
      template: existing.template,
      description: 'Manual lunch edit',
      amount: 300,
      currency: existing.originalCurrency,
      date: existing.date,
      categoryId: existing.categoryId,
      primaryAccountId: 'cash'
    });

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(result.workbook.transactions[index]).toMatchObject({
      id: existing.id,
      description: 'Manual lunch edit',
      amount: 300
    });
    expect(workbook.aiDrafts).toEqual(beforeDrafts);
    expect(summarizeLedgerActivity(result.workbook).categoryTotals.food).toBe(300);
  });

  it('does not corrupt workbook state when manual creation is invalid', () => {
    const workbook = makeDraftIsolationWorkbook();
    const before = cloneFixture(workbook);

    const result = submitManualTransactionCommand(workbook, {
      template: 'expense_paid',
      description: 'Invalid manual transaction',
      amount: 0,
      currency: 'PHP',
      date: '2026-06-30',
      categoryId: 'food',
      primaryAccountId: 'cash'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: 'transaction.submit_failed',
      message: 'Enter a valid amount.'
    });
    expect(workbook).toEqual(before);
  });
});
