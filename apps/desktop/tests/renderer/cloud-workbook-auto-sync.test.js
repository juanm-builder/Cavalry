import { describe, expect, it, vi } from 'vitest';

import { createCloudWorkbookAutoSyncScheduler } from '../../src/renderer/app/cloud-workbook-auto-sync.js';

function createManualTimers() {
  const timers = [];
  return {
    timers,
    scheduleTimer(callback, delay) {
      const timer = { callback, canceled: false, delay };
      timers.push(timer);
      return timer;
    },
    cancelTimer(timer) {
      timer.canceled = true;
    },
    runLatest() {
      const timer = [...timers].reverse().find((candidate) => !candidate.canceled);
      timer.callback();
      return timer;
    }
  };
}

function entry(name) {
  return {
    userId: 'user-1',
    workbookId: 'workbook-1',
    workbook: { id: 'workbook-1', name }
  };
}

describe('Cloud workbook automatic sync scheduler', () => {
  it('coalesces local saves and uploads only the latest workbook snapshot', async () => {
    const timers = createManualTimers();
    const performSync = vi.fn(async () => ({ ok: true }));
    const scheduler = createCloudWorkbookAutoSyncScheduler({
      performSync,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer
    });

    scheduler.enqueue(entry('First'));
    scheduler.enqueue(entry('Latest'));

    expect(timers.timers[0].canceled).toBe(true);
    expect(performSync).not.toHaveBeenCalled();
    expect(timers.runLatest().delay).toBe(800);
    await vi.waitFor(() => expect(performSync).toHaveBeenCalledOnce());
    expect(performSync.mock.calls[0][0].workbook.name).toBe('Latest');
    expect(scheduler.hasWork()).toBe(false);
  });

  it('retries an offline save with the same CAS revision and the newest local snapshot', async () => {
    const timers = createManualTimers();
    const statuses = [];
    const expectedRevisions = [];
    const names = [];
    const performSync = vi.fn(async (queued) => {
      if (!Object.prototype.hasOwnProperty.call(queued, 'expectedRevision')) {
        queued.expectedRevision = 7;
      }
      expectedRevisions.push(queued.expectedRevision);
      names.push(queued.workbook.name);
      return expectedRevisions.length === 1
        ? { ok: false, code: 'cloud_upload_failed', retry: true }
        : { ok: true };
    });
    const scheduler = createCloudWorkbookAutoSyncScheduler({
      performSync,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onStatus: (status) => statuses.push(status)
    });

    scheduler.enqueue(entry('Offline'));
    timers.runLatest();
    await vi.waitFor(() => expect(performSync).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(timers.timers.some((timer) => !timer.canceled && timer.delay === 5_000)).toBe(true)
    );
    expect(statuses.map((status) => status.phase)).toContain('retrying');
    expect(statuses.at(-1)).toMatchObject({
      phase: 'retrying',
      userId: 'user-1',
      workbookId: 'workbook-1'
    });

    scheduler.enqueue(entry('Newest while offline'));
    expect(timers.runLatest().delay).toBe(800);
    await vi.waitFor(() => expect(performSync).toHaveBeenCalledTimes(2));

    expect(expectedRevisions).toEqual([7, 7]);
    expect(names).toEqual(['Offline', 'Newest while offline']);
    expect(scheduler.hasWork()).toBe(false);
  });

  it('publishes a scoped terminal failure after automatic retries stop', async () => {
    const timers = createManualTimers();
    const statuses = [];
    const scheduler = createCloudWorkbookAutoSyncScheduler({
      performSync: async () => ({
        ok: false,
        retry: false,
        code: 'cloud_record_invalid',
        error: 'iCloud rejected this workbook.'
      }),
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onStatus: (status) => statuses.push(status)
    });

    scheduler.enqueue(entry('Rejected'));
    expect(statuses.at(-1)).toMatchObject({ phase: 'waiting', workbookId: 'workbook-1' });
    timers.runLatest();
    await vi.waitFor(() => expect(scheduler.hasWork()).toBe(false));

    expect(statuses.map((status) => status.phase)).toContain('syncing');
    expect(statuses.at(-1)).toMatchObject({
      phase: 'failed',
      userId: 'user-1',
      workbookId: 'workbook-1',
      result: {
        ok: false,
        retry: false,
        code: 'cloud_record_invalid',
        error: 'iCloud rejected this workbook.'
      }
    });
  });

  it('never schedules an automatic retry after an optimistic-concurrency conflict', async () => {
    const timers = createManualTimers();
    const performSync = vi.fn(async () => ({
      ok: false,
      code: 'workbook_revision_conflict',
      conflict: true,
      retry: false
    }));
    const scheduler = createCloudWorkbookAutoSyncScheduler({
      performSync,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer
    });

    scheduler.enqueue(entry('Conflicted'));
    timers.runLatest();
    await vi.waitFor(() => expect(performSync).toHaveBeenCalledOnce());

    expect(timers.timers.filter((timer) => !timer.canceled)).toHaveLength(1);
    expect(scheduler.hasWork()).toBe(false);
  });

  it('cancels a queued automatic upload without stopping future manual re-enablement', async () => {
    const timers = createManualTimers();
    const performSync = vi.fn(async () => ({ ok: true }));
    const scheduler = createCloudWorkbookAutoSyncScheduler({
      performSync,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer
    });

    scheduler.enqueue(entry('Do not upload'));
    scheduler.cancelPending();
    expect(scheduler.hasWork()).toBe(false);
    expect(timers.timers.at(-1).canceled).toBe(true);

    scheduler.enqueue(entry('Upload after re-enabling'));
    timers.runLatest();
    await vi.waitFor(() => expect(performSync).toHaveBeenCalledOnce());
    expect(performSync.mock.calls[0][0].workbook.name).toBe('Upload after re-enabling');
  });
});
