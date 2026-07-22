import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CategoryRoute } from '../../src/renderer/features/categories/CategoryRoute.jsx';

function makeWorkbook() {
  return {
    id: 'category-interaction-workbook',
    version: 2,
    name: 'Category Interactions',
    year: 2026,
    currency: 'PHP',
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'food-expense',
        isActive: true
      },
      {
        id: 'unused',
        name: 'Unused',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'unused-expense',
        isActive: true
      },
      {
        id: 'hidden',
        name: 'Hidden Category',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'hidden-expense',
        isActive: false
      },
      {
        id: 'system',
        name: 'System Category',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'system-expense',
        isSystem: true,
        isActive: true
      }
    ],
    accounts: [
      {
        id: 'food-expense',
        name: 'Food',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'unused-expense',
        name: 'Unused',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'hidden-expense',
        name: 'Hidden',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'system-expense',
        name: 'System',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      },
      { id: 'cash', name: 'Cash', group: 'asset', subtype: 'cash', currency: 'PHP', isActive: true }
    ],
    transactions: [
      {
        id: 'txn-food',
        date: '2026-06-01',
        template: 'expense_paid',
        categoryId: 'food',
        amount: 125,
        baseAmount: 125,
        lines: [
          { accountId: 'food-expense', direction: 'debit', amount: 125, baseAmount: 125 },
          { accountId: 'cash', direction: 'credit', amount: 125, baseAmount: 125 }
        ]
      }
    ],
    recurringItems: [],
    sheets: []
  };
}

function CategoryHarness({ initialWorkbook, onResult }) {
  const [workbook, setWorkbook] = useState(initialWorkbook);
  function handleResult(result) {
    onResult(result);
    if (result.ok) setWorkbook(result.workbook);
  }
  return (
    <>
      <output aria-label="Category workbook state">
        {JSON.stringify({ categories: workbook.categories, accounts: workbook.accounts })}
      </output>
      <CategoryRoute workbook={workbook} onCommandResult={handleResult} />
    </>
  );
}

function rowFor(name) {
  return screen.getByRole('article', { name: `${name} category` });
}

