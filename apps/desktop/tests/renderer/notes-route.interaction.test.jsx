import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import { NotesRoute } from '../../src/renderer/features/notes/NotesRoute.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';
import {
  sourceKeys,
  readNotesDraft
} from '../../src/renderer/features/notes/notes-draft-storage.js';

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

let restoreStorage;
beforeEach(() => {
  restoreStorage = installMemoryStorage();
});
afterEach(() => {
  restoreStorage();
});
const note = '2026-07-29\n₱180 food cash';
async function review(user, text = note) {
  await user.type(screen.getByLabelText('Transaction notes'), text);
  await user.click(screen.getByRole('button', { name: 'Review transactions' }));
}
function Harness({ onCommand = () => {} }) {
  const [workbook, setWorkbook] = React.useState(makeWorkbook);
  return (
    <NotesRoute
      workbook={workbook}
      services={makeServices()}
      onCommandResult={(result) => {
        onCommand(result);
        setWorkbook(result.workbook);
        return result;
      }}
    />
  );
}

describe('Notes route', () => {
  it('distinguishes the same purchase on different days when no date heading was written', () => {
    const first = sourceKeys([{ sourceText: '180 food cash', date: '2026-07-29' }])[0];
    const next = sourceKeys([{ sourceText: '180 food cash', date: '2026-07-30' }])[0];
    expect(first.sourceKey).not.toBe(next.sourceKey);
  });

  it('does not overwrite an unreadable stored draft with an empty note', () => {
    const key = 'cavalry.notes.draft.notes-interaction-workbook';
    window.localStorage.setItem(key, '{broken data');
    render(<NotesRoute workbook={makeWorkbook()} services={makeServices()} />);
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    expect(window.localStorage.getItem(key)).toBe('{broken data');
  });

  it('discards a delayed AI review when the workbook changed while it was running', async () => {
    const user = userEvent.setup();
    let finish;
    const advisor = {
      invoke: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
    };
    const onCommandResult = vi.fn();
    const workbook = makeWorkbook();
    const view = render(
      <NotesRoute
        workbook={workbook}
        services={makeServices()}
        advisor={advisor}
        onCommandResult={onCommandResult}
      />
    );
    await user.type(screen.getByLabelText('Transaction notes'), note);
    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    view.rerender(
      <NotesRoute
        workbook={{ ...workbook, name: 'Changed elsewhere' }}
        services={makeServices()}
        advisor={advisor}
        onCommandResult={onCommandResult}
      />
    );
    finish({ ok: false, unavailable: true });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('workbook changed')
    );
    expect(onCommandResult).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Edit transaction/ })).toBeNull();
    expect(screen.getByLabelText('Transaction notes').value).toBe(note);
  });
  it('keeps writing intact, reviews offline, and only commits on the separate Add action', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    const advisor = { invoke: vi.fn() };
    render(
      <NotesRoute
        workbook={makeWorkbook()}
        services={makeServices()}
        onCommandResult={onCommandResult}
        advisor={advisor}
      />
    );
    await review(user);
    expect(onCommandResult).not.toHaveBeenCalled();
    expect(advisor.invoke).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Transaction notes').value).toBe(note);
    expect(screen.getByText(/2026-07-29 · Ready/)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    expect(onCommandResult).toHaveBeenCalledTimes(1);
    expect(onCommandResult.mock.calls[0][0].transactions[0].amount).toBe(180);
    expect(screen.getByLabelText('Transaction notes').value).toBe(note);
  });

  it('keeps headings and reminders as a useful note without fabricated transaction rows', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        workbook={makeWorkbook()}
        services={makeServices()}
        onCommandResult={onCommandResult}
      />
    );
    const writing =
      'Thursday notes\nRemember to buy coffee tomorrow\nNeed to check the grocery receipt';
    await review(user, writing);
    expect(screen.getByText(/No transactions found/)).not.toBeNull();
    expect(screen.getByLabelText('Transaction notes').value).toBe(writing);
    expect(onCommandResult).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Edit transaction/ })).toBeNull();
  });

  it('retains uncertain details until explicit confirmation, which still does not save to the ledger', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        workbook={makeWorkbook()}
        services={makeServices()}
        onCommandResult={onCommandResult}
      />
    );
    await review(user, '2026-07-29\nfood cash 180 or 160?');
    expect(screen.getByRole('button', { name: 'Add 0 transactions' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '160');
    await user.click(screen.getByRole('button', { name: 'Confirm details' }));
    expect(onCommandResult).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    expect(onCommandResult.mock.calls[0][0].transactions[0].amount).toBe(160);
  });

  it('removes an unwanted candidate without changing the original writing', async () => {
    const user = userEvent.setup();
    render(<NotesRoute workbook={makeWorkbook()} services={makeServices()} />);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Remove draft 1' }));
    expect(screen.queryByRole('button', { name: /Edit transaction/ })).toBeNull();
    expect(screen.getByLabelText('Transaction notes').value).toBe(note);
  });

  it('preserves legitimate duplicate lines but prevents adding the same prepared note twice', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    await review(user, `${note}\n₱180 food cash`);
    await user.click(screen.getByRole('button', { name: 'Add 2 transactions' }));
    expect(onCommand.mock.calls[0][0].transactions).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Review transactions' }));
    expect(screen.getByText('These transactions are already added.')).not.toBeNull();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Add 2 transactions' })).toBeNull();
  });

  it('requires another review after the original note changes', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        workbook={makeWorkbook()}
        services={makeServices()}
        onCommandResult={onCommandResult}
      />
    );
    await review(user);
    await user.type(screen.getByLabelText('Transaction notes'), '\n₱90 food cash');
    expect(screen.getByRole('button', { name: 'Add 1 transaction' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Review transactions' }));
    await user.click(screen.getByRole('button', { name: 'Add 2 transactions' }));
    expect(onCommandResult.mock.calls[0][0].transactions).toHaveLength(2);
  });

  it('restores the note, pending review, and an unfinished edit after remount', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const view = render(<NotesRoute workbook={workbook} services={makeServices()} />);
    await review(user);
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '175');
    view.unmount();
    render(<NotesRoute workbook={workbook} services={makeServices()} />);
    expect(screen.getByLabelText('Transaction notes').value).toBe(note);
    expect(screen.getByLabelText('Amount').value).toBe('175');
    await user.click(screen.getByRole('button', { name: 'Confirm details' }));
    expect(screen.getByRole('button', { name: 'Add 1 transaction' }).disabled).toBe(false);
  });

  it('reports failed draft persistence and makes clearing reversible', async () => {
    const user = userEvent.setup();
    const storage = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    render(<NotesRoute workbook={makeWorkbook()} services={makeServices()} />);
    await user.type(screen.getByLabelText('Transaction notes'), 'remember this');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    await user.click(screen.getByRole('button', { name: /Clear the Notes draft/ }));
    expect(screen.getByLabelText('Transaction notes').value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Undo clear' }));
    expect(screen.getByLabelText('Transaction notes').value).toBe('remember this');
    storage.mockRestore();
  });

  it('keeps the draft ready when the application rejects a commit', async () => {
    const user = userEvent.setup();
    render(
      <NotesRoute
        workbook={makeWorkbook()}
        services={makeServices()}
        onCommandResult={() => ({ ok: false, errors: [{ message: 'Could not save workbook.' }] })}
      />
    );
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    expect(screen.getByRole('alert').textContent).toContain('Could not save workbook');
    expect(screen.getByRole('button', { name: 'Add 1 transaction' }).disabled).toBe(false);
  });

  it('updates a committed row in place, while Cancel leaves its ledger transaction unchanged', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    const id = onCommand.mock.calls[0][0].transactions[0].id;
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '999');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    expect(screen.getByLabelText('Amount').value).toBe('180');
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '175');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const result = onCommand.mock.calls[1][0];
    expect(result.workbook.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ id, amount: 175 });
  });

  it('never calls AI until requested and falls back to review without committing if unavailable', async () => {
    const user = userEvent.setup();
    const advisor = { invoke: vi.fn(async () => ({ ok: false, unavailable: true })) };
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        workbook={makeWorkbook()}
        services={makeServices()}
        advisor={advisor}
        onCommandResult={onCommandResult}
      />
    );
    await user.type(screen.getByLabelText('Transaction notes'), note);
    expect(advisor.invoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add 1 transaction' })).not.toBeNull()
    );
    expect(advisor.invoke).toHaveBeenCalled();
    expect(onCommandResult).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Transaction notes').value).toBe(note);
  });

  it('wires Notes through the app shell and persists only after reviewed transactions are added', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => ({ ok: true, savedAt: '2026-07-29T01:00:01.000Z' }));
    const cacheSave = vi.fn(async () => ({ ok: true }));
    const services = makeServices();
    const ports = createNullRendererPorts({
      workbookStorage: { save },
      browserCache: { save: cacheSave },
      clock: { now: services.now, today: services.today },
      ids: { create: services.createId }
    });
    render(<AppShell initialWorkbook={makeWorkbook()} ports={ports} routeId="dashboard" />);
    await user.click(
      within(screen.getByRole('navigation', { name: 'Workbook' })).getByRole('button', {
        name: 'Notes'
      })
    );
    await review(user);
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].transactions).toHaveLength(1);
    expect(cacheSave).toHaveBeenCalled();
  });
  it('clears an orphan editor when its saved transaction is deleted elsewhere', async () => {
    const user = userEvent.setup();
    function ExternalDeleteHarness() {
      const [workbook, setWorkbook] = React.useState(makeWorkbook);
      return (
        <>
          <button onClick={() => setWorkbook((current) => ({ ...current, transactions: [] }))}>
            Delete elsewhere
          </button>
          <NotesRoute
            workbook={workbook}
            services={makeServices()}
            onCommandResult={(result) => {
              setWorkbook(result.workbook);
              return result;
            }}
          />
        </>
      );
    }
    render(<ExternalDeleteHarness />);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    await user.click(screen.getByRole('button', { name: 'Delete elsewhere' }));
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review transactions' }).disabled).toBe(false);
    expect(screen.getByLabelText('Transaction notes').value).toBe(note);
  });

  it('does not restore an editor whose committed transaction was removed before reload', () => {
    const entry = {
      id: 'saved-row',
      transactionId: 'gone',
      amount: 180,
      date: '2026-07-29',
      description: 'Food',
      categoryId: 'food',
      primaryAccountId: 'cash',
      currency: 'PHP',
      issues: []
    };
    window.localStorage.setItem(
      'cavalry.notes.draft.notes-interaction-workbook',
      JSON.stringify({ text: note, entries: [entry], editingEntry: { ...entry, amount: 175 } })
    );
    expect(readNotesDraft(makeWorkbook())).toMatchObject({
      text: note,
      entries: [],
      editingEntry: null
    });
  });

  it('shows the parsed foreign currency even when no account uses it', async () => {
    const user = userEvent.setup();
    render(<NotesRoute workbook={makeWorkbook()} services={makeServices()} />);
    await review(user, 'EUR 180 food cash');
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    expect(screen.getByLabelText('Currency').textContent).toContain('EUR');
    expect(screen.getByLabelText('EUR to PHP rate')).not.toBeNull();
  });

  it('disables confirmation if the original note changed during editing', async () => {
    const user = userEvent.setup();
    render(<NotesRoute workbook={makeWorkbook()} services={makeServices()} />);
    await review(user);
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    await user.type(screen.getByLabelText('Transaction notes'), '\nfood 90 cash');
    expect(screen.getByRole('button', { name: 'Confirm details' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false);
  });

  it('does not claim a transaction was added without an application commit handler', async () => {
    const user = userEvent.setup();
    render(<NotesRoute workbook={makeWorkbook()} services={makeServices()} />);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    expect(screen.getByRole('alert').textContent).toContain('connection is unavailable');
    expect(screen.getByRole('button', { name: 'Add 1 transaction' }).disabled).toBe(false);
    expect(screen.queryByText(/2026-07-29 · Added/)).toBeNull();
  });

  it('requires explicit duplicate review after a note is cleared and re-entered', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    await user.click(screen.getByRole('button', { name: /Clear the Notes draft/ }));
    await review(user);
    expect(screen.getByText(/matching transaction is already recorded/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add 0 transactions' }).disabled).toBe(true);
    expect(onCommand).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /Edit transaction 1/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm details' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 transaction' }));
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(onCommand.mock.calls[1][0].workbook.transactions).toHaveLength(2);
  });
  it('shows the actual payment account and an explicit unresolved amount in review', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    workbook.accounts.push({
      id: 'gcash',
      name: 'GCash',
      group: 'asset',
      subtype: 'wallet',
      currency: 'PHP',
      isActive: true
    });
    render(<NotesRoute workbook={workbook} services={makeServices()} />);
    await review(user, 'food 180 GCash\nfood 220 or 200 GCash?');
    const rows = document.querySelectorAll('.notes-review-entry');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.notes-payment-pill').textContent).toBe('GCash');
    expect(rows[1].querySelector('.notes-payment-pill').textContent).toBe('GCash');
    expect(within(rows[1]).getByLabelText('Check amount').textContent).toBe('Check amount');
    expect(rows[1].querySelector('.notes-entry-amount').textContent).not.toContain('₱0');
  });
});
