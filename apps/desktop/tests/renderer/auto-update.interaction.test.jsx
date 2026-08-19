import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { normalizeAutoUpdateState, useAutoUpdate } from '../../src/renderer/app/use-auto-update.js';

describe('renderer auto update state', () => {
  it('normalizes public progress without carrying arbitrary updater details', () => {
    expect(
      normalizeAutoUpdateState({
        enabled: true,
        status: 'downloading',
        availableVersion: ' 1.0.19 ',
        progress: { percent: 104.7 },
        sequence: 8,
        files: ['/private/update.zip'],
        error: { message: 'socket details' }
      })
    ).toEqual({
      enabled: true,
      status: 'downloading',
      version: '1.0.19',
      percent: 100,
      kind: '',
      sequence: 8
    });
  });

  it('subscribes before loading state and rejects an older snapshot', async () => {
    let listener;
    let resolveSnapshot;
    const dispose = vi.fn();
    const snapshot = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    const updates = {
      invoke: vi.fn((command) =>
        command === 'getState' ? snapshot : Promise.resolve({ ok: true })
      ),
      subscribe: vi.fn((callback) => {
        listener = callback;
        return dispose;
      })
    };
    const { result, unmount } = renderHook(() => useAutoUpdate(updates));

    expect(updates.subscribe).toHaveBeenCalledOnce();
    act(() => {
      listener({ enabled: true, status: 'ready', version: '1.0.19', sequence: 2 });
    });
    expect(result.current.state.status).toBe('ready');

    await act(async () => {
      resolveSnapshot({
        ok: true,
        state: { enabled: true, status: 'available', version: '1.0.18', sequence: 1 }
      });
      await snapshot;
    });
    expect(result.current.state).toMatchObject({ status: 'ready', version: '1.0.19', sequence: 2 });

    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('maps renderer actions to the updater port and applies returned state', async () => {
    const updates = {
      invoke: vi.fn(async (command) => {
        if (command === 'getState') return { enabled: true, status: 'idle' };
        if (command === 'downloadUpdate') {
          return {
            ok: true,
            state: { enabled: true, status: 'downloading', percent: 3, sequence: 2 }
          };
        }
        return { ok: true };
      }),
      subscribe: () => () => {}
    };
    const { result } = renderHook(() => useAutoUpdate(updates));
    await waitFor(() => expect(result.current.state.status).toBe('idle'));

    await act(async () => {
      await result.current.checkForUpdates();
      await result.current.downloadUpdate();
      await result.current.restartAndInstall();
    });

    expect(updates.invoke.mock.calls.map(([command]) => command)).toEqual([
      'getState',
      'checkForUpdates',
      'downloadUpdate',
      'restartAndInstall'
    ]);
    expect(result.current.state).toMatchObject({ status: 'downloading', percent: 3 });
  });
});
