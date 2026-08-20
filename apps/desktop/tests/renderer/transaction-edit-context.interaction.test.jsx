import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  makeLine,
  makeTransaction
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import {
  CATEGORY_ACTIONS,
  executeCategoryCommand
} from '../../src/renderer/features/categories/category-controller.js';
import { TransactionRoute } from '../../src/renderer/features/transactions/TransactionRoute.jsx';
import { useTransactionController } from '../../src/renderer/features/transactions/transaction-controller.js';
import { openOptions, selectedOptionLabel } from './select-helpers.js';

function makeContextualEditWorkbook() {
  return {
    id: 'transaction-edit-contexts',
    version: 2,
    name: 'Transaction Edit Contexts',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'bank',
        name: 'BPI Savings',
        group: 'asset',
        subtype: 'bank',
        institution: 'BPI',
        institutionId: 'bpi',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'cash',
        name: 'Cash Wallet',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'wallet',
        name: 'GCash',
        group: 'asset',
        subtype: 'wallet',
        institution: 'GCash',
        institutionId: 'gcash',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'card',
        name: 'BPI Rewards',
        group: 'liability',
        subtype: 'credit_card',
        institution: 'BPI',
        institutionId: 'bpi',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'investment',
        name: 'Long-term Portfolio',
        group: 'asset',
        subtype: 'investment',
        institution: 'COL Financial',
        currency: 'PHP',
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
        isActive: true
      },
      {
        id: 'old-wallet',
        name: 'Old GCash',
        group: 'asset',
        subtype: 'wallet',
        institution: 'GCash',
        institutionId: 'gcash',
        currency: 'PHP',
        isActive: false
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'investment-income',
        name: 'Investment Income',
        group: 'income',
        subtype: 'income',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'debt-expense',
        name: 'Debt Payment',
        group: 'expense',
        subtype: 'debt',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'opening_balance_equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'investment-distribution',
        name: 'Investment Distribution',
        type: 'income',
        linkedAccountId: 'investment-income',
        isActive: true
      },
      {
        id: 'loan-payment',
        name: 'Loan Payment',
        type: 'debt',
        linkedAccountId: 'debt-expense',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [
      makeTransaction({
        id: 'txn-bank',
        date: '2026-07-01',
        template: 'expense_paid',
        description: 'Bank groceries',
        categoryId: 'food',
        amount: 500,
        lines: [makeLine('food-expense', 'debit', 500), makeLine('bank', 'credit', 500)]
      }),
      makeTransaction({
        id: 'txn-cash',
        date: '2026-07-02',
        template: 'expense_paid',
        description: 'Cash lunch',
        categoryId: 'food',
        amount: 250,
        lines: [makeLine('food-expense', 'debit', 250), makeLine('cash', 'credit', 250)]
      }),
      makeTransaction({
        id: 'txn-wallet',
        date: '2026-07-03',
        template: 'expense_paid',
        description: 'Wallet delivery',
        categoryId: 'food',
        amount: 350,
        lines: [makeLine('food-expense', 'debit', 350), makeLine('wallet', 'credit', 350)]
      }),
      makeTransaction({
        id: 'txn-card',
        date: '2026-07-04',
        template: 'expense_charged',
        description: 'Card dinner',
        categoryId: 'food',
        amount: 1200,
        lines: [makeLine('food-expense', 'debit', 1200), makeLine('card', 'credit', 1200)]
      }),
      makeTransaction({
        id: 'txn-investment',
        date: '2026-07-05',
        template: 'income_received',
        description: 'Fund distribution',
        categoryId: 'investment-distribution',
        amount: 3000,
        lines: [
          makeLine('investment', 'debit', 3000),
          makeLine('investment-income', 'credit', 3000)
        ]
      }),
      makeTransaction({
        id: 'txn-loan',
        date: '2026-07-06',
        template: 'debt_payment',
        description: 'Monthly auto loan',
        categoryId: 'loan-payment',
        amount: 8500,
        lines: [makeLine('loan', 'debit', 8500), makeLine('bank', 'credit', 8500)]
      }),
      makeTransaction({
        id: 'txn-old-wallet',
        date: '2026-07-07',
        template: 'expense_paid',
        description: 'Archived wallet purchase',
        categoryId: 'food',
        amount: 75,
        lines: [makeLine('food-expense', 'debit', 75), makeLine('old-wallet', 'credit', 75)]
      })
    ],
    recurringItems: [],
    sheets: [],
    aiDrafts: [],
    externalDraftGroups: [],
    advisorDraftGroups: []
  };
}

