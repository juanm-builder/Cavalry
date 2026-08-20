import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppearanceProvider } from '../../src/renderer/app/AppearanceProvider.jsx';
import { NAVIGATION_ROUTES } from '../../src/renderer/app/routes.js';
import {
  ApplicationFrame,
  WorkbookStartupScreen,
  WORKBOOK_STARTUP_STATUS
} from '../../src/renderer/shell/index.js';
import { chooseOption } from './select-helpers.js';

const workbook = Object.freeze({
  name: 'Household Plan',
  year: 2026,
  currency: 'PHP'
});

describe('application frame', () => {
  it('renders the authoritative route registry and emits explicit navigation callbacks', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <ApplicationFrame
        activeRouteId="dashboard"
        onNavigate={onNavigate}
        pendingDraftCount={3}
        workbook={workbook}
      >
        <h1>Dashboard content</h1>
      </ApplicationFrame>
    );

    const navigation = screen.getByRole('navigation', { name: 'Workbook' });
    for (const route of NAVIGATION_ROUTES) {
      expect(
        within(navigation).getByRole('button', { name: new RegExp(route.label) })
      ).not.toBeNull();
    }
    expect(
      within(navigation).getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current')
    ).toBe('page');
    expect(within(navigation).queryByRole('button', { name: /Advisor/ })).toBeNull();
    expect(within(navigation).queryByRole('button', { name: /AI Drafts/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Dashboard content' })).not.toBeNull();
    expect(document.querySelector('.brand-mark')).toBeNull();
    expect(document.querySelector('.brand-symbol')?.tagName).toBe('SPAN');

    await user.click(within(navigation).getByRole('button', { name: 'Transactions' }));
    expect(onNavigate).toHaveBeenCalledWith('ledger');
    await user.click(within(navigation).getByRole('button', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenLastCalledWith('settings');
    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1);

    expect(document.querySelector('[data-action], [data-route]')).toBeNull();
  });

  it('reports save state and emits the remaining top-bar and quick-add callbacks', async () => {
    const user = userEvent.setup();
    const onAskAdvisor = vi.fn();
    const onAddTransaction = vi.fn();
    const onAddAccount = vi.fn();

    render(
      <ApplicationFrame
        activeRouteId="accounts"
        onAddAccount={onAddAccount}
        onAddTransaction={onAddTransaction}
        onAskAdvisor={onAskAdvisor}
        save={{ status: 'dirty' }}
        workbook={workbook}
      >
        <div>Account list</div>
      </ApplicationFrame>
    );

    expect(screen.getByRole('heading', { name: 'Household Plan' })).not.toBeNull();
    expect(screen.getByText('2026 • PHP base')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');

    await user.click(screen.getByRole('button', { name: 'Ask Advisor' }));
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));
    await user.click(screen.getByRole('button', { name: 'Add Account' }));

    expect(onAskAdvisor).toHaveBeenCalledOnce();
    expect(onAddTransaction).toHaveBeenCalledOnce();
    expect(onAddAccount).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByLabelText('Change color palette')).toBeNull();
  });

  it('renders compact navigation quick actions without the expanded title block', () => {
    const storage = {
      getItem: () => JSON.stringify({ navigation: 'compact' }),
      setItem: vi.fn()
    };

    render(
      <AppearanceProvider storage={storage}>
        <ApplicationFrame
          activeRouteId="settings"
          onAddAccount={vi.fn()}
          onAddTransaction={vi.fn()}
          workbook={workbook}
        >
          <div />
        </ApplicationFrame>
      </AppearanceProvider>
    );

    expect(document.querySelector('.app-shell.navigation-compact')).not.toBeNull();
    expect(document.querySelector('.quick-add-title')).toBeNull();
    expect(screen.queryByText('Capture money movement fast')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Transaction' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add Account' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add Transaction' }).className).toContain(
      'quick-add-primary'
    );
    expect(screen.getByRole('button', { name: 'Add Account' }).className).toContain(
      'quick-add-primary'
    );
    expect(document.querySelector('.rail-user-card')).toBeNull();
  });

  it('keeps update actions in the user footer and reports background download progress', async () => {
    const user = userEvent.setup();
    const downloadUpdate = vi.fn();
    const restartAndInstall = vi.fn();
    const renderFrame = (state) => (
      <ApplicationFrame
        activeRouteId="dashboard"
        update={{ state, downloadUpdate, restartAndInstall }}
        workbook={workbook}
      >
        <div />
      </ApplicationFrame>
    );
    const { rerender } = render(
      renderFrame({ enabled: true, status: 'available', version: '1.0.19' })
    );

    let footer = document.querySelector('.rail-user-card');
    const downloadButton = within(footer).getByRole('button', {
      name: 'Download Cavalry update 1.0.19'
    });
    expect(footer.classList.contains('has-update')).toBe(true);
    expect(within(footer).queryByRole('button', { name: 'Settings' })).toBeNull();
    await user.click(downloadButton);
    expect(downloadUpdate).toHaveBeenCalledOnce();

    rerender(renderFrame({ enabled: true, status: 'downloading', version: '1.0.19', percent: 42 }));
    footer = document.querySelector('.rail-user-card');
    expect(footer.classList.contains('update-downloading')).toBe(true);
    expect(within(footer).queryByRole('status')).toBeNull();
    const progress = screen.getByRole('progressbar', {
      name: 'Downloading Cavalry update 1.0.19'
    });
    expect(progress.getAttribute('aria-valuenow')).toBe('42');
    expect(progress.getAttribute('aria-valuetext')).toBe('42% downloaded');

    rerender(renderFrame({ enabled: true, status: 'ready', version: '1.0.19' }));
    await user.click(
      within(document.querySelector('.rail-user-card')).getByRole('button', {
        name: 'Restart Cavalry to install update 1.0.19'
      })
    );
    expect(restartAndInstall).toHaveBeenCalledOnce();

    rerender(renderFrame({ enabled: true, status: 'error', kind: 'download', version: '1.0.19' }));
    await user.click(
      within(document.querySelector('.rail-user-card')).getByRole('button', {
        name: 'Retry downloading Cavalry update 1.0.19'
      })
    );
    expect(downloadUpdate).toHaveBeenCalledTimes(2);

    rerender(renderFrame({ enabled: true, status: 'error', kind: 'check' }));
    footer = document.querySelector('.rail-user-card');
    expect(footer.classList.contains('has-update')).toBe(false);
    expect(within(footer).queryByRole('button', { name: /update/i })).toBeNull();
  });

  it('hides idle and up-to-date updater state without changing the footer grid', () => {
    const { rerender } = render(
      <ApplicationFrame
        activeRouteId="dashboard"
        update={{ state: { enabled: true, status: 'idle' } }}
        workbook={workbook}
      >
        <div />
      </ApplicationFrame>
    );

    expect(document.querySelector('.rail-user-card.has-update')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    rerender(
      <ApplicationFrame
        activeRouteId="dashboard"
        update={{ state: { enabled: true, status: 'up-to-date' } }}
        workbook={workbook}
      >
        <div />
      </ApplicationFrame>
    );
    expect(document.querySelector('.rail-user-card.has-update')).toBeNull();
  });

  it('does not show Data Health indicators in the Settings navigation item', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <ApplicationFrame activeRouteId="dashboard" onNavigate={onNavigate} workbook={workbook}>
        <div />
      </ApplicationFrame>
    );

    expect(screen.queryByText(/data health/i)).toBeNull();
    const navigation = screen.getByRole('navigation', { name: 'Workbook' });
    await user.click(within(navigation).getByRole('button', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('reports save progress without rendering a duplicate save action', () => {
    render(
      <ApplicationFrame activeRouteId="dashboard" save={{ status: 'saving' }} workbook={workbook}>
        <div />
      </ApplicationFrame>
    );

    expect(screen.getByRole('status').textContent).toBe('Saving…');
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull();
  });

  it('finds routes and quick actions through the command menu', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onAddTransaction = vi.fn();

    render(
      <ApplicationFrame
        activeRouteId="dashboard"
        onAddTransaction={onAddTransaction}
        onNavigate={onNavigate}
        workbook={workbook}
      >
        <div />
      </ApplicationFrame>
    );

    await user.click(screen.getByRole('button', { name: 'Open command menu' }));
    expect(screen.getByRole('dialog', { name: 'Command menu' })).not.toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'budget');
    expect(screen.queryByRole('button', { name: /Add transaction/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Budget Monthly plan/ }));
    expect(onNavigate).toHaveBeenCalledWith('budgets');
    expect(screen.queryByRole('dialog', { name: 'Command menu' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open command menu' }));
    await user.click(screen.getByRole('button', { name: /Add transaction Record income/ }));
    expect(onAddTransaction).toHaveBeenCalledOnce();
  });
});

describe('workbook startup screen', () => {
  it('submits normalized create values and opens a workbook through callbacks', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onOpen = vi.fn();

    render(<WorkbookStartupScreen defaultYear={2026} onCreate={onCreate} onOpen={onOpen} />);

    const name = screen.getByLabelText('1. Workbook Name');
    await user.clear(name);
    await user.type(name, '  Family Ledger  ');
    await user.clear(screen.getByLabelText('2. Year'));
    await user.type(screen.getByLabelText('2. Year'), '2027');
    await chooseOption(user, screen.getByLabelText('3. Base Currency'), 'USD');
    await user.click(screen.getByRole('button', { name: 'Create Workbook' }));

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Family Ledger',
      year: 2027,
      currency: 'USD'
    });

    await user.click(screen.getByRole('button', { name: 'Open Workbook File' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-action], [data-route]')).toBeNull();
  });

  it('renders accessible loading and recoverable error states', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onOpen = vi.fn();
    const { rerender } = render(<WorkbookStartupScreen status={WORKBOOK_STARTUP_STATUS.LOADING} />);

    expect(screen.getByRole('status').textContent).toContain('Loading workbook');

    rerender(
      <WorkbookStartupScreen
        error="Workbook payload is corrupt."
        onOpen={onOpen}
        onRetry={onRetry}
        status={WORKBOOK_STARTUP_STATUS.ERROR}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('Workbook payload is corrupt.');
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    await user.click(screen.getByRole('button', { name: 'Open Another Workbook' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('rejects whitespace-only workbook names before creation', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(<WorkbookStartupScreen defaultName="Plan" defaultYear={2026} onCreate={onCreate} />);
    await user.clear(screen.getByLabelText('1. Workbook Name'));
    await user.type(screen.getByLabelText('1. Workbook Name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create Workbook' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Give your workbook a name');
  });

  it('shows recently saved workbooks and opens one through its opaque identifier', async () => {
    const user = userEvent.setup();
    const onOpenRecent = vi.fn();

    render(
      <WorkbookStartupScreen
        defaultYear={2026}
        onOpenRecent={onOpenRecent}
        recentWorkbooks={{
          status: 'ready',
          items: [
            {
              id: 'recent-plan',
              fileName: 'Family Plan.html',
              folderName: 'Finances',
              savedAt: '2026-07-20T10:16:00.000Z'
            }
          ]
        }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Recent workbooks' })).not.toBeNull();
    expect(screen.getByRole('list', { name: 'Recent workbooks on this Mac' })).not.toBeNull();
    expect(screen.getByText('Finances')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open Family Plan.html' }));
    expect(onOpenRecent).toHaveBeenCalledWith('recent-plan');
  });
});
