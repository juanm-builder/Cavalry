import { describe, expect, it } from 'vitest';

import {
  createAccount,
  deleteAccount,
  listSelectableAccounts,
  updateAccount
} from '@cavalry/finance-core/application/accounts/account-management-service.js';
import {
  makeMinimalAccountWorkbook,
  makeNormalAccountWorkbook
} from '@cavalry/finance-core/test-fixtures/account-scenarios.js';

function rendererLikeServices() {
  let lineCounter = 0;
  let transactionCounter = 0;
  return {
    normalizeAccount(input, index, baseCurrency) {
      return {
        id: 'account_' + String(index + 1),
        name: String(input.name || '').trim(),
        group: input.group,
        subtype: String(input.subtype || '').trim(),
        currency: String(input.currency || baseCurrency || 'PHP')
          .trim()
          .toUpperCase(),
        note: String(input.note || ''),
        openedDate: String(input.openedDate || '2026-06-30'),
        placementDate: String(input.placementDate || ''),
        maturityDate: String(input.maturityDate || ''),
        interestRate: Number(input.interestRate) || 0,
        withholdingTaxRate: 20,
        interestPostingStartDate: '',
        estimatedMaturityAmount: Number(input.estimatedMaturityAmount) || 0,
        isSystem: false,
        isActive: true
      };
    },
    createLine(_workbook, accountId, direction, amount, currency, note) {
      lineCounter += 1;
      return {
        id: 'line_' + String(lineCounter),
        accountId,
        direction,
        amount,
        currency,
        baseAmount: amount,
        note
      };
    },
    normalizeTransaction(transaction) {
      transactionCounter += 1;
      return Object.assign(
        {
          id: 'txn_' + String(transactionCounter),
          monthKey: transaction.date.slice(0, 7),
          categoryId: '',
          reference: '',
          counterpartyId: '',
          recurringItemId: '',
          note: '',
          fxRateToBase: 0
        },
        transaction,
        {
          baseAmount: transaction.amount
        }
      );
    }
  };
}

describe('account management integration', () => {
  it('preserves create output shape, trimming, defaults, opening-balance behavior, and validation copy', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.transactions = [];
    const result = createAccount(
      workbook,
      {
        name: '  New Bank  ',
        group: 'asset',
        subtype: '',
        currency: 'PHP',
        openedDate: '2026-06-01',
        openingBalance: '500'
      },
      rendererLikeServices()
    );

    expect(result.account).toMatchObject({
      id: 'account_4',
      name: 'New Bank',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      openedDate: '2026-06-01',
      isActive: true
    });
    expect(result.openingTransaction).toMatchObject({
      template: 'opening_balance',
      description: 'New Bank opening balance',
      amount: 500
    });
    expect(() =>
      createAccount(workbook, { name: '', openedDate: '2026-06-01' }, rendererLikeServices())
    ).toThrow('Account name is required.');
  });

  it('preserves edit, selector, and archive/delete policy', () => {
    const workbook = makeNormalAccountWorkbook();
    const edited = updateAccount(
      workbook,
      'cash',
      {
        name: 'Cash Main',
        subtype: 'wallet',
        currency: 'PHP',
        note: 'Pocket'
      },
      rendererLikeServices()
    );
    const archived = deleteAccount(workbook, 'cash');

    expect(edited.account).toMatchObject({
      id: 'cash',
      name: 'Cash Main',
      subtype: 'wallet',
      note: 'Pocket'
    });
    expect(archived).toMatchObject({ archived: true, deleted: false });
    expect(
      listSelectableAccounts(workbook, { groups: 'asset' }).map((account) => account.id)
    ).not.toContain('cash');
  });
});
