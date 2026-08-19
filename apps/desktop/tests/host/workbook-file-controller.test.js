// Protects extracted native workbook IPC behavior without launching the native shell.

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createWorkbookFileController } = require('../../src/host/workbook-file-controller.cjs');

const expectedWorkbookFileChannels = [
  'cavalry-files:forget-active',
  'cavalry-files:get-active',
  'cavalry-files:list-recent',
  'cavalry-files:open',
  'cavalry-files:open-recent',
  'cavalry-files:reveal-active',
  'cavalry-files:save-active',
  'cavalry-files:save-as'
];

function makeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}

function getFileHandler(ipcMain, channel) {
  const handler = ipcMain.handlers.get(channel);
  expect(handler).toBeTypeOf('function');
  return handler;
}

function invokeFileHandler(ipcMain, channel, payload) {
  return getFileHandler(ipcMain, channel)(null, payload);
}

function makeFakeFs() {
  const files = new Map([['/tmp/workbook.html', '<html>Workbook</html>']]);
  return {
    writes: [],
    async readFile(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('missing file');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(filePath);
    },
    async stat(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('missing file');
        error.code = 'ENOENT';
        throw error;
      }
      return { mtime: new Date('2026-07-01T10:00:00.000Z') };
    },
    async mkdir() {},
    async writeFile(filePath, text) {
      this.writes.push([filePath, text]);
      files.set(filePath, text);
    },
    put(filePath, text) {
      files.set(filePath, text);
    },
    remove(filePath) {
      files.delete(filePath);
    }
  };
}

function makeController(overrides = {}) {
  const ipcMain = makeIpcMain();
  const fs = makeFakeFs();
  const shellCalls = [];
  const writes = [];
  const dialog = {
    async showOpenDialog() {
      return overrides.openResult || { canceled: false, filePaths: ['/tmp/workbook.html'] };
    },
    async showSaveDialog() {
      return overrides.saveResult || { canceled: false, filePath: '/tmp/saved-workbook.html' };
    }
  };
  const controller = createWorkbookFileController({
    app: { getPath: () => '/tmp/cavalry-user-data' },
    ipcMain,
    dialog,
    shell: {
      showItemInFolder(filePath) {
        shellCalls.push(filePath);
      }
    },
    fs,
    appTitle: 'Cavalry for Mac',
    now: overrides.now || (() => '2026-07-01T12:00:00.000Z'),
    getWorkbookPersistenceService: async () =>
      overrides.persistenceService || {
        async safeWriteWorkbookFile(filePath, html) {
          writes.push([filePath, html]);
          return {
            savedAt: '2026-07-01T11:00:00.000Z',
            backupPath: filePath + '.bak'
          };
        }
      },
    assertTrustedSender: overrides.assertTrustedSender || (() => true)
  });
  controller.registerFileHandlers();
  return { controller, fs, ipcMain, shellCalls, writes };
}

