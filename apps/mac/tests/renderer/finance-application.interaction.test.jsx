import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  makeLine,
  makeMinimalWorkbook,
  makeTransaction
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';

const IMPORT_CSV = [
  'date,description,amount,account,category',
  '2026-07-03,Imported lunch,-210,Cash,Food'
].join('\n');

function makeApplicationWorkbook() {
  const workbook = makeMinimalWorkbook();
  workbook.name = 'Application Integration';
  workbook.accounts.push({
    id: 'subscriptions-expense',
    name: 'Subscriptions Expense',
    group: 'expense',
    currency: 'PHP',
    isActive: true
  });
  workbook.categories.push({
    id: 'subscriptions',
    name: 'Subscriptions',
    type: 'expense',
    currency: 'PHP',
    linkedAccountId: 'subscriptions-expense',
    isActive: true
  });
  workbook.sheets = [
    {
      id: 'sheet-july',
      name: 'July',
      monthIndex: 6,
      budgets: [],
      budgetLineItems: []
    }
  ];
  workbook.recurringItems = [];
  workbook.counterparties = [];
  return workbook;
}

function makePorts(overrides = {}) {
  let idSequence = 0;
  const save =
    overrides.save ||
    vi.fn(async () => ({
      ok: true,
      savedAt: '2026-07-10T08:00:00.000Z'
    }));
  const saveAs = overrides.saveAs || vi.fn(async () => ({ ok: true }));
  const cacheSave = overrides.cacheSave || vi.fn(async () => ({ ok: true }));
  const download = overrides.download || vi.fn(async () => ({ ok: true }));
  const openText =
    overrides.openText ||
    vi.fn(async () => ({
      ok: true,
      fileName: 'transactions.csv',
      text: IMPORT_CSV
    }));
  const advisorInvoke =
    overrides.advisorInvoke || vi.fn(async () => ({ ok: true, candidates: [] }));
  const ports = createNullRendererPorts({
    workbookStorage: {
      save,
      saveAs,
      open: overrides.open || vi.fn(async () => ({ status: 'canceled' })),
      reveal: overrides.reveal || vi.fn(async () => ({ ok: true })),
      forget: overrides.forget || vi.fn(async () => ({ ok: true }))
    },
    browserCache: {
      save: cacheSave,
      clear: overrides.cacheClear || vi.fn(async () => ({ ok: true }))
    },
    downloads: { save: download },
    filePicker: { openText },
    advisor: { invoke: advisorInvoke },
    clock: {
      now: () => '2026-07-10T08:00:00.000Z',
      today: () => '2026-07-10'
    },
    ids: {
      create(prefix = 'id') {
        idSequence += 1;
        return `${prefix}-app-${idSequence}`;
      }
    }
  });
  return { ports, save, saveAs, cacheSave, download, openText, advisorInvoke };
}

