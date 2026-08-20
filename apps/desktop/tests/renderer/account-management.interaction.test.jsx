import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AccountRoute } from '../../src/renderer/features/accounts/AccountRoute.jsx';
import { chooseOption } from './select-helpers.js';

function makeWorkbook() {
  return {
    id: 'account-interaction-workbook',
    version: 2,
    name: 'Account Interactions',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'bank',
        name: 'Bank',
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'unused',
        name: 'Unused',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'old-wallet',
        name: 'Old Wallet',
        group: 'asset',
        subtype: 'wallet',
        currency: 'PHP',
        openedDate: '2025-01-01',
        isActive: false
      },
      {
        id: 'system-asset',
        name: 'System Asset',
        group: 'asset',
        subtype: 'clearing',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isSystem: true,
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', linkedAccountId: 'food-expense', isActive: true }
    ],
    transactions: [
      {
        id: 'txn-bank',
        date: '2026-06-01',
        template: 'expense_paid',
        description: 'Groceries',
        categoryId: 'food',
        amount: 100,
        baseAmount: 100,
        lines: [
          {
            id: 'line-food',
            accountId: 'food-expense',
            direction: 'debit',
            amount: 100,
            baseAmount: 100
          },
          { id: 'line-bank', accountId: 'bank', direction: 'credit', amount: 100, baseAmount: 100 }
        ]
      }
    ],
    recurringItems: [],
    sheets: []
  };
}

function AccountHarness({ initialWorkbook, onResult }) {
  const [workbook, setWorkbook] = useState(initialWorkbook);
  function handleResult(result) {
    onResult(result);
    if (result.ok) setWorkbook(result.workbook);
  }
  return (
    <>
      <output aria-label="Account workbook state">{JSON.stringify(workbook.accounts)}</output>
      <AccountRoute workbook={workbook} onCommandResult={handleResult} />
    </>
  );
}

function rowFor(name) {
  return screen
    .getByRole('button', {
      name: (accessibleName) => accessibleName.startsWith(`Open ${name} account,`)
    })
    .closest('[data-account-id]');
}

