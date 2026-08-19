import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_ACTIONS,
  executeAccountCommand
} from '../../src/renderer/features/accounts/account-controller.js';

function makeWorkbook() {
  return {
    id: 'account-edit-command-workbook',
    version: 2,
    name: 'Account edit commands',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'old-wallet',
        name: 'Old Wallet',
        group: 'asset',
        subtype: 'wallet',
        institution: 'GCash',
        institutionId: 'gcash',
        currency: 'PHP',
        openedDate: '2025-01-01',
        note: 'Historical wallet',
        details: {
          mobileNumber: '09170000000',
          email: 'old@example.com',
          accountReference: 'OLD-REF'
        },
        isActive: false
      },
      {
        id: 'opening-balance-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      }
    ],
    categories: [],
    transactions: [
      {
        id: 'txn-wallet-opening',
        date: '2025-01-01',
        template: 'opening_balance',
        description: 'Old Wallet opening balance',
        amount: 2500,
        baseAmount: 2500,
        lines: [
          {
            id: 'line-wallet-opening',
            accountId: 'old-wallet',
            direction: 'debit',
            amount: 2500,
            currency: 'PHP',
            baseAmount: 2500
          },
          {
            id: 'line-equity-opening',
            accountId: 'opening-balance-equity',
            direction: 'credit',
            amount: 2500,
            currency: 'PHP',
            baseAmount: 2500
          }
        ]
      }
    ],
    recurringItems: [],
    sheets: []
  };
}

describe('account edit command', () => {
  it('updates an archived account provider and contextual details on a cloned workbook', () => {
    const workbook = makeWorkbook();
    const originalTransactions = structuredClone(workbook.transactions);
    const originalAccount = structuredClone(workbook.accounts[0]);

    const result = executeAccountCommand(workbook, {
      type: ACCOUNT_ACTIONS.UPDATE,
      payload: {
        accountId: 'old-wallet',
        name: 'Archived Maya Wallet',
        group: 'asset',
        subtype: 'wallet',
        institution: 'Maya',
        institutionId: 'mayawallet',
        icon: 'account_balance_wallet',
        logoMode: 'institution',
        currency: 'PHP',
        openedDate: '2025-02-02',
        note: 'Keep for historical reporting',
        details: {
          mobileNumber: '09181234567',
          email: 'maya@example.com',
          accountReference: 'MAYA-REF'
        }
      }
    });

    expect(result).toMatchObject({
      ok: true,
      warnings: [],
      errors: [],
      events: [{ type: 'account.updated', accountId: 'old-wallet' }]
    });
    expect(result.workbook).not.toBe(workbook);
    expect(result.workbook.accounts.find((account) => account.id === 'old-wallet')).toMatchObject({
      id: 'old-wallet',
      name: 'Archived Maya Wallet',
      group: 'asset',
      subtype: 'wallet',
      institution: 'Maya',
      institutionId: 'mayawallet',
      icon: 'account_balance_wallet',
      logoMode: 'institution',
      currency: 'PHP',
      openedDate: '2025-02-02',
      note: 'Keep for historical reporting',
      details: {
        mobileNumber: '09181234567',
        email: 'maya@example.com',
        accountReference: 'MAYA-REF'
      },
      isActive: false
    });
    expect(result.workbook.transactions).toEqual(originalTransactions);
    expect(
      result.workbook.transactions[0].lines.some((line) => line.accountId === 'old-wallet')
    ).toBe(true);

    expect(workbook.accounts[0]).toEqual(originalAccount);
    expect(workbook.transactions).toEqual(originalTransactions);
  });

  it('returns the original workbook when an account edit is invalid', () => {
    const workbook = makeWorkbook();
    const before = structuredClone(workbook);

    const result = executeAccountCommand(workbook, {
      type: ACCOUNT_ACTIONS.UPDATE,
      payload: {
        accountId: 'old-wallet',
        name: '',
        subtype: 'wallet',
        institution: 'Maya',
        institutionId: 'mayawallet',
        currency: 'PHP',
        details: { mobileNumber: '09181234567' }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.workbook).toBe(workbook);
    expect(result.errors[0]).toMatchObject({ code: 'account_name_required' });
    expect(workbook).toEqual(before);
  });
});
