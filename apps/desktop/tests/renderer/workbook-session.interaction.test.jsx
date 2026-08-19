import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import {
  createWorkbookSessionState,
  workbookSessionReducer
} from '../../src/renderer/app/workbook-session-reducer.js';
import { useWorkbookSession, WorkbookProvider } from '../../src/renderer/app/WorkbookProvider.jsx';
import { createDesktopRendererPorts } from '../../src/renderer/platform/desktop-ports.js';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';

function makeWorkbook() {
  return {
    id: 'wb-session-test',
    version: 2,
    name: 'Session Test',
    year: 2026,
    currency: 'PHP',
    settings: {},
    accounts: [],
    categories: [],
    transactions: [],
    sheets: []
  };
}

function SessionHarness() {
  const { state, navigate, openOverlay, closeOverlay } = useWorkbookSession();
  return (
    <div>
      <output aria-label="route">{state.routeId}</output>
      <output aria-label="overlay-count">{state.overlays.length}</output>
      <button type="button" onClick={() => navigate('settings')}>
        Open settings
      </button>
      <button type="button" onClick={() => openOverlay({ id: 'editor', type: 'modal' })}>
        Open overlay
      </button>
      <button type="button" onClick={() => closeOverlay('editor')}>
        Close overlay
      </button>
    </div>
  );
}

function NativeCommandHarness() {
  const { state } = useWorkbookSession();
  return (
    <div>
      <output aria-label="native-route">{state.routeId}</output>
      <output aria-label="native-workbook">{(state.workbook && state.workbook.id) || ''}</output>
      <output aria-label="native-overlay">{JSON.stringify(state.overlays)}</output>
    </div>
  );
}

function PersistenceHarness() {
  const { state, openWorkbook, saveWorkbook, saveWorkbookAs, scheduleWorkbookSave } =
    useWorkbookSession();
  return (
    <div>
      <output aria-label="persistence-workbook">{state.workbook?.name || ''}</output>
      <output aria-label="persistence-save-status">{state.save.status}</output>
      <output aria-label="persistence-error-count">{state.errors.length}</output>
      <button
        type="button"
        onClick={() => {
          saveWorkbook({ ...state.workbook, name: 'First save' });
          saveWorkbook({ ...state.workbook, name: 'Second save' });
        }}
      >
        Queue saves
      </button>
      <button type="button" onClick={() => saveWorkbook(state.workbook)}>
        Save once
      </button>
      <button
        type="button"
        onClick={() => scheduleWorkbookSave({ ...state.workbook, name: 'Pending automatic' })}
      >
        Schedule automatic save
      </button>
      <button
        type="button"
        onClick={() => {
          saveWorkbook({ ...state.workbook, name: 'Older in flight' });
          saveWorkbookAs({ ...state.workbook, name: 'Save As snapshot' }, 'saved-copy.html');
          scheduleWorkbookSave({ ...state.workbook, name: 'Newest snapshot' });
        }}
      >
        Save As behind active save
      </button>
      <button
        type="button"
        onClick={() => {
          scheduleWorkbookSave({ ...state.workbook, name: 'Pending before canceled Save As' });
          saveWorkbookAs({ ...state.workbook, name: 'Canceled Save As snapshot' }, 'canceled.html');
        }}
      >
        Cancel Save As with pending autosave
      </button>
      <button type="button" onClick={openWorkbook}>
        Open workbook
      </button>
    </div>
  );
}

