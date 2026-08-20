import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AccountCreateWizard } from '../../src/renderer/features/accounts/AccountModals.jsx';
import { chooseOption, selectedOptionLabel } from './select-helpers.js';

const DEFAULT_DATE = '2026-07-12';

function renderWizard(overrides = {}) {
  const onCancel = overrides.onCancel || vi.fn();
  const onSubmit = overrides.onSubmit || vi.fn();

  render(
    <AccountCreateWizard
      defaultCurrency="PHP"
      defaultDate={DEFAULT_DATE}
      error=""
      onCancel={onCancel}
      onSubmit={onSubmit}
      {...overrides}
    />
  );

  return { onCancel, onSubmit };
}

function dialog() {
  return screen.getByRole('dialog');
}

async function chooseAccountType(user, name) {
  const typePicker = screen.getByRole('dialog', { name: 'Add Account' });
  await user.click(within(typePicker).getByRole('button', { name }));
  return dialog();
}

async function chooseInstitution(user, scope, label, query, optionName) {
  const field = within(scope).getByLabelText(label);
  await user.type(field, query);
  await user.click(within(scope).getByRole('option', { name: optionName }));
  return field;
}

async function enterAmount(user, field, value) {
  await user.clear(field);
  await user.type(field, value);
}

async function revealOptionalDetails(user, scope) {
  const label = within(scope).getByText(/Additional details — Optional/i);
  const details = label.closest('details');
  if (details && !details.open) {
    await user.click(label.closest('summary'));
  }
}

const ACCOUNT_CONTEXTS = [
  {
    picker: /^Bank Account\b/i,
    title: 'Add Bank Account',
    badge: 'Bank account',
    primaryField: 'Account name'
  },
  {
    picker: /^Cash Account\b/i,
    title: 'Add Cash Account',
    badge: 'Cash account',
    primaryField: 'Cash account name'
  },
  {
    picker: /^E-Wallet\b/i,
    title: 'Add E-Wallet Account',
    badge: 'E-wallet account',
    primaryField: 'E-wallet name'
  },
  {
    picker: /^Credit Card\b/i,
    title: 'Add Account',
    badge: 'Credit card account',
    primaryField: 'Card name'
  },
  {
    picker: /^Investment Account\b/i,
    title: 'Add Account',
    badge: 'Investment account',
    primaryField: 'Investment name'
  },
  {
    picker: /^Liability\b/i,
    title: 'Add Account',
    badge: 'Liability account',
    primaryField: 'Liability name'
  }
];

