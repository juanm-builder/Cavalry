import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AccountRoute } from '../../src/renderer/features/accounts/AccountRoute.jsx';

const ACCOUNT_CONTEXTS = [
  {
    id: 'bank',
    title: 'Edit Bank Account',
    badge: 'Bank account',
    nameLabel: 'Account name',
    detailLabel: 'Account number (last 4 digits)',
    detailValue: '4321',
    balanceLabel: 'Current balance',
    balanceCopy: '₱1,200.00'
  },
  {
    id: 'cash',
    title: 'Edit Cash Account',
    badge: 'Cash account',
    nameLabel: 'Cash account name',
    detailLabel: 'Location',
    detailValue: 'Home safe',
    balanceLabel: 'Current balance',
    balanceCopy: '₱300.00'
  },
  {
    id: 'wallet',
    title: 'Edit E-Wallet Account',
    badge: 'E-wallet account',
    nameLabel: 'E-wallet name',
    detailLabel: 'Mobile number',
    detailValue: '09170000000',
    balanceLabel: 'Current balance',
    balanceCopy: '₱2,500.00',
    showArchived: true
  },
  {
    id: 'card',
    title: 'Edit Credit Card',
    badge: 'Credit card account',
    nameLabel: 'Card name',
    detailLabel: 'Credit limit',
    detailValue: '100,000.00',
    balanceLabel: 'Current balance owed',
    balanceCopy: '₱3,500.00'
  },
  {
    id: 'investment',
    title: 'Edit Investment Account',
    badge: 'Investment account',
    nameLabel: 'Investment name',
    detailLabel: 'Investment type',
    detailValue: 'brokerage',
    balanceLabel: 'Current market value',
    balanceCopy: '₱15,000.00'
  },
  {
    id: 'loan',
    title: 'Edit Liability Account',
    badge: 'Liability account',
    nameLabel: 'Liability name',
    detailLabel: 'Liability type',
    detailValue: 'auto_loan',
    balanceLabel: 'Outstanding balance',
    balanceCopy: '₱8,000.00'
  }
];

function openingTransaction(account, index) {
  const amount = {
    bank: 1200,
    cash: 300,
    wallet: 2500,
    card: 3500,
    investment: 15000,
    loan: 8000,
    'legacy-gcash': 700
  }[account.id];
  const direction = account.group === 'liability' ? 'credit' : 'debit';
  const equityDirection = direction === 'debit' ? 'credit' : 'debit';
  return {
    id: `opening-${account.id}`,
    date: '2026-01-01',
    template: 'opening_balance',
    description: `${account.name} opening balance`,
    amount,
    baseAmount: amount,
    lines: [
      {
        id: `opening-${index}-account`,
        accountId: account.id,
        direction,
        amount,
        currency: 'PHP',
        baseAmount: amount
      },
      {
        id: `opening-${index}-equity`,
        accountId: 'opening-equity',
        direction: equityDirection,
        amount,
        currency: 'PHP',
        baseAmount: amount
      }
    ]
  };
}

