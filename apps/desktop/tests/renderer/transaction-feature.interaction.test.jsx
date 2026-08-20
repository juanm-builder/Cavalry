import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  makeMinimalWorkbook,
  makeMultiCurrencyWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { makeTransactionTableWorkbook } from '@cavalry/finance-core/test-fixtures/transaction-table-scenarios.js';
import { TransactionRoute } from '../../src/renderer/features/transactions/TransactionRoute.jsx';
import { useTransactionController } from '../../src/renderer/features/transactions/transaction-controller.js';
import { chooseOption, selectedOptionLabel } from './select-helpers.js';

const VALID_CSV = [
  'date,description,amount,account,category',
  '2026-07-02,CSV lunch,-250,Cash,Food'
].join('\n');

function TransactionHarness({
  initialWorkbook,
  initialState,
  onCommandResult,
  onIntent,
  services = { defaultDate: '2026-07-01' }
}) {
  const [workbook, setWorkbook] = useState(initialWorkbook);
  const [revision, setRevision] = useState(0);
  const controller = useTransactionController({
    workbook,
    initialState,
    services,
    onCommandResult: (result) => {
      if (typeof onCommandResult === 'function') {
        onCommandResult(result);
      }
      if (result.ok && result.workbook && result.workbook !== workbook) {
        setWorkbook(result.workbook);
        setRevision((value) => value + 1);
      }
    },
    onIntent
  });
  return (
    <>
      <output aria-label="transaction-count">{workbook.transactions.length}</output>
      <output aria-label="workbook-revision">{revision}</output>
      <button
        type="button"
        onClick={() =>
          controller.onAction({
            type: 'csv-import-preview',
            payload: { fileName: 'transactions.csv', text: VALID_CSV }
          })
        }
      >
        Load CSV fixture
      </button>
      <TransactionRoute model={controller.model} onAction={controller.onAction} />
    </>
  );
}

async function openCreateDetails(user, type) {
  await user.click(screen.getByRole('button', { name: 'Create transaction' }));
  const typeDialog = screen.getByRole('dialog', { name: 'Add Transaction' });
  await user.click(
    within(typeDialog).getByRole('button', { name: new RegExp(`^${type}\\b`, 'i') })
  );
  return screen.getByRole('dialog', { name: 'Add Transaction' });
}

async function advanceToReview(user, detailsDialog) {
  await user.click(within(detailsDialog).getByRole('button', { name: 'Next' }));
  return screen.getByRole('dialog', { name: 'Review Transaction' });
}

function makeIncomeCreateWorkbook() {
  const workbook = makeMinimalWorkbook();
  workbook.accounts.push({
    id: 'salary-income',
    name: 'Salary Income',
    group: 'income',
    currency: 'PHP',
    isActive: true
  });
  workbook.categories.push({
    id: 'salary',
    name: 'Salary',
    type: 'income',
    currency: 'PHP',
    linkedAccountId: 'salary-income',
    isActive: true
  });
  return workbook;
}

function makeTransferCreateWorkbook() {
  const workbook = makeMinimalWorkbook();
  workbook.accounts.push({
    id: 'bank',
    name: 'Bank',
    group: 'asset',
    currency: 'PHP',
    isActive: true
  });
  return workbook;
}

