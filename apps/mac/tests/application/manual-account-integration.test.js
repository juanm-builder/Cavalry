import { describe, expect, it } from 'vitest';

import {
  createAccount,
  deleteAccount,
  getAccountBalances,
  updateAccount
} from '@cavalry/finance-core/application/accounts/account-management-service.js';
import {
  cloneAccountScenario,
  makeMinimalAccountWorkbook,
  makeNormalAccountWorkbook
} from '@cavalry/finance-core/test-fixtures/account-scenarios.js';

describe('manual account integration', () => {
  it('creates an account without creating transactions or drafts when opening balance is blank', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.transactions = [];
    const beforeDrafts = cloneAccountScenario({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    });
    const result = createAccount(workbook, {
      name: 'Renderer Cash',
      group: 'asset',
      currency: 'PHP',
      openedDate: '2026-06-01'
    });

    expect(result.account).toMatchObject({ name: 'Renderer Cash', group: 'asset' });
    expect(workbook.transactions).toEqual([]);
    expect({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    }).toEqual(beforeDrafts);
  });

  it('renames and archives accounts without deleting committed transactions', () => {
    const workbook = makeNormalAccountWorkbook();
    const beforeTransactions = cloneAccountScenario(workbook.transactions);
    const beforeBalance = getAccountBalances(workbook).historical.cash;

    updateAccount(workbook, 'cash', { name: 'Cash Main', subtype: 'cash', currency: 'PHP' });
    const deleted = deleteAccount(workbook, 'cash');

    expect(workbook.accounts.find((account) => account.id === 'cash')).toMatchObject({
      name: 'Cash Main',
      isActive: false
    });
    expect(deleted).toMatchObject({ archived: true, deleted: false });
    expect(workbook.transactions).toEqual(beforeTransactions);
    expect(getAccountBalances(workbook).historical.cash).toBe(beforeBalance);
  });
});
