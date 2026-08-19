import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TransactionRoute } from '../../src/renderer/features/transactions/TransactionRoute.jsx';
import { useTransactionController } from '../../src/renderer/features/transactions/transaction-controller.js';

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

async function fillExpenseDetails(user, dialog, { accountId, amount, description }) {
  const initialAccountPicker = within(dialog).getByLabelText('Paid with');
  await user.selectOptions(initialAccountPicker, accountId);
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
    expect(within(accountPicker).getByRole('option', { name: /Cash/ })).not.toBeNull();
    expect(within(accountPicker).getByRole('option', { name: /BPI Credit Card/ })).not.toBeNull();
    expect(within(accountPicker).queryByRole('option', { name: /Personal Loan/ })).toBeNull();

    await fillExpenseDetails(user, detailsDialog, {
      accountId: 'cash',
      amount: '125',
      description: 'Cash lunch'
    });
    expect(within(detailsDialog).getByLabelText('Paid from').value).toBe('cash');
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
      accountId: 'credit-card',
      amount: '900',
      description: 'Card groceries'
    });

    expect(within(detailsDialog).getByLabelText('Charged to').value).toBe('credit-card');
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
