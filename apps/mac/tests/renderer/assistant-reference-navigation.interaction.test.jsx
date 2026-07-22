import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { makeMinimalWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { AppRouter } from '../../src/renderer/app/AppRouter.jsx';
import { CommandExecutorProvider } from '../../src/renderer/app/CommandExecutor.jsx';
import { useFinanceApplicationController } from '../../src/renderer/app/use-finance-application-controller.js';
import { useWorkbookSession, WorkbookProvider } from '../../src/renderer/app/WorkbookProvider.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';

function makeReferenceWorkbook() {
  const workbook = makeMinimalWorkbook();
  workbook.accounts.push({
    id: 'bank',
    name: 'Bank',
    group: 'asset',
    subtype: 'bank',
    currency: 'PHP',
    isActive: true
  });
  workbook.accounts.push({
    id: 'cash:reserve',
    name: 'Reserve',
    group: 'asset',
    subtype: 'cash',
    currency: 'PHP',
    isActive: true
  });
  workbook.accounts.push({
    id: 'old-food-expense',
    name: 'Old Food Expense',
    group: 'expense',
    currency: 'PHP',
    isActive: true
  });
  workbook.categories.push({
    id: 'old-food',
    name: 'Old Food',
    type: 'expense',
    linkedAccountId: 'old-food-expense',
    currency: 'PHP',
    isActive: false
  });
  workbook.transactions = [
    {
      id: 'txn-coffee',
      date: '2026-07-09',
      template: 'expense_paid',
      description: 'Coffee',
      categoryId: 'food',
      amount: 125,
      baseAmount: 125,
      currency: 'PHP',
      lines: [
        {
          id: 'line-coffee-expense',
          accountId: 'food-expense',
          direction: 'debit',
          amount: 125,
          baseAmount: 125
        },
        {
          id: 'line-coffee-cash',
          accountId: 'cash',
          direction: 'credit',
          amount: 125,
          baseAmount: 125
        }
      ]
    }
  ];
  workbook.sheets = [
    {
      id: 'sheet-july',
      name: 'July',
      monthIndex: 6,
      budgets: [{ categoryId: 'food', planned: 500, createdAt: '2026-07-01' }],
      budgetLineItems: []
    },
    {
      id: 'sheet-august',
      name: 'August',
      monthIndex: 7,
      budgets: [{ categoryId: 'food', planned: 700, createdAt: '2026-07-10' }],
      budgetLineItems: []
    }
  ];
  workbook.recurringItems = [
    {
      id: 'recurring-netflix',
      kind: 'subscription',
      name: 'Netflix',
      categoryId: 'food',
      accountId: 'cash',
      amount: 549,
      currency: 'PHP',
      frequency: 'Monthly',
      anchorDate: '2026-07-20',
      autoRenew: true,
      isActive: true,
      note: 'Family plan'
    }
  ];
  return workbook;
}

function makePorts() {
  return createNullRendererPorts({
    clock: {
      now: () => '2026-07-10T08:00:00.000Z',
      today: () => '2026-07-10'
    }
  });
}

function ControllerHarness({ controllerRef }) {
  const { state } = useWorkbookSession();
  const application = useFinanceApplicationController();
  controllerRef.current = application;
  return (
    <>
      <output aria-label="Active route">{state.routeId}</output>
      <AppRouter
        routeId={state.routeId}
        routeModels={application.routeModels}
        routeProps={application.routeProps}
        onAction={application.handleFallbackAction}
      />
    </>
  );
}

function renderHarness() {
  const controllerRef = { current: null };
  render(
    <WorkbookProvider
      initialRouteId="dashboard"
      initialWorkbook={makeReferenceWorkbook()}
      ports={makePorts()}
    >
      <CommandExecutorProvider>
        <ControllerHarness controllerRef={controllerRef} />
      </CommandExecutorProvider>
    </WorkbookProvider>
  );
  return controllerRef;
}

async function openReference(controllerRef, sourceRef) {
  let result;
  await act(async () => {
    result = controllerRef.current.assistant.openReference({
      source_refs: [sourceRef]
    });
    await Promise.resolve();
  });
  return result;
}

async function navigate(controllerRef, routeId) {
  await act(async () => {
    controllerRef.current.handleFallbackAction({
      type: 'route/navigate',
      payload: { routeId }
    });
    await Promise.resolve();
  });
}

describe('assistant reference navigation', () => {
  it('opens exact accounts and transactions and reopens repeated targets', async () => {
    const user = userEvent.setup();
    const controllerRef = renderHarness();

    expect(await openReference(controllerRef, 'account:cash')).toMatchObject({
      ok: true,
      route: 'accounts'
    });
    await waitFor(() =>
      expect(document.querySelector('.account-detail-card h3')?.textContent).toBe('Cash')
    );

    await user.click(
      screen.getByRole('button', {
        name: (name) => name.startsWith('Open Bank account,')
      })
    );
    expect(document.querySelector('.account-detail-card h3')?.textContent).toBe('Bank');
    await openReference(controllerRef, 'account:cash');
    await waitFor(() =>
      expect(document.querySelector('.account-detail-card h3')?.textContent).toBe('Cash')
    );

    await openReference(controllerRef, 'account:cash%3Areserve');
    await waitFor(() =>
      expect(document.querySelector('.account-detail-card h3')?.textContent).toBe('Reserve')
    );

    await openReference(controllerRef, 'transaction:txn-coffee');
    expect(await screen.findByRole('dialog', { name: 'Transaction detail' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close transaction detail' }));
    expect(screen.queryByRole('dialog', { name: 'Transaction detail' })).toBeNull();
    await openReference(controllerRef, 'transaction:txn-coffee');
    expect(await screen.findByRole('dialog', { name: 'Transaction detail' })).not.toBeNull();
  });

  it('reveals, highlights, focuses, and refocuses an exact hidden category', async () => {
    const controllerRef = renderHarness();

    await openReference(controllerRef, 'category:old-food');
    const category = await screen.findByRole('article', { name: 'Old Food category' });
    await waitFor(() => expect(category.classList).toContain('is-reference-target'));
    expect(screen.getByRole('checkbox', { name: /Show hidden/ }).checked).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(category));

    screen.getByRole('button', { name: 'Grid view' }).focus();
    expect(document.activeElement).not.toBe(category);
    await openReference(controllerRef, 'category:old-food');
    await waitFor(() => expect(document.activeElement).toBe(category));

    await navigate(controllerRef, 'dashboard');
    await navigate(controllerRef, 'categories');
    expect(screen.queryByRole('article', { name: 'Old Food category' })).toBeNull();
  });

  it('selects exact sheets and opens exact budget details on every request', async () => {
    const user = userEvent.setup();
    const controllerRef = renderHarness();

    await openReference(controllerRef, 'sheet:sheet-august');
    expect(await screen.findByText('August 1 - 31, 2026')).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: /budget details/ })).toBeNull();

    await openReference(controllerRef, 'budget:sheet-july:food');
    let drawer = await screen.findByRole('dialog', { name: 'Food budget details' });
    expect(within(drawer).getAllByText('₱500.00').length).toBeGreaterThan(0);
    await user.click(within(drawer).getByRole('button', { name: 'Close Food budget details' }));
    expect(screen.queryByRole('dialog', { name: 'Food budget details' })).toBeNull();

    await navigate(controllerRef, 'dashboard');
    await navigate(controllerRef, 'budgets');
    expect(screen.queryByRole('dialog', { name: 'Food budget details' })).toBeNull();

    await openReference(controllerRef, 'budget:sheet-july:food');
    drawer = await screen.findByRole('dialog', { name: 'Food budget details' });
    expect(drawer).not.toBeNull();
  });

  it('opens and reopens the exact bill or subscription editor', async () => {
    const user = userEvent.setup();
    const controllerRef = renderHarness();

    await openReference(controllerRef, 'recurringItem:recurring-netflix');
    let editor = await screen.findByRole('dialog', { name: 'Edit bill or subscription' });
    expect(within(editor).getByLabelText('Recurring name').value).toBe('Netflix');
    await user.click(within(editor).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Edit bill or subscription' })).toBeNull();

    await navigate(controllerRef, 'dashboard');
    await navigate(controllerRef, 'bills');
    expect(screen.queryByRole('dialog', { name: 'Edit bill or subscription' })).toBeNull();

    await openReference(controllerRef, 'recurringItem:recurring-netflix');
    editor = await screen.findByRole('dialog', { name: 'Edit bill or subscription' });
    expect(within(editor).getByLabelText('Recurring name').value).toBe('Netflix');
  });

  it('rejects ambiguous, malformed, and stale source refs without navigating', async () => {
    const controllerRef = renderHarness();
    expect(screen.getByLabelText('Active route').textContent).toBe('dashboard');

    let result;
    await act(async () => {
      result = controllerRef.current.assistant.openReference({
        source_refs: ['account:missing', 'account:cash']
      });
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'assistant-reference.invalid'
    });
    expect(screen.getByLabelText('Active route').textContent).toBe('dashboard');

    const staleReferences = [
      ['transaction:missing', 'assistant-reference.transaction-not-found'],
      ['category:missing', 'assistant-reference.category-not-found'],
      ['sheet:missing', 'assistant-reference.sheet-not-found'],
      ['budget:sheet-july:missing', 'assistant-reference.budget-not-found'],
      ['recurringItem:missing', 'assistant-reference.recurring-item-not-found']
    ];
    for (const [sourceRef, code] of staleReferences) {
      result = await openReference(controllerRef, sourceRef);
      expect(result).toMatchObject({ ok: false, code });
      expect(screen.getByLabelText('Active route').textContent).toBe('dashboard');
    }

    result = await openReference(controllerRef, 'budget:sheet-july');
    expect(result).toMatchObject({ ok: false, code: 'assistant-reference.invalid' });
    expect(screen.getByLabelText('Active route').textContent).toBe('dashboard');
  });
});
