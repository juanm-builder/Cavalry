import { describe, expect, it } from 'vitest';

import { buildLegacyTransactionFromComposerFields } from '@cavalry/finance-core/application/transactions/legacy-transaction-composer-adapter.js';
import {
  getAccountBalances,
  listSelectableAccounts
} from '@cavalry/finance-core/application/accounts/account-management-service.js';
import {
  buildPortableWorkbookHtml,
  parsePortableWorkbookText
} from '@cavalry/finance-core/domain/workbook/portable.js';
import {
  cloneAccountScenario,
  makeArchivedAccountWorkbook,
  makeNormalAccountWorkbook
} from '../fixtures/account-scenarios.js';

function services() {
  return {
    createId(prefix) {
      return prefix + '_assignment';
    },
    getAccountById(workbook, accountId) {
      return (workbook.accounts || []).find((account) => account.id === accountId) || null;
    },
    getCategoryById(workbook, categoryId) {
      return (workbook.categories || []).find((category) => category.id === categoryId) || null;
    }
  };
}

function build(workbook, fields, existing = null, index = 0) {
  return buildLegacyTransactionFromComposerFields(
    workbook,
    fields,
    existing,
    index,
    {
      source: 'manual',
      reference: ''
    },
    services()
  );
}

describe('account assignment workflow', () => {
  it('assigns a new transaction to an active account and updates balances without drafts', () => {
    const workbook = makeNormalAccountWorkbook();
    const beforeDrafts = cloneAccountScenario({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    });
    const transaction = build(
      workbook,
      {
        template: 'expense_paid',
        description: 'Wallet lunch',
        amount: 100,
        currency: 'PHP',
        date: '2026-06-20',
        categoryId: 'food',
        primaryAccountId: 'gcash'
      },
      null,
      workbook.transactions.length
    );

    workbook.transactions.push(transaction);

    expect(transaction.lines[1]).toMatchObject({ accountId: 'gcash', direction: 'credit' });
    expect(getAccountBalances(workbook).historical.gcash).toBe(-100);
    expect({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    }).toEqual(beforeDrafts);
  });

  it('moves a transaction between accounts while preserving ID and category fields', () => {
    const workbook = makeNormalAccountWorkbook();
    const index = workbook.transactions.findIndex(
      (transaction) => transaction.id === 'txn-food-cash'
    );
    const existing = workbook.transactions[index];
    const beforeTransactionIds = workbook.transactions.map((transaction) => transaction.id);
    const edited = build(
      workbook,
      {
        template: existing.template,
        description: existing.description,
        amount: existing.amount,
        currency: existing.originalCurrency,
        date: existing.date,
        categoryId: existing.categoryId,
        primaryAccountId: 'gcash'
      },
      existing,
      index
    );

    workbook.transactions[index] = edited;

    expect(edited).toMatchObject({ id: existing.id, categoryId: existing.categoryId });
    expect(edited.lines[1]).toMatchObject({ accountId: 'gcash', direction: 'credit' });
    expect(workbook.transactions.map((transaction) => transaction.id)).toEqual(
      beforeTransactionIds
    );
    expect(getAccountBalances(workbook).historical.cash).toBe(0);
    expect(getAccountBalances(workbook).historical.gcash).toBe(-250);
  });

  it('hides archived accounts from selectors while direct adapter calls still preserve current ID-based behavior', () => {
    const workbook = makeArchivedAccountWorkbook();
    const before = cloneAccountScenario(workbook);

    const archivedAssignment = build(
      workbook,
      {
        template: 'expense_paid',
        description: 'Archived wallet attempt',
        amount: 100,
        currency: 'PHP',
        date: '2026-06-20',
        categoryId: 'food',
        primaryAccountId: 'old-wallet'
      },
      null,
      workbook.transactions.length
    );

    expect(archivedAssignment.lines[1]).toMatchObject({ accountId: 'old-wallet' });
    expect(() =>
      build(
        workbook,
        {
          template: 'expense_paid',
          description: 'Missing account attempt',
          amount: 100,
          currency: 'PHP',
          date: '2026-06-20',
          categoryId: 'food',
          primaryAccountId: 'missing'
        },
        null,
        workbook.transactions.length
      )
    ).toThrow('Choose an asset account to fund the payment.');
    expect(workbook).toEqual(before);
    expect(
      listSelectableAccounts(workbook, { groups: 'asset' }).map((account) => account.id)
    ).not.toContain('old-wallet');
  });

  it('roundtrips account reassignment through workbook export/import', () => {
    const workbook = makeNormalAccountWorkbook();
    const index = workbook.transactions.findIndex(
      (transaction) => transaction.id === 'txn-food-cash'
    );
    workbook.transactions[index] = build(
      workbook,
      {
        template: 'expense_paid',
        description: 'Roundtrip reassignment',
        amount: 250,
        currency: 'PHP',
        date: '2026-06-02',
        categoryId: 'food',
        primaryAccountId: 'gcash'
      },
      workbook.transactions[index],
      index
    );
    const parsed = parsePortableWorkbookText(buildPortableWorkbookHtml(workbook));

    expect(parsed.transactions[index].lines[1]).toMatchObject({ accountId: 'gcash' });
  });
});
