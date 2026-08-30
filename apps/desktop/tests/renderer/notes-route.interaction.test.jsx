import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import { NotesRoute } from '../../src/renderer/features/notes/NotesRoute.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';
import { chooseOption } from './select-helpers.js';

function makeWorkbook() {
  return {
    id: 'notes-interaction-workbook',
    version: 2,
    name: 'Notes Interaction',
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
        id: 'bank',
        name: 'BPI Checking',
        group: 'asset',
        subtype: 'checking',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'card',
        name: 'Credit Card',
        group: 'liability',
        subtype: 'credit_card',
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
        id: 'transport-expense',
        name: 'Transportation Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        color: '#deb063',
        linkedAccountId: 'food-expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'transportation',
        name: 'Transportation',
        type: 'expense',
        color: '#68c89b',
        linkedAccountId: 'transport-expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    recurringItems: [],
    recurringReconciliations: [],
    sheets: []
  };
}

function makeServices() {
  let sequence = 0;
  return {
    today: () => '2026-07-29',
    defaultDate: () => '2026-07-29',
    now: () => '2026-07-29T01:00:00.000Z',
    createId(prefix = 'id') {
      sequence += 1;
      return `${prefix}-notes-${sequence}`;
    },
    transactionBuilderServices: {
      createId(prefix = 'id') {
        sequence += 1;
        return `${prefix}-notes-${sequence}`;
      }
    }
  };
}

function expectNoBatchApproval() {
  expect(screen.queryByText('Needs review')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Save \d+ transactions?$/ })).toBeNull();
}

function installMemoryStorage() {
  const stored = new Map();
  const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => stored.clear(),
      getItem: (key) => (stored.has(key) ? stored.get(key) : null),
      removeItem: (key) => stored.delete(key),
      setItem: (key, value) => stored.set(key, String(value))
    }
  });
  return () => {
    if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage);
    else delete window.localStorage;
  };
}