describe('finance application composition', () => {
  it('opens the account wizard from the global quick-add shortcut', async () => {
    const user = userEvent.setup();
    const { ports } = makePorts();
    render(
      <AppShell initialWorkbook={makeApplicationWorkbook()} ports={ports} routeId="dashboard" />
    );

    await user.click(screen.getByRole('button', { name: 'Add Account' }));

    expect(document.querySelector('[data-react-route="accounts"]')).not.toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Add Account' })).not.toBeNull();
  });

  it('navigates from quick add, opens the transaction modal, rerenders, and saves', async () => {
    const user = userEvent.setup();
    const { ports, save, cacheSave } = makePorts();
    const onAction = vi.fn();
    render(
      <AppShell
        initialWorkbook={makeApplicationWorkbook()}
        onAction={onAction}
        ports={ports}
        routeId="dashboard"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));
    const typeDialog = await screen.findByRole('dialog', { name: 'Add Transaction' });
    expect(document.querySelector('[data-react-route="transactions"]')).not.toBeNull();

    await user.click(within(typeDialog).getByRole('button', { name: /^Expense\b/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Transaction' });
    await user.type(within(dialog).getByLabelText('Description'), 'Application coffee');
    await user.type(within(dialog).getByLabelText('Amount'), '125');
    await user.click(within(dialog).getByRole('combobox', { name: 'Category' }));
    await user.click(screen.getByRole('option', { name: 'Food' }));
    await user.selectOptions(within(dialog).getByLabelText('Paid with'), 'cash');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    const reviewDialog = screen.getByRole('dialog', { name: 'Review Transaction' });
    await user.click(within(reviewDialog).getByRole('button', { name: 'Add Transaction' }));

    expect(await screen.findByText('Application coffee')).not.toBeNull();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].transactions.at(-1).description).toBe('Application coffee');
    expect(cacheSave).toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledWith({ type: 'open-ledger-composer', payload: {} });
  });

  it('owns budget editor overlays and persists immutable budget mutations', async () => {
    const user = userEvent.setup();
    const { ports, save } = makePorts();
    render(
      <AppShell initialWorkbook={makeApplicationWorkbook()} ports={ports} routeId="budgets" />
    );

    await user.click(screen.getByRole('button', { name: 'Create budget' }));
    const editor = await screen.findByRole('dialog', { name: 'Budget editor' });
    await user.click(within(editor).getByRole('combobox', { name: 'Budget category' }));
    await user.click(screen.getByRole('option', { name: 'Food' }));
    await user.type(within(editor).getByLabelText('Planned amount'), '500');
    await user.click(within(editor).getByRole('button', { name: 'Save Budget' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Budget editor' })).toBeNull());
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].sheets[0].budgets).toContainEqual(
      expect.objectContaining({ categoryId: 'food', planned: 500, createdAt: expect.any(String) })
    );
    expect(screen.getAllByText('₱500.00').length).toBeGreaterThan(0);
  });

  it('creates a monthly sheet when budgeting the displayed month', async () => {
    const user = userEvent.setup();
    const { ports, save } = makePorts();
    render(
      <AppShell initialWorkbook={makeApplicationWorkbook()} ports={ports} routeId="budgets" />
    );

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Create budget' }));
    const editor = await screen.findByRole('dialog', { name: 'Budget editor' });
    expect(within(editor).getByLabelText('Budget month').value).toBe('August 2026');
    await user.click(within(editor).getByRole('combobox', { name: 'Budget category' }));
    await user.click(screen.getByRole('option', { name: 'Food' }));
    await user.type(within(editor).getByLabelText('Planned amount'), '650');
    await user.click(within(editor).getByRole('button', { name: 'Save Budget' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].sheets).toContainEqual(
      expect.objectContaining({
        monthKey: '2026-08',
        monthIndex: 7,
        budgets: [
          expect.objectContaining({ categoryId: 'food', planned: 650, createdAt: '2026-07-10' })
        ]
      })
    );
  });

  it('drills from a budget category transaction into the full ledger detail', async () => {
    const user = userEvent.setup();
    const workbook = makeApplicationWorkbook();
    workbook.sheets[0].budgets = [{ categoryId: 'food', planned: 500, createdAt: '2026-07-01' }];
    workbook.transactions = [
      makeTransaction({
        id: 'budget-coffee',
        date: '2026-07-09',
        description: 'Budget coffee',
        categoryId: 'food',
        amount: 125,
        lines: [makeLine('food-expense', 'debit', 125), makeLine('cash', 'credit', 125)]
      })
    ];
    const { ports } = makePorts();
    const { container } = render(
      <AppShell initialWorkbook={workbook} ports={ports} routeId="budgets" />
    );

    await user.click(container.querySelector('.budget-category-list-row'));
    await user.click(screen.getByRole('tab', { name: 'Transactions' }));
    await user.click(
      screen.getByRole('button', { name: 'View Budget coffee transaction details' })
    );

    expect(await screen.findByRole('dialog', { name: 'Transaction detail' })).not.toBeNull();
    expect(screen.getAllByText('Budget coffee').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-react-route="transactions"]')).not.toBeNull();
  });

  it('wires account and category command results into the shared workbook session', async () => {
    const user = userEvent.setup();
    const { ports, save } = makePorts();
    render(
      <AppShell initialWorkbook={makeApplicationWorkbook()} ports={ports} routeId="accounts" />
    );

    const main = screen.getByRole('main', { name: 'Workbook content' });
    await user.click(within(main).getByRole('button', { name: /^Create account/ }));
    await user.click(screen.getByRole('button', { name: /Cash Account/ }));
    const accountDialog = screen.getByRole('dialog', { name: 'Add Cash Account' });
    await user.type(within(accountDialog).getByLabelText('Cash account name'), 'Savings');
    await user.click(within(accountDialog).getByRole('button', { name: 'Save Account' }));
    expect(await screen.findByRole('button', { name: /^Open Savings account,/ })).not.toBeNull();
    await waitFor(() => expect(save).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Categories' }));
    await user.click(within(main).getByRole('button', { name: 'Create category' }));
    let categoryDialog = screen.getByRole('dialog', { name: 'Create a new category' });
    await user.type(within(categoryDialog).getByLabelText('Category name'), 'Travel');
    await user.click(within(categoryDialog).getByRole('button', { name: 'Next' }));
    categoryDialog = screen.getByRole('dialog', { name: 'New Category' });
    await user.click(within(categoryDialog).getByRole('button', { name: 'Create Category' }));

    expect(await screen.findByRole('article', { name: 'Travel category' })).not.toBeNull();
    await waitFor(() =>
      expect(
        save.mock.calls.at(-1)[0].categories.some((category) => category.name === 'Travel')
      ).toBe(true)
    );
  });

  it('runs CSV import and workbook exports entirely through injected ports', async () => {
    const user = userEvent.setup();
    const { ports, save, download, openText } = makePorts();
    render(<AppShell initialWorkbook={makeApplicationWorkbook()} ports={ports} routeId="ledger" />);

    await user.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(openText).toHaveBeenCalledWith({
      kind: 'transactions-csv',
      accept: '.csv,text/csv'
    });
    const preview = await screen.findByRole('dialog', { name: 'CSV import preview' });
    await user.click(within(preview).getByRole('button', { name: /Apply Ready Rows/ }));
    expect(await screen.findByText(/Applied 1 ready rows/)).not.toBeNull();
    await waitFor(() => expect(save).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(download.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(
      download.mock.calls.some(([payload]) => payload.suggestedName.endsWith('transactions.csv'))
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(
        download.mock.calls.some(([payload]) => payload.mimeType === 'text/html;charset=utf-8')
      ).toBe(true)
    );
  });

  it('executes settings storage/Advisor intents and surfaces controller failures', async () => {
    const user = userEvent.setup();
    const { ports, save, saveAs, advisorInvoke } = makePorts();
    render(
      <AppShell initialWorkbook={makeApplicationWorkbook()} ports={ports} routeId="settings" />
    );

    const rateInput = document.querySelector('#usd-rate-form input[name="usdRate"]');
    await user.clear(rateInput);
    await user.type(rateInput, '0');
    await user.click(screen.getByRole('button', { name: 'Update Rate' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent.includes('greater than zero'))).toBe(true);

    await user.clear(rateInput);
    await user.type(rateInput, '60');
    await user.click(screen.getByRole('button', { name: 'Update Rate' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].settings.usdToBaseRate).toBe(60);

    await user.click(screen.getByRole('tab', { name: /Files & Data/ }));
    await user.click(screen.getByRole('button', { name: /Save As/ }));
    await waitFor(() => expect(saveAs).toHaveBeenCalled());
    await waitFor(() => expect(advisorInvoke).toHaveBeenCalledWith('getSettings'));
    advisorInvoke.mockClear();
    await user.click(
      within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('tab', {
        name: /Assistant/
      })
    );
    await user.selectOptions(document.querySelector('select[name="provider"]'), 'openai');
    expect(advisorInvoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Save Assistant/ }));
    await waitFor(() =>
      expect(advisorInvoke).toHaveBeenCalledWith(
        'saveSettings',
        expect.objectContaining({ provider: 'openai' })
      )
    );
  });

  it('persists recurring items without exposing the retired subscription scan', async () => {
    const user = userEvent.setup();
    const { ports, save } = makePorts();
    render(<AppShell initialWorkbook={makeApplicationWorkbook()} ports={ports} routeId="bills" />);

    await user.click(screen.getByRole('button', { name: 'Create bill or subscription' }));
    const editor = await screen.findByRole('dialog', { name: 'Add bill or subscription' });
    await user.type(within(editor).getByLabelText('Recurring name'), 'Internet');
    await user.type(within(editor).getByLabelText('Recurring amount'), '1499');
    fireEvent.change(within(editor).getByLabelText('Recurring due date'), {
      target: { value: '2026-07-20' }
    });
    await user.click(within(editor).getByRole('combobox', { name: 'Recurring category' }));
    await user.click(screen.getByRole('option', { name: 'Food' }));
    await user.selectOptions(within(editor).getByLabelText('Recurring payment account'), 'cash');
    await user.click(within(editor).getByRole('button', { name: 'Save Bill' }));

    expect(screen.queryByRole('dialog', { name: 'Add bill or subscription' })).toBeNull();
    expect(screen.queryAllByRole('alert').map((alert) => alert.textContent)).toEqual([]);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].recurringItems.at(-1).name).toBe('Internet');
    expect((await screen.findAllByText('Internet')).length).toBeGreaterThan(0);

    expect(screen.queryByRole('button', { name: /Scan Transactions/ })).toBeNull();
  });
});
