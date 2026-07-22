import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BudgetRoute } from '../../src/renderer/features/budgets/BudgetRoute.jsx';

function model(overrides = {}) {
  return {
    currency: 'PHP',
    summary: {},
    categoryRows: [],
    spendingRows: [],
    range: { start: '2026-07-01', end: '2026-07-31' },
    sheet: { id: 'sheet-july' },
    categoryOptions: [
      { id: 'food', name: 'Food', type: 'expense', planned: 0 },
      { id: 'transport', name: 'Transport', type: 'expense', planned: 300 }
    ],
    editor: {
      sheetId: 'sheet-july',
      currentDate: '2026-07-11',
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31'
    },
    ...overrides
  };
}

describe('budget editor interactions', () => {
  it('closes when Escape is pressed or the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(<BudgetRoute model={model()} onAction={onAction} />);

    await user.keyboard('{Escape}');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'close-budget-editor', payload: {} });

    onAction.mockClear();
    await user.click(container.querySelector('.budget-editor-backdrop'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenLastCalledWith({ type: 'close-budget-editor', payload: {} });

    expect(screen.queryByText('Plan simply. Spend mindfully.')).toBeNull();
  });

  it('submits serializable budget values and cancels explicitly', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<BudgetRoute model={model()} onAction={onAction} />);

    await user.click(screen.getByRole('combobox', { name: 'Budget category' }));
    await user.click(screen.getByRole('option', { name: 'Food' }));
    await user.type(screen.getByLabelText('Planned amount'), '450');
    expect(screen.getByLabelText('Planned amount').value).toBe('450.00');
    await user.click(screen.getByRole('button', { name: 'Save Budget' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'save-budget',
      payload: {
        sheetId: 'sheet-july',
        categoryId: 'food',
        planned: 450,
        createdAt: '2026-07-11',
        rangeStart: '2026-07-01',
        rangeEnd: '2026-07-31'
      }
    });
    expect(screen.getByLabelText('Budget month').value).toBe('July 2026');
    expect(screen.getByLabelText('Budget date created').readOnly).toBe(true);
    expect(
      within(screen.getByRole('dialog', { name: 'Budget editor' })).queryByLabelText(
        'Budget period'
      )
    ).toBeNull();
    expect(screen.queryByText('This budget will repeat every month.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'close-budget-editor', payload: {} });
  });

  it('offers reference-safe budget archival only for an existing budget', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <BudgetRoute
        model={model({
          editor: { sheetId: 'sheet-july', categoryId: 'transport', planned: 300 }
        })}
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Archive Budget' }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'archive-budget',
      payload: { sheetId: 'sheet-july', categoryId: 'transport' }
    });
  });

  it('shows budget overview and transaction tabs before opening full transaction details', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(
      <BudgetRoute
        model={model({
          editor: null,
          summary: { totalBudget: 500, spent: 200, leftToSpend: 300, spentPercent: 40 },
          currentDate: '2026-07-11',
          categoryRows: [
            {
              category: { id: 'food', name: 'Food' },
              planned: 500,
              actual: 200,
              remaining: 300,
              percent: 40,
              progressPercent: 40,
              transactions: [
                {
                  id: 'coffee',
                  description: 'Coffee beans',
                  date: '2026-07-10',
                  amount: 200,
                  currency: 'PHP'
                }
              ]
            }
          ]
        })}
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open Food budget details' }));
    expect(screen.getByRole('dialog', { name: 'Food budget details' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByText('Budget vs Actual')).not.toBeNull();
    expect(screen.queryByText('Coffee beans')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Transactions' }));
    expect(screen.getByText('Coffee beans')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'View Coffee beans transaction details' }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'open-budget-transaction',
      payload: { transactionId: 'coffee' }
    });
    await user.click(screen.getByRole('button', { name: 'Close Food budget details' }));

    await user.click(container.querySelector('.budget-category-list-row'));
    expect(screen.getByRole('dialog', { name: 'Food budget details' })).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Food budget details' })).toBeNull();

    await user.click(container.querySelector('.budget-category-list-row'));
    await user.click(screen.getByRole('button', { name: 'Edit Budget' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'open-simple-budget',
      payload: { sheetId: 'sheet-july', categoryId: 'food', planned: 500 }
    });

    await user.click(container.querySelector('.budget-category-list-row'));
    await user.click(screen.getByRole('button', { name: /Delete Budget/ }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'archive-budget',
      payload: { sheetId: 'sheet-july', categoryId: 'food' }
    });

    expect(screen.queryByText('Insights from Cavalry')).toBeNull();
  });
});