describe('Notes route', () => {
  it('uses Cavalry AI asynchronously, commits immediately, and keeps the added row listed', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    let resolveModel;
    const modelResult = new Promise((resolve) => {
      resolveModel = resolve;
    });
    const advisor = {
      invoke: vi.fn((command) => {
        if (command === 'getSettings') {
          return Promise.resolve({
            ok: true,
            settings: {
              provider: 'openai',
              apiMode: 'responses',
              model: 'notes-test-model',
              hasApiKey: true
            }
          });
        }
        if (command === 'runAgentTurn') return modelResult;
        return Promise.resolve({ ok: false, unavailable: true });
      })
    };
    render(
      <NotesRoute
        advisor={advisor}
        onCommandResult={onCommandResult}
        services={makeServices()}
        workbook={makeWorkbook()}
      />
    );

    await user.type(
      screen.getByLabelText('Transaction notes'),
      'one kay Grab home from NAIA, charged to Credit Card'
    );
    await user.click(screen.getByRole('button', { name: 'Add transactions' }));

    expect(screen.getByRole('button', { name: 'Adding…' }).disabled).toBe(true);
    expect(screen.getByLabelText('Transaction notes').disabled).toBe(true);
    expect(onCommandResult).not.toHaveBeenCalled();

    resolveModel({
      ok: true,
      response: {
        output_text: JSON.stringify({
          transactions: [
            {
              lineNumber: 1,
              amount: 1000,
              currency: 'PHP',
              date: '2026-07-29',
              description: 'Grab home from NAIA',
              categoryId: 'transportation',
              categoryName: 'Transportation',
              primaryAccountId: 'card',
              primaryAccountName: 'Credit Card',
              confidence: 0.96,
              uncertainFields: [],
              evidence: {
                amount: 'one kay',
                category: 'Grab',
                primaryAccount: 'Credit Card',
                date: '',
                description: 'Grab home from NAIA'
              }
            }
          ]
        })
      }
    });

    await waitFor(() => expect(onCommandResult).toHaveBeenCalledOnce());
    expect(advisor.invoke).toHaveBeenCalledWith('runAgentTurn', expect.any(Object));
    expect(onCommandResult.mock.calls[0][0].workbook.transactions[0]).toMatchObject({
      amount: 1000,
      categoryId: 'transportation'
    });
    expect(screen.getByText('Grab home from NAIA')).not.toBeNull();
    expect(screen.getByText('AI enhanced')).not.toBeNull();
    expect(screen.getByLabelText('Transaction notes').value).toBe('');
    expect(
      screen.getByRole('button', { name: 'Edit transaction 1: Grab home from NAIA' })
    ).not.toBeNull();
    expectNoBatchApproval();
  });

  it('commits locally parsed transactions immediately and leaves every row listed', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        onCommandResult={onCommandResult}
        services={makeServices()}
        workbook={makeWorkbook()}
      />
    );

    await user.type(
      screen.getByLabelText('Transaction notes'),
      '₱1,000 transportation credit card\n₱180 food cash\n₱2,450 food debit'
    );
    await user.click(screen.getByRole('button', { name: 'Add transactions' }));

    await waitFor(() => expect(onCommandResult).toHaveBeenCalledOnce());
    expect(onCommandResult.mock.calls[0][0].workbook.transactions).toHaveLength(3);
    expect(screen.getByText('Credit card')).not.toBeNull();
    expect(screen.getByText('Cash')).not.toBeNull();
    expect(screen.getByText('Debit card')).not.toBeNull();
    expect(
      screen
        .getAllByRole('button', { name: /^Edit transaction \d+:/ })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Edit transaction 1: Transportation',
      'Edit transaction 2: Food',
      'Edit transaction 3: Food'
    ]);
    expect(document.querySelectorAll('.notes-review-entry')).toHaveLength(3);
    expect(screen.getByRole('status').textContent).toContain('3 transactions added');
    expect(screen.getByLabelText('Transaction notes').value).toBe('');
    expectNoBatchApproval();
  });

  it('restores added and unresolved rows after remount and continues global edit numbering', async () => {
    const restoreStorage = installMemoryStorage();
    try {
      const user = userEvent.setup();
      const onCommandResult = vi.fn();
      const services = makeServices();
      const firstView = render(
        <NotesRoute
          onCommandResult={onCommandResult}
          services={services}
          workbook={makeWorkbook()}
        />
      );

      await user.type(screen.getByLabelText('Transaction notes'), '₱180 food cash\nmystery cash');
      await user.click(screen.getByRole('button', { name: 'Add transactions' }));
      await waitFor(() => expect(onCommandResult).toHaveBeenCalledOnce());

      const updatedWorkbook = onCommandResult.mock.calls[0][0].workbook;
      expect(
        screen
          .getAllByRole('button', { name: /^Edit transaction \d+:/ })
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual(['Edit transaction 1: Food', 'Edit transaction 2: Mystery']);
      expect(
        JSON.parse(
          window.localStorage.getItem('cavalry.notes.entries.notes-interaction-workbook') || '[]'
        )
      ).toHaveLength(2);

      firstView.unmount();
      render(
        <NotesRoute
          onCommandResult={onCommandResult}
          services={services}
          workbook={updatedWorkbook}
        />
      );

      await waitFor(() =>
        expect(
          screen
            .getAllByRole('button', { name: /^Edit transaction \d+:/ })
            .map((button) => button.getAttribute('aria-label'))
        ).toEqual(['Edit transaction 1: Food', 'Edit transaction 2: Mystery'])
      );
      expect(screen.getByText('1 added · 1 needs details')).not.toBeNull();

      await user.type(screen.getByLabelText('Transaction notes'), '₱90 transportation cash');
      await user.click(screen.getByRole('button', { name: 'Add transactions' }));
      await waitFor(() => expect(onCommandResult).toHaveBeenCalledTimes(2));

      expect(
        screen
          .getAllByRole('button', { name: /^Edit transaction \d+:/ })
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual([
        'Edit transaction 1: Food',
        'Edit transaction 2: Mystery',
        'Edit transaction 3: Transportation'
      ]);
      expect(screen.getByText('2 added · 1 needs details')).not.toBeNull();
    } finally {
      restoreStorage();
    }
  });

  it('adds legitimate duplicate note lines without an approval gate', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        onCommandResult={onCommandResult}
        services={makeServices()}
        workbook={makeWorkbook()}
      />
    );

    await user.type(screen.getByLabelText('Transaction notes'), '₱180 food cash\n₱180 food cash');
    await user.click(screen.getByRole('button', { name: 'Add transactions' }));

    await waitFor(() => expect(onCommandResult).toHaveBeenCalledOnce());
    const transactions = onCommandResult.mock.calls[0][0].workbook.transactions;
    expect(transactions).toHaveLength(2);
    expect(new Set(transactions.map((transaction) => transaction.id)).size).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('2 transactions added');
    expect(
      screen
        .getAllByRole('button', { name: /^Edit transaction \d+:/ })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Edit transaction 1: Food', 'Edit transaction 2: Food']);
    expectNoBatchApproval();
  });

  it('updates the same committed transaction from Edit after a workbook rerender', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    const services = makeServices();
    const initialWorkbook = makeWorkbook();
    const view = render(
      <NotesRoute
        onCommandResult={onCommandResult}
        services={services}
        workbook={initialWorkbook}
      />
    );

    await user.type(screen.getByLabelText('Transaction notes'), '₱180 food cash');
    await user.click(screen.getByRole('button', { name: 'Add transactions' }));
    await waitFor(() => expect(onCommandResult).toHaveBeenCalledOnce());

    const createdResult = onCommandResult.mock.calls[0][0];
    const createdTransaction = createdResult.workbook.transactions[0];
    expect(createdTransaction.id).toBeTruthy();
    const enrichedWorkbook = {
      ...createdResult.workbook,
      counterparties: [
        {
          id: 'merchant-kept-from-ledger',
          name: 'Dinner Merchant',
          kind: 'merchant',
          isActive: true
        }
      ],
      transactions: createdResult.workbook.transactions.map((transaction) => ({
        ...transaction,
        counterpartyId: 'merchant-kept-from-ledger',
        note: 'Keep this Ledger note'
      }))
    };
    view.rerender(
      <NotesRoute
        onCommandResult={onCommandResult}
        services={services}
        workbook={enrichedWorkbook}
      />
    );

    expect(screen.getAllByText('Food')).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Edit transaction 1: Food' }));
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '275');
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Dinner');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onCommandResult).toHaveBeenCalledTimes(2));
    const updatedResult = onCommandResult.mock.calls[1][0];
    expect(updatedResult.workbook.transactions).toHaveLength(1);
    expect(updatedResult.workbook.transactions[0]).toMatchObject({
      id: createdTransaction.id,
      amount: 275,
      description: 'Dinner',
      categoryId: 'food',
      counterpartyId: 'merchant-kept-from-ledger',
      note: 'Keep this Ledger note'
    });
    expect(screen.getByText('Dinner')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Transaction updated');
    expect(screen.getByRole('button', { name: 'Edit transaction 1: Dinner' })).not.toBeNull();
    expectNoBatchApproval();
  });

  it('keeps the committed summary unchanged when an edit is invalid and Cancel restores it', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    const services = makeServices();
    const view = render(
      <NotesRoute onCommandResult={onCommandResult} services={services} workbook={makeWorkbook()} />
    );

    await user.type(screen.getByLabelText('Transaction notes'), '₱180 food cash');
    await user.click(screen.getByRole('button', { name: 'Add transactions' }));
    await waitFor(() => expect(onCommandResult).toHaveBeenCalledOnce());

    view.rerender(
      <NotesRoute
        onCommandResult={onCommandResult}
        services={services}
        workbook={onCommandResult.mock.calls[0][0].workbook}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Edit transaction 1: Food' }));
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Unsaved dinner');
    await user.clear(screen.getByLabelText('Amount'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Fix the highlighted details before saving.'
      )
    );
    expect(screen.getByText('Enter an amount greater than zero.')).not.toBeNull();
    expect(onCommandResult).toHaveBeenCalledOnce();
    let listedEntry = document.querySelector('.notes-review-entry');
    expect(listedEntry.querySelector('.notes-entry-copy small').textContent).toBe('Food');
    expect(listedEntry.querySelector('.notes-entry-amount').textContent).toContain('₱180');
    expect(screen.getByLabelText('Description').value).toBe('Unsaved dinner');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    listedEntry = document.querySelector('.notes-review-entry');
    expect(listedEntry.querySelector('.notes-entry-copy small').textContent).toBe('Food');
    expect(listedEntry.querySelector('.notes-entry-amount').textContent).toContain('₱180');
    expect(screen.queryByLabelText('Description')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit transaction 1: Food' }));
    expect(screen.getByLabelText('Description').value).toBe('Food');
    expect(screen.getByLabelText('Amount').value).toBe('180');
  });

  it('keeps a structurally invalid row editable and commits it as soon as it is fixed', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        onCommandResult={onCommandResult}
        services={makeServices()}
        workbook={makeWorkbook()}
      />
    );

    await user.type(screen.getByLabelText('Transaction notes'), 'mystery cash');
    await user.click(screen.getByRole('button', { name: 'Add transactions' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit transaction 1: Mystery' })).not.toBeNull()
    );
    expect(onCommandResult).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('1 needs details');
    expectNoBatchApproval();

    await user.click(screen.getByRole('button', { name: 'Edit transaction 1: Mystery' }));
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '450');
    await chooseOption(user, screen.getByLabelText('Category'), 'Food');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onCommandResult).toHaveBeenCalledOnce());
    expect(onCommandResult.mock.calls[0][0].workbook.transactions[0]).toMatchObject({
      amount: 450,
      categoryId: 'food'
    });
    expect(screen.getByRole('status').textContent).toContain('Transaction added');
    expect(screen.getAllByText('Food')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Edit transaction 1: Mystery' })).not.toBeNull();
    expectNoBatchApproval();
  });

  it('wires Notes through the app shell and persists immediately after adding', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => ({ ok: true, savedAt: '2026-07-29T01:00:01.000Z' }));
    const cacheSave = vi.fn(async () => ({ ok: true }));
    const advisorInvoke = vi.fn(async (command) => {
      if (command === 'getSettings') {
        return {
          ok: true,
          settings: { provider: 'local', hasApiKey: false }
        };
      }
      if (command === 'getServerStatus') return { ok: true, status: {} };
      if (command === 'getMicrophoneStatus') return { ok: true, status: {} };
      return { ok: false, unavailable: true };
    });
    const services = makeServices();
    const ports = createNullRendererPorts({
      workbookStorage: { save },
      browserCache: { save: cacheSave },
      advisor: { invoke: advisorInvoke },
      clock: {
        now: services.now,
        today: services.today
      },
      ids: { create: services.createId }
    });

    render(<AppShell initialWorkbook={makeWorkbook()} ports={ports} routeId="dashboard" />);
    const navigation = screen.getByRole('navigation', { name: 'Workbook' });
    await user.click(within(navigation).getByRole('button', { name: 'Notes' }));

    expect(document.querySelector('[data-react-route="notes"]')).not.toBeNull();
    await user.type(screen.getByLabelText('Transaction notes'), '₱180 food cash');
    await user.click(screen.getByRole('button', { name: 'Add transactions' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].transactions).toHaveLength(1);
    expect(cacheSave).toHaveBeenCalled();
    expect(screen.getAllByText('Food')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Edit transaction 1: Food' })).not.toBeNull();
    expectNoBatchApproval();
  });
});
