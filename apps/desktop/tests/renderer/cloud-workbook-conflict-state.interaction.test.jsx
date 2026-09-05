import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCloudWorkbookConflictState } from '../../src/renderer/app/use-cloud-workbook-conflict-state.js';

function fixture() {
  let finishRequest;
  const values = new Map();
  const options = {
    conflictNoticePublicationRef: { current: '' },
    localConflictNoticeRef: { current: null },
    stateRef: { current: { user: { id: 'owner-A' } } },
    resolvedSyncStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    setLocalConflictNotice: vi.fn(),
    updateWorkbookConflict: vi.fn(),
    flushDurableSyncState: vi.fn(async () => ({ ok: true })),
    invoke: vi.fn(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        })
    )
  };
  options.applyRemoteState = vi.fn((state) => {
    options.stateRef.current = state;
  });
  const hook = renderHook(() => useCloudWorkbookConflictState(options));
  const noticeB = {
    id: 'notice-B',
    report: { workbookId: 'same-workbook', workbookName: 'Owner B workbook' }
  };
  const selectB = () => {
    options.stateRef.current = { user: { id: 'owner-B' } };
    options.conflictNoticePublicationRef.current = 'owner-B-publication';
    options.localConflictNoticeRef.current = noticeB;
    options.setLocalConflictNotice.mockClear();
  };
  const expectBUnchanged = () => {
    expect(options.stateRef.current.user.id).toBe('owner-B');
    expect(options.conflictNoticePublicationRef.current).toBe('owner-B-publication');
    expect(options.localConflictNoticeRef.current).toBe(noticeB);
    expect(options.setLocalConflictNotice).not.toHaveBeenCalled();
    expect(options.updateWorkbookConflict).not.toHaveBeenCalled();
    expect(options.flushDurableSyncState).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  };
  return { options, hook, selectB, expectBUnchanged, finish: (result) => finishRequest(result) };
}

const publication = {
  workbookId: 'same-workbook',
  expectedUserId: 'owner-A',
  baseRevision: 1,
  remoteRevision: 2,
  review: {
    version: 1,
    workbookId: 'same-workbook',
    workbookName: 'Owner A private workbook',
    entries: []
  }
};

describe('conflict UI account boundaries', () => {
  it.each([false, true])(
    'ignores a delayed publication response with ok=%s after a native owner change',
    async (ok) => {
      const test = fixture();
      let pending;
      act(() => {
        pending = test.hook.result.current.publishConflictReport(publication);
      });
      expect(test.options.invoke).toHaveBeenCalledTimes(1);
      act(test.selectB);
      let result;
      await act(async () => {
        test.finish({
          ok,
          error: ok ? '' : 'Old owner request failed.',
          state: { user: { id: 'owner-A' } }
        });
        result = await pending;
      });
      test.expectBUnchanged();
      expect(result).toMatchObject({ ok: false, code: 'cloud_sync_scope_changed' });
      expect(test.options.applyRemoteState).not.toHaveBeenCalled();
    }
  );

  it('does not install the old failed notice when the response itself reports a new owner', async () => {
    const test = fixture();
    test.options.applyRemoteState.mockImplementation(() => test.selectB());
    let pending;
    act(() => {
      pending = test.hook.result.current.publishConflictReport(publication);
    });
    let result;
    await act(async () => {
      test.finish({ ok: false, state: { user: { id: 'owner-B' } } });
      result = await pending;
    });
    test.expectBUnchanged();
    expect(result).toMatchObject({ ok: false, code: 'cloud_sync_scope_changed' });
  });

  it('does not latch an old owner’s conflict into the current owner’s UI or local anchors', async () => {
    const test = fixture();
    act(test.selectB);
    let result;
    await act(async () => {
      result = await test.hook.result.current.latchWorkbookConflict('owner-A', 'same-workbook', 3);
    });
    test.expectBUnchanged();
    expect(result).toMatchObject({ ok: false, code: 'cloud_sync_scope_changed' });
  });

  it('does not apply a delayed clear response over the newly selected owner', async () => {
    const test = fixture();
    let pending;
    act(() => {
      pending = test.hook.result.current.clearSharedConflictNotice('same-workbook', 'owner-A');
    });
    act(test.selectB);
    let result;
    await act(async () => {
      test.finish({ ok: true, state: { user: { id: 'owner-A' } } });
      result = await pending;
    });
    test.expectBUnchanged();
    expect(result).toMatchObject({ ok: false, code: 'cloud_sync_scope_changed' });
    expect(test.options.applyRemoteState).not.toHaveBeenCalled();
  });
});
