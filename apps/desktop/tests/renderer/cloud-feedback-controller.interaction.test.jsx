import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCloudFeedbackController } from '../../src/renderer/app/use-cloud-feedback-controller.js';

const CLOUD_USER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const cloud = {
  configured: true,
  sessionGeneration: 1,
  status: 'signed_in',
  user: { id: CLOUD_USER_ID }
};

describe('cloud feedback controller', () => {
  it('loads, submits, and downloads owner-scoped reports through the narrow port', async () => {
    const invoke = vi.fn(async (operation, payload) => {
      if (operation === 'list') {
        return {
          ok: true,
          sessionGeneration: 1,
          userId: CLOUD_USER_ID,
          reports: [
            {
              id: 'report-1',
              kind: 'bug',
              description: 'Existing report',
              status: 'received',
              source: 'settings',
              created_at: '2026-07-24T01:00:00.000Z',
              attachment: {
                id: 'attachment-1',
                name: 'screen.png',
                mimeType: 'image/png',
                byteSize: 1200
              }
            }
          ]
        };
      }
      if (operation === 'submit') {
        return {
          ok: true,
          sessionGeneration: 1,
          userId: CLOUD_USER_ID,
          warning: 'The report was saved, but its image could not be uploaded.',
          report: {
            id: 'report-2',
            status: 'received',
            createdAt: '2026-07-24T02:00:00.000Z',
            ...payload
          }
        };
      }
      return {
        ok: true,
        sessionGeneration: 1,
        userId: CLOUD_USER_ID,
        attachment: {
          id: payload.attachmentId,
          name: 'screen.png',
          mimeType: 'image/png',
          byteSize: 1200,
          dataUrl: 'data:image/png;base64,AA=='
        }
      };
    });
    const { result, rerender } = renderHook(
      ({ cloudState }) => useCloudFeedbackController({ cloud: cloudState, feedback: { invoke } }),
      { initialProps: { cloudState: cloud } }
    );

    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(invoke).toHaveBeenCalledWith('list', {
      expectedSessionGeneration: 1,
      expectedUserId: CLOUD_USER_ID
    });
    expect(result.current.model.reports[0]).toMatchObject({
      id: 'report-1',
      createdAt: '2026-07-24T01:00:00.000Z',
      attachment: { fileName: 'screen.png', sizeBytes: 1200 }
    });

    await act(async () => {
      await result.current.submit({
        clientRequestId: CLIENT_REQUEST_ID,
        kind: 'feedback',
        description: '  A thoughtful idea.  ',
        source: 'assistant',
        context: { routeId: 'ledger', workbookId: 'must-not-cross' }
      });
    });
    expect(invoke).toHaveBeenCalledWith('submit', {
      clientRequestId: CLIENT_REQUEST_ID,
      kind: 'feedback',
      description: 'A thoughtful idea.',
      source: 'assistant',
      context: { routeId: 'ledger' },
      expectedSessionGeneration: 1,
      expectedUserId: CLOUD_USER_ID
    });
    expect(result.current.model.reports.map((report) => report.id)).toEqual([
      'report-2',
      'report-1'
    ]);
    expect(result.current.model).toMatchObject({
      warning: true,
      notice: 'The report was saved, but its image could not be uploaded.'
    });

    let downloaded;
    await act(async () => {
      downloaded = await result.current.downloadAttachment({
        reportId: 'report-2',
        attachmentId: 'attachment-1'
      });
    });
    expect(invoke).toHaveBeenCalledWith('download', {
      attachmentId: 'attachment-1',
      expectedSessionGeneration: 1,
      expectedUserId: CLOUD_USER_ID
    });
    expect(downloaded.attachment).toMatchObject({
      fileName: 'screen.png',
      sizeBytes: 1200,
      dataUrl: 'data:image/png;base64,AA=='
    });

    act(() => {
      rerender({
        cloudState: { configured: true, status: 'signed_out', user: null }
      });
    });
    expect(result.current.model.reports).toEqual([]);
    expect(result.current.model.loaded).toBe(false);
  });

  it('does not call the port or pretend reports sync while signed out', async () => {
    const invoke = vi.fn();
    const { result } = renderHook(() =>
      useCloudFeedbackController({
        cloud: { configured: true, status: 'signed_out', user: null },
        feedback: { invoke }
      })
    );

    let submitted;
    await act(async () => {
      submitted = await result.current.submit({
        clientRequestId: CLIENT_REQUEST_ID,
        kind: 'bug',
        description: 'Cannot submit this yet.'
      });
    });
    expect(submitted).toMatchObject({ ok: false, code: 'not_signed_in' });
    expect(result.current.model.signedIn).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not expose an in-flight report list after the Cloud user changes', async () => {
    let resolveList;
    const invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ cloudState }) => useCloudFeedbackController({ cloud: cloudState, feedback: { invoke } }),
      { initialProps: { cloudState: cloud } }
    );

    let pendingRefresh;
    await act(async () => {
      pendingRefresh = result.current.refresh();
      await Promise.resolve();
    });
    act(() => {
      rerender({
        cloudState: {
          configured: true,
          status: 'signed_in',
          user: { id: '22222222-2222-4222-8222-222222222222' }
        }
      });
    });
    let refreshResult;
    await act(async () => {
      resolveList({
        ok: true,
        reports: [{ id: 'private-report-from-the-previous-user', description: 'Private' }]
      });
      refreshResult = await pendingRefresh;
    });

    expect(refreshResult).toMatchObject({ ok: false, code: 'cloud_session_changed' });
    expect(result.current.model.reports).toEqual([]);
    expect(result.current.model.loaded).toBe(false);
  });

  it('does not revive stale reports when the same user starts a new Cloud session', async () => {
    let listCount = 0;
    const invoke = vi.fn(async () => {
      listCount += 1;
      return listCount === 1
        ? {
            ok: true,
            sessionGeneration: 1,
            userId: CLOUD_USER_ID,
            reports: [
              {
                id: 'old-session-report',
                kind: 'bug',
                description: 'Old private state',
                source: 'settings'
              }
            ]
          }
        : { ok: false, error: 'Cloud is temporarily offline.' };
    });
    const { result, rerender } = renderHook(
      ({ cloudState }) => useCloudFeedbackController({ cloud: cloudState, feedback: { invoke } }),
      { initialProps: { cloudState: cloud } }
    );

    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(result.current.model.reports).toHaveLength(1);
    act(() => {
      rerender({
        cloudState: {
          ...cloud,
          sessionGeneration: 2
        }
      });
    });
    expect(result.current.model.reports).toEqual([]);
    expect(result.current.model.loaded).toBe(false);

    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(result.current.model.reports).toEqual([]);
    expect(result.current.model.error).toBe('Cloud is temporarily offline.');
    expect(result.current.model.reportsError).toBe('Cloud is temporarily offline.');
  });

  it('does not present a submit error as a report-history sync failure', async () => {
    const invoke = vi.fn(async (operation) =>
      operation === 'list'
        ? {
            ok: true,
            sessionGeneration: 1,
            userId: CLOUD_USER_ID,
            reports: []
          }
        : { ok: false, error: 'The report could not be sent.' }
    );
    const { result } = renderHook(() =>
      useCloudFeedbackController({ cloud, feedback: { invoke } })
    );

    await act(async () => {
      await result.current.ensureLoaded();
      await result.current.submit({
        clientRequestId: CLIENT_REQUEST_ID,
        kind: 'bug',
        description: 'Submission-only error'
      });
    });

    expect(result.current.model.error).toBe('The report could not be sent.');
    expect(result.current.model.reportsError).toBe('');
    expect(result.current.model.submitError).toBe('The report could not be sent.');
  });
});
