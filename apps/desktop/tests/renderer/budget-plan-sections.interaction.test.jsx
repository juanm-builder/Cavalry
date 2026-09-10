// Covers the combined "All" plan tab, which stacks every section on one screen.

import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BudgetRoute } from '../../src/renderer/features/budgets/BudgetRoute.jsx';
import { createBudgetController } from '../../src/renderer/features/budgets/budget-controller.js';

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

const TYPES = [
  ['expense', 'Spending', 'Spending limit'],
  ['income', 'Income', 'Expected income'],
  ['savings', 'Savings', 'Savings target'],
  ['debt', 'Debt', 'Debt payment target']
];

function EmptyPlanHarness({ workbook, onAction }) {
  const [editor, setEditor] = useState(null);
  const controller = createBudgetController({ currentDate: '2026-08-12' });
  const routeModel = controller.buildModel(workbook);
  return (
    <BudgetRoute
      model={{ ...routeModel, editor }}
      onAction={(action) => {
        onAction(action);
        const result = controller.handleAction(action, { workbook });
        const opened = result.events?.find((event) => event.type === 'budget/add-requested');
        if (opened) setEditor(opened.payload);
      }}
    />
  );
}

function emptyWorkbook(types = TYPES) {
  return {
    id: 'empty-plan-actions',
    version: 2,
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [],
    transactions: [],
    recurringItems: [],
    counterparties: [],
    sheets: [],
    categories: types.map(([type, name]) => ({
      id: type,
      name: `${name} category`,
      type,
      isActive: true
    }))
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
    expect(within(combined).getByRole('button', { name: 'Add debt plan' })).not.toBeNull();

    // Keep the existing spending action and add exactly one action to the empty debt section.
    expect(combined.querySelectorAll('.budget-category-create-row')).toHaveLength(2);
  });

  it('keeps the combined view open when a row is opened from it', async () => {
    const user = userEvent.setup();
    render(<BudgetRoute model={model()} />);

    await user.click(screen.getByRole('tab', { name: /^All/ }));
    await user.click(screen.getByRole('button', { name: /Salary/ }));

    expect(screen.getByRole('tab', { name: /^All/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('gives every empty section one matching add row in All without dispatching writes', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(
      <BudgetRoute model={{ ...model(), categoryRows: [] }} onAction={onAction} />
    );
    await user.click(screen.getByRole('tab', { name: /^All/ }));
    const sections = container.querySelectorAll(
      '.monthly-plan-all-sections .budget-categories-section'
    );
    expect(sections).toHaveLength(4);
    for (const section of sections)
      expect(section.querySelectorAll('.budget-category-create-row')).toHaveLength(1);
    for (const [type] of TYPES) {
      await user.click(
        screen.getByRole('button', { name: `Add ${type === 'expense' ? 'spending' : type} plan` })
      );
      expect(onAction).toHaveBeenLastCalledWith({
        type: 'open-simple-budget',
        payload: { categoryType: type }
      });
    }
    expect(onAction.mock.calls).toHaveLength(4);
    expect(onAction.mock.calls.every(([action]) => action.type === 'open-simple-budget')).toBe(
      true
    );
  });

  it.each(TYPES)(
    'opens the empty %s tab with its matching plan type selected',
    async (type, tab, amountLabel) => {
      const user = userEvent.setup();
      const workbook = emptyWorkbook();
      const before = structuredClone(workbook);
      const onAction = vi.fn();
      const { container } = render(<EmptyPlanHarness workbook={workbook} onAction={onAction} />);
      await user.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
      expect(container.querySelectorAll('.budget-category-create-row')).toHaveLength(1);
      await user.click(
        screen.getByRole('button', { name: `Add ${type === 'expense' ? 'spending' : type} plan` })
      );
      const dialog = screen.getByRole('dialog', { name: 'Budget editor' });
      expect(within(dialog).getByText(amountLabel)).not.toBeNull();
      expect(
        within(dialog).getByRole('combobox', { name: 'Budget category' }).textContent
      ).toContain(`${tab} category`);
      expect(onAction).toHaveBeenCalledExactlyOnceWith({
        type: 'open-simple-budget',
        payload: { categoryType: type }
      });
      expect(workbook).toEqual(before);
    }
  );

  it('retains the empty plan type when no category of that type exists', async () => {
    const user = userEvent.setup();
    const workbook = emptyWorkbook([TYPES[0]]);
    const onAction = vi.fn();
    render(<EmptyPlanHarness workbook={workbook} onAction={onAction} />);
    await user.click(screen.getByRole('tab', { name: /^Income/ }));
    await user.click(screen.getByRole('button', { name: 'Add income plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Budget editor' });
    expect(within(dialog).getByText('Expected income')).not.toBeNull();
    expect(
      within(dialog).getByRole('combobox', { name: 'Budget category' }).textContent
    ).not.toContain('Spending category');
    expect(within(dialog).getByRole('button', { name: 'Save Budget' }).disabled).toBe(true);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
