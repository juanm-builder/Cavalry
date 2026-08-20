import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CategorizedSelect } from '../../src/renderer/shared/CategorizedSelect.jsx';
import { chooseOption } from './select-helpers.js';

const OPTIONS = [
  { value: 'credit-card', label: 'Credit Card Payment', type: 'debt' },
  { value: 'food', label: 'Food', type: 'expense', icon: 'pets' },
  { value: 'transport', label: 'Transport', type: 'expense' },
  { value: 'leisure', label: 'Leisure', type: 'expense' },
  { value: 'savings', label: 'Emergency Savings', type: 'savings' }
];

function ControlledCategorySelect() {
  const [value, setValue] = useState('credit-card');
  return (
    <CategorizedSelect
      aria-label="Budget category"
      onValueChange={setValue}
      options={OPTIONS}
      value={value}
    />
  );
}

describe('categorized select', () => {
  it('groups category options and reflects the selected category', async () => {
    const user = userEvent.setup();
    render(<ControlledCategorySelect />);

    const control = screen.getByRole('combobox', { name: 'Budget category' });
    expect(control.textContent).toContain('Credit Card Payment');
    await user.click(control);

    expect(screen.getByRole('group', { name: 'Payments & Debt' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Everyday Expenses' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Lifestyle' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Savings & Goals' })).not.toBeNull();
    expect(
      screen
        .getByRole('group', { name: 'Everyday Expenses' })
        .querySelector('[data-cavalry-icon="pets"]')
    ).not.toBeNull();

    await user.click(
      within(screen.getByRole('group', { name: 'Everyday Expenses' })).getByRole('option', {
        name: /Food/
      })
    );
    expect(control.textContent).toContain('Food');
    expect(control.getAttribute('aria-expanded')).toBe('false');
  });

  it('creates a category inline, selects it, and reports command failures without closing', async () => {
    const user = userEvent.setup();
    const createCategory = vi
      .fn()
      .mockReturnValueOnce({
        ok: false,
        errors: [{ message: 'A category named Trip already exists.' }]
      })
      .mockReturnValueOnce({
        ok: true,
        workbook: {
          categories: [
            { id: 'trip', name: 'Trip', type: 'expense', icon: 'flight', isActive: true }
          ]
        },
        events: [{ type: 'category.created', categoryId: 'trip' }]
      });

    function CreatableSelect() {
      const [value, setValue] = useState('food');
      return (
        <CategorizedSelect
          aria-label="Transaction category"
          createCategoryType="expense"
          onCreateCategory={createCategory}
          onValueChange={setValue}
          options={OPTIONS}
          value={value}
        />
      );
    }

    render(<CreatableSelect />);
    const control = screen.getByRole('combobox', { name: 'Transaction category' });
    await user.click(control);
    await user.click(screen.getByRole('option', { name: 'Create new category' }));

    let dialog = screen.getByRole('dialog', { name: 'Create new category' });
    await user.type(within(dialog).getByLabelText('Category name'), 'Trip');
    await user.click(within(dialog).getByRole('button', { name: 'Create & select' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'A category named Trip already exists.'
    );
    expect(control.textContent).toContain('Food');

    await user.click(within(dialog).getByRole('button', { name: 'Create & select' }));
    expect(createCategory).toHaveBeenLastCalledWith({
      name: 'Trip',
      postingAccountName: 'Trip',
      type: 'expense'
    });
    expect(screen.queryByRole('dialog', { name: 'Create new category' })).toBeNull();
    expect(control.textContent).toContain('Trip');

    await user.click(control);
    expect(screen.getByRole('option', { name: 'Trip' })).not.toBeNull();
  });

  it('lets mixed-purpose dropdowns create the appropriate category type', async () => {
    const user = userEvent.setup();
    const createCategory = vi.fn((payload) => ({
      ok: true,
      workbook: {
        categories: [{ id: 'loan-payment', ...payload, isActive: true }]
      },
      events: [{ type: 'category.created', categoryId: 'loan-payment' }]
    }));

    function MixedPurposeSelect() {
      const [value, setValue] = useState('');
      return (
        <CategorizedSelect
          aria-label="Recurring category"
          createCategoryType="expense"
          createCategoryTypes={['expense', 'debt']}
          onCreateCategory={createCategory}
          onValueChange={setValue}
          options={OPTIONS}
          value={value}
        />
      );
    }

    render(<MixedPurposeSelect />);

    await user.click(screen.getByRole('combobox', { name: 'Recurring category' }));
    await user.click(screen.getByRole('option', { name: 'Create new category' }));
    const dialog = screen.getByRole('dialog', { name: 'Create new category' });
    await user.type(within(dialog).getByLabelText('Category name'), 'Loan payment');
    await chooseOption(user, within(dialog).getByLabelText('Category type'), 'Debt');
    await user.click(within(dialog).getByRole('button', { name: 'Create & select' }));

    expect(createCategory).toHaveBeenCalledWith({
      name: 'Loan payment',
      postingAccountName: 'Loan payment',
      type: 'debt'
    });
    expect(screen.getByRole('combobox', { name: 'Recurring category' }).textContent).toContain(
      'Loan payment'
    );
  });
});
