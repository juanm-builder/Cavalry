import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ActionBindingProvider } from '../../src/renderer/shared/action-binding.jsx';
import { CloudAccountPanel } from '../../src/renderer/features/settings/CloudAccountPanel.jsx';

const connected = {
  status: 'signed_in',
  accountSource: 'system',
  browserSignInAvailable: true,
  user: { id: '_1234567890abcdef1234567890abcdef' },
  current: {
    workbookId: 'plan',
    linked: true,
    status: 'synced',
    cloudUpdatedAt: '2026-09-05T04:42:00Z'
  },
  workbooks: [{ id: 'plan', name: 'Household 2026', revision: 3 }]
};
function show({ cloud = connected, onAction = vi.fn(), localSave = {}, recovery = {} } = {}) {
  return render(
    <ActionBindingProvider onAction={onAction}>
      <CloudAccountPanel
        cloud={cloud}
        localSave={localSave}
        recovery={recovery}
        workbook={{ id: 'plan', name: 'Household 2026' }}
      />
    </ActionBindingProvider>
  );
}

describe('Account and sync settings', () => {
  it('lets the user explicitly choose a browser account and retains the real reference', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(async () => ({ ok: true }));
    show({ onAction });
    expect(screen.getByText('This Mac’s iCloud account')).toBeTruthy();
    expect(screen.getByText('567890ABCDEF')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Change account…' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose an Apple Account' });
    await user.click(within(dialog).getByRole('radio', { name: /Use another Apple Account/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue in browser' }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'select-icloud-account',
      payload: { source: 'browser' }
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('This Mac’s iCloud account')).toBeTruthy();
    expect(screen.queryByText('Apple Account selected in browser')).toBeNull();
  });

  it('never offers a working browser sign-in when the build lacks the required configuration', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    show({
      onAction,
      cloud: {
        ...connected,
        browserSignInAvailable: false,
        browserSignInUnavailableReason: 'Browser sign-in is not available in this build.'
      }
    });
    await user.click(screen.getByRole('button', { name: 'Change account…' }));
    const option = screen.getByRole('radio', { name: /Use another Apple Account/ });
    expect(option.disabled).toBe(true);
    await user.click(option);
    expect(option.checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Continue in browser' })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText('Browser sign-in is not available in this build.')).toBeTruthy();
  });

  it('keeps account selection open on failure and restores keyboard focus on dismissal', async () => {
    const user = userEvent.setup();
    show({
      onAction: vi.fn(async () => ({ ok: false, error: 'Browser sign-in expired. Try again.' }))
    });
    const change = screen.getByRole('button', { name: 'Change account…' });
    await user.click(change);
    await user.click(screen.getByRole('radio', { name: /Use another Apple Account/ }));
    await user.click(screen.getByRole('button', { name: 'Continue in browser' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Browser sign-in expired. Try again.'
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(change);
  });

  it('cancels a pending browser attempt before dismissing the chooser', async () => {
    const user = userEvent.setup();
    let resolve;
    const onAction = vi.fn((action) =>
      action.type === 'cancel-icloud-sign-in'
        ? Promise.resolve({ ok: true })
        : new Promise((done) => {
            resolve = done;
          })
    );
    show({ onAction });
    await user.click(screen.getByRole('button', { name: 'Change account…' }));
    await user.click(screen.getByRole('radio', { name: /Use another Apple Account/ }));
    await user.click(screen.getByRole('button', { name: 'Continue in browser' }));
    expect(screen.getByRole('button', { name: 'Waiting for browser sign-in…' }).disabled).toBe(
      true
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'cancel-icloud-sign-in', payload: {} });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => resolve({ ok: false, canceled: true }));
  });

  it('keeps the chooser open when cancellation is refused during the durable account commit', async () => {
    const user = userEvent.setup();
    let finishSelection;
    const onAction = vi.fn((action) =>
      action.type === 'cancel-icloud-sign-in'
        ? Promise.resolve({
            ok: false,
            code: 'cloud_account_commit_in_progress',
            error: 'The account change is finishing. Please wait.'
          })
        : new Promise((resolve) => {
            finishSelection = resolve;
          })
    );
    show({ onAction });
    await user.click(screen.getByRole('button', { name: 'Change account…' }));
    await user.click(screen.getByRole('radio', { name: /Use another Apple Account/ }));
    await user.click(screen.getByRole('button', { name: 'Continue in browser' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'cancel-icloud-sign-in', payload: {} });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The account change is finishing. Please wait.'
    );
    expect(screen.getByRole('dialog', { name: 'Choose an Apple Account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Waiting for browser sign-in…' }).disabled).toBe(
      true
    );
    expect(screen.getByText('This Mac’s iCloud account')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Choose an Apple Account' })).toBeTruthy();
    await act(async () => finishSelection({ ok: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows browser identity while paused and resumes the same connection', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    show({
      onAction,
      cloud: { ...connected, accountSource: 'browser', status: 'disconnected', syncPaused: true }
    });
    expect(screen.getByText('Apple Account selected in browser')).toBeTruthy();
    expect(screen.getByText('567890ABCDEF')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Resume syncing' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'resume-icloud-sync', payload: {} });
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it.each([
    [{ status: 'saved', lastSavedAt: '2026-09-05T04:43:00Z' }, 'Saved on this Mac'],
    [{ status: 'saving' }, 'Saving on this Mac…'],
    [{ status: 'dirty' }, 'Changes waiting to save'],
    [{ status: 'error' }, 'Couldn’t save on this Mac'],
    [{ status: 'cache' }, 'Saved to browser cache'],
    [{}, 'Local save not yet confirmed']
  ])('reports actual local save state %j separately from iCloud', (localSave, label) => {
    show({ localSave });
    expect(screen.getByText(label)).toBeTruthy();
    if (localSave.status !== 'saved') expect(screen.queryByText('Saved on this Mac')).toBeNull();
    if (localSave.status !== 'saved') expect(screen.queryByText('Saved to iCloud')).toBeNull();
  });

  it('offers real recovery entries and retains an actionable error when opening fails', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(async (action) =>
      action.type === 'open-workbook-recovery'
        ? { ok: false, error: 'Current workbook could not be saved.' }
        : { ok: true }
    );
    show({
      onAction,
      recovery: {
        status: 'ready',
        items: [
          {
            id: 'recovery-real-id',
            fileName: 'Earlier household.html',
            folderName: 'Workbook Recovery'
          }
        ]
      }
    });
    await user.click(screen.getByRole('button', { name: 'Find recovery copies' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'refresh-workbook-recovery', payload: {} });
    await user.click(
      screen.getByRole('button', { name: 'Open recovery copy Earlier household.html' })
    );
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'open-workbook-recovery',
      payload: { id: 'recovery-real-id' }
    });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Current workbook could not be saved.'
    );
    expect(screen.getByRole('dialog', { name: 'Find recovery copies' })).toBeTruthy();
  });
});