describe('controlled transaction feature', () => {
  it('opens the transaction detail side panel when a row is clicked', async () => {
    const user = userEvent.setup();
    render(<TransactionHarness initialWorkbook={makeTransactionTableWorkbook()} />);

    await user.click(screen.getByText('Uncategorized adjustment'));

    const detail = screen.getByRole('dialog', { name: 'Transaction detail' });
    expect(detail).not.toBeNull();
    expect(detail.querySelector('.transaction-detail-title-row .status-pill')).toBeNull();
    expect(within(detail).getByText('Cash balance before')).not.toBeNull();
    expect(within(detail).getByText('Cash balance after')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close transaction detail' }));
    expect(screen.queryByRole('dialog', { name: 'Transaction detail' })).toBeNull();
  });

  it('separates expense accounts from categories and explains their balance impact', async () => {
    const user = userEvent.setup();
    render(<TransactionHarness initialWorkbook={makeTransactionTableWorkbook()} />);

    await user.click(screen.getByText('Coffee beans'));
    let detail = screen.getByRole('dialog', { name: 'Transaction detail' });
    expect(within(detail).getByText('Paid from Cash')).not.toBeNull();
    expect(within(detail).getByText('Cash balance before')).not.toBeNull();
    expect(within(detail).getByText('Cash balance after')).not.toBeNull();
    expect(within(detail).getByText('Paid from').nextElementSibling.textContent).toBe('Cash');
    expect(within(detail).getByText('Category').nextElementSibling.textContent).toBe('Food');
    await user.click(within(detail).getByRole('button', { name: 'Close transaction detail' }));

    await user.click(screen.getByText('Card groceries'));
    detail = screen.getByRole('dialog', { name: 'Transaction detail' });
    expect(within(detail).getByText('Charged to Credit Card')).not.toBeNull();
    expect(within(detail).getByText('Balance owed before')).not.toBeNull();
    expect(within(detail).getByText('Balance owed after')).not.toBeNull();
    expect(within(detail).getByText('Charged to').nextElementSibling.textContent).toBe(
      'Credit Card'
    );
    expect(within(detail).getByText('Category').nextElementSibling.textContent).toBe('Shopping');
    expect(within(detail).getByText('+₱1,200.00')).not.toBeNull();
  });

  it('creates, edits, and deletes with immutable command-result workbooks', async () => {
    const user = userEvent.setup();
    const initialWorkbook = makeMinimalWorkbook();
    const commandResults = [];
    render(
      <TransactionHarness
        initialWorkbook={initialWorkbook}
        onCommandResult={(result) => commandResults.push(result)}
      />
    );

    const createDialog = await openCreateDetails(user, 'Expense');
    await user.type(within(createDialog).getByLabelText('Description'), 'Coffee beans');
    await user.type(within(createDialog).getByLabelText('Amount'), '125');
    await user.click(within(createDialog).getByRole('combobox', { name: 'Category' }));
    await user.click(screen.getByRole('option', { name: 'Food' }));
    await chooseOption(user, within(createDialog).getByLabelText('Paid with'), 'Cash');

    const reviewDialog = await advanceToReview(user, createDialog);
    expect(screen.getByLabelText('transaction-count').textContent).toBe('0');
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('0');
    expect(commandResults).toHaveLength(0);
    await user.click(within(reviewDialog).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('1'));
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('1');
    expect(screen.getByText('Coffee beans')).not.toBeNull();
    expect(commandResults[0].ok).toBe(true);
    expect(commandResults[0].workbook).not.toBe(initialWorkbook);
    expect(initialWorkbook.transactions).toHaveLength(0);

    await user.click(screen.getByText('Coffee beans'));
    await user.click(screen.getByRole('button', { name: 'Edit Transaction' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit Transaction' });
    const description = within(editDialog).getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Coffee beans edited');
    await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByText('Coffee beans edited')).not.toBeNull());
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('2');
    expect(commandResults[1].workbook).not.toBe(commandResults[0].workbook);
    expect(commandResults[0].workbook.transactions[0].description).toBe('Coffee beans');

    await user.click(screen.getByText('Coffee beans edited'));
    await user.click(screen.getByRole('button', { name: 'More transaction actions' }));
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete transaction' });
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete Transaction' }));

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('0'));
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('3');
    expect(commandResults[2].workbook).not.toBe(commandResults[1].workbook);
    expect(commandResults[1].workbook.transactions).toHaveLength(1);
  });

  it('keeps invalid expense details open without invoking the submit command', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <TransactionHarness
        initialWorkbook={makeMinimalWorkbook()}
        onCommandResult={onCommandResult}
      />
    );

    const dialog = await openCreateDetails(user, 'Expense');
    await user.type(within(dialog).getByLabelText('Description'), 'Invalid row');
    await user.type(within(dialog).getByLabelText('Amount'), '20');
    await chooseOption(user, within(dialog).getByLabelText('Paid with'), 'Cash');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Pick an expense category.');
    expect(screen.getByRole('dialog', { name: 'Add Transaction' })).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Review Transaction' })).toBeNull();
    expect(screen.getByLabelText('transaction-count').textContent).toBe('0');
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('0');
    expect(onCommandResult).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Add Transaction' })).toBeNull();
  });

  it('creates income through review and posts asset and income lines', async () => {
    const user = userEvent.setup();
    const initialWorkbook = makeIncomeCreateWorkbook();
    const commandResults = [];
    render(
      <TransactionHarness
        initialWorkbook={initialWorkbook}
        onCommandResult={(result) => commandResults.push(result)}
      />
    );

    const detailsDialog = await openCreateDetails(user, 'Income');
    await chooseOption(user, within(detailsDialog).getByLabelText('To account'), 'Cash');
    await user.type(within(detailsDialog).getByLabelText('Amount'), '25000');
    await user.click(within(detailsDialog).getByRole('combobox', { name: 'Source' }));
    await user.click(screen.getByRole('option', { name: 'Salary' }));
    await user.type(within(detailsDialog).getByLabelText('Description'), 'July salary');

    const reviewDialog = await advanceToReview(user, detailsDialog);
    expect(screen.getByLabelText('transaction-count').textContent).toBe('0');
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('0');
    expect(commandResults).toHaveLength(0);
    expect(within(reviewDialog).getByText(/increase your Cash by/i)).not.toBeNull();
    await user.click(within(reviewDialog).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('1'));
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('1');
    const posted = commandResults.at(-1).transaction;
    expect(posted.template).toBe('income_received');
    expect(posted.categoryId).toBe('salary');
    expect(posted.lines).toEqual([
      expect.objectContaining({ accountId: 'cash', direction: 'debit', amount: 25000 }),
      expect.objectContaining({
        accountId: 'salary-income',
        direction: 'credit',
        amount: 25000
      })
    ]);
  });

  it('creates a neutral transfer with two opposing balance-account lines', async () => {
    const user = userEvent.setup();
    const initialWorkbook = makeTransferCreateWorkbook();
    const commandResults = [];
    render(
      <TransactionHarness
        initialWorkbook={initialWorkbook}
        onCommandResult={(result) => commandResults.push(result)}
      />
    );

    const detailsDialog = await openCreateDetails(user, 'Transfer');
    await chooseOption(user, within(detailsDialog).getByLabelText('From account'), 'Cash');
    await chooseOption(user, within(detailsDialog).getByLabelText('To account'), 'Bank');
    await user.type(within(detailsDialog).getByLabelText('Amount'), '2000');
    await user.type(within(detailsDialog).getByLabelText('Note (optional)'), 'Transfer to bank');

    const reviewDialog = await advanceToReview(user, detailsDialog);
    expect(screen.getByLabelText('transaction-count').textContent).toBe('0');
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('0');
    expect(commandResults).toHaveLength(0);
    expect(within(reviewDialog).getByText(/total balance won't change/i)).not.toBeNull();
    expect(reviewDialog.querySelector('.transaction-impact.info')).not.toBeNull();
    await user.click(within(reviewDialog).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('1'));
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('1');
    const posted = commandResults.at(-1).transaction;
    expect(posted.template).toBe('transfer');
    expect(posted.categoryId).toBe('');
    expect(posted.lines).toEqual([
      expect.objectContaining({ accountId: 'bank', direction: 'debit', amount: 2000 }),
      expect.objectContaining({ accountId: 'cash', direction: 'credit', amount: 2000 })
    ]);
    const transferRow = screen.getByText(/Transfer: Cash/).closest('tr');
    expect(transferRow.querySelector('.amount.info')).not.toBeNull();
    expect(transferRow.querySelector('.amount.good, .amount.bad')).toBeNull();
  });

  it('posts the explicitly entered historical USD expense rate', async () => {
    const user = userEvent.setup();
    const commandResults = [];
    render(
      <TransactionHarness
        initialWorkbook={makeMultiCurrencyWorkbook()}
        onCommandResult={(result) => commandResults.push(result)}
      />
    );

    const dialog = await openCreateDetails(user, 'Expense');
    await user.type(within(dialog).getByLabelText('Description'), 'Historical USD purchase');
    await user.type(within(dialog).getByLabelText('Amount'), '10');
    await chooseOption(user, within(dialog).getByLabelText('Currency'), 'USD');
    await user.click(within(dialog).getByRole('combobox', { name: 'Category' }));
    await user.click(screen.getByRole('option', { name: 'Food' }));
    await chooseOption(user, within(dialog).getByLabelText('Paid with'), 'Cash');
    await user.type(within(dialog).getByLabelText('FX rate to base'), '61.25');

    const reviewDialog = await advanceToReview(user, dialog);
    expect(screen.getByLabelText('transaction-count').textContent).toBe('1');
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('0');
    expect(commandResults).toHaveLength(0);
    await user.click(within(reviewDialog).getByRole('button', { name: 'Add Transaction' }));

    expect(
      await within(reviewDialog).findByText(
        /Transaction currency: USD.*Cash \(configured PHP\).*1 USD = PHP 61\.25/
      )
    ).not.toBeNull();
    await user.click(
      within(reviewDialog).getByRole('button', { name: 'Confirm Conversion & Post' })
    );

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('2'));
    const posted = commandResults.at(-1).workbook.transactions.at(-1);
    expect(posted.originalCurrency).toBe('USD');
    expect(posted.fxRateToBase).toBe(61.25);
    expect(posted.baseAmount).toBe(612.5);
  });

  it('supports type, range, category, sort, reset, and pagination interactions', async () => {
    const user = userEvent.setup();
    render(
      <TransactionHarness
        initialWorkbook={makeTransactionTableWorkbook()}
        initialState={{ view: { pageSize: 2, sort: { key: 'date', direction: 'desc' } } }}
      />
    );

    expect(screen.getByText('Uncategorized adjustment')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Archived card fee')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByLabelText('Search')).toBeNull();
    const minimumAmount = screen.getByLabelText('Minimum amount range');
    fireEvent.change(minimumAmount, { target: { value: '1000' } });
    await waitFor(() => expect(screen.getByLabelText('Minimum amount range').value).toBe('1000'));

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('combobox', { name: 'Filter transactions by category' }));
    await user.click(screen.getByRole('option', { name: 'Shopping' }));
    expect(await screen.findByText('Card groceries')).not.toBeNull();

    await chooseOption(user, screen.getByLabelText('Sort by'), 'Amount');
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(await screen.findByText('Uncategorized adjustment')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Income' }));
    expect(await screen.findByText('Salary payroll')).not.toBeNull();
    expect(screen.queryByText('Coffee beans')).toBeNull();
  });

  it('searches meaningful transaction fields beside the filter and composes with filters', async () => {
    const user = userEvent.setup();
    render(<TransactionHarness initialWorkbook={makeTransactionTableWorkbook()} />);

    const search = screen.getByRole('searchbox', { name: 'Search transactions' });
    const filterButton = screen.getByRole('button', { name: 'Filters' });
    expect(search.closest('.transaction-search-control').nextElementSibling).toBe(filterButton);

    await user.type(search, 'CrEdIt CaRd');
    expect(search.value).toBe('CrEdIt CaRd');
    expect(await screen.findByText('Card groceries')).not.toBeNull();
    expect(screen.queryByText('Archived card fee')).toBeNull();
    expect(screen.queryByText('Coffee beans')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear transaction search' }));
    expect(search.value).toBe('');
    expect(await screen.findByText('Coffee beans')).not.toBeNull();

    await user.type(search, 'card');
    expect(await screen.findByText('Archived card fee')).not.toBeNull();
    await user.click(filterButton);
    await user.click(screen.getByRole('combobox', { name: 'Filter transactions by category' }));
    await user.click(screen.getByRole('option', { name: 'Shopping', exact: true }));

    expect(search.value).toBe('card');
    expect(await screen.findByText('Card groceries')).not.toBeNull();
    expect(screen.queryByText('Archived card fee')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(search.value).toBe('');
    expect(await screen.findByText('Archived card fee')).not.toBeNull();
  });

  it('filters transactions by type from the filter panel dropdown', async () => {
    const user = userEvent.setup();
    render(<TransactionHarness initialWorkbook={makeTransactionTableWorkbook()} />);

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const typeFilter = screen.getByLabelText('Type');
    await chooseOption(user, typeFilter, 'Income');

    expect(selectedOptionLabel(typeFilter)).toBe('Income');
    expect(await screen.findByText('Salary payroll')).not.toBeNull();
    expect(screen.queryByText('Coffee beans')).toBeNull();
    expect(screen.queryByText('Move to bank')).toBeNull();
  });

  it('previews, applies, and closes CSV imports with a new workbook identity', async () => {
    const user = userEvent.setup();
    const results = [];
    render(
      <TransactionHarness
        initialWorkbook={makeMinimalWorkbook()}
        onCommandResult={(result) => results.push(result)}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Load CSV fixture' }));
    expect(screen.getByRole('dialog', { name: 'CSV import preview' })).not.toBeNull();
    expect(screen.getByText('1 of 1 rows ready')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /Apply Ready Rows/ }));

    await waitFor(() => expect(screen.getByLabelText('transaction-count').textContent).toBe('1'));
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('1');
    expect(screen.getByText(/Applied 1 ready rows/)).not.toBeNull();
    expect(results.at(-1).workbook.transactions[0].description).toBe('CSV lunch');

    const actions = document.querySelector('.modal-actions');
    await user.click(within(actions).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'CSV import preview' })).toBeNull();
  });

  it('cancels CSV previews without replacing the workbook', async () => {
    const user = userEvent.setup();
    const results = [];
    render(
      <TransactionHarness
        initialWorkbook={makeMinimalWorkbook()}
        onCommandResult={(result) => results.push(result)}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Load CSV fixture' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'CSV import preview' })).toBeNull();
    expect(screen.getByLabelText('transaction-count').textContent).toBe('0');
    expect(screen.getByLabelText('workbook-revision').textContent).toBe('0');
    expect(results.at(-1).importResult.canceled).toBe(true);
  });

  it('emits platform-neutral workbook, CSV, and file-selection intents', async () => {
    const user = userEvent.setup();
    const onIntent = vi.fn();
    render(<TransactionHarness initialWorkbook={makeMinimalWorkbook()} onIntent={onIntent} />);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(onIntent).toHaveBeenLastCalledWith({
      type: 'export/requested',
      payload: expect.objectContaining({
        kind: 'csv-bundle',
        files: expect.objectContaining({
          'transactions.csv': expect.any(String),
          'accounts.csv': expect.any(String),
          'categories.csv': expect.any(String)
        })
      })
    });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onIntent).toHaveBeenLastCalledWith({
      type: 'export/requested',
      payload: expect.objectContaining({
        kind: 'workbook-html',
        contents: expect.stringContaining('ledger-grove-export')
      })
    });

    await user.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(onIntent).toHaveBeenLastCalledWith({
      type: 'import/file-requested',
      payload: {
        kind: 'transactions-csv',
        accept: '.csv,text/csv'
      }
    });
  });
});