function makeWorkbook() {
  const editableAccounts = [
    {
      id: 'bank',
      name: 'BPI Savings',
      group: 'asset',
      subtype: 'bank',
      institution: 'BPI',
      institutionId: 'bpi',
      currency: 'PHP',
      openedDate: '2026-01-01',
      note: 'Main savings',
      details: {
        bankAccountType: 'savings',
        accountNumber: '4321',
        branch: 'Makati',
        interestRate: 1.5
      },
      isActive: true
    },
    {
      id: 'cash',
      name: 'Emergency Cash',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      openedDate: '2026-01-01',
      note: 'For emergencies',
      details: { location: 'Home safe' },
      isActive: true
    },
    {
      id: 'wallet',
      name: 'Old GCash',
      group: 'asset',
      subtype: 'wallet',
      institution: 'GCash',
      institutionId: 'gcash',
      currency: 'PHP',
      openedDate: '2026-01-01',
      note: 'Historical wallet',
      details: {
        mobileNumber: '09170000000',
        email: 'wallet@example.com',
        accountReference: 'GCASH-REF'
      },
      isActive: false
    },
    {
      id: 'card',
      name: 'BDO Credit Card',
      group: 'liability',
      subtype: 'credit_card',
      institution: 'BDO',
      institutionId: 'bdo',
      currency: 'PHP',
      openedDate: '2026-01-01',
      note: 'Primary card',
      details: {
        cardNetwork: 'mastercard',
        creditLimit: 100000,
        accountNumber: '9876',
        interestRate: 18,
        annualFee: 2500,
        billingDay: 12,
        dueDay: 5
      },
      isActive: true
    },
    {
      id: 'investment',
      name: 'Long-term Portfolio',
      group: 'asset',
      subtype: 'investment',
      institution: 'COL Financial',
      institutionId: '',
      currency: 'PHP',
      openedDate: '2026-01-01',
      note: 'Long horizon',
      details: {
        investmentType: 'brokerage',
        accountReference: 'COL-123',
        costBasis: 12000,
        monthlyContribution: 2000
      },
      isActive: true
    },
    {
      id: 'loan',
      name: 'Auto Loan',
      group: 'liability',
      subtype: 'loan',
      institution: 'BPI',
      institutionId: 'bpi',
      currency: 'PHP',
      openedDate: '2026-01-01',
      note: 'Vehicle financing',
      details: {
        loanType: 'auto_loan',
        originalBalance: 500000,
        interestRate: 6.5,
        monthlyPayment: 15000,
        paymentDueDay: 15,
        maturityDate: '2028-01-01',
        accountReference: 'AUTO-123'
      },
      isActive: true
    },
    {
      id: 'legacy-gcash',
      name: 'GCash',
      group: 'asset',
      subtype: 'asset',
      institution: 'GCash',
      institutionId: '',
      currency: 'PHP',
      openedDate: '2025-01-01',
      details: {},
      isActive: true
    }
  ];
  return {
    id: 'account-edit-context-workbook',
    version: 2,
    name: 'Account edit contexts',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      ...editableAccounts,
      {
        id: 'opening-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      }
    ],
    categories: [],
    transactions: editableAccounts.map(openingTransaction),
    recurringItems: [],
    sheets: []
  };
}

function AccountHarness({ initialWorkbook, selectedAccountId, showArchived = false, onResult }) {
  const [workbook, setWorkbook] = useState(initialWorkbook);

  function handleResult(result) {
    onResult(result);
    if (result.ok) setWorkbook(result.workbook);
  }

  return (
    <>
      <output aria-label="Account workbook state">{JSON.stringify(workbook.accounts)}</output>
      <AccountRoute
        initialSelectedAccountId={selectedAccountId}
        initialShowArchived={showArchived}
        onCommandResult={handleResult}
        workbook={workbook}
      />
    </>
  );
}

