import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import { NotesRoute } from '../../src/renderer/features/notes/NotesRoute.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';

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

describe('Notes route', () => {
  it('uses Cavalry AI asynchronously and still waits for explicit review and save', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    let resolveChat;
    const chatResult = new Promise((resolve) => {
      resolveChat = resolve;
    });
    const advisor = {
      invoke: vi.fn((command) => {
        if (command === 'getSettings') {
          return Promise.resolve({
            ok: true,
            settings: { provider: 'openai', hasApiKey: true }
          });
        }
        if (command === 'chat') return chatResult;
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

    expect(
      screen.queryByText('Turn rough money notes into clean, reviewable transactions.')
    ).toBeNull();
    expect(screen.queryByText('One transaction per line')).toBeNull();
    expect(screen.queryByText('Check details before saving')).toBeNull();

    await user.type(
      screen.getByLabelText('Transaction notes'),
      'one kay Grab home from NAIA, charged to Credit Card'
    );
    await user.click(screen.getByRole('button', { name: 'Process transactions' }));

    expect(screen.getByRole('button', { name: 'Processing…' }).disabled).toBe(true);
    expect(screen.getByLabelText('Transaction notes').disabled).toBe(true);
    expect(onCommandResult).not.toHaveBeenCalled();

    resolveChat({
      ok: true,
      text: JSON.stringify({
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
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save 1 transaction' }).disabled).toBe(false)
    );
    expect(screen.getByText('Grab home from NAIA')).not.toBeNull();
    expect(onCommandResult).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save 1 transaction' }));
    expect(onCommandResult).toHaveBeenCalledOnce();
    expect(onCommandResult.mock.calls[0][0].workbook.transactions[0]).toMatchObject({
      amount: 1000,
      categoryId: 'transportation'
    });
  });

  it('keeps parsed transactions in review until the user saves the batch', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Process transactions' }));

    expect(screen.getByText('Credit card')).not.toBeNull();
    expect(screen.getByText('Cash')).not.toBeNull();
    expect(screen.getByText('Debit card')).not.toBeNull();
    expect(onCommandResult).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save 3 transactions' }));
    expect(onCommandResult).toHaveBeenCalledOnce();
    expect(onCommandResult.mock.calls[0][0].workbook.transactions).toHaveLength(3);
    expect(screen.getByRole('status').textContent).toContain('3 transactions saved');
  });

  it('requires ambiguous details to be reviewed and edited before saving', async () => {
    const user = userEvent.setup();
    const onCommandResult = vi.fn();
    render(
      <NotesRoute
        onCommandResult={onCommandResult}
        services={makeServices()}
        workbook={makeWorkbook()}
      />
    );

    await user.type(screen.getByLabelText('Transaction notes'), '₱450 mystery cash');
    await user.click(screen.getByRole('button', { name: 'Process transactions' }));

    const saveButton = screen.getByRole('button', { name: 'Save 1 transaction' });
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText('Needs review')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit line 1' }));
    await user.selectOptions(screen.getByLabelText('Category'), 'food');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(saveButton.disabled).toBe(false);
    await user.click(saveButton);
    expect(onCommandResult).toHaveBeenCalledOnce();
    expect(onCommandResult.mock.calls[0][0].workbook.transactions[0].categoryId).toBe('food');
  });

  it('wires Notes through the app shell and persists the saved workbook', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => ({ ok: true, savedAt: '2026-07-29T01:00:01.000Z' }));
    const cacheSave = vi.fn(async () => ({ ok: true }));
    const advisorInvoke = vi.fn(async (command) => {
      if (command === 'getSettings') {
        return {
          ok: true,
          settings: { provider: 'openai', hasApiKey: true }
        };
      }
      if (command === 'chat') {
        return {
          ok: true,
          text: JSON.stringify({
            transactions: [
              {
                lineNumber: 1,
                amount: 180,
                currency: 'PHP',
                date: '2026-07-29',
                description: 'Food',
                categoryId: 'food',
                categoryName: 'Food',
                primaryAccountId: 'cash',
                primaryAccountName: 'Cash',
                confidence: 0.98,
                uncertainFields: [],
                evidence: {
                  amount: '₱180',
                  category: 'food',
                  primaryAccount: 'cash',
                  date: '',
                  description: 'food'
                }
              }
            ]
          })
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
    await user.click(screen.getByRole('button', { name: 'Process transactions' }));
    await waitFor(() => expect(advisorInvoke).toHaveBeenCalledWith('chat', expect.any(Object)));
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save 1 transaction' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)[0].transactions).toHaveLength(1);
    expect(cacheSave).toHaveBeenCalled();
  });
});