describe('account management interactions', () => {
  it('keeps Create account inside the collection in list and grid views', async () => {
    const user = userEvent.setup();
    render(<AccountHarness initialWorkbook={makeWorkbook()} onResult={vi.fn()} />);

    const createAccount = screen.getByRole('button', { name: /^Create account/ });
    expect(createAccount.closest('[data-account-view="list"]')).not.toBeNull();
    expect(createAccount.classList.contains('account-create-entry')).toBe(true);
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.querySelector('[data-account-view="list"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(screen.getByRole('button', { name: /^Create account/ }).classList).toContain(
      'account-create-card'
    );
    expect(
      screen.getByRole('button', { name: /^Create account/ }).closest('[data-account-view="grid"]')
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.querySelector('[data-account-view="grid"]')).not.toBeNull();
  });

  it('reports filtered rows against the full visible account count', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AccountHarness initialWorkbook={makeWorkbook()} onResult={vi.fn()} />
    );
    const total = container.querySelectorAll('.account-compact-list [data-account-id]').length;

    expect(total).toBeGreaterThan(1);
    await user.type(screen.getByRole('textbox', { name: 'Search accounts' }), 'Bank');

    expect(container.querySelectorAll('.account-compact-list [data-account-id]')).toHaveLength(1);
    expect(screen.getByText(`Showing 1 to 1 of ${total} accounts`)).not.toBeNull();
  });

  it('creates, edits, rerenders, and cancels through React forms', async () => {
    const user = userEvent.setup();
    const initialWorkbook = makeWorkbook();
    const onResult = vi.fn();
    render(<AccountHarness initialWorkbook={initialWorkbook} onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: /^Create account/ }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Account' })).getByRole('button', {
        name: /^Bank Account Savings, checking, or other bank accounts$/
      })
    );
    const createDialog = screen.getByRole('dialog', { name: 'Add Bank Account' });
    await user.type(within(createDialog).getByLabelText('Account name'), 'Savings');
    await user.type(within(createDialog).getByLabelText('Bank'), 'BPI');
    await user.click(
      within(createDialog).getByRole('option', { name: /BPI.*Bank of the Philippine Islands/ })
    );
    await user.click(within(createDialog).getByRole('button', { name: 'Save Account' }));

    expect(await screen.findByRole('button', { name: /^Open Savings account,/ })).not.toBeNull();
    const createResult = onResult.mock.calls[0][0];
    expect(createResult.ok).toBe(true);
    expect(createResult.workbook).not.toBe(initialWorkbook);
    expect(initialWorkbook.accounts.some((account) => account.name === 'Savings')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Edit Account' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit Bank Account' });
    const nameInput = within(editDialog).getByLabelText('Account name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Emergency Savings');
    await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }));
    expect(
      await screen.findByRole('button', { name: /^Open Emergency Savings account,/ })
    ).not.toBeNull();

    const resultCount = onResult.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Edit Account' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Edit Bank Account' })).getByRole('button', {
        name: 'Close'
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onResult).toHaveBeenCalledTimes(resultCount);
  });

  it('keeps a failed form open and retains workbook identity', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    workbook.settings.usdToBaseRate = 0;
    const onResult = vi.fn();
    render(<AccountHarness initialWorkbook={workbook} onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: /^Create account/ }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add Account' })).getByRole('button', {
        name: /^Bank Account Savings, checking, or other bank accounts$/
      })
    );
    const dialog = screen.getByRole('dialog', { name: 'Add Bank Account' });
    await user.type(within(dialog).getByLabelText('Account name'), 'USD wallet');
    await user.type(within(dialog).getByLabelText('Bank'), 'BPI');
    await user.click(
      within(dialog).getByRole('option', { name: /BPI.*Bank of the Philippine Islands/ })
    );
    await chooseOption(user, within(dialog).getByLabelText('Currency'), 'USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save Account' }));

    expect((await screen.findByRole('alert')).textContent).toContain('USD to PHP rate');
    const result = onResult.mock.calls[0][0];
    expect(result.ok).toBe(false);
    expect(result.workbook).toBe(workbook);
    expect(screen.getByRole('dialog', { name: 'Add Bank Account' })).not.toBeNull();
  });

  it('dismisses account dialogs with Escape or a backdrop click', async () => {
    const user = userEvent.setup();
    render(<AccountHarness initialWorkbook={makeWorkbook()} onResult={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Create account/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Create account/ }));
    await user.click(document.querySelector('.modal-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('owns selection and archived visibility without mutating the workbook', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const onResult = vi.fn();
    const { container } = render(<AccountHarness initialWorkbook={workbook} onResult={onResult} />);

    expect(screen.queryByRole('button', { name: /^Open Old Wallet account,/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Active only' }));
    expect(screen.getByRole('button', { name: /^Open Old Wallet account,/ })).not.toBeNull();

    await user.click(within(rowFor('Bank')).getByRole('button', { name: /Bank/ }));
    expect(
      within(container.querySelector('.account-detail-card')).getByRole('heading', { name: 'Bank' })
    ).not.toBeNull();
    expect(container.querySelector('.account-compact-list .action-menu')).toBeNull();
    expect(container.querySelector('.selected-account-hero .tag')).toBeNull();
    const historyPoint = screen.getByRole('button', {
      name: /2026-06-01: Groceries.*balance -₱100.00/
    });
    await user.hover(historyPoint);
    expect(historyPoint.querySelector('.account-history-svg-tooltip').textContent).toContain(
      'Groceries'
    );
    expect(historyPoint.querySelector('.account-history-svg-tooltip').textContent).toContain(
      'Change'
    );
    expect(onResult).not.toHaveBeenCalled();
    expect(workbook.accounts.find((account) => account.id === 'old-wallet').isActive).toBe(false);
  });

  it('opens account-specific transaction details from chart points with pointer or keyboard', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const onResult = vi.fn();
    const { container } = render(<AccountHarness initialWorkbook={workbook} onResult={onResult} />);

    await user.click(within(rowFor('Bank')).getByRole('button', { name: /Bank/ }));
    const historyPoint = screen.getByRole('button', {
      name: /2026-06-01: Groceries.*balance -₱100.00/
    });

    expect(historyPoint.getAttribute('aria-haspopup')).toBe('dialog');
    await user.click(historyPoint);

    let dialog = screen.getByRole('dialog', { name: 'Transaction details for Groceries' });
    const detailValue = (label) =>
      within(dialog).getByText(label).closest('div').querySelector('dd').textContent;
    expect(container.querySelector('[data-react-route="accounts"]')).not.toBeNull();
    expect(dialog.closest('.modal-backdrop').parentElement).toBe(document.body);
    expect(within(dialog).getByText('2026-06-01 · Expense Paid')).not.toBeNull();
    expect(within(dialog).getByRole('region', { name: 'Balance impact' }).textContent).toContain(
      '₱0.00'
    );
    expect(within(dialog).getAllByText('-₱100.00')).toHaveLength(3);
    expect(detailValue('Account')).toBe('Bank');
    expect(detailValue('Category')).toBe('Food');
    expect(detailValue('Transaction total')).toBe('₱100.00');
    expect(within(dialog).queryByText('Related account')).toBeNull();
    expect(detailValue('Note')).toBe('No note added');
    expect(onResult).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Transaction details for Groceries' })).toBeNull();
    expect(document.activeElement).toBe(historyPoint);

    historyPoint.focus();
    await user.keyboard('{Enter}');
    dialog = screen.getByRole('dialog', { name: 'Transaction details for Groceries' });
    await user.click(within(dialog).getByRole('button', { name: 'Close transaction details' }));

    historyPoint.focus();
    await user.keyboard(' ');
    expect(
      screen.getByRole('dialog', { name: 'Transaction details for Groceries' })
    ).not.toBeNull();
    await user.click(document.querySelector('.account-transaction-detail-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'Transaction details for Groceries' })).toBeNull();
    expect(workbook.transactions).toHaveLength(1);
  });

  it('restores archived accounts, archives referenced deletes, and removes unused accounts', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<AccountHarness initialWorkbook={makeWorkbook()} onResult={onResult} />);

    await user.click(screen.getByRole('checkbox', { name: 'Active only' }));
    await user.click(within(rowFor('Old Wallet')).getByRole('button', { name: /Old Wallet/ }));
    await user.click(screen.getByRole('button', { name: 'Restore Account' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Restore Account' })).getByRole('button', {
        name: 'Restore Account'
      })
    );
    expect(rowFor('Old Wallet').textContent).not.toContain('Archived');
    expect(screen.getByRole('button', { name: 'Archive Account' })).not.toBeNull();

    await user.click(within(rowFor('Cash')).getByRole('button', { name: /Cash/ }));
    await user.click(screen.getByRole('button', { name: 'Archive Account' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Archive Account' })).getByRole('button', {
        name: 'Archive Account'
      })
    );
    expect(rowFor('Cash').textContent).toContain('Archived');

    await user.click(within(rowFor('Bank')).getByRole('button', { name: /Bank/ }));
    await user.click(screen.getByRole('button', { name: 'Delete Account' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Account' })).getByRole('button', {
        name: 'Delete Account'
      })
    );
    expect(rowFor('Bank').textContent).toContain('Archived');
    expect(onResult.mock.calls.at(-1)[0].warnings[0].code).toBe(
      'account.archived_instead_of_deleted'
    );

    await user.click(within(rowFor('Unused')).getByRole('button', { name: /Unused/ }));
    await user.click(screen.getByRole('button', { name: 'Delete Account' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Account' })).getByRole('button', {
        name: 'Delete Account'
      })
    );
    expect(screen.queryByRole('button', { name: /^Open Unused account,/ })).toBeNull();

    const systemRow = rowFor('System Asset');
    await user.click(within(systemRow).getByRole('button', { name: /System Asset/ }));
    expect(screen.queryByRole('button', { name: 'Edit Account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Account' })).toBeNull();
  });
});
