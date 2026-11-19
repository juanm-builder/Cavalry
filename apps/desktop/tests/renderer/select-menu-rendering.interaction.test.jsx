import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CategorizedSelect } from '../../src/renderer/shared/CategorizedSelect.jsx';
import { CavalrySelect } from '../../src/renderer/shared/CavalrySelect.jsx';

describe.each([CavalrySelect, CategorizedSelect])('%s menu placement', (Select) => {
  it('keeps a narrow field’s options inside the right and bottom edges', async () => {
    const user = userEvent.setup();
    render(<Select aria-label="Filter" options={[{ value: 'all', label: 'All' }]} />);
    const trigger = screen.getByRole('combobox');
    const { innerWidth: width, innerHeight: height } = window;
    const bounds = { width: 100, left: width - 110, top: height - 52, bottom: height - 12 };
    vi.spyOn(trigger.parentElement, 'getBoundingClientRect').mockReturnValue(bounds);
    await user.click(trigger);
    const { style } = screen.getByRole('listbox');
    expect(parseFloat(style.left) + parseFloat(style.width)).toBeLessThanOrEqual(width - 12);
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(240);
    expect(parseFloat(style.bottom)).toBeGreaterThan(height - bounds.top);
    expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(bounds.top - 12);
  });
});
