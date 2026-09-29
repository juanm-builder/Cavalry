import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BudgetTransactionsModal } from '../../src/renderer/features/budgets/BudgetTransactionsModal.jsx';
import { ActionBindingProvider } from '../../src/renderer/shared/action-binding.jsx';

const row = {
  category: { id: 'subscriptions', name: 'Subscriptions' },
  categoryType: 'expense',
  planned: 1000,
  actual: 1200,
  remaining: -200,
  percent: 120,
  progressPercent: 100,
  statusLabel: 'Overspent',
  committed: 800,
  commitmentRows: [
    { id: 'scheduled', name: 'Monthly subscription', amount: 800, dueDate: '2026-09-10' }
  ],
  transactions: [
    {
      id: 'charge',
      description: 'Subscription charge',
      date: '2026-09-10',
      amount: 1500,
      accountId: 'bank',
      accountName: 'Bank'
    },
    {
      id: 'refund',
      description: 'Subscription refund',
      date: '2026-09-11',
      amount: -300,
      accountId: 'bank',
      accountName: 'Bank'
    },
    {
      id: 'cash',
      description: 'Cash charge',
      date: '2026-09-09',
      amount: 0,
      accountId: 'cash',
      accountName: 'Cash'
    }
  ],
  receipt: {
    unresolvedCount: 1,
    unresolved: [
      {
        transactionId: 'foreign',
        description: 'Foreign charge',
        date: '2026-09-12',
        nativeAmount: 100,
        nativeCurrency: 'USD',
        accountId: 'bank',
        accountName: 'Bank'
      }
    ]
  }
};
function mount() {
  const onAction = vi.fn(),
    onClose = vi.fn();
  render(
    <ActionBindingProvider onAction={onAction}>
      <BudgetTransactionsModal
        row={row}
        currency="PHP"
        periodLabel="September 2026"
        sheetId="september"
        onClose={onClose}
      />
    </ActionBindingProvider>
  );
  return { onAction, onClose };
}
describe('budget detail redesign', () => {
  it('keeps edit and removal available on both tabs and dispatches existing actions', () => {
    const { onAction, onClose } = mount();
    expect(screen.getByText('Recurring commitments')).toBeTruthy();
    expect(screen.getByText('Over budget')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    expect(screen.getByRole('button', { name: 'Delete Budget' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Budget' }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'open-simple-budget',
      payload: { sheetId: 'september', categoryId: 'subscriptions', planned: 1000 }
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('searches, filters accounts, sorts and totals canonical contributions including refunds', () => {
    const { onAction } = mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    expect(screen.getByText('Total ₱1,200.00')).toBeTruthy();
    expect(screen.getByText('1 excluded from total', { exact: false })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort transactions' }), {
      target: { value: 'highest' }
    });
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByRole('button')[0].textContent).toContain('Subscription charge');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by account' }), {
      target: { value: 'bank' }
    });
    expect(screen.queryByText('Cash charge')).toBeNull();
    expect(screen.getByText('Foreign charge')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search transactions' }), {
      target: { value: 'refund' }
    });
    expect(screen.getByText('Total -₱300.00')).toBeTruthy();
    expect(screen.getByText('+₱300.00')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'View Subscription refund transaction details' })
    );
    expect(onAction).toHaveBeenCalledWith({
      type: 'open-budget-transaction',
      payload: { transactionId: 'refund' }
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search transactions' }), {
      target: { value: 'missing' }
    });
    expect(screen.getByText('No matching transactions.')).toBeTruthy();
    expect(screen.getByText('Total ₱0.00')).toBeTruthy();
  });
});
