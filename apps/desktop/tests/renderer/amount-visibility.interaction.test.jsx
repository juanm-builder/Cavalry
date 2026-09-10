import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeIncomeAndExpenseWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import {
  AmountVisibilityProvider,
  AMOUNT_VISIBILITY_STORAGE_KEY
} from '../../src/renderer/app/AmountVisibilityProvider.jsx';
import { WorkbookTopBar } from '../../src/renderer/shell/WorkbookTopBar.jsx';
import { PrivateValue } from '../../src/renderer/shared/PrivateValue.jsx';
import { MarkdownText } from '../../src/renderer/shared/MarkdownText.jsx';
import { SanitizedRichText } from '../../src/renderer/shared/SanitizedRichText.jsx';
import { maskFinancialText } from '../../src/renderer/shared/amount-privacy.js';

beforeEach(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  });
});
afterEach(() => vi.unstubAllGlobals());

const MONEY = /(?:[₱$€£¥]\s*[\d]|\b(?:PHP|USD|EUR)\s+\d)/u;

function expectNoDisplayedMoney(container) {
  expect(container.textContent).not.toMatch(MONEY);
  for (const node of container.querySelectorAll('[aria-label], [title], [aria-valuetext]')) {
    for (const attribute of ['aria-label', 'title', 'aria-valuetext']) {
      expect(node.getAttribute(attribute) || '').not.toMatch(MONEY);
    }
  }
}

describe('amount visibility', () => {
  it.each([
    '₱0.00',
    '-₱1,234.50',
    '− ₱1,234.50',
    '($200.00)',
    'USD 14.00',
    '14.00 PHP',
    '1 234,50 €',
    'CA$25.00',
    '₱387k',
    '١٬٢٣٤٫٥٠ PHP'
  ])('masks the complete amount %s', (value) => {
    expect(maskFinancialText(value)).toBe('••••');
  });

  it('preserves dates, percentages, counts and currency labels', () => {
    const text = 'Sep 10, 2026 · 3 accounts · 85% used · PHP';
    expect(maskFinancialText(text)).toBe(text);
  });

  it('toggles the whole app across routes, restores values, and remembers the choice', () => {
    const workbook = makeIncomeAndExpenseWorkbook();
    const original = JSON.stringify(workbook);
    const view = render(<AppShell initialWorkbook={workbook} />);
    expect(view.container.textContent).toMatch(MONEY);
    fireEvent.click(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(screen.getByRole('button', { name: 'Show amounts' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expectNoDisplayedMoney(view.container);
    for (const route of [
      'Accounts',
      'Transactions',
      'Budget',
      'Bills & Subscriptions',
      'Dashboard'
    ]) {
      fireEvent.click(screen.getByRole('button', { name: route, exact: true }));
      expectNoDisplayedMoney(view.container);
      expect(screen.getByRole('button', { name: 'Show amounts' })).toBeTruthy();
    }
    expect(JSON.stringify(workbook)).toBe(original);
    expect(window.localStorage.getItem(AMOUNT_VISIBILITY_STORAGE_KEY)).toBe('true');
    view.unmount();
    const reloaded = render(<AppShell initialWorkbook={workbook} />);
    expectNoDisplayedMoney(reloaded.container);
    fireEvent.click(screen.getByRole('button', { name: 'Show amounts' }));
    expect(reloaded.container.textContent).toMatch(MONEY);
    expect(window.localStorage.getItem(AMOUNT_VISIBILITY_STORAGE_KEY)).toBe('false');
  });

  it('redacts rich text and spoken/hover labels while preserving editable amounts', () => {
    const storage = { getItem: () => 'true', setItem: vi.fn() };
    const view = render(
      <AmountVisibilityProvider storage={storage}>
        <WorkbookTopBar />
        <PrivateValue as="button" title="Balance ₱9,876.00" aria-label="Savings ₱9,876.00">
          ₱9,876.00
        </PrivateValue>
        <PrivateValue as="strong" amount>
          {9876}
        </PrivateValue>
        <MarkdownText text="Spent **₱250.00**, with USD 20.00 remaining." />
        <SanitizedRichText html={'<p title="₱800.00">Bill <b>₱800.00</b></p>'} />
        <input aria-label="Amount being edited" defaultValue="9876.00" />
      </AmountVisibilityProvider>
    );
    expectNoDisplayedMoney(view.container);
    expect(
      screen.getByRole('button', { name: 'Savings Amount hidden' }).getAttribute('title')
    ).toBe('Balance Amount hidden');
    expect(screen.getByRole('textbox').value).toBe('9876.00');
    fireEvent.click(screen.getByRole('button', { name: 'Show amounts' }));
    expect(screen.getByRole('button', { name: 'Savings ₱9,876.00' })).toBeTruthy();
    expect(view.container.textContent).toContain('₱250.00');
  });

  it('works even if local storage is blocked', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };
    render(
      <AmountVisibilityProvider storage={storage}>
        <WorkbookTopBar />
      </AmountVisibilityProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(screen.getByRole('button', { name: 'Show amounts' })).toBeTruthy();
  });
});
