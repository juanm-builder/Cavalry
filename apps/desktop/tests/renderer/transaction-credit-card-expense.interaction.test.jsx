import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TransactionRoute } from '../../src/renderer/features/transactions/TransactionRoute.jsx';
import { useTransactionController } from '../../src/renderer/features/transactions/transaction-controller.js';
import { chooseOption, openOptions, selectedOptionLabel } from './select-helpers.js';

function makeCreditCardExpenseWorkbook() {
  return {
    id: 'wb-credit-card-expense-interaction',
    version: 2,
    name: 'Credit Card Expense Interaction',
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
        isActive: true
      },
      {
        id: 'credit-card',
        name: 'BPI Credit Card',
        group: 'liability',
        subtype: 'credit_card',
        institution: 'BPI',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'personal-loan',
        name: 'Personal Loan',
        group: 'liability',
        subtype: 'loan',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'opening-balance-equity',
        name: 'Opening Balance Equity',
        group: 'equity',
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
        currency: 'PHP',
        linkedAccountId: 'food-expense',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    sheets: [],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

function TransactionHarness({ initialWorkbook, onCommandResult }) {
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
  return (
    <>
      <output aria-label="transaction-count">{workbook.transactions.length}</output>
      <TransactionRoute model={controller.model} onAction={controller.onAction} />
    </>
  );
}

async function openExpenseDetails(user) {
  await user.click(screen.getByRole('button', { name: 'Create transaction' }));
  const typeDialog = screen.getByRole('dialog', { name: 'Add Transaction' });
  await user.click(within(typeDialog).getByRole('button', { name: /^Expense\b/i }));
  return screen.getByRole('dialog', { name: 'Add Transaction' });
}

async function fillExpenseDetails(user, dialog, { accountLabel, accountId, amount, description }) {
  const initialAccountPicker = within(dialog).getByLabelText('Paid with');
  await chooseOption(user, initialAccountPicker, accountLabel);
  const amountField = within(dialog).getByLabelText(
    accountId === 'credit-card' ? 'Purchase amount' : 'Amount'
  );
  await user.type(amountField, amount);
  expect(amountField.value).toBe(
    Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
  await user.click(within(dialog).getByRole('combobox', { name: 'Category' }));
  await user.click(screen.getByRole('option', { name: 'Food' }));
  await user.type(within(dialog).getByLabelText('Description'), description);
}

function getReviewRow(dialog, label) {
  return within(dialog).getByText(label, { selector: '.transaction-review-row > span' })
    .parentElement;
}

describe('credit-card expense creation', () => {
  it('keeps a cash-funded expense paid and previews a cash decrease', async () => {
    const user = userEvent.setup();
    const commandResults = [];
    render(
      <TransactionHarness
        initialWorkbook={makeCreditCardExpenseWorkbook()}
        onCommandResult={(result) => commandResults.push(result)}
      />
    );

    const detailsDialog = await openExpenseDetails(user);
    const accountPicker = within(detailsDialog).getByLabelText('Paid with');
    const accountOptions = await openOptions(user, accountPicker);
    expect(within(accountOptions).getByRole('option', { name: /Cash/ })).not.toBeNull();
    expect(within(accountOptions).getByRole('option', { name: /BPI Credit Card/ })).not.toBeNull();
    expect(within(accountOptions).queryByRole('option', { name: /Personal Loan/ })).toBeNull();
    await user.click(accountPicker);

    await fillExpenseDetails(user, detailsDialog, {
      accountLabel: 'Cash',
      accountId: 'cash',
      amount: '125',
      description: 'Cash lunch'
    });
    expect(selectedOptionLabel(within(detailsDialog).getByLabelText('Paid from'))).toContain(
      'Cash'
    );
    await user.click(within(detailsDialog).getByRole('button', { name: 'Next' }));

    const reviewDialog = screen.getByRole('dialog', { name: 'Review Transaction' });
    expect(within(getReviewRow(reviewDialog, 'Paid from')).getByText('Cash')).not.toBeNull();
    expect(within(reviewDialog).getByText(/decrease your Cash by/i)).not.toBeNull();
    await user.click(within(reviewDialog).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('1'));
    expect(commandResults.at(-1).transaction).toMatchObject({
      template: 'expense_paid',
      categoryId: 'food',
      amount: 125
    });
    expect(commandResults.at(-1).transaction.lines).toEqual([
      expect.objectContaining({ accountId: 'food-expense', direction: 'debit', amount: 125 }),
      expect.objectContaining({ accountId: 'cash', direction: 'credit', amount: 125 })
    ]);
  });

  it('records one card purchase across categories and can edit it back to one category', async () => {
    const user = userEvent.setup();
    const workbook = makeCreditCardExpenseWorkbook();
    workbook.accounts.push({
      id: 'supplies-expense',
      name: 'Supplies',
      group: 'expense',
      currency: 'PHP'
    });
    workbook.categories.push({
      id: 'supplies',
      name: 'Supplies',
      type: 'expense',
      linkedAccountId: 'supplies-expense'
    });
    const results = [];
    render(
      <TransactionHarness
        initialWorkbook={workbook}
        onCommandResult={(result) => results.push(result)}
      />
    );

    const details = await openExpenseDetails(user);
    await fillExpenseDetails(user, details, {
      accountLabel: 'BPI Credit Card',
      accountId: 'credit-card',
      amount: '125',
      description: 'Market receipt'
    });
    await user.click(within(details).getByRole('button', { name: 'Split by category' }));
    expect(within(details).getByRole('combobox', { name: 'Category 1' }).textContent).toContain(
      'Food'
    );
    await user.type(within(details).getByLabelText('Amount for category 1'), '100');
    await user.click(within(details).getByRole('combobox', { name: 'Category 2' }));
    expect(screen.queryByRole('option', { name: 'Food' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Supplies' }));
    await user.type(within(details).getByLabelText('Amount for category 2'), '20');
    expect(within(details).getByText(/5.00 left to assign/)).toBeTruthy();
    await user.click(within(details).getByRole('button', { name: 'Next' }));
    expect(within(details).getByRole('alert').textContent).toMatch(/total/i);

    const suppliesAmount = within(details).getByLabelText('Amount for category 2');
    await user.clear(suppliesAmount);
    await user.type(suppliesAmount, '25');
    await user.click(within(details).getByRole('button', { name: 'Next' }));
    const review = screen.getByRole('dialog', { name: 'Review Transaction' });
    expect(getReviewRow(review, 'Food').textContent).toMatch(/100.00/);
    expect(getReviewRow(review, 'Supplies').textContent).toMatch(/25.00/);
    await user.click(within(review).getByRole('button', { name: 'Add Transaction' }));
    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('1'));
    expect(results.at(-1).transaction.categorySplits).toEqual([
      { categoryId: 'food', amount: 100 },
      { categoryId: 'supplies', amount: 25 }
    ]);

    await user.click(screen.getByText('Market receipt'));
    const panel = screen.getByRole('dialog', { name: 'Transaction detail' });
    expect(within(panel).getByText('Supplies').parentElement.textContent).toMatch(/25.00/);
    await user.click(within(panel).getByRole('button', { name: 'Edit Transaction' }));
    const edit = screen.getByRole('dialog', { name: 'Edit Transaction' });
    expect(within(edit).getByLabelText('Amount for category 1').value).toBe('100.00');
    await user.click(within(edit).getByRole('button', { name: 'Use one category' }));
    expect(within(edit).getByRole('combobox', { name: 'Category' }).textContent).toContain('Food');
    await user.click(within(edit).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit Transaction' })).toBeNull()
    );
    expect(results.at(-1).transaction.categorySplits?.length || 0).toBe(0);
    expect(results.at(-1).transaction.lines).toHaveLength(2);
    expect(screen.getByLabelText('transaction-count').textContent).toBe('1');
  });

  it('turns the same Expense flow into a card charge and previews balance owed', async () => {
    const user = userEvent.setup();
    const commandResults = [];
    render(
      <TransactionHarness
        initialWorkbook={makeCreditCardExpenseWorkbook()}
        onCommandResult={(result) => commandResults.push(result)}
      />
    );

    const detailsDialog = await openExpenseDetails(user);
    await fillExpenseDetails(user, detailsDialog, {
      accountLabel: 'BPI Credit Card',
      accountId: 'credit-card',
      amount: '900',
      description: 'Card groceries'
    });

    expect(selectedOptionLabel(within(detailsDialog).getByLabelText('Charged to'))).toContain(
      'BPI Credit Card'
    );
    await user.click(within(detailsDialog).getByRole('button', { name: 'Next' }));

    const reviewDialog = screen.getByRole('dialog', { name: 'Review Transaction' });
    expect(
      within(getReviewRow(reviewDialog, 'Charged to')).getByText('BPI Credit Card')
    ).not.toBeNull();
    expect(
      within(reviewDialog).getByText(/increase your BPI Credit Card balance owed by/i)
    ).not.toBeNull();
    await user.click(within(reviewDialog).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('1'));
    const posted = commandResults.at(-1).transaction;
    expect(posted).toMatchObject({
      template: 'expense_charged',
      categoryId: 'food',
      amount: 900
    });
    expect(posted.lines).toEqual([
      expect.objectContaining({ accountId: 'food-expense', direction: 'debit', amount: 900 }),
      expect.objectContaining({ accountId: 'credit-card', direction: 'credit', amount: 900 })
    ]);
  });
});
