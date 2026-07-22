import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CategorizedSelect } from '../../src/renderer/shared/CategorizedSelect.jsx';

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
      within(screen.getByRole('group', { name: 'Everyday Expenses' })).getByText('pets')
    ).not.toBeNull();

    await user.click(
      within(screen.getByRole('group', { name: 'Everyday Expenses' })).getByRole('option', {
        name: /Food/
      })
    );
    expect(control.textContent).toContain('Food');
    expect(control.getAttribute('aria-expanded')).toBe('false');
  });
});
