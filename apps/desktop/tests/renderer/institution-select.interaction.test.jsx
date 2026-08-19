import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { InstitutionSelect } from '../../src/renderer/shared/InstitutionSelect.jsx';

function InstitutionHarness({ accountSubtype = 'bank' }) {
  const [selection, setSelection] = useState({ institution: '', institutionId: '' });
  return (
    <>
      <label htmlFor="institution-test-input">Institution / Bank</label>
      <InstitutionSelect
        accountSubtype={accountSubtype}
        id="institution-test-input"
        institution={selection.institution}
        institutionId={selection.institutionId}
        onChange={setSelection}
      />
      <output aria-label="Institution selection">{JSON.stringify(selection)}</output>
    </>
  );
}

describe('InstitutionSelect', () => {
  it('searches aliases and commits the canonical RCBC metadata and logo', async () => {
    const user = userEvent.setup();
    const { container } = render(<InstitutionHarness />);
    const input = screen.getByLabelText('Institution / Bank');

    await user.type(input, 'rizal');

    const listbox = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(input.getAttribute('aria-activedescendant')).toBe(`${listbox.id}-rcbc`);
    await user.click(
      within(listbox).getByRole('option', {
        name: /RCBC.*Rizal Commercial Banking Corporation/
      })
    );

    expect(input.value).toBe('RCBC');
    expect(screen.getByLabelText('Institution selection').textContent).toBe(
      JSON.stringify({ institution: 'RCBC', institutionId: 'rcbc' })
    );
    expect(container.querySelector('[data-institution-id="rcbc"]')).not.toBeNull();
  });

  it('keeps bank searches scoped to banks and supports keyboard selection', async () => {
    const user = userEvent.setup();
    render(<InstitutionHarness accountSubtype="bank" />);
    const input = screen.getByLabelText('Institution / Bank');

    await user.type(input, 'Maya');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Maya Bank/ })).not.toBeNull();
    expect(within(listbox).queryByRole('option', { name: /Maya Wallet|E-Wallet/ })).toBeNull();
    await user.keyboard('{Enter}');

    expect(screen.getByLabelText('Institution selection').textContent).toBe(
      JSON.stringify({ institution: 'Maya Bank', institutionId: 'mayabank' })
    );
  });

  it('uses bank-only results for credit cards and other bank-backed account subtypes', async () => {
    const user = userEvent.setup();
    render(<InstitutionHarness accountSubtype="credit_card" />);

    await user.type(screen.getByLabelText('Institution / Bank'), 'Maya');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Maya Bank/ })).not.toBeNull();
    expect(within(listbox).queryByRole('option', { name: /Maya Wallet|E-Wallet/ })).toBeNull();
  });

  it('preserves unsupported institutions as free text without assigning a logo', async () => {
    const user = userEvent.setup();
    const { container } = render(<InstitutionHarness />);

    await user.type(screen.getByLabelText('Institution / Bank'), 'My Cooperative');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Institution selection').textContent).toBe(
      JSON.stringify({ institution: 'My Cooperative', institutionId: '' })
    );
    expect(container.querySelector('[data-institution-id]')).toBeNull();
  });
});