function TransactionHarness({ initialWorkbook, onCommandResult = () => {} }) {
  const [workbook, setWorkbook] = useState(initialWorkbook);
  const controller = useTransactionController({
    workbook,
    services: { defaultDate: '2026-07-14' },
    onCommandResult: (result) => {
      onCommandResult(result);
      if (result.ok && result.workbook && result.workbook !== workbook) {
        setWorkbook(result.workbook);
      }
    }
  });
  const handleAction = (action) => {
    if (action?.type === CATEGORY_ACTIONS.CREATE) {
      const result = executeCategoryCommand(workbook, action);
      if (result.ok && result.workbook) setWorkbook(result.workbook);
      return result;
    }
    return controller.onAction(action);
  };

  return (
    <>
      <output aria-label="transaction-count">{workbook.transactions.length}</output>
      <TransactionRoute model={controller.model} onAction={handleAction} />
    </>
  );
}

async function openEditorFor(user, description) {
  const row = screen.getByText(description).closest('tr');
  await user.click(row);
  await user.click(screen.getByRole('button', { name: 'Edit Transaction' }));
  return screen.getByRole('dialog', { name: 'Edit Transaction' });
}

const ACCOUNT_CONTEXTS = [
  {
    description: 'Bank groceries',
    kind: 'bank',
    heading: 'Edit Bank Transaction',
    badge: 'Bank transaction',
    accountLabel: 'Paid from bank account',
    accountId: 'bank',
    accountName: 'BPI Savings'
  },
  {
    description: 'Cash lunch',
    kind: 'cash',
    heading: 'Edit Cash Transaction',
    badge: 'Cash transaction',
    accountLabel: 'Paid from cash account',
    accountId: 'cash',
    accountName: 'Cash Wallet'
  },
  {
    description: 'Wallet delivery',
    kind: 'wallet',
    heading: 'Edit E-Wallet Transaction',
    badge: 'E-wallet transaction',
    accountLabel: 'Paid from e-wallet',
    accountId: 'wallet',
    accountName: 'GCash'
  },
  {
    description: 'Card dinner',
    kind: 'credit_card',
    heading: 'Edit Credit Card Transaction',
    badge: 'Credit card transaction',
    accountLabel: 'Charged to credit card',
    accountId: 'card',
    accountName: 'BPI Rewards'
  },
  {
    description: 'Fund distribution',
    kind: 'investment',
    heading: 'Edit Investment Transaction',
    badge: 'Investment transaction',
    accountLabel: 'Received into investment account',
    accountId: 'investment',
    accountName: 'Long-term Portfolio'
  },
  {
    description: 'Monthly auto loan',
    kind: 'liability',
    heading: 'Edit Liability Transaction',
    badge: 'Liability transaction',
    accountLabel: 'Liability account',
    accountId: 'loan',
    accountName: 'Auto Loan'
  }
];

