import { describe, expect, it } from 'vitest';

import {
  archiveAccount,
  deleteAccount,
  getAccountBalances,
  listSelectableAccounts,
  restoreAccount
} from '@cavalry/finance-core/application/accounts/account-management-service.js';
import {
  cloneAccountScenario,
  makeMinimalAccountWorkbook,
  makeNormalAccountWorkbook
} from '../fixtures/account-scenarios.js';

describe('account archive and delete workflow', () => {
  it('archives and restores active accounts without deleting transactions', () => {
    const workbook = makeNormalAccountWorkbook();
    const beforeTransactions = cloneAccountScenario(workbook.transactions);
    const beforeBalance = getAccountBalances(workbook).historical.cash;

    const archived = archiveAccount(workbook, 'cash');
    expect(archived).toMatchObject({ changed: true });
    expect(workbook.accounts.find((account) => account.id === 'cash').isActive).toBe(false);
    expect(workbook.transactions).toEqual(beforeTransactions);
    expect(getAccountBalances(workbook).historical.cash).toBe(beforeBalance);
    expect(
      listSelectableAccounts(workbook, { groups: 'asset' }).map((account) => account.id)
    ).not.toContain('cash');

    const restored = restoreAccount(workbook, 'cash');
    expect(restored).toMatchObject({ changed: true });
    expect(workbook.accounts.find((account) => account.id === 'cash').isActive).toBe(true);
    expect(
      listSelectableAccounts(workbook, { groups: 'asset' }).map((account) => account.id)
    ).toContain('cash');
  });

  it('archives referenced accounts instead of hard deleting them', () => {
    const workbook = makeNormalAccountWorkbook();
    const beforeTransactions = cloneAccountScenario(workbook.transactions);
    const result = deleteAccount(workbook, 'bank-checking');

    expect(result).toMatchObject({ changed: true, archived: true, deleted: false });
    expect(workbook.accounts.find((account) => account.id === 'bank-checking').isActive).toBe(
      false
    );
    expect(workbook.transactions).toEqual(beforeTransactions);
  });

  it('permanently deletes unused accounts and opening-balance-only accounts under current rules', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.accounts.push({
      id: 'unused',
      name: 'Unused',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isActive: true
    });
    workbook.accounts.push({
      id: 'setup-only',
      name: 'Setup Only',
      group: 'liability',
      subtype: 'credit_card',
      currency: 'PHP',
      isActive: true
    });
    workbook.transactions = [
      {
        id: 'txn-setup-only',
        date: '2026-06-01',
        monthKey: '2026-06',
        template: 'opening_balance',
        description: 'Setup Only opening balance',
        categoryId: '',
        amount: 500,
        baseAmount: 500,
        lines: [
          {
            id: 'line-equity',
            accountId: 'opening_balance_equity',
            direction: 'debit',
            amount: 500,
            currency: 'PHP',
            baseAmount: 500
          },
          {
            id: 'line-setup',
            accountId: 'setup-only',
            direction: 'credit',
            amount: 500,
            currency: 'PHP',
            baseAmount: 500
          }
        ]
      }
    ];

    expect(deleteAccount(workbook, 'unused')).toMatchObject({
      deleted: true,
      removedTransactionIds: []
    });
    expect(workbook.accounts.find((account) => account.id === 'unused')).toBeUndefined();

    expect(deleteAccount(workbook, 'setup-only')).toMatchObject({
      deleted: true,
      removedTransactionIds: ['txn-setup-only']
    });
    expect(workbook.accounts.find((account) => account.id === 'setup-only')).toBeUndefined();
    expect(workbook.transactions).toEqual([]);
  });

  it('fails safely for missing and system accounts and does not create drafts', () => {
    const workbook = makeMinimalAccountWorkbook();
    const before = cloneAccountScenario(workbook);

    expect(deleteAccount(workbook, 'missing')).toMatchObject({ changed: false });
    expect(archiveAccount(workbook, 'opening_balance_equity')).toMatchObject({ changed: false });
    expect(workbook).toEqual(before);
  });
});
