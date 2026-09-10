import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CavalryAssistant } from '../../src/renderer/features/assistant/CavalryAssistant.jsx';

function completed(id) {
  const persistence = { status: 'saved', durable: true, revision: `after-${id}` };
  return {
    ok: true,
    changed: true,
    commitStatus: 'committed',
    verificationStatus: 'verified',
    persistence,
    receipt: {
      kind: 'action_receipt',
      actionVerb: 'Deleted',
      lifecycle: 'completed',
      changed: true,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence,
      entity: { id, type: 'transaction', label: id },
      errors: [],
      warnings: [],
      items: [],
      accounts: []
    }
  };
}

function setup({ batches = [['Rent', 'Coffee']] } = {}) {
  let turn = 0;
  const advisor = {
    subscribe: () => () => {},
    invoke: vi.fn(async () => {
      const batch = batches[turn++];
      if (!batch) return { ok: false, error: 'Fixture connection unavailable.' };
      return {
        ok: true,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: batch.map((id) => ({
            id: `call-${id}`,
            type: 'function',
            function: {
              name: 'delete_transaction',
              arguments: JSON.stringify({ transaction: id, confirmed: true })
            }
          }))
        }
      };
    })
  };
  const executeTool = vi.fn(async (_name, args) => {
    if (args.confirmed === true) return completed(args.transactionId);
    return {
      ok: false,
      status: 'confirmation_required',
      confirmation: {
        required: true,
        field: 'confirmed',
        message: `Delete ${args.transaction}?`,
        proposal: {
          arguments: {
            transactionId: args.transaction,
            expectedRevision: `reviewed-${args.transaction}`
          }
        }
      }
    };
  });
  render(
    <CavalryAssistant
      advisor={advisor}
      executeTool={executeTool}
      isOpen={true}
      activeRouteId="bills"
      settings={{ provider: 'custom', model: 'fixture-model' }}
      workbook={{ id: 'confirmation-queue-fixture', name: 'Test plan' }}
      today={() => '2026-09-10'}
      conversationStorage={{ getItem: () => null, setItem: () => {} }}
    />
  );
  return { advisor, executeTool };
}

async function ask(user, message) {
  await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), message);
  await user.click(screen.getByRole('button', { name: 'Send message' }));
}

describe('assistant confirmation queue', () => {
  it('requires separate confirmation of every action in a multi-tool reply', async () => {
    const user = userEvent.setup();
    const { advisor, executeTool } = setup();
    await ask(user, 'Delete Rent and Coffee.');
    const firstCard = await screen.findByRole('region', { name: 'Confirm Cavalry action' });
    expect(within(firstCard).getByText('Delete Rent?')).not.toBeNull();
    expect(executeTool).toHaveBeenCalledTimes(2);
    await user.click(within(firstCard).getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Deleted “Rent”.');
    const secondCard = await screen.findByRole('region', { name: 'Confirm Cavalry action' });
    expect(within(secondCard).getByText('Delete Coffee?')).not.toBeNull();
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(executeTool.mock.calls[2][1]).toEqual({
      transactionId: 'Rent',
      expectedRevision: 'reviewed-Rent',
      confirmed: true
    });
    expect(executeTool.mock.calls[2][2]).toMatchObject({
      approvedByUser: true,
      question: 'Delete Rent and Coffee.',
      today: '2026-09-10',
      activeRouteId: 'bills'
    });
    await user.click(within(secondCard).getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Deleted “Coffee”.');
    expect(executeTool.mock.calls[3][1]).toEqual({
      transactionId: 'Coffee',
      expectedRevision: 'reviewed-Coffee',
      confirmed: true
    });
    expect(screen.queryByRole('region', { name: 'Confirm Cavalry action' })).toBeNull();
    expect(advisor.invoke).toHaveBeenCalledOnce();
  });

  it('cancels remaining proposals without undoing the first save or approving the second', async () => {
    const user = userEvent.setup();
    const { executeTool } = setup();
    await ask(user, 'Delete Rent and Coffee.');
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    await screen.findByText('Deleted “Rent”.');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await screen.findByText('Cancelled. Pending changes were not applied.');
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(executeTool.mock.calls.filter(([, args]) => args.confirmed === true)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.getByText('Deleted “Rent”.')).not.toBeNull();
  });

  it('replaces old proposals when the user corrects the requested target', async () => {
    const user = userEvent.setup();
    const { advisor, executeTool } = setup({ batches: [['September'], ['October']] });
    await ask(user, 'Delete September.');
    await screen.findByRole('button', { name: 'Confirm' });
    await ask(user, 'Actually remove October, not September.');
    await waitFor(() => expect(executeTool).toHaveBeenCalledTimes(2));
    const card = await screen.findByRole('region', { name: 'Confirm Cavalry action' });
    expect(within(card).getByText('Delete October?')).not.toBeNull();
    expect(screen.getByText('Earlier pending changes were cleared.')).not.toBeNull();
    const secondPayload = advisor.invoke.mock.calls[1][1];
    expect(secondPayload.messages[0].content).not.toContain(
      'confirmation card is currently showing'
    );
    expect(
      secondPayload.messages.some(
        (message) => message.content === 'Earlier pending changes were cleared.'
      )
    ).toBe(true);
    await user.click(within(card).getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Deleted “October”.');
    expect(
      executeTool.mock.calls
        .filter(([, args]) => args.confirmed === true)
        .map(([, args]) => args.transactionId)
    ).toEqual(['October']);
    expect(screen.queryByRole('region', { name: 'Confirm Cavalry action' })).toBeNull();
  });

  it('clears old proposals even when the next request fails before proposing a replacement', async () => {
    const user = userEvent.setup();
    const { executeTool } = setup({ batches: [['September'], null] });
    await ask(user, 'Delete September.');
    await screen.findByRole('button', { name: 'Confirm' });
    await ask(user, 'Why September? I meant October.');
    await screen.findByText('Earlier pending changes were cleared.');
    await screen.findAllByText('Fixture connection unavailable.');
    expect(screen.queryByRole('region', { name: 'Confirm Cavalry action' })).toBeNull();
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0][1].confirmed).not.toBe(true);
  });
});
