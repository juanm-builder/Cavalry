import { describe, expect, it } from 'vitest';

import {
  getAccountBalances,
  updateAccount
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

describe('account rename and edit workflow', () => {
  it('renames active accounts while preserving IDs, transaction references, balances, and draft isolation', () => {
    const workbook = makeNormalAccountWorkbook();
    const beforeIds = workbook.transactions.map((transaction) => transaction.id);
    const beforeDrafts = cloneAccountScenario({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    });
    const beforeBalance = getAccountBalances(workbook).historical['bank-checking'];

    const result = updateAccount(workbook, 'bank-checking', {
      name: 'Bank Main',
      subtype: 'checking',
      currency: 'PHP',
      note: 'Primary bank'
    });

    expect(result.account).toMatchObject({
      id: 'bank-checking',
      name: 'Bank Main',
      subtype: 'checking',
      note: 'Primary bank'
    });
    expect(workbook.transactions.map((transaction) => transaction.id)).toEqual(beforeIds);
    expect(
      workbook.transactions.some((transaction) =>
        (transaction.lines || []).some((line) => line.accountId === 'bank-checking')
      )
    ).toBe(true);
    expect(getAccountBalances(workbook).historical['bank-checking']).toBe(beforeBalance);
    expect({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    }).toEqual(beforeDrafts);
  });

  it('renames archived accounts and roundtrips the edited display name', () => {
    const workbook = makeArchivedAccountWorkbook();
    const result = updateAccount(workbook, 'old-wallet', {
      name: 'Old Wallet Archive',
      subtype: 'wallet',
      currency: 'PHP',
      note: 'Closed account'
    });
    const parsed = parsePortableWorkbookText(buildPortableWorkbookHtml(workbook));

    expect(result.account).toMatchObject({
      id: 'old-wallet',
      name: 'Old Wallet Archive',
      isActive: false
    });
    expect(parsed.accounts.find((account) => account.id === 'old-wallet')).toMatchObject({
      name: 'Old Wallet Archive',
      isActive: false
    });
  });

  it('persists a safe custom icon, logo mode, opened date, and contextual details', () => {
    const workbook = makeNormalAccountWorkbook();
    const beforeTransactions = cloneAccountScenario(workbook.transactions);

    const result = updateAccount(workbook, 'bank-checking', {
      name: 'Bank Main',
      subtype: 'checking',
      currency: 'PHP',
      institution: 'BPI',
      institutionId: 'bpi',
      icon: 'savings',
      logoMode: 'icon',
      openedDate: '2025-12-31',
      note: 'Primary bank',
      details: {
        bankAccountType: 'checking',
        accountNumber: '9012',
        branch: 'Makati'
      }
    });

    expect(result.account).toMatchObject({
      id: 'bank-checking',
      institution: 'BPI',
      institutionId: 'bpi',
      icon: 'savings',
      logoMode: 'icon',
      openedDate: '2025-12-31',
      details: {
        bankAccountType: 'checking',
        accountNumber: '9012',
        branch: 'Makati'
      }
    });
    expect(workbook.transactions).toEqual(beforeTransactions);

    const beforeInvalidDate = cloneAccountScenario(workbook);
    expect(() =>
      updateAccount(workbook, 'bank-checking', {
        name: 'Bank Main',
        subtype: 'checking',
        currency: 'PHP',
        openedDate: 'not-a-date'
      })
    ).toThrow('Enter a valid account date');
    expect(workbook).toEqual(beforeInvalidDate);
  });

  it('edits time-deposit fields, allows duplicate display names, and rejects blank names safely', () => {
    const workbook = makeNormalAccountWorkbook();
    const before = cloneAccountScenario(workbook);
    const timeDeposit = updateAccount(workbook, 'freedom-fund', {
      name: 'Freedom Fund',
      subtype: 'time_deposit',
      currency: 'PHP',
      placementDate: '2026-06-01',
      maturityDate: '2026-12-01',
      interestRate: '5.5',
      estimatedMaturityAmount: '10550'
    });

    expect(timeDeposit.account).toMatchObject({
      subtype: 'time_deposit',
      placementDate: '2026-06-01',
      maturityDate: '2026-12-01',
      interestRate: 5.5,
      estimatedMaturityAmount: 10550
    });

    const editedBeforeInvalid = cloneAccountScenario(workbook);
    expect(() => updateAccount(workbook, 'freedom-fund', { name: '', currency: 'PHP' })).toThrow(
      'Account name is required.'
    );
    expect(workbook).toEqual(editedBeforeInvalid);
    expect(
      updateAccount(workbook, 'freedom-fund', {
        name: 'Cash',
        subtype: 'time_deposit',
        currency: 'PHP',
        placementDate: '2026-06-01',
        maturityDate: '2026-12-01',
        interestRate: '5.5',
        estimatedMaturityAmount: '10550'
      })
    ).toMatchObject({ changed: true, account: { name: 'Cash' } });
    expect(before.accounts.find((account) => account.id === 'freedom-fund').subtype).toBe(
      'savings'
    );
  });
});
