import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BillsRoute } from '../../src/renderer/features/recurring/BillsRoute.jsx';
import { buildBillsRouteModelFromBase } from '../../src/renderer/features/recurring/bills-route-model.js';
import { BillOccurrenceModal } from '../../src/renderer/features/recurring/BillOccurrenceModal.jsx';

const candidate = {
  id: 'airpods:2026-09-07',
  recurringItemId: 'airpods',
  name: 'Airpods Installment',
  dueDate: '2026-09-07',
  dueDateCopy: 'September 7, 2026',
  amountCopy: '₱1,332.50',
  frequency: 'Monthly',
  paymentMethod: 'RCBC Credit Card',
  status: 'Review match',
  reconciliation: {
    state: 'candidate',
    statusLabel: 'Review match',
    title: 'Likely transaction found',
    transaction: {
      id: 'txn-airpods',
      date: '2026-09-08',
      description: 'Beyond the Box',
      amountCopy: '₱1,332.50'
    },
    canConfirm: true,
    canReject: true
  }
};

describe('minimal bills page', () => {
  it('keeps automatic evidence collapsed and opens the linked transaction without changing its record', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onEdit = vi.fn();
    const onClose = vi.fn();
    const row = {
      ...candidate,
      name: 'ChatGPT Pro',
      kind: 'subscription',
      status: 'Paid',
      amountCopy: '₱1,006,490.00',
      categoryName: 'Subscriptions',
      reconciliation: {
        state: 'matched',
        source: 'automatic',
        statusLabel: 'Charged',
        explanation: 'Matched using amount, merchant, date, account.',
        transaction: {
          id: 'txn-chatgpt',
          date: '2026-09-07',
          description: 'ChatGPT Pro',
          amountCopy: '₱1,006,490.00',
          accountName: 'RCBC Credit Card'
        }
      }
    };
    render(<BillOccurrenceModal row={row} onAction={onAction} onEdit={onEdit} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Charged')).toBeTruthy();
    expect(within(dialog).queryByText('Paid')).toBeNull();
    const evidence = within(dialog).getByText('Why this matched').closest('details');
    expect(evidence.open).toBe(false);
    await user.click(within(dialog).getByText('Why this matched'));
    expect(evidence.open).toBe(true);
    expect(
      within(evidence).getByText('Matched using amount, merchant, date, account.')
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'View transaction' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'open-transaction-detail',
      payload: { transactionId: 'txn-chatgpt' }
    });
    await user.click(within(dialog).getByRole('button', { name: 'Edit recurring rule' }));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(row);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('opens matching details only on request and preserves confirm and reject payloads', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <BillsRoute
        model={{ header: { sheetId: 'september' }, rows: [candidate] }}
        onAction={onAction}
      />
    );
    expect(screen.queryByText('Likely transaction found')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review match: Airpods Installment' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Likely transaction found')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm match' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'confirm-recurring-transaction-match',
      payload: {
        rowId: candidate.id,
        recurringItemId: 'airpods',
        occurrenceDate: '2026-09-07',
        transactionId: 'txn-airpods'
      }
    });
    await user.click(screen.getByRole('button', { name: 'Not this' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'reject-recurring-transaction-match',
      payload: {
        rowId: candidate.id,
        recurringItemId: 'airpods',
        occurrenceDate: '2026-09-07',
        transactionId: 'txn-airpods'
      }
    });
  });

  it('includes partial allocations and excludes unverified FX without changing totals during search', () => {
    const workbook = { currency: 'PHP', transactions: [], recurringItems: [] };
    const rows = [
      { id: 'paid', kind: 'subscription', status: 'Paid', amount: 1000 },
      { id: 'partial', kind: 'bill', status: 'Partial', amount: 2000, remainingAmount: 1500 },
      { id: 'overdue', kind: 'bill', status: 'Overdue', amount: 300 },
      { id: 'future', kind: 'bill', status: 'Upcoming', amount: 400 },
      { id: 'fx', kind: 'bill', status: 'Overdue', amount: 999, baseAmountVerified: false }
    ];
    const base = {
      rows,
      currency: 'PHP',
      today: '2026-09-27',
      filterOptions: { categories: [], accounts: [], statuses: [], sorts: [] }
    };
    const model = buildBillsRouteModelFromBase(workbook, base);
    const searched = buildBillsRouteModelFromBase(workbook, base, { search: 'no match' });
    expect(model.overview.map((item) => item.value)).toEqual([
      '₱3,700.00',
      '₱1,500.00',
      '₱1,800.00'
    ]);
    expect(searched.overview).toEqual(model.overview);
    expect(searched.rows).toEqual([]);
    expect(
      buildBillsRouteModelFromBase(workbook, base, { filterKind: 'subscription' }).overview.map(
        (item) => item.value
      )
    ).toEqual(['₱1,000.00', '₱1,000.00', '₱0.00']);
  });
});
