import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FinancialValueInput } from '../../src/renderer/shared/FinancialValueInput.jsx';

function ControlledFinancialInput({ allowNegative = true, initialValue = '', name, onValue }) {
  const [value, setValue] = useState(initialValue);
  return (
    <FinancialValueInput
      allowNegative={allowNegative}
      aria-label="Financial amount"
      name={name}
      onChange={(event) => {
        setValue(event.currentTarget.value);
        onValue?.(event.currentTarget.value);
      }}
      value={value}
    />
  );
}

describe('financial value input', () => {
  it('adds grouping and two decimal places during whole-number typing', async () => {
    const user = userEvent.setup();
    render(<ControlledFinancialInput />);
    const input = screen.getByLabelText('Financial amount');

    await user.click(input);
    await user.keyboard('1');
    expect(input.value).toBe('1.00');
    expect(input.selectionStart).toBe(1);

    await user.keyboard('23');
    expect(input.value).toBe('123.00');
    expect(input.selectionStart).toBe(3);

    await user.keyboard('4567');
    expect(input.value).toBe('1,234,567.00');
    expect(input.selectionStart).toBe(9);

    await user.tab();
    expect(input.value).toBe('1,234,567.00');
  });

  it('keeps the caret in the fractional part while entering cents', async () => {
    const user = userEvent.setup();
    render(<ControlledFinancialInput />);
    const input = screen.getByLabelText('Financial amount');

    await user.type(input, '1234.5');
    expect(input.value).toBe('1,234.50');
    expect(input.selectionStart).toBe(7);

    await user.keyboard('6');
    expect(input.value).toBe('1,234.56');
    expect(input.selectionStart).toBe(8);

    await user.keyboard('7');
    expect(input.value).toBe('1,234.56');
  });

  it('supports formatted paste, accounting negatives, and positive-only fields', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ControlledFinancialInput />);
    const input = screen.getByLabelText('Financial amount');

    await user.click(input);
    await user.paste('₱1,234,567.89');
    expect(input.value).toBe('1,234,567.89');

    await user.clear(input);
    await user.paste('(2500)');
    expect(input.value).toBe('-2,500.00');

    rerender(<ControlledFinancialInput allowNegative={false} />);
    await user.clear(input);
    await user.type(input, '-2500');
    expect(input.value).toBe('2,500.00');
  });

  it('handles backspace, clearing, and movement across the fixed decimal separator', async () => {
    const user = userEvent.setup();
    render(<ControlledFinancialInput />);
    const input = screen.getByLabelText('Financial amount');

    await user.type(input, '1234');
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('123.00');
    expect(input.selectionStart).toBe(3);

    input.setSelectionRange(4, 4);
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('123.00');
    expect(input.selectionStart).toBe(3);

    await user.keyboard('{Delete}');
    expect(input.value).toBe('123.00');
    expect(input.selectionStart).toBe(4);

    input.select();
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('');
  });

  it('emits and submits unformatted numeric values', async () => {
    const user = userEvent.setup();
    const submitted = vi.fn();
    const onValue = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted(Object.fromEntries(new FormData(event.currentTarget)));
        }}
      >
        <ControlledFinancialInput name="amount" onValue={onValue} />
        <button type="submit">Save</button>
      </form>
    );

    await user.type(screen.getByLabelText('Financial amount'), '9876543.5');
    expect(screen.getByLabelText('Financial amount').value).toBe('9,876,543.50');
    expect(onValue).toHaveBeenLastCalledWith('9876543.5');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(submitted).toHaveBeenCalledWith({ amount: '9876543.5' });
  });
});