describe('contextual transaction editing', () => {
  it.each(ACCOUNT_CONTEXTS)(
    'renders the $kind editor for $description',
    async ({ description, kind, heading, badge, accountLabel, accountId, accountName }) => {
      const user = userEvent.setup();
      render(<TransactionHarness initialWorkbook={makeContextualEditWorkbook()} />);

      const dialog = await openEditorFor(user, description);

      expect(dialog.getAttribute('data-account-context')).toBe(kind);
      expect(within(dialog).getByRole('heading', { name: heading })).not.toBeNull();
      expect(within(dialog).getByText(badge, { selector: 'strong' })).not.toBeNull();
      expect(within(dialog).getByText(accountName, { selector: 'strong' })).not.toBeNull();
      expect(selectedOptionLabel(within(dialog).getByLabelText(accountLabel))).toContain(
        accountName
      );
      expect(within(dialog).getByRole('button', { name: 'Save Changes' })).not.toBeNull();
    }
  );

  it('saves an edit with the same transaction identity without mutating the prior workbook', async () => {
    const user = userEvent.setup();
    const initialWorkbook = makeContextualEditWorkbook();
    const results = [];
    render(
      <TransactionHarness
        initialWorkbook={initialWorkbook}
        onCommandResult={(result) => results.push(result)}
      />
    );

    const dialog = await openEditorFor(user, 'Card dinner');
    const description = within(dialog).getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Card dinner edited');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByText('Card dinner edited')).not.toBeNull());
    expect(screen.getByLabelText('transaction-count').textContent).toBe('7');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].workbook).not.toBe(initialWorkbook);
    expect(results[0].transaction.id).toBe('txn-card');
    expect(results[0].workbook.transactions).toHaveLength(initialWorkbook.transactions.length);
    expect(initialWorkbook.transactions.find((item) => item.id === 'txn-card').description).toBe(
      'Card dinner'
    );
  });

  it('creates and selects a category while preserving an in-progress transaction edit', async () => {
    const user = userEvent.setup();
    const results = [];
    render(
      <TransactionHarness
        initialWorkbook={makeContextualEditWorkbook()}
        onCommandResult={(result) => results.push(result)}
      />
    );

    const dialog = await openEditorFor(user, 'Bank groceries');
    const description = within(dialog).getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Trip groceries');
    await user.click(within(dialog).getByRole('combobox', { name: 'Category' }));
    await user.click(screen.getByRole('option', { name: 'Create new category' }));

    const createDialog = screen.getByRole('dialog', { name: 'Create new category' });
    await user.type(within(createDialog).getByLabelText('Category name'), 'Trip meals');
    await user.click(within(createDialog).getByRole('button', { name: 'Create & select' }));

    expect(description.value).toBe('Trip groceries');
    expect(selectedOptionLabel(within(dialog).getByLabelText('Paid from bank account'))).toContain(
      'BPI Savings'
    );
    expect(within(dialog).getByRole('combobox', { name: 'Category' }).textContent).toContain(
      'Trip meals'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByText('Trip groceries')).not.toBeNull());
    const result = results.at(-1);
    const category = result.workbook.categories.find((item) => item.name === 'Trip meals');
    expect(category).toMatchObject({ type: 'expense', isActive: true });
    expect(result.transaction).toMatchObject({
      id: 'txn-bank',
      description: 'Trip groceries',
      categoryId: category.id
    });
  });

  it('keeps an archived referenced wallet selected while editing its historical transaction', async () => {
    const user = userEvent.setup();
    render(<TransactionHarness initialWorkbook={makeContextualEditWorkbook()} />);

    const dialog = await openEditorFor(user, 'Archived wallet purchase');
    const account = within(dialog).getByLabelText('Paid from e-wallet');

    expect(dialog.getAttribute('data-account-context')).toBe('wallet');
    expect(selectedOptionLabel(account)).toContain('Old GCash');
    expect(within(dialog).getByText('Old GCash', { selector: 'strong' })).not.toBeNull();
    const accountOptions = await openOptions(user, account);
    expect(within(accountOptions).getByRole('option', { name: /Old GCash/ })).not.toBeNull();
  });

  it.each([
    {
      hint: 'account name',
      name: 'GCash',
      details: {}
    },
    {
      hint: 'provider details',
      name: 'Everyday balance',
      details: { providerName: 'GCash' }
    }
  ])('infers the e-wallet editor from legacy $hint when subtype is missing', async (account) => {
    const user = userEvent.setup();
    const workbook = makeContextualEditWorkbook();
    const wallet = workbook.accounts.find((item) => item.id === 'wallet');
    Object.assign(wallet, {
      name: account.name,
      subtype: '',
      institution: '',
      institutionId: '',
      details: account.details
    });
    render(<TransactionHarness initialWorkbook={workbook} />);

    const dialog = await openEditorFor(user, 'Wallet delivery');

    expect(dialog.getAttribute('data-account-context')).toBe('wallet');
    expect(
      within(dialog).getByRole('heading', { name: 'Edit E-Wallet Transaction' })
    ).not.toBeNull();
    expect(within(dialog).getByText('E-wallet transaction', { selector: 'strong' })).not.toBeNull();
  });
});
