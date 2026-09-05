import { describe, expect, it, vi } from 'vitest';
import { createDesktopRendererPorts } from '../../src/renderer/platform/desktop-ports.js';

const workbook = {
  id: 'durable-test',
  name: 'Durable workbook',
  version: 2,
  year: 2026,
  currency: 'PHP',
  settings: {},
  accounts: [],
  categories: [],
  transactions: [],
  sheets: []
};

describe('desktop durable recovery port', () => {
  it('saves and loads with the browser database completely unavailable', async () => {
    let saved;
    const files = {
      saveRecoveryWorkbook: async (payload) => {
        saved = payload.html;
        return { ok: true, durable: true, savedAt: '2026-09-05T00:00:00Z' };
      },
      loadRecoveryWorkbook: async () => ({ ok: true, text: saved, savedAt: '2026-09-05T00:00:00Z' })
    };
    const first = createDesktopRendererPorts({ files }, {});
    expect(await first.browserCache.save(workbook)).toMatchObject({ ok: true, durable: true });
    const restarted = createDesktopRendererPorts({ files }, {});
    expect(await restarted.browserCache.load()).toMatchObject({
      status: 'loaded',
      source: 'recovery',
      workbook
    });
  });

  it('does not downgrade a native disk error to a successful browser-only save', async () => {
    const ports = createDesktopRendererPorts(
      {
        files: {
          saveRecoveryWorkbook: async () => {
            throw new Error('disk full');
          },
          loadRecoveryWorkbook: async () => ({ ok: false, empty: true })
        }
      },
      {}
    );
    await expect(ports.browserCache.save(workbook)).rejects.toThrow('disk full');
  });

  it('preserves a local recovery read error rather than displaying a fresh empty workbook', async () => {
    const ports = createDesktopRendererPorts(
      {
        files: {
          saveRecoveryWorkbook: vi.fn(),
          loadRecoveryWorkbook: async () => {
            throw new Error('Saved files need recovery');
          }
        }
      },
      {}
    );
    expect(await ports.browserCache.load()).toEqual({
      status: 'error',
      source: 'recovery',
      error: 'Saved files need recovery'
    });
  });

  it('does not reopen a stale browser copy after explicitly leaving a workbook', async () => {
    const open = vi.fn(() => {
      throw new Error('must not read legacy storage');
    });
    const ports = createDesktopRendererPorts(
      {
        files: {
          saveRecoveryWorkbook: vi.fn(),
          loadRecoveryWorkbook: async () => ({ ok: false, empty: true, cleared: true })
        }
      },
      { indexedDB: { open } }
    );
    expect(await ports.browserCache.load()).toEqual({
      status: 'empty',
      source: 'recovery',
      cleared: true
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('validates stored recovery text before it can become an active workbook', async () => {
    const invalid = createDesktopRendererPorts(
      {
        files: {
          saveRecoveryWorkbook: vi.fn(),
          loadRecoveryWorkbook: async () => ({ ok: true, text: '<html>broken</html>' })
        }
      },
      {}
    );
    expect(await invalid.browserCache.load()).toMatchObject({
      status: 'error',
      source: 'recovery'
    });
  });
});