describe('account create wizard', () => {
  it.each(ACCOUNT_CONTEXTS)(
    'shows the $title context and $primaryField field after choosing $picker',
    async ({ picker, title, badge, primaryField }) => {
      const user = userEvent.setup();
      renderWizard();

      const accountDialog = await chooseAccountType(user, picker);

      expect(within(accountDialog).getByRole('heading', { name: title })).not.toBeNull();
      expect(within(accountDialog).getByText(badge, { selector: 'strong' })).not.toBeNull();
      expect(within(accountDialog).getByLabelText(primaryField)).not.toBeNull();
      expect(within(accountDialog).getByRole('button', { name: 'Save Account' })).not.toBeNull();
    }
  );

  it('keeps the top-level Coming Soon option disabled', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWizard();
    const typePicker = screen.getByRole('dialog', { name: 'Add Account' });
    const comingSoon = within(typePicker).getByRole('button', {
      name: /More account types are on the way/i
    });

    expect(comingSoon.disabled).toBe(true);
    expect(comingSoon.getAttribute('aria-disabled')).toBe('true');

    await user.click(comingSoon);

    expect(screen.getByRole('dialog', { name: 'Add Account' })).toBe(typePicker);
    expect(within(typePicker).queryByRole('button', { name: 'Save Account' })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses a bank institution suggestion and submits the exact bank payload', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWizard();
    const accountDialog = await chooseAccountType(user, /^Bank Account\b/i);

    await chooseInstitution(
      user,
      accountDialog,
      'Bank',
      'BPI',
      /BPI.*Bank of the Philippine Islands/i
    );
    expect(within(accountDialog).getByText('Suggestion: BPI Savings')).not.toBeNull();
    await user.click(within(accountDialog).getByRole('button', { name: 'Use' }));
    await enterAmount(user, within(accountDialog).getByLabelText('Starting balance'), '1250');
    await user.click(within(accountDialog).getByRole('button', { name: 'Save Account' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'BPI Savings',
      group: 'asset',
      subtype: 'bank',
      institution: 'BPI',
      institutionId: 'bpi',
      currency: 'PHP',
      openedDate: DEFAULT_DATE,
      openingBalance: '1250',
      note: '',
      details: { bankAccountType: 'savings' }
    });
  });

  it('uses the GCash wallet quick pick without submitting hidden optional defaults', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWizard();
    const accountDialog = await chooseAccountType(user, /^E-Wallet\b/i);
    const gcash = within(accountDialog).getByRole('button', { name: 'GCash' });

    expect(gcash.getAttribute('aria-pressed')).toBe('true');
    expect(within(accountDialog).getByLabelText('E-wallet name').value).toBe('GCash');

    const name = within(accountDialog).getByLabelText('E-wallet name');
    await user.clear(name);
    await user.type(name, 'Daily GCash');
    await enterAmount(user, within(accountDialog).getByLabelText('Starting balance'), '2500');
    await user.click(within(accountDialog).getByRole('button', { name: 'Save Account' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'Daily GCash',
      group: 'asset',
      subtype: 'wallet',
      institution: 'GCash',
      institutionId: 'gcash',
      currency: 'PHP',
      openedDate: DEFAULT_DATE,
      openingBalance: '2500',
      note: '',
      details: {}
    });
  });

  it('submits Coins.ph as a custom provider through the wallet Other flow', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWizard();
    const accountDialog = await chooseAccountType(user, /^E-Wallet\b/i);

    await user.click(within(accountDialog).getByRole('button', { name: 'Other…' }));
    expect(
      within(accountDialog).getByRole('button', { name: 'Other…' }).getAttribute('aria-pressed')
    ).toBe('true');
    await user.type(within(accountDialog).getByLabelText('Provider name'), 'Coins.ph');
    await user.type(within(accountDialog).getByLabelText('E-wallet name'), 'Coins.ph Wallet');
    await user.click(within(accountDialog).getByRole('button', { name: 'Save Account' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'Coins.ph Wallet',
      group: 'asset',
      subtype: 'wallet',
      institution: 'Coins.ph',
      institutionId: 'coinsph',
      currency: 'PHP',
      openedDate: DEFAULT_DATE,
      openingBalance: '0',
      note: '',
      details: {}
    });
  });

  it('calculates available credit and submits only the selected optional card network', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWizard();
    const accountDialog = await chooseAccountType(user, /^Credit Card\b/i);

    await user.click(within(accountDialog).getByRole('button', { name: 'BPI' }));
    expect(within(accountDialog).getByLabelText('Card name').value).toBe('BPI Credit Card');
    await enterAmount(user, within(accountDialog).getByLabelText('Current balance owed'), '35000');
    await enterAmount(user, within(accountDialog).getByLabelText('Credit limit'), '100000');
    expect(within(accountDialog).getByLabelText('Current balance owed').value).toBe('35,000.00');
    expect(within(accountDialog).getByLabelText('Credit limit').value).toBe('100,000.00');
    await chooseOption(user, within(accountDialog).getByLabelText('Card network'), 'Mastercard');

    expect(within(accountDialog).getByRole('status').textContent).toContain('₱65,000.00');

    await user.click(within(accountDialog).getByRole('button', { name: 'Save Account' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'BPI Credit Card',
      group: 'liability',
      subtype: 'credit_card',
      institution: 'BPI',
      institutionId: 'bpi',
      currency: 'PHP',
      openedDate: DEFAULT_DATE,
      openingBalance: '35000',
      note: '',
      details: {
        cardNetwork: 'mastercard',
        creditLimit: '100000'
      }
    });
  });

  it('submits the liability contract and omits untouched optional liability fields', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWizard();
    const accountDialog = await chooseAccountType(user, /^Liability\b/i);

    await chooseInstitution(
      user,
      accountDialog,
      'Lender / Institution',
      'BPI',
      /BPI.*Bank of the Philippine Islands/i
    );
    await user.type(within(accountDialog).getByLabelText('Liability name'), 'Auto Loan');
    await enterAmount(user, within(accountDialog).getByLabelText('Outstanding balance'), '500000');
    await revealOptionalDetails(user, accountDialog);
    await chooseOption(user, within(accountDialog).getByLabelText('Liability type'), 'Auto Loan');
    await user.click(within(accountDialog).getByRole('button', { name: 'Save Account' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'Auto Loan',
      group: 'liability',
      subtype: 'loan',
      institution: 'BPI',
      institutionId: 'bpi',
      currency: 'PHP',
      openedDate: DEFAULT_DATE,
      openingBalance: '500000',
      note: '',
      details: { loanType: 'auto_loan' }
    });
  });

  it('retains common fields but resets institution and type-specific details after Back', async () => {
    const user = userEvent.setup();
    renderWizard();
    let accountDialog = await chooseAccountType(user, /^Bank Account\b/i);

    await user.type(within(accountDialog).getByLabelText('Account name'), 'Travel Account');
    await chooseOption(user, within(accountDialog).getByLabelText('Currency'), 'USD');
    await enterAmount(user, within(accountDialog).getByLabelText('Starting balance'), '123');
    const accountDate = within(accountDialog).getByLabelText('Balance as of');
    await user.clear(accountDate);
    await user.type(accountDate, '2026-06-30');
    await chooseInstitution(
      user,
      accountDialog,
      'Bank',
      'BPI',
      /BPI.*Bank of the Philippine Islands/i
    );
    await user.click(within(accountDialog).getByRole('radio', { name: 'Checking' }));
    await revealOptionalDetails(user, accountDialog);
    await user.type(within(accountDialog).getByLabelText('Branch'), 'Makati');
    await user.type(within(accountDialog).getByLabelText('Notes'), 'Keep this note');

    await user.click(within(accountDialog).getByRole('button', { name: 'Go back' }));
    accountDialog = await chooseAccountType(user, /^Credit Card\b/i);

    expect(within(accountDialog).getByLabelText('Card name').value).toBe('Travel Account');
    expect(
      within(accountDialog).getByLabelText('Current balance owed').value.replace(/,/g, '')
    ).toBe('123.00');
    expect(within(accountDialog).getByLabelText('Balance as of').value).toBe('2026-06-30');
    expect(
      within(accountDialog).getByRole('button', { name: 'BDO' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(within(accountDialog).getByLabelText('Credit limit').value).toBe('0.00');
    expect(within(accountDialog).getByLabelText('Card network').value).toBe('');
    expect(within(accountDialog).getByLabelText('Notes').value).toBe('Keep this note');

    await enterAmount(user, within(accountDialog).getByLabelText('Credit limit'), '120000');
    await chooseOption(user, within(accountDialog).getByLabelText('Card network'), 'Mastercard');
    await user.click(within(accountDialog).getByRole('button', { name: 'Go back' }));
    accountDialog = await chooseAccountType(user, /^Bank Account\b/i);

    expect(within(accountDialog).getByLabelText('Account name').value).toBe('Travel Account');
    expect(selectedOptionLabel(within(accountDialog).getByLabelText('Currency'))).toBe('USD');
    expect(within(accountDialog).getByLabelText('Starting balance').value.replace(/,/g, '')).toBe(
      '123.00'
    );
    expect(within(accountDialog).getByLabelText('Balance as of').value).toBe('2026-06-30');
    expect(within(accountDialog).getByLabelText('Bank').value).toBe('');
    expect(within(accountDialog).getByRole('radio', { name: 'Savings' }).checked).toBe(true);
    expect(within(accountDialog).getByLabelText('Branch').value).toBe('');
    expect(within(accountDialog).getByLabelText('Notes').value).toBe('Keep this note');
  });

  it('cancels a contextual form with Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWizard({ onCancel });
    await chooseAccountType(user, /^Cash Account\b/i);

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes an institution dropdown with Escape without closing the wizard', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderWizard();
    const accountDialog = await chooseAccountType(user, /^Bank Account\b/i);

    await user.type(within(accountDialog).getByLabelText('Bank'), 'BPI');
    expect(within(accountDialog).getByRole('option', { name: /BPI/i })).not.toBeNull();
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Add Bank Account' })).not.toBeNull();
    expect(within(accountDialog).queryByRole('listbox')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