async function openEditor(user, context, onResult = vi.fn()) {
  const workbook = makeWorkbook();
  render(
    <AccountHarness
      initialWorkbook={workbook}
      onResult={onResult}
      selectedAccountId={context.id}
      showArchived={context.showArchived}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Edit Account' }));
  return {
    dialog: screen.getByRole('dialog', { name: context.title }),
    onResult,
    workbook
  };
}

describe('account-aware editing', () => {
  it.each(ACCOUNT_CONTEXTS)(
    'renders and round-trips the $badge context without exposing its ledger balance as an input',
    async (context) => {
      const user = userEvent.setup();
      const { dialog, onResult, workbook } = await openEditor(user, context);
      const accountBefore = structuredClone(
        workbook.accounts.find((account) => account.id === context.id)
      );
      const transactionsBefore = structuredClone(workbook.transactions);

      expect(within(dialog).getByRole('heading', { name: context.title })).not.toBeNull();
      expect(within(dialog).getByText(context.badge, { selector: 'strong' })).not.toBeNull();
      expect(within(dialog).getByLabelText(context.nameLabel).value).toBe(accountBefore.name);
      expect(within(dialog).getByLabelText(context.detailLabel).value).toBe(context.detailValue);
      expect(within(dialog).getByRole('group', { name: 'Account icon / logo' })).not.toBeNull();

      const summary = within(dialog).getByRole('region', { name: 'Account summary' });
      expect(summary.textContent).toContain(context.balanceLabel);
      expect(summary.textContent).toContain(context.balanceCopy);
      expect(within(dialog).queryByLabelText(context.balanceLabel)).toBeNull();
      expect(
        within(dialog).getByText(/Record a transaction to adjust the balance/i)
      ).not.toBeNull();

      await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

      expect(onResult).toHaveBeenCalledTimes(1);
      const result = onResult.mock.calls[0][0];
      const accountAfter = result.workbook.accounts.find((account) => account.id === context.id);
      expect(result.ok).toBe(true);
      expect(result.workbook).not.toBe(workbook);
      expect(accountAfter).toMatchObject({
        id: accountBefore.id,
        group: accountBefore.group,
        subtype: accountBefore.subtype,
        openedDate: accountBefore.openedDate,
        isActive: accountBefore.isActive,
        details: accountBefore.details
      });
      expect(result.workbook.transactions).toEqual(transactionsBefore);
      expect(workbook.accounts.find((account) => account.id === context.id)).toEqual(accountBefore);
    }
  );

  it('switches an archived wallet to an official provider logo without restoring it', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const context = ACCOUNT_CONTEXTS.find((item) => item.id === 'wallet');
    const { dialog, workbook } = await openEditor(user, context, onResult);

    await user.click(within(dialog).getByRole('button', { name: 'Maya' }));

    const mayaLogo = within(dialog).getByRole('button', { name: 'Use Maya logo' });
    expect(mayaLogo.getAttribute('aria-pressed')).toBe('true');
    expect(
      within(dialog)
        .getByRole('region', { name: 'Account summary' })
        .querySelector('[data-institution-id="mayawallet"]')
    ).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    const result = onResult.mock.calls[0][0];
    const saved = result.workbook.accounts.find((account) => account.id === 'wallet');
    expect(saved).toMatchObject({
      id: 'wallet',
      institution: 'Maya',
      institutionId: 'mayawallet',
      logoMode: 'institution',
      isActive: false
    });
    expect(result.workbook.transactions).toEqual(workbook.transactions);
  });

  it('persists a custom cash icon and uses it after the edit rerenders', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const context = ACCOUNT_CONTEXTS.find((item) => item.id === 'cash');
    const { dialog } = await openEditor(user, context, onResult);

    await user.click(within(dialog).getByRole('button', { name: 'Use Cash machine icon' }));
    expect(
      within(dialog)
        .getByRole('button', { name: 'Use Cash machine icon' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    const result = onResult.mock.calls[0][0];
    expect(result.workbook.accounts.find((account) => account.id === 'cash')).toMatchObject({
      icon: 'local_atm',
      logoMode: 'icon'
    });
    expect(
      screen
        .getByRole('button', { name: /^Open Emergency Cash account,/ })
        .querySelector('[data-cavalry-icon="local_atm"]')
    ).not.toBeNull();
  });

  it('formats edited credit terms live and saves their unformatted value', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const context = ACCOUNT_CONTEXTS.find((item) => item.id === 'card');
    const { dialog } = await openEditor(user, context, onResult);
    const creditLimit = within(dialog).getByLabelText('Credit limit');

    await user.clear(creditLimit);
    await user.type(creditLimit, '125000');
    expect(creditLimit.value).toBe('125,000.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    const saved = onResult.mock.calls[0][0].workbook.accounts.find(
      (account) => account.id === 'card'
    );
    expect(saved.details.creditLimit).toBe(125000);
  });

  it('infers the E-Wallet editor and official GCash logo for a legacy generic asset', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const legacyContext = {
      id: 'legacy-gcash',
      title: 'Edit E-Wallet Account',
      showArchived: false
    };
    const { dialog } = await openEditor(user, legacyContext, onResult);

    expect(within(dialog).getByText('E-wallet account', { selector: 'strong' })).not.toBeNull();
    expect(within(dialog).getByLabelText('E-wallet name').value).toBe('GCash');
    expect(within(dialog).getByRole('button', { name: 'GCash' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(
      within(dialog).getByRole('button', { name: 'Use GCash logo' }).getAttribute('aria-pressed')
    ).toBe('true');
  });
});
