import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCloudWorkbookController } from '../../src/renderer/app/use-cloud-workbook-controller.js';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function signedInState() {
  return {
    configured: true,
    status: 'signed_in',
    user: { id: 'user-1', email: 'alex@example.com', name: 'Alex Example' },
    workbooks: [{ id: 'cloud-workbook', name: 'Cloud Plan', revision: 2 }]
  };
}

function makeCloud(downloadResult) {
  return {
    invoke: vi.fn(async (command) => {
      if (command === 'getState') return { ok: true, state: signedInState() };
      if (command === 'downloadWorkbook') return downloadResult;
      return { ok: true, state: signedInState() };
    }),
    subscribe: () => () => {}
  };
}

describe('cloud workbook controller interactions', () => {
  it('caches the validated Cloud workbook before disconnecting and replacing native state', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.id = 'cloud-workbook';
    workbook.name = 'Cloud Plan';
    const cloud = makeCloud({ ok: true, workbook });
    const forget = vi.fn(async () => ({ ok: true }));
    const save = vi.fn(async () => ({ ok: true }));
    const setWorkbook = vi.fn();
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'local-workbook', name: 'Local Plan' },
        browserCache: { save },
        workbookStorage: {
          forget,
          load: async () => ({
            status: 'loaded',
            workbook: { id: 'local-workbook', name: 'Local Plan' }
          })
        },
        saveStatus: 'saved',
        setWorkbook,
        navigate
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });

    expect(forget).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(workbook);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(forget.mock.invocationCallOrder[0]);
    expect(setWorkbook).toHaveBeenCalledWith(workbook, {
      source: 'cloud',
      markDirty: false,
      saveStatus: 'cache'
    });
    expect(navigate).toHaveBeenCalledWith('dashboard');
  });

  it('leaves the active workbook untouched when its native file cannot be disconnected', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.id = 'cloud-workbook';
    const cloud = makeCloud({ ok: true, workbook });
    const setWorkbook = vi.fn();
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'local-workbook' },
        browserCache: { save: vi.fn() },
        workbookStorage: {
          forget: async () => ({ ok: false, error: 'busy' }),
          load: async () => ({ status: 'loaded', workbook: { id: 'local-workbook' } })
        },
        saveStatus: 'saved',
        setWorkbook,
        navigate: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let opened;
    await act(async () => {
      opened = await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });

    expect(opened).toMatchObject({ ok: false });
    expect(result.current.model.error).toContain('disconnect the current file');
    expect(setWorkbook).not.toHaveBeenCalled();
  });

  it('does not overwrite the only cache copy of the active workbook', async () => {
    const workbook = cloneFixture(makeMinimalWorkbook());
    workbook.id = 'cloud-workbook';
    const cloud = makeCloud({ ok: true, workbook });
    const save = vi.fn(async () => ({ ok: true }));
    const forget = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useCloudWorkbookController({
        cloud,
        workbook: { id: 'local-workbook' },
        browserCache: { save },
        workbookStorage: { forget },
        saveStatus: 'cache',
        setWorkbook: vi.fn(),
        navigate: vi.fn()
      })
    );
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    let opened;
    await act(async () => {
      opened = await result.current.execute('open', { workbookId: 'cloud-workbook' });
    });

    expect(opened).toMatchObject({ ok: false });
    expect(opened.error).toContain('Save the current workbook to a file');
    expect(cloud.invoke).not.toHaveBeenCalledWith('downloadWorkbook', expect.anything());
    expect(save).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it('shows the specific main-process sign-in failure', async () => {
    const signedOut = { configured: true, status: 'signed_out', user: null, workbooks: [] };
    const cloud = {
      invoke: vi.fn(async (command) => {
        if (command === 'signInWithGoogle') {
          return {
            ok: false,
            state: {
              ...signedOut,
              error: {
                code: 'google_sign_in_failed',
                message: 'Google sign-in could not be started.'
              }
            }
          };
        }
        return { ok: true, state: signedOut };
      }),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.status).toBe('signed_out'));

    await act(async () => {
      await result.current.execute('sign-in');
    });

    expect(result.current.model.error).toBe('Google sign-in could not be started.');
  });

  it('updates the Cavalry profile name and publishes the returned Cloud state', async () => {
    const updatedState = {
      ...signedInState(),
      user: { ...signedInState().user, name: 'Alex Example' }
    };
    const cloud = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getState') return { ok: true, state: signedInState() };
        if (command === 'updateProfile') {
          return { ok: true, profile: { name: payload.name }, state: updatedState };
        }
        return { ok: true, state: signedInState() };
      }),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.user?.name).toBe('Alex Example'));

    let updated;
    await act(async () => {
      updated = await result.current.execute('profile-update', { name: '  Alex Example  ' });
    });

    expect(updated).toMatchObject({ ok: true, profile: { name: 'Alex Example' } });
    expect(cloud.invoke).toHaveBeenCalledWith('updateProfile', { name: 'Alex Example' });
    expect(result.current.model.user?.name).toBe('Alex Example');
    expect(result.current.model.notice).toBe('Profile name updated.');
  });

  it('rejects invalid profile names before invoking the main process', async () => {
    const cloud = makeCloud();
    const { result } = renderHook(() => useCloudWorkbookController({ cloud }));
    await waitFor(() => expect(result.current.model.status).toBe('signed_in'));

    await act(async () => {
      await result.current.execute('profile-update', { name: '   ' });
    });

    expect(result.current.model.error).toBe('Enter a profile name.');
    expect(cloud.invoke).not.toHaveBeenCalledWith('updateProfile', expect.anything());
  });
});
