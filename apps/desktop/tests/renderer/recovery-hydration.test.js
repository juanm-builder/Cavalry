import { createWorkbook } from '@cavalry/finance-core';
import { describe, expect, it, vi } from 'vitest';
import { hydrateWorkbookFromPorts } from '../../src/renderer/app/workbook-session-reducer.js';

function workbook(id = 'household', name = 'Current work') {
  let sequence = 0;
  return createWorkbook(
    { id, name },
    {
      now: () => '2026-09-05T00:00:00.000Z',
      createId: (prefix) => `${prefix}-${++sequence}`
    }
  );
}

function portsFor(native, cache) {
  return {
    workbookStorage: {
      load: vi.fn(async () => native),
      forget: vi.fn(async () => ({ ok: true }))
    },
    browserCache: {
      load: vi.fn(async () => cache),
      save: vi.fn(async () => ({ ok: true, durable: true, savedAt: '2026-09-05T10:00:00.000Z' }))
    }
  };
}

describe('recovery workbook selection after an app restart', () => {
  it('keeps the saved workbook when an old export receives a newer filesystem timestamp', async () => {
    const current = workbook();
    const ports = portsFor(
      {
        status: 'loaded',
        source: 'native',
        workbook: { ...current, name: 'Old export' },
        file: { savedAt: '2026-09-05T12:00:00.000Z' }
      },
      {
        status: 'loaded',
        source: 'recovery',
        workbook: current,
        file: { savedAt: '2026-09-05T08:00:00.000Z' }
      }
    );
    const result = await hydrateWorkbookFromPorts(ports);
    expect(result.status).toBe('loaded');
    expect(result.workbook).toEqual(current);
    expect(ports.workbookStorage.forget).toHaveBeenCalledOnce();
    expect(ports.browserCache.save).not.toHaveBeenCalled();
    expect(result.warnings?.length).toBeGreaterThan(0);
  });

  it('detaches a different workbook export before restoring the local selection', async () => {
    const current = workbook();
    const ports = portsFor(
      { status: 'loaded', source: 'native', workbook: workbook('another-household') },
      { status: 'loaded', source: 'recovery', workbook: current }
    );
    const result = await hydrateWorkbookFromPorts(ports);
    expect(result.workbook).toEqual(current);
    expect(ports.workbookStorage.forget).toHaveBeenCalledOnce();
  });

  it('retains the export link when both saved copies contain the same workbook', async () => {
    const current = workbook();
    const ports = portsFor(
      { status: 'loaded', source: 'native', workbook: structuredClone(current) },
      { status: 'loaded', source: 'recovery', workbook: current }
    );
    expect((await hydrateWorkbookFromPorts(ports)).workbook).toEqual(current);
    expect(ports.workbookStorage.forget).not.toHaveBeenCalled();
  });

  it('reports recovery corruption instead of silently loading an older export', async () => {
    const failure = {
      status: 'error',
      source: 'recovery',
      error: 'Saved workbook checksum failed.'
    };
    const ports = portsFor(
      { status: 'loaded', source: 'native', workbook: workbook('old-copy') },
      failure
    );
    expect(await hydrateWorkbookFromPorts(ports)).toEqual(failure);
    expect(ports.browserCache.save).not.toHaveBeenCalled();
  });

  it('migrates the linked workbook instead of resurrecting a stale pre-upgrade browser cache', async () => {
    const current = workbook();
    const native = { status: 'loaded', source: 'native', workbook: current };
    const ports = portsFor(native, {
      status: 'loaded',
      source: 'cache',
      workbook: workbook('old-browser-book')
    });
    expect((await hydrateWorkbookFromPorts(ports)).workbook).toEqual(current);
    expect(ports.browserCache.save).toHaveBeenCalledWith(current);
  });

  it('promotes the legacy browser workbook when the linked export has disappeared', async () => {
    const current = workbook();
    const ports = portsFor(
      { status: 'missing', source: 'native', error: 'The linked file was moved.' },
      { status: 'loaded', source: 'cache', workbook: current }
    );
    const result = await hydrateWorkbookFromPorts(ports);
    expect(result).toMatchObject({ status: 'loaded', source: 'recovery', workbook: current });
    expect(ports.browserCache.save).toHaveBeenCalledWith(current);
  });
});