describe('workbook file controller', () => {
  it('registers the stable workbook file IPC channels', () => {
    const { ipcMain } = makeController();

    expect(Array.from(ipcMain.handlers.keys()).sort()).toEqual(expectedWorkbookFileChannels);
  });

  it('checks the trusted renderer before every workbook command', () => {
    const assertTrustedSender = () => {
      throw new Error('untrusted renderer');
    };
    const { ipcMain } = makeController({ assertTrustedSender });

    ipcMain.handlers.forEach((handler) => {
      expect(() => handler({ sender: {} }, {})).toThrow('untrusted renderer');
    });
  });

  it('opens a workbook and persists active file state', async () => {
    const { fs, ipcMain } = makeController();
    const opened = await getFileHandler(ipcMain, 'cavalry-files:open')();

    expect(opened).toMatchObject({
      ok: true,
      fileName: 'workbook.html',
      text: '<html>Workbook</html>',
      savedAt: '2026-07-01T10:00:00.000Z'
    });
    expect(fs.writes[0][0]).toBe('/tmp/cavalry-user-data/cavalry-file-state.json');
    expect(JSON.parse(fs.writes[0][1])).toEqual({
      activeWorkbookPath: '/tmp/workbook.html',
      recentWorkbooks: [
        {
          filePath: '/tmp/workbook.html',
          lastUsedAt: '2026-07-01T12:00:00.000Z',
          savedAt: '2026-07-01T10:00:00.000Z'
        }
      ]
    });
  });

  it('preserves save-active, save-as, forget, and reveal response shapes', async () => {
    const { ipcMain, shellCalls, writes } = makeController();

    expect(
      await invokeFileHandler(ipcMain, 'cavalry-files:save-active', {
        html: '<html>Before open</html>'
      })
    ).toEqual({
      ok: false,
      needsFile: true,
      error: 'No workbook file selected.'
    });

    await getFileHandler(ipcMain, 'cavalry-files:open')();
    expect(
      await invokeFileHandler(ipcMain, 'cavalry-files:save-active', {
        html: '<html>Saved</html>'
      })
    ).toMatchObject({
      ok: true,
      fileName: 'workbook.html',
      savedAt: '2026-07-01T11:00:00.000Z',
      backupFileName: 'workbook.html.bak'
    });
    expect(writes.at(-1)).toEqual(['/tmp/workbook.html', '<html>Saved</html>']);

    expect(
      await invokeFileHandler(ipcMain, 'cavalry-files:save-as', {
        html: '<html>Save As</html>'
      })
    ).toMatchObject({
      ok: true,
      fileName: 'saved-workbook.html',
      savedAt: '2026-07-01T11:00:00.000Z',
      backupFileName: 'saved-workbook.html.bak'
    });
    expect(writes.at(-1)).toEqual(['/tmp/saved-workbook.html', '<html>Save As</html>']);

    expect(await getFileHandler(ipcMain, 'cavalry-files:reveal-active')()).toEqual({
      ok: true,
      fileName: 'saved-workbook.html'
    });
    expect(shellCalls).toEqual(['/tmp/saved-workbook.html']);

    expect(await getFileHandler(ipcMain, 'cavalry-files:forget-active')()).toEqual({ ok: true });
    expect(await getFileHandler(ipcMain, 'cavalry-files:reveal-active')()).toEqual({
      ok: false,
      error: 'No workbook file selected.'
    });
  });

  it('returns canceled responses without changing state', async () => {
    const { ipcMain } = makeController({
      openResult: { canceled: true, filePaths: [] },
      saveResult: { canceled: true, filePath: '' }
    });

    expect(await getFileHandler(ipcMain, 'cavalry-files:open')()).toEqual({
      ok: false,
      canceled: true
    });
    expect(await invokeFileHandler(ipcMain, 'cavalry-files:save-as', { html: '' })).toEqual({
      ok: false,
      canceled: true
    });
    expect(await getFileHandler(ipcMain, 'cavalry-files:get-active')()).toEqual({
      ok: false,
      empty: true,
      fileName: ''
    });
  });

  it('lists deduplicated recent workbooks and opens only main-owned identifiers', async () => {
    const { fs, ipcMain } = makeController();

    await getFileHandler(ipcMain, 'cavalry-files:open')();
    const firstList = await getFileHandler(ipcMain, 'cavalry-files:list-recent')();
    expect(firstList).toMatchObject({
      ok: true,
      workbooks: [
        {
          fileName: 'workbook.html',
          folderName: 'tmp',
          savedAt: '2026-07-01T10:00:00.000Z'
        }
      ]
    });
    expect(firstList.workbooks[0].id).toMatch(/^[0-9a-f]{24}$/);
    expect(firstList.workbooks[0]).not.toHaveProperty('filePath');

    await invokeFileHandler(ipcMain, 'cavalry-files:save-active', {
      html: '<html>Saved again</html>'
    });
    expect((await getFileHandler(ipcMain, 'cavalry-files:list-recent')()).workbooks).toHaveLength(
      1
    );

    await expect(
      invokeFileHandler(ipcMain, 'cavalry-files:open-recent', {
        id: 'not-in-the-allowlist',
        filePath: '/tmp/other.html'
      })
    ).resolves.toMatchObject({ ok: false, code: 'invalid_recent_workbook' });

    const reopened = await invokeFileHandler(ipcMain, 'cavalry-files:open-recent', {
      id: firstList.workbooks[0].id
    });
    expect(reopened).toMatchObject({ ok: true, fileName: 'workbook.html' });
    expect(fs.writes.at(-1)[1]).not.toContain('<html>Saved again</html>');
  });

  it('loads legacy active state and bounds deduplicated recent metadata', async () => {
    const { controller, fs } = makeController();
    const recentWorkbooks = Array.from({ length: 10 }, (_, index) => ({
      filePath: `/tmp/workbook-${index}.html`,
      lastUsedAt: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      savedAt: ''
    }));
    recentWorkbooks.splice(1, 0, recentWorkbooks[0]);
    recentWorkbooks.push({ filePath: 'relative-workbook.html' });
    fs.put(
      '/tmp/cavalry-user-data/cavalry-file-state.json',
      JSON.stringify({
        activeWorkbookPath: '/tmp/legacy-active.html',
        recentWorkbooks
      })
    );

    await controller.loadFileState();

    const loaded = controller.getRecentWorkbooks();
    expect(loaded).toHaveLength(8);
    expect(loaded.map((workbook) => workbook.fileName)).toEqual([
      'legacy-active.html',
      'workbook-0.html',
      'workbook-1.html',
      'workbook-2.html',
      'workbook-3.html',
      'workbook-4.html',
      'workbook-5.html',
      'workbook-6.html'
    ]);
    expect(loaded.every((workbook) => !Object.hasOwn(workbook, 'filePath'))).toBe(true);
  });

  it('retains a recent workbook after a non-missing read failure', async () => {
    let reads = 0;
    const { ipcMain } = makeController({
      persistenceService: {
        async readWorkbookFileWithRecovery() {
          reads += 1;
          if (reads > 1) {
            const error = new Error('Permission denied');
            error.code = 'EACCES';
            throw error;
          }
          return {
            text: '<html>Workbook</html>',
            savedAt: '2026-07-01T10:00:00.000Z',
            recoveredFromBackup: false
          };
        }
      }
    });
    await getFileHandler(ipcMain, 'cavalry-files:open')();
    const recent = (await getFileHandler(ipcMain, 'cavalry-files:list-recent')()).workbooks[0];

    await expect(
      invokeFileHandler(ipcMain, 'cavalry-files:open-recent', { id: recent.id })
    ).resolves.toMatchObject({
      ok: false,
      missing: false,
      permissionDenied: true,
      error: expect.stringContaining('privacy settings')
    });
    await expect(getFileHandler(ipcMain, 'cavalry-files:list-recent')()).resolves.toMatchObject({
      ok: true,
      workbooks: [{ id: recent.id }]
    });
  });

  it('prunes a recent workbook that was moved or deleted', async () => {
    const { fs, ipcMain } = makeController();
    await getFileHandler(ipcMain, 'cavalry-files:open')();
    const recent = (await getFileHandler(ipcMain, 'cavalry-files:list-recent')()).workbooks[0];
    fs.remove('/tmp/workbook.html');

    await expect(
      invokeFileHandler(ipcMain, 'cavalry-files:open-recent', { id: recent.id })
    ).resolves.toMatchObject({
      ok: false,
      missing: true,
      error: 'This recent workbook has moved or been deleted.',
      recentWorkbooks: []
    });
    await expect(getFileHandler(ipcMain, 'cavalry-files:list-recent')()).resolves.toEqual({
      ok: true,
      workbooks: []
    });
  });

  it('reports backup recovery and protects the valid backup on the next save', async () => {
    const writeOptions = [];
    const { controller, ipcMain } = makeController({
      persistenceService: {
        async readWorkbookFileWithRecovery() {
          return {
            text: '<html>Recovered workbook</html>',
            savedAt: '2026-07-01T09:00:00.000Z',
            recoveredFromBackup: true,
            backupPath: '/tmp/workbook.html.bak',
            warning: 'Recovered from backup.'
          };
        },
        async safeWriteWorkbookFile(filePath, html, options) {
          writeOptions.push(options);
          return { savedAt: '2026-07-01T11:00:00.000Z', backupPath: '' };
        }
      }
    });
    controller.setActiveWorkbookPath('/tmp/workbook.html');

    await expect(getFileHandler(ipcMain, 'cavalry-files:get-active')()).resolves.toMatchObject({
      ok: true,
      recoveredFromBackup: true,
      backupFileName: 'workbook.html.bak',
      text: '<html>Recovered workbook</html>'
    });
    await invokeFileHandler(ipcMain, 'cavalry-files:save-active', {
      html: '<html>Recovered workbook</html>'
    });
    expect(writeOptions).toEqual([{ skipBackup: true }]);
  });
});