describe('category management interactions', () => {
  it('creates, rerenders, and cancels category forms', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const onResult = vi.fn();
    render(<CategoryHarness initialWorkbook={workbook} onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'Create category' }));
    let dialog = screen.getByRole('dialog', { name: 'Create a new category' });
    await user.type(within(dialog).getByLabelText('Category name'), 'Travel');
    expect(within(dialog).getByText('Preview')).not.toBeNull();
    expect(within(dialog).getByText('Travel')).not.toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = screen.getByRole('dialog', { name: 'New Category' });
    await user.click(within(dialog).getByText('Advanced options'));
    const linkedAccount = within(dialog).getByLabelText('Linked account name');
    await user.clear(linkedAccount);
    await user.type(linkedAccount, 'Travel Expense');
    await user.click(within(dialog).getByRole('button', { name: 'Create Category' }));

    expect(await screen.findByRole('dialog', { name: 'Category created' })).not.toBeNull();
    expect(rowFor('Travel')).not.toBeNull();
    const result = onResult.mock.calls[0][0];
    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.categories.some((category) => category.name === 'Travel')).toBe(false);

    const resultCount = onResult.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'View Categories' }));
    await user.click(screen.getByRole('button', { name: 'Create category' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Create a new category' })).getByRole('button', {
        name: 'Close'
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onResult).toHaveBeenCalledTimes(resultCount);
  });

  it('keeps duplicate failures visible and preserves workbook identity', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const onResult = vi.fn();
    render(<CategoryHarness initialWorkbook={workbook} onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'Create category' }));
    let dialog = screen.getByRole('dialog', { name: 'Create a new category' });
    await user.type(within(dialog).getByLabelText('Category name'), 'Food');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = screen.getByRole('dialog', { name: 'New Category' });
    await user.click(within(dialog).getByRole('button', { name: 'Create Category' }));

    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
    expect(onResult.mock.calls[0][0].ok).toBe(false);
    expect(onResult.mock.calls[0][0].workbook).toBe(workbook);
    expect(screen.getByRole('dialog', { name: 'New Category' })).not.toBeNull();
  });

  it('toggles hidden rows, hides and restores, and protects referenced deletes', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const onResult = vi.fn();
    render(<CategoryHarness initialWorkbook={workbook} onResult={onResult} />);

    expect(screen.queryByRole('article', { name: 'Hidden Category category' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Show hidden' }));
    expect(rowFor('Hidden Category')).not.toBeNull();

    await user.click(
      within(rowFor('Hidden Category')).getByRole('button', { name: 'Restore category' })
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Restore Category' })).getByRole('button', {
        name: 'Restore Category'
      })
    );
    expect(rowFor('Hidden Category').className).not.toContain('is-archived');

    await user.click(within(rowFor('Food')).getByRole('button', { name: 'Hide category' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Hide Category' })).getByRole('button', {
        name: 'Hide Category'
      })
    );
    expect(rowFor('Food').className).toContain('is-archived');

    await user.click(within(rowFor('Food')).getByRole('button', { name: 'Delete category' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Category' })).getByRole('button', {
        name: 'Delete Category'
      })
    );
    expect((await screen.findByRole('alert')).textContent).toContain('referenced');
    expect(onResult.mock.calls.at(-1)[0].workbook).not.toBeNull();
    expect(onResult.mock.calls.at(-1)[0].ok).toBe(false);
    expect(workbook.categories.find((category) => category.id === 'food').isActive).toBe(true);
  });

  it('renames, relinks, deletes unused categories, and hides system actions', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<CategoryHarness initialWorkbook={makeWorkbook()} onResult={onResult} />);

    await user.click(within(rowFor('Unused')).getByRole('button', { name: 'Edit category' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit category' });
    const name = within(dialog).getByLabelText('Category name');
    await user.clear(name);
    await user.type(name, 'Flexible Spending');
    await user.click(within(dialog).getByLabelText('flight'));
    await user.click(within(dialog).getByLabelText('Color #5ba1df'));
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Category' });
    await user.type(within(dialog).getByLabelText('Description (optional)'), 'Flexible expenses');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    expect(
      await screen.findByRole('article', { name: 'Flexible Spending category' })
    ).not.toBeNull();
    expect(screen.getByLabelText('Category workbook state').textContent).toContain(
      '"icon":"flight"'
    );
    expect(screen.getByLabelText('Category workbook state').textContent).toContain(
      '"color":"#5ba1df"'
    );

    await user.click(
      within(rowFor('Flexible Spending')).getByRole('button', { name: 'Edit linked account' })
    );
    dialog = screen.getByRole('dialog', { name: 'Edit Linked Account' });
    const linkedName = within(dialog).getByLabelText('Linked Account Name');
    await user.clear(linkedName);
    await user.type(linkedName, 'Flexible Expense');
    await user.click(within(dialog).getByRole('button', { name: 'Save Linked Account' }));
    expect(screen.getByLabelText('Category workbook state').textContent).toContain(
      'Flexible Expense'
    );

    await user.click(
      within(rowFor('Flexible Spending')).getByRole('button', { name: 'Delete category' })
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Category' })).getByRole('button', {
        name: 'Delete Category'
      })
    );
    expect(screen.queryByRole('article', { name: 'Flexible Spending category' })).toBeNull();

    const systemRow = rowFor('System Category');
    expect(within(systemRow).queryByRole('button', { name: 'Edit category' })).toBeNull();
    expect(within(systemRow).queryByRole('button', { name: 'Hide category' })).toBeNull();
    expect(within(systemRow).queryByRole('button', { name: 'Delete category' })).toBeNull();
  });
});
