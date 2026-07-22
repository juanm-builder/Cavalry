import { describe, expect, it, vi } from 'vitest';

import { createLatestWorkbookSaveScheduler } from '../../src/renderer/app/workbook-save-scheduler.js';

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
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('latest workbook save scheduler', () => {
  it('debounces automatic saves and retains only the latest pending snapshot', async () => {
    const timers = createManualTimers();
    const performSave = vi.fn(async (workbook) => ({ ok: true, name: workbook.name }));
    const scheduler = createLatestWorkbookSaveScheduler({
      performSave,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer
    });

    const firstResult = scheduler.enqueue({ name: 'First' }, { automatic: true });
    const latestResult = scheduler.enqueue({ name: 'Latest' }, { automatic: true });

    expect(firstResult).toBe(latestResult);
    expect(performSave).not.toHaveBeenCalled();
    expect(timers.timers[0].canceled).toBe(true);
    timers.timers[0].callback();
    expect(performSave).not.toHaveBeenCalled();
    expect(timers.timers.at(-1).delay).toBe(200);
    timers.timers.at(-1).callback();

    await expect(firstResult).resolves.toEqual({ ok: true, name: 'Latest' });
    await expect(latestResult).resolves.toEqual({ ok: true, name: 'Latest' });
    expect(performSave).toHaveBeenCalledTimes(1);
    expect(performSave).toHaveBeenCalledWith({ name: 'Latest' }, { hasAutomatic: true });
  });

  it('keeps one in-flight save and replaces additional pending snapshots', async () => {
    const timers = createManualTimers();
    const firstSave = deferred();
    const savedNames = [];
    const scheduler = createLatestWorkbookSaveScheduler({
      performSave(workbook) {
        savedNames.push(workbook.name);
        if (workbook.name === 'In flight') return firstSave.promise;
        return Promise.resolve({ ok: true, name: workbook.name });
      },
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer
    });

    const inFlightResult = scheduler.enqueue({ name: 'In flight' });
    await Promise.resolve();
    expect(savedNames).toEqual(['In flight']);

    const replacedResult = scheduler.enqueue({ name: 'Replaced' }, { automatic: true });
    const latestResult = scheduler.enqueue({ name: 'Latest' }, { automatic: true });
    expect(replacedResult).toBe(latestResult);
    timers.timers.at(-1).callback();
    await Promise.resolve();
    expect(savedNames).toEqual(['In flight']);

    firstSave.resolve({ ok: true, name: 'In flight' });
    await expect(inFlightResult).resolves.toEqual({ ok: true, name: 'In flight' });
    await expect(replacedResult).resolves.toEqual({ ok: true, name: 'Latest' });
    await expect(latestResult).resolves.toEqual({ ok: true, name: 'Latest' });
    expect(savedNames).toEqual(['In flight', 'Latest']);
  });

  it('flushes a pending automatic save without waiting for its debounce', async () => {
    const timers = createManualTimers();
    const performSave = vi.fn(async (workbook) => ({ ok: true, name: workbook.name }));
    const scheduler = createLatestWorkbookSaveScheduler({
      performSave,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer
    });

    const automaticResult = scheduler.enqueue({ name: 'Pending' }, { automatic: true });
    const flushResult = scheduler.flush();

    await expect(flushResult).resolves.toEqual({ ok: true, name: 'Pending' });
    await expect(automaticResult).resolves.toEqual({ ok: true, name: 'Pending' });
    expect(timers.timers[0].canceled).toBe(true);
    expect(performSave).toHaveBeenCalledTimes(1);
  });

  it('sequences a Save As operation and preserves it when newer automatic snapshots arrive', async () => {
    const firstSave = deferred();
    const performSave = vi.fn(() => firstSave.promise);
    const performSaveAs = vi.fn(async (workbook, metadata) => ({
      ok: true,
      name: workbook.name,
      hasAutomatic: metadata.hasAutomatic
    }));
    const scheduler = createLatestWorkbookSaveScheduler({ performSave });

    const inFlightResult = scheduler.enqueue({ name: 'Older in flight' });
    await Promise.resolve();
    const saveAsResult = scheduler.enqueue(
      { name: 'Save As snapshot' },
      { perform: performSaveAs }
    );
    const automaticResult = scheduler.enqueue({ name: 'Newest snapshot' }, { automatic: true });

    expect(performSaveAs).not.toHaveBeenCalled();
    firstSave.resolve({ ok: true, name: 'Older in flight' });
    await inFlightResult;
    await expect(saveAsResult).resolves.toEqual({
      ok: true,
      name: 'Newest snapshot',
      hasAutomatic: true
    });
    await expect(automaticResult).resolves.toEqual({
      ok: true,
      name: 'Newest snapshot',
      hasAutomatic: true
    });
    expect(performSaveAs).toHaveBeenCalledWith({ name: 'Newest snapshot' }, { hasAutomatic: true });
    expect(performSave).toHaveBeenCalledTimes(1);
  });

  it('starts an explicit operation immediately when it replaces a debounced automatic save', async () => {
    const timers = createManualTimers();
    const performSave = vi.fn();
    const performSaveAs = vi.fn(async (workbook) => ({ ok: true, name: workbook.name }));
    const scheduler = createLatestWorkbookSaveScheduler({
      performSave,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer
    });

    const automaticResult = scheduler.enqueue({ name: 'Automatic' }, { automatic: true });
    const saveAsResult = scheduler.enqueue(
      { name: 'Explicit Save As' },
      { perform: performSaveAs }
    );

    expect(automaticResult).toBe(saveAsResult);
    await expect(saveAsResult).resolves.toEqual({ ok: true, name: 'Explicit Save As' });
    expect(timers.timers[0].canceled).toBe(true);
    expect(performSave).not.toHaveBeenCalled();
    expect(performSaveAs).toHaveBeenCalledWith(
      { name: 'Explicit Save As' },
      { hasAutomatic: true }
    );
  });
});