describe('workbook session', () => {
  it('applies workbook command results with new identity', () => {
    const original = makeWorkbook();
    const state = createWorkbookSessionState({ initialWorkbook: original });
    const replacement = { ...original, name: 'Updated workbook' };
    const next = workbookSessionReducer(state, {
      type: 'workbook/replaced',
      workbook: replacement
    });

    expect(next.workbook).toBe(replacement);
    expect(next.workbook).not.toBe(original);
    expect(next.save.status).toBe('dirty');
  });

  it('reports application errors without mislabeling them as save failures', () => {
    const state = createWorkbookSessionState({ initialWorkbook: makeWorkbook() });
    const next = workbookSessionReducer(state, {
      type: 'error/reported',
      error: { code: 'transaction.invalid', message: 'Choose an account.' }
    });
    const duplicate = workbookSessionReducer(next, {
      type: 'error/reported',
      error: { code: 'transaction.invalid', message: 'Choose an account.' }
    });

    expect(next.save.status).toBe('idle');
    expect(next.errors).toHaveLength(1);
    expect(duplicate.errors).toHaveLength(1);
  });

  it('increments the Cloud handoff sequence only after a native workbook save succeeds', () => {
    const initial = createWorkbookSessionState({ initialWorkbook: makeWorkbook() });
    const hydrated = workbookSessionReducer(initial, {
      type: 'hydration/succeeded',
      source: 'native',
      workbook: makeWorkbook()
    });
    const cached = workbookSessionReducer(hydrated, {
      type: 'save/cached',
      savedAt: '2026-08-16T00:00:00.000Z'
    });
    const saved = workbookSessionReducer(cached, {
      type: 'save/succeeded',
      savedAt: '2026-08-16T00:00:01.000Z'
    });

    expect(hydrated.save.localSaveSequence).toBe(0);
    expect(cached.save.localSaveSequence).toBe(0);
    expect(saved.save.localSaveSequence).toBe(1);
  });

  it('owns route and overlay interactions in one reducer-backed provider', async () => {
    const user = userEvent.setup();
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} initialRouteId="dashboard">
        <SessionHarness />
      </WorkbookProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByLabelText('route').textContent).toBe('settings');
    await user.click(screen.getByRole('button', { name: 'Open overlay' }));
    expect(screen.getByLabelText('overlay-count').textContent).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Close overlay' }));
    expect(screen.getByLabelText('overlay-count').textContent).toBe('0');
  });

  it('hydrates a cached workbook after native storage reports no workbook', async () => {
    const ports = createNullRendererPorts({
      workbookStorage: { load: async () => ({ status: 'empty', source: 'native' }) },
      browserCache: {
        load: async () => ({ status: 'loaded', source: 'cache', workbook: makeWorkbook() })
      }
    });
    render(
      <AppShell autoHydrate ports={ports} routeId="dashboard" routeModels={{ dashboard: {} }} />
    );

    expect(screen.getByRole('status').textContent).toContain('Loading workbook');
    await waitFor(() =>
      expect(document.querySelector('[data-react-route="dashboard"]')).not.toBeNull()
    );
  });

  it('renders the no-workbook landing state', async () => {
    const ports = createNullRendererPorts({
      workbookStorage: { load: async () => ({ status: 'empty', source: 'native' }) },
      browserCache: { load: async () => ({ status: 'empty', source: 'cache' }) }
    });
    render(<AppShell autoHydrate ports={ports} routeId="dashboard" />);

    expect(await screen.findByRole('heading', { name: 'Start a workbook' })).not.toBeNull();
  });

  it('renders the landing page from the real no-active-file IPC response', async () => {
    const ports = createDesktopRendererPorts({
      cavalryFiles: {
        getActiveWorkbookFile: async () => ({ ok: false, empty: true, fileName: '' }),
        listRecentWorkbooks: async () => ({ ok: true, workbooks: [] })
      }
    });
    render(<AppShell autoHydrate ports={ports} routeId="dashboard" />);

    expect(await screen.findByRole('heading', { name: 'Start a workbook' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Workbook could not be opened' })).toBeNull();
  });

  it('opens a recently saved workbook from the landing page', async () => {
    const user = userEvent.setup();
    const recentWorkbook = { ...makeWorkbook(), id: 'recent-workbook', name: 'Recent Plan' };
    const cacheSave = vi.fn(async () => ({ ok: true }));
    const openRecent = vi.fn(async () => ({
      status: 'loaded',
      source: 'native',
      workbook: recentWorkbook,
      file: { fileName: 'Recent Plan.html', savedAt: '2026-07-20T10:16:00.000Z' }
    }));
    const ports = createNullRendererPorts({
      workbookStorage: {
        load: async () => ({ status: 'empty', source: 'native' }),
        listRecent: async () => ({
          ok: true,
          workbooks: [
            {
              id: 'recent-1',
              fileName: 'Recent Plan.html',
              folderName: 'Finances',
              lastUsedAt: '2026-07-20T10:17:00.000Z',
              savedAt: '2026-07-20T10:16:00.000Z'
            }
          ]
        }),
        openRecent
      },
      browserCache: {
        load: async () => ({ status: 'empty', source: 'cache' }),
        save: cacheSave
      }
    });
    render(<AppShell autoHydrate ports={ports} routeId="dashboard" />);

    await user.click(await screen.findByRole('button', { name: 'Open Recent Plan.html' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Start a workbook' })).toBeNull()
    );
    expect(openRecent).toHaveBeenCalledWith('recent-1');
    expect(cacheSave).toHaveBeenCalledWith(recentWorkbook);
  });

  it('keeps the landing page open when a recent workbook was moved', async () => {
    const user = userEvent.setup();
    let items = [
      {
        id: 'missing-1',
        fileName: 'Moved Plan.html',
        folderName: 'Finances',
        lastUsedAt: '2026-07-20T10:17:00.000Z'
      }
    ];
    const ports = createNullRendererPorts({
      workbookStorage: {
        load: async () => ({ status: 'empty', source: 'native' }),
        listRecent: async () => ({ ok: true, workbooks: items }),
        openRecent: async () => {
          items = [];
          return {
            status: 'missing',
            source: 'native',
            error: 'This recent workbook has moved or been deleted.'
          };
        }
      },
      browserCache: { load: async () => ({ status: 'empty', source: 'cache' }) }
    });
    render(<AppShell autoHydrate ports={ports} routeId="dashboard" />);

    await user.click(await screen.findByRole('button', { name: 'Open Moved Plan.html' }));
    expect(await screen.findByRole('heading', { name: 'Start a workbook' })).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('moved or been deleted');
    expect(screen.queryByRole('button', { name: 'Open Moved Plan.html' })).toBeNull();
  });

  it('lets a returning user open a Cloud workbook from an empty device', async () => {
    const user = userEvent.setup();
    const cloudWorkbook = { ...makeWorkbook(), id: 'cloud-workbook', name: 'Cloud Plan' };
    const cloudState = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', email: 'alex@example.com', name: 'Alex Example' },
      workbooks: [
        { id: cloudWorkbook.id, name: cloudWorkbook.name, year: 2026, currency: 'PHP', revision: 3 }
      ]
    };
    const cacheSave = vi.fn(async () => ({ ok: true }));
    const ports = createNullRendererPorts({
      workbookStorage: {
        load: async () => ({ status: 'empty', source: 'native' }),
        forget: async () => ({ ok: true })
      },
      browserCache: {
        load: async () => ({ status: 'empty', source: 'cache' }),
        save: cacheSave
      },
      cloud: {
        invoke: async (command) => {
          if (command === 'downloadWorkbook') {
            return { ok: true, workbook: cloudWorkbook, state: cloudState };
          }
          return { ok: true, state: cloudState };
        },
        subscribe: () => () => {}
      }
    });
    render(<AppShell autoHydrate ports={ports} routeId="dashboard" />);

    expect(await screen.findByRole('heading', { name: 'Your Cloud workbooks' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open Cloud Plan from Cavalry Cloud' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Start a workbook' })).toBeNull()
    );
    expect(cacheSave).toHaveBeenCalledWith(cloudWorkbook);
  });

  it('surfaces corrupt native workbook errors instead of hiding them behind cache', async () => {
    const ports = createNullRendererPorts({
      workbookStorage: {
        load: async () => ({
          status: 'error',
          source: 'native',
          error: 'Workbook payload is corrupt.'
        })
      },
      browserCache: {
        load: async () => ({ status: 'loaded', source: 'cache', workbook: makeWorkbook() })
      }
    });
    render(<AppShell autoHydrate ports={ports} routeId="dashboard" />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Workbook payload is corrupt.'
    );
  });

  it('owns native menu and deep-link commands in the workbook session', async () => {
    let sendCommand = () => {};
    const openedWorkbook = { ...makeWorkbook(), id: 'wb-opened' };
    const ports = createNullRendererPorts({
      workbookStorage: {
        open: async () => ({ status: 'loaded', source: 'native', workbook: openedWorkbook }),
        subscribe(callback) {
          sendCommand = callback;
          return () => {};
        }
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} initialRouteId="dashboard" ports={ports}>
        <NativeCommandHarness />
      </WorkbookProvider>
    );

    act(() => sendCommand('open-settings'));
    expect(screen.getByLabelText('native-route').textContent).toBe('settings');
    act(() => sendCommand('new-transaction'));
    expect(screen.getByLabelText('native-route').textContent).toBe('ledger');
    expect(screen.getByLabelText('native-overlay').textContent).toContain('transaction-composer');

    act(() => sendCommand({ type: 'open-draft-group', draftGroupId: 'group-safe' }));
    expect(screen.getByLabelText('native-route').textContent).toBe('dashboard');
    expect(screen.getByLabelText('native-overlay').textContent).toContain('group-safe');
    act(() => sendCommand({ type: 'open-checkpoint', checkpointId: 'checkpoint-safe' }));
    expect(screen.getByLabelText('native-overlay').textContent).toContain('checkpoint-safe');

    await act(async () => sendCommand('open-workbook'));
    await waitFor(() =>
      expect(screen.getByLabelText('native-workbook').textContent).toBe('wb-opened')
    );
  });

  it('accepts Companion workbook updates through the injected port', async () => {
    let publishUpdate = () => {};
    const ports = createNullRendererPorts({
      companion: {
        subscribe(callback) {
          publishUpdate = callback;
          return () => {};
        }
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} initialRouteId="dashboard" ports={ports}>
        <NativeCommandHarness />
      </WorkbookProvider>
    );

    act(() => publishUpdate({ workbook: { ...makeWorkbook(), id: 'wb-companion' } }));
    expect(screen.getByLabelText('native-workbook').textContent).toBe('wb-companion');
  });

  it('serializes saves so an older workbook cannot finish after a newer write', async () => {
    const user = userEvent.setup();
    const nativeWrites = [];
    const resolvers = [];
    const ports = createNullRendererPorts({
      browserCache: { save: async () => ({ ok: true }) },
      workbookStorage: {
        save(workbook) {
          nativeWrites.push(workbook.name);
          return new Promise((resolve) => resolvers.push(resolve));
        }
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} ports={ports}>
        <PersistenceHarness />
      </WorkbookProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Queue saves' }));
    await waitFor(() => expect(nativeWrites).toEqual(['First save']));
    await act(async () => resolvers[0]({ ok: true, savedAt: '2026-07-10T01:00:00.000Z' }));
    await waitFor(() => expect(nativeWrites).toEqual(['First save', 'Second save']));
    await act(async () => resolvers[1]({ ok: true, savedAt: '2026-07-10T01:00:01.000Z' }));
    await waitFor(() =>
      expect(screen.getByLabelText('persistence-save-status').textContent).toBe('saved')
    );
  });

  it('sequences Save As behind an active save and writes the latest pending snapshot', async () => {
    const nativeWrites = [];
    const saveAsWrites = [];
    const resolvers = [];
    const ports = createNullRendererPorts({
      browserCache: { save: async () => ({ ok: true }) },
      workbookStorage: {
        save(workbook) {
          nativeWrites.push(workbook.name);
          return new Promise((resolve) => resolvers.push(resolve));
        },
        async saveAs(workbook) {
          saveAsWrites.push(workbook.name);
          return { ok: true, savedAt: '2026-07-10T01:00:01.000Z' };
        }
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} ports={ports}>
        <PersistenceHarness />
      </WorkbookProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save As behind active save' }));
    await waitFor(() => expect(nativeWrites).toEqual(['Older in flight']));
    expect(saveAsWrites).toEqual([]);

    await act(async () => resolvers[0]({ ok: true, savedAt: '2026-07-10T01:00:00.000Z' }));
    await waitFor(() => expect(saveAsWrites).toEqual(['Newest snapshot']));
    expect(nativeWrites).toEqual(['Older in flight']);
  });

  it('falls back to the normal save path when a Save As absorbs an autosave and is canceled', async () => {
    const nativeWrites = [];
    const saveAsWrites = [];
    const ports = createNullRendererPorts({
      workbookStorage: {
        async save(workbook) {
          nativeWrites.push(workbook.name);
          return { ok: true };
        },
        async saveAs(workbook) {
          saveAsWrites.push(workbook.name);
          return { ok: false, canceled: true };
        }
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} ports={ports}>
        <PersistenceHarness />
      </WorkbookProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Save As with pending autosave' }));

    await waitFor(() => expect(saveAsWrites).toEqual(['Canceled Save As snapshot']));
    await waitFor(() => expect(nativeWrites).toEqual(['Canceled Save As snapshot']));
  });

  it('flushes a pending automatic snapshot when the page is hidden', async () => {
    const nativeWrites = [];
    const ports = createNullRendererPorts({
      workbookStorage: {
        async save(workbook) {
          nativeWrites.push(workbook.name);
          return { ok: true };
        }
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} ports={ports}>
        <PersistenceHarness />
      </WorkbookProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Schedule automatic save' }));
    act(() => window.dispatchEvent(new Event('pagehide')));

    await waitFor(() => expect(nativeWrites).toEqual(['Pending automatic']));
  });

  it('flushes a pending automatic snapshot when the provider unmounts', async () => {
    const nativeWrites = [];
    const ports = createNullRendererPorts({
      workbookStorage: {
        async save(workbook) {
          nativeWrites.push(workbook.name);
          return { ok: true };
        }
      }
    });
    const view = render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} ports={ports}>
        <PersistenceHarness />
      </WorkbookProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Schedule automatic save' }));
    view.unmount();

    await waitFor(() => expect(nativeWrites).toEqual(['Pending automatic']));
  });

  it('still saves natively when the browser cache fails', async () => {
    const user = userEvent.setup();
    const nativeWrites = [];
    const ports = createNullRendererPorts({
      browserCache: {
        save: async () => {
          throw new Error('IndexedDB unavailable');
        }
      },
      workbookStorage: {
        save: async (workbook) => {
          nativeWrites.push(workbook.name);
          return { ok: true, savedAt: '2026-07-10T01:00:00.000Z' };
        }
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} ports={ports}>
        <PersistenceHarness />
      </WorkbookProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Save once' }));
    await waitFor(() =>
      expect(screen.getByLabelText('persistence-save-status').textContent).toBe('saved')
    );
    expect(nativeWrites).toEqual(['Session Test']);
  });

  it('keeps the current workbook open when a replacement file is invalid', async () => {
    const user = userEvent.setup();
    const ports = createNullRendererPorts({
      workbookStorage: {
        open: async () => ({
          status: 'error',
          source: 'native',
          error: 'The selected workbook is corrupt.'
        })
      }
    });
    render(
      <WorkbookProvider initialWorkbook={makeWorkbook()} ports={ports}>
        <PersistenceHarness />
      </WorkbookProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Open workbook' }));
    await waitFor(() =>
      expect(screen.getByLabelText('persistence-error-count').textContent).toBe('1')
    );
    expect(screen.getByLabelText('persistence-workbook').textContent).toBe('Session Test');
  });
});
