// Covers the combined "All" plan tab, which stacks every section on one screen.

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { BudgetRoute } from '../../src/renderer/features/budgets/BudgetRoute.jsx';

function planRow(id, name, type, planned, actual) {
  return {
    category: { id, name, type },
    categoryId: id,
    categoryType: type,
    planned,
    actual,
    remaining: planned - actual,
    percent: planned ? (actual / planned) * 100 : 0,
    transactions: [],
    sources: []
  };
}

function model() {
  return {
    currency: 'PHP',
    summary: {},
    spendingRows: [],
    range: { start: '2026-08-01', end: '2026-08-31' },
    sheet: { id: 'sheet-august' },
    categoryOptions: [],
    editor: null,
    categoryRows: [
      planRow('food', 'Food', 'expense', 8000, 1200),
      planRow('salary', 'Salary', 'income', 100000, 67964),
      planRow('emergency', 'Emergency Fund', 'savings', 10000, 4500)
    ]
  };
}

describe('monthly plan sections', () => {
  it('offers an All tab that counts every plan entry', async () => {
    const user = userEvent.setup();
    render(<BudgetRoute model={model()} />);

    const allTab = screen.getByRole('tab', { name: /^All/ });
    expect(within(allTab).getByText('3')).not.toBeNull();
    expect(allTab.getAttribute('aria-selected')).toBe('false');

    await user.click(allTab);
    expect(screen.getByRole('tab', { name: /^All/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('stacks spending, income, savings, and debt on one screen', async () => {
    const user = userEvent.setup();
    const { container } = render(<BudgetRoute model={model()} />);

    await user.click(screen.getByRole('tab', { name: /^All/ }));

    const combined = container.querySelector('.monthly-plan-all-sections');
    expect(combined).not.toBeNull();
    const headings = [...combined.querySelectorAll('.budget-section-heading h3')].map((node) =>
      node.textContent.trim()
    );
    expect(headings).toEqual(['Spending', 'Income', 'Savings', 'Debt Paydown']);

    // Empty sections stay visible so the combined view really shows everything.
    expect(within(combined).getByText('Food')).not.toBeNull();
    expect(within(combined).getByText('Salary')).not.toBeNull();
    expect(within(combined).getByText('Emergency Fund')).not.toBeNull();
    expect(within(combined).getAllByText('No plan entries yet.')).toHaveLength(1);

    // Only the first section carries the create row, so it is offered once.
    expect(within(combined).getAllByRole('button', { name: 'Create budget' })).toHaveLength(1);
  });

  it('keeps the combined view open when a row is opened from it', async () => {
    const user = userEvent.setup();
    render(<BudgetRoute model={model()} />);

    await user.click(screen.getByRole('tab', { name: /^All/ }));
    await user.click(screen.getByRole('button', { name: /Salary/ }));

    expect(screen.getByRole('tab', { name: /^All/ }).getAttribute('aria-selected')).toBe('true');
  });
});
