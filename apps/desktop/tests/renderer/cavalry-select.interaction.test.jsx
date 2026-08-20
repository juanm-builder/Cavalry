// Covers the shared dropdown that replaced native <select> elements.

import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  CavalrySelect,
  UncontrolledCavalrySelect
} from '../../src/renderer/shared/CavalrySelect.jsx';
import { chooseOption, openOptions, selectedOptionLabel } from './select-helpers.js';

const ACCOUNTS = [
  {
    value: 'cash',
    label: 'Cash',
    icon: 'payments',
    meta: 'Cash account · PHP 4,800.00',
    group: 'Assets'
  },
  {
    value: 'bank',
    label: 'Bank',
    icon: 'account_balance',
    meta: 'Bank account · PHP 120.00',
    group: 'Assets'
  },
  {
    value: 'card',
    label: 'Credit Card',
    icon: 'credit_card',
    meta: 'Credit card · PHP 900.00',
    group: 'Liabilities'
  },
  {
    value: 'frozen',
    label: 'Frozen',
    icon: 'savings',
    meta: 'Closed',
    group: 'Liabilities',
    disabled: true
  }
];

function Harness({ onChange, ...props }) {
  const [value, setValue] = useState('');
  return (
    <CavalrySelect
      aria-label="Account"
      options={ACCOUNTS}
      placeholder="Choose account"
      {...props}
      onChange={(event) => {
        setValue(event.currentTarget.value);
        onChange?.(event);
      }}
      value={value}
    />
  );
}

describe('CavalrySelect', () => {
  it('opens a grouped listbox and reports the chosen value like a change event', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const combobox = screen.getByRole('combobox', { name: 'Account' });
    expect(selectedOptionLabel(combobox)).toBe('Choose account');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');

    const listbox = await openOptions(user, combobox);
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    expect(within(listbox).getByRole('group', { name: 'Assets' })).not.toBeNull();
    expect(within(listbox).getByRole('group', { name: 'Liabilities' })).not.toBeNull();

    await user.click(within(listbox).getByRole('option', { name: /^Cash —/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].currentTarget.value).toBe('cash');
    expect(onChange.mock.calls[0][0].target.value).toBe('cash');
    expect(selectedOptionLabel(combobox)).toContain('Cash');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('names options by label and detail so balances are announced', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const listbox = await openOptions(user, screen.getByRole('combobox', { name: 'Account' }));
    expect(
      within(listbox).getByRole('option', { name: 'Cash — Cash account · PHP 4,800.00' })
    ).not.toBeNull();
  });

  it('never commits a disabled option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const listbox = await openOptions(user, screen.getByRole('combobox', { name: 'Account' }));
    await user.click(within(listbox).getByRole('option', { name: /^Frozen/ }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves through options with the keyboard and commits on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const combobox = screen.getByRole('combobox', { name: 'Account' });
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).not.toBeNull();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTarget: expect.objectContaining({ value: 'bank' }) })
    );
  });

  it('closes on Escape without letting the key reach a surrounding dialog', async () => {
    const user = userEvent.setup();
    const onDialogKeyDown = vi.fn();
    render(
      <div onKeyDown={onDialogKeyDown}>
        <Harness />
      </div>
    );

    const combobox = screen.getByRole('combobox', { name: 'Account' });
    await openOptions(user, combobox);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onDialogKeyDown).not.toHaveBeenCalled();
  });

  it('publishes an uncontrolled value through a hidden input for form submission', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <UncontrolledCavalrySelect
          aria-label="Kind"
          defaultValue="employer"
          name="kind"
          options={[
            { value: 'employer', label: 'Employer' },
            { value: 'biller', label: 'Biller' }
          ]}
          showLeadingIcon={false}
        />
      </form>
    );

    expect(container.querySelector('input[name="kind"]').value).toBe('employer');
    await chooseOption(user, screen.getByRole('combobox', { name: 'Kind' }), 'Biller');
    expect(container.querySelector('input[name="kind"]').value).toBe('biller');
  });
});
