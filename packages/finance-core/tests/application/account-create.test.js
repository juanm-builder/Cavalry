import { describe, expect, it } from 'vitest';

import {
  createAccount,
  listSelectableAccounts,
  updateAccount
} from '@cavalry/finance-core/application/accounts/account-management-service.js';
import { summarizeLedgerActivity } from '@cavalry/finance-core/domain/ledger/transactions.js';
import {
  buildPortableWorkbookHtml,
  parsePortableWorkbookText
} from '@cavalry/finance-core/domain/workbook/portable.js';
import { cloneAccountScenario, makeMinimalAccountWorkbook } from '../fixtures/account-scenarios.js';

function services() {
  return {
    today: () => '2026-06-30',
    normalizeAccount(input, index, baseCurrency) {
      return {
        id: 'created_' + String(index + 1),
        name: String(input.name || '').trim(),
        group: input.group,
        subtype: input.subtype,
        currency: String(input.currency || baseCurrency || 'PHP').toUpperCase(),
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
    }
  };
}

describe('account creation workflow', () => {
  it('creates common account kinds and makes them selectable', () => {
    const workbook = makeMinimalAccountWorkbook();
    const cash = createAccount(
      workbook,
      { name: 'Cash Test', group: 'asset', openedDate: '2026-06-01' },
      services()
    );
    const bank = createAccount(
      workbook,
      { name: 'Bank Checking Test', group: 'asset', subtype: 'bank', openedDate: '2026-06-01' },
      services()
    );
    const wallet = createAccount(
      workbook,
      { name: 'Wallet Test', group: 'asset', subtype: 'wallet', openedDate: '2026-06-01' },
      services()
    );
    const savings = createAccount(
      workbook,
      { name: 'Savings Test', group: 'short_term_asset', openedDate: '2026-06-01' },
      services()
    );
    const card = createAccount(
      workbook,
      { name: 'Credit Card Test', group: 'liability', openedDate: '2026-06-01' },
      services()
    );

    expect(cash.account).toMatchObject({ name: 'Cash Test', group: 'asset', subtype: 'cash' });
    expect(bank.account).toMatchObject({ subtype: 'bank' });
    expect(wallet.account).toMatchObject({ subtype: 'wallet' });
    expect(savings.account).toMatchObject({ group: 'asset', subtype: 'time_deposit' });
    expect(card.account).toMatchObject({ group: 'liability', subtype: 'credit_card' });
    expect(
      listSelectableAccounts(workbook, { groups: ['asset', 'liability'] }).map(
        (account) => account.id
      )
    ).toEqual(
      expect.arrayContaining([
        cash.account.id,
        bank.account.id,
        wallet.account.id,
        savings.account.id,
        card.account.id
      ])
    );
  });

  it('trims names, supports explicit currency, roundtrips, and leaves totals unchanged without transactions', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.transactions = [];
    const beforeDrafts = cloneAccountScenario({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    });
    const beforeSummary = summarizeLedgerActivity(workbook);
    const result = createAccount(
      workbook,
      {
        name: '  USD Wallet Test  ',
        group: 'asset',
        subtype: 'wallet',
        currency: 'USD',
        openedDate: '2026-06-01'
      },
      services()
    );
    const parsed = parsePortableWorkbookText(buildPortableWorkbookHtml(workbook));

    expect(result.account).toMatchObject({ name: 'USD Wallet Test', currency: 'USD' });
    expect(summarizeLedgerActivity(workbook)).toMatchObject(beforeSummary);
    expect({
      aiDrafts: workbook.aiDrafts,
      externalDraftGroups: workbook.externalDraftGroups
    }).toEqual(beforeDrafts);
    expect(parsed.accounts.find((account) => account.id === result.account.id)).toMatchObject({
      name: 'USD Wallet Test',
      currency: 'USD'
    });
  });

  it('creates a sanitized flat details object with typed account metadata', () => {
    const workbook = makeMinimalAccountWorkbook();
    const inputDetails = {
      bankAccountType: '  Savings  ',
      accountNumber: '  0012-3456  ',
      branch: '  Makati  ',
      location: '  Home safe  ',
      mobileNumber: '  0917 123 4567  ',
      email: '  owner@example.com  ',
      accountReference: '  WALLET-42  ',
      cardNetwork: '  Visa  ',
      creditLimit: '100,000.129',
      billingDay: '15',
      dueDay: 28,
      annualFee: 0,
      investmentType: '  ETF  ',
      costBasis: '10,000.50',
      monthlyContribution: '2,000',
      loanType: '  Personal loan  ',
      originalBalance: '500,000',
      interestRate: '6.375',
      monthlyPayment: '12,345.67',
      paymentDueDay: '20',
      maturityDate: '2030-12-31',
      assetType: '  Vehicle  ',
      acquisitionDate: '2025-01-02',
      acquisitionCost: '750,000',
      identifier: '  ABC-123  ',
      unknownField: 'discard me',
      nested: { discard: true }
    };
    const result = createAccount(
      workbook,
      {
        name: 'Metadata Account',
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        openedDate: '2026-06-01',
        details: inputDetails
      },
      services()
    );

    expect(result.account.details).toEqual({
      bankAccountType: 'Savings',
      accountNumber: '0012-3456',
      branch: 'Makati',
      location: 'Home safe',
      mobileNumber: '0917 123 4567',
      email: 'owner@example.com',
      accountReference: 'WALLET-42',
      cardNetwork: 'Visa',
      investmentType: 'ETF',
      loanType: 'Personal loan',
      assetType: 'Vehicle',
      identifier: 'ABC-123',
      creditLimit: 100000.13,
      annualFee: 0,
      costBasis: 10000.5,
      monthlyContribution: 2000,
      originalBalance: 500000,
      monthlyPayment: 12345.67,
      acquisitionCost: 750000,
      billingDay: 15,
      dueDay: 28,
      paymentDueDay: 20,
      maturityDate: '2030-12-31',
      acquisitionDate: '2025-01-02',
      interestRate: 6.375
    });
    inputDetails.branch = 'Mutated after create';
    expect(result.account.details.branch).toBe('Makati');
  });

  it('preserves sanitized account details through a portable workbook roundtrip', () => {
    const workbook = makeMinimalAccountWorkbook();
    const result = createAccount(
      workbook,
      {
        name: 'Roundtrip Card',
        group: 'liability',
        subtype: 'credit_card',
        currency: 'PHP',
        openedDate: '2026-06-01',
        details: {
          cardNetwork: 'Mastercard',
          creditLimit: '75,000',
          billingDay: '12',
          dueDay: '27',
          annualFee: '2,500'
        }
      },
      services()
    );
    const parsed = parsePortableWorkbookText(buildPortableWorkbookHtml(workbook));

    expect(parsed.accounts.find((account) => account.id === result.account.id).details).toEqual({
      cardNetwork: 'Mastercard',
      creditLimit: 75000,
      annualFee: 2500,
      billingDay: 12,
      dueDay: 27
    });
  });

  it('preserves details when an edit omits them and safely replaces supplied details', () => {
    const workbook = makeMinimalAccountWorkbook();
    const result = createAccount(
      workbook,
      {
        name: 'Editable Bank',
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        openedDate: '2026-06-01',
        details: { bankAccountType: 'Savings', branch: 'Makati', interestRate: '1.5' }
      },
      services()
    );
    const originalDetails = result.account.details;

    updateAccount(workbook, result.account.id, {
      name: 'Renamed Bank',
      subtype: 'bank',
      currency: 'PHP'
    });
    expect(result.account.details).toBe(originalDetails);

    const replacement = {
      bankAccountType: '  Checking  ',
      branch: '  BGC  ',
      billingDay: 0,
      creditLimit: Number.POSITIVE_INFINITY,
      acquisitionDate: '2026-02-31',
      accountNumber: { nested: 'not allowed' },
      unsupported: 'discard me'
    };
    updateAccount(workbook, result.account.id, {
      name: 'Renamed Bank',
      subtype: 'bank',
      currency: 'PHP',
      details: replacement
    });

    expect(result.account.details).toEqual({ bankAccountType: 'Checking', branch: 'BGC' });
    replacement.branch = 'Mutated after edit';
    expect(result.account.details.branch).toBe('BGC');
  });

  it('allows duplicate display names while rejecting blank, invalid-date, and missing-rate inputs safely', () => {
    const workbook = makeMinimalAccountWorkbook();
    const before = cloneAccountScenario(workbook);

    expect(() =>
      createAccount(workbook, { name: '', openedDate: '2026-06-01' }, services())
    ).toThrow('Account name is required.');
    const duplicateName = createAccount(
      workbook,
      { name: 'Cash', group: 'asset', currency: 'PHP', openedDate: '2026-06-01' },
      services()
    );
    expect(duplicateName.account).toMatchObject({ name: 'Cash', group: 'asset', currency: 'PHP' });
    expect(() => createAccount(workbook, { name: 'No Date', group: 'asset' }, services())).toThrow(
      'Account date is required.'
    );
    workbook.settings.usdToBaseRate = 0;
    expect(() =>
      createAccount(
        workbook,
        { name: 'USD Blocked', group: 'asset', currency: 'USD', openedDate: '2026-06-01' },
        services()
      )
    ).toThrow('Set a USD to PHP rate before creating USD accounts.');
    workbook.settings.usdToBaseRate = before.settings.usdToBaseRate;

    expect(workbook.accounts).toHaveLength(before.accounts.length + 1);
  });
});
