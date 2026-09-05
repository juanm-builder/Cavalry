import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  serializeWorkbookForSave,
  deserializeWorkbookFromFile
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
import { makeIncomeAndExpenseWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { createWorkbookRecoveryStore } from '../../src/host/workbook-recovery-store.mjs';
import { createWorkbookFileController } from '../../src/host/workbook-file-controller.cjs';
import * as persistence from '../../src/host/workbook-file-persistence.mjs';

const directories = [];
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cavalry-recovery-'));
  directories.push(directory);
  const options = { rootDir: path.join(directory, 'Workbook Recovery') };
  return { directory, options, store: createWorkbookRecoveryStore(options) };
}
const html = (overrides = {}) =>
  serializeWorkbookForSave(
    { ...makeIncomeAndExpenseWorkbook(), ...overrides },
    { rejectInvalid: true }
  ).html;
const book = (result) => deserializeWorkbookFromFile(result.text, { rejectInvalid: true }).workbook;
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('native workbook recovery across restart and update', () => {
  it('restores all financial data from a fresh store without browser storage or an export file', async () => {
    const { store, options } = await setup();
    await expect(store.save(html())).resolves.toMatchObject({ ok: true, durable: true });
    const restarted = createWorkbookRecoveryStore(options);
    expect(book(await restarted.load())).toMatchObject(makeIncomeAndExpenseWorkbook());
    expect(await restarted.list()).toHaveLength(1);
  });

  it('keeps every workbook discoverable after clearing selection and losing metadata', async () => {
    const { store, options } = await setup();
    for (let index = 0; index < 12; index += 1)
      await store.save(html({ id: `book-${index}`, name: `Book ${index}` }));
    await store.clear();
    expect(await createWorkbookRecoveryStore(options).load()).toMatchObject({ empty: true });
    expect(await store.list()).toHaveLength(12);
    await fs.writeFile(path.join(options.rootDir, 'active.json'), '{interrupted', 'utf8');
    const restarted = createWorkbookRecoveryStore(options);
    expect((await restarted.load()).ok).toBe(true);
    const library = await restarted.list();
    expect(library).toHaveLength(12);
    expect(
      book(await restarted.open(library.find((entry) => entry.fileName === 'Book 0.html').id)).id
    ).toBe('book-0');
  });

  it('recovers a previous verified revision without deleting damaged copies', async () => {
    const { store, options } = await setup();
    await store.save(html({ name: 'Before damage' }));
    await store.save(html({ name: 'Latest' }));
    const [key] = (await fs.readdir(options.rootDir)).filter((entry) => entry !== 'active.json');
    const folder = path.join(options.rootDir, key);
    for (const file of await fs.readdir(folder)) {
      if ((await fs.readFile(path.join(folder, file), 'utf8')).includes('Latest'))
        await fs.writeFile(path.join(folder, file), 'corrupt', 'utf8');
    }
    const result = await createWorkbookRecoveryStore(options).load();
    expect(book(result).name).toBe('Before damage (Recovered)');
    expect(book(result).id).toMatch(/^workbook-recovered-/);
    expect(result.warning).toContain('earlier verified copy');
    expect(await fs.readdir(folder)).toHaveLength(2);
  });

  it('fails visibly and retains an unreadable workbook in the library', async () => {
    const { store, options } = await setup();
    await store.save(html());
    const [key] = (await fs.readdir(options.rootDir)).filter((entry) => entry !== 'active.json');
    const folder = path.join(options.rootDir, key);
    const [file] = await fs.readdir(folder);
    await fs.writeFile(path.join(folder, file), 'corrupt', 'utf8');
    await expect(createWorkbookRecoveryStore(options).load()).rejects.toThrow(
      'Recovery copies have been kept'
    );
    expect(await store.list()).toMatchObject([{ fileName: 'Workbook needs recovery' }]);
    expect(await fs.readdir(folder)).toEqual([file]);
  });

  it('preserves the previous acknowledged workbook after a disk failure and accepts a later retry', async () => {
    const { store, options } = await setup();
    await store.save(html({ name: 'Acknowledged' }));
    let fail = true;
    const fileSystem = {
      ...fs,
      rename: async (...args) => {
        if (fail && String(args[1]).endsWith('.html')) throw new Error('disk full');
        return fs.rename(...args);
      }
    };
    const failing = createWorkbookRecoveryStore({ ...options, fileSystem });
    await expect(failing.save(html({ name: 'Not saved' }))).rejects.toThrow('disk full');
    expect(book(await store.load()).name).toBe('Acknowledged');
    fail = false;
    await failing.save(html({ name: 'Retry saved' }));
    expect(book(await store.load()).name).toBe('Retry saved');
  });

  it('retains a complete workbook when selection commit is interrupted', async () => {
    const { options } = await setup();
    const failing = createWorkbookRecoveryStore({
      ...options,
      fileSystem: {
        ...fs,
        rename: async (...args) => {
          if (String(args[1]).endsWith('active.json')) throw new Error('interrupted selection');
          return fs.rename(...args);
        }
      }
    });
    await expect(failing.save(html())).rejects.toThrow('interrupted selection');
    const restarted = createWorkbookRecoveryStore(options);
    expect(book(await restarted.load())).toMatchObject(makeIncomeAndExpenseWorkbook());
    expect(await restarted.list()).toHaveLength(1);
  });

  it('serializes overlapping edits and keeps thirty distinct copies without pruning other workbooks', async () => {
    const { store, options } = await setup();
    await store.save(html({ id: 'other-book' }));
    await Promise.all(
      Array.from({ length: 35 }, (_, index) => store.save(html({ name: `Edit ${index}` })))
    );
    expect(book(await createWorkbookRecoveryStore(options).load()).name).toBe('Edit 34');
    const folders = (await fs.readdir(options.rootDir)).filter((entry) => entry !== 'active.json');
    const counts = await Promise.all(
      folders.map(async (folder) => (await fs.readdir(path.join(options.rootDir, folder))).length)
    );
    expect(counts.sort((a, b) => a - b)).toEqual([1, 30]);
  });

  it('rejects malformed input and arbitrary recovery paths without replacing the saved workbook', async () => {
    const { store } = await setup();
    await store.save(html());
    await expect(store.save('<html>not a workbook</html>')).rejects.toThrow();
    await expect(store.open('recovery-../../secrets')).rejects.toThrow(
      'Invalid workbook recovery reference'
    );
    expect(book(await store.load())).toMatchObject(makeIncomeAndExpenseWorkbook());
  });

  it('discovers a previous-version native iCloud payload without adopting or altering it', async () => {
    const { directory, options } = await setup();
    const legacy = path.join(directory, 'old-native-cache');
    await fs.mkdir(legacy);
    const original = html({ id: 'old-cloud-workbook', name: 'Previous version workbook' });
    await fs.writeFile(path.join(legacy, 'remote-record-12.html'), original);
    await fs.writeFile(path.join(legacy, 'broken.html'), 'unreadable');
    const store = createWorkbookRecoveryStore({ ...options, legacyPayloadDirs: [legacy] });
    expect(await store.load()).toMatchObject({ empty: true });
    const library = await store.list();
    expect(library).toMatchObject([{ fileName: 'Previous version workbook (iCloud recovery)' }]);
    const recovered = await store.open(library[0].id);
    expect(book(recovered).id).toMatch(/^workbook-recovered-/);
    expect(book(recovered).name).toBe('Previous version workbook (Recovered)');
    expect(await fs.readFile(path.join(legacy, 'remote-record-12.html'), 'utf8')).toBe(original);
    expect(await fs.readFile(path.join(legacy, 'broken.html'), 'utf8')).toBe('unreadable');
  });

  it('rejects a different workbook at a linked export path and preserves both books across restart', async () => {
    const { directory, store } = await setup();
    const filePath = path.join(directory, 'original.html');
    await persistence.safeWriteWorkbookFile(filePath, html({ id: 'original' }));
    const handlers = new Map();
    const controller = createWorkbookFileController({
      app: { getPath: () => directory },
      recoveryStore: store,
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      getWorkbookPersistenceService: async () => persistence,
      assertTrustedSender: () => {},
      shell: {},
      dialog: {}
    });
    controller.registerFileHandlers();
    controller.setActiveWorkbookPath(filePath);
    await store.save(html({ id: 'new-book' }));
    const result = await handlers.get('cavalry-files:save-active')(null, {
      html: html({ id: 'new-book' })
    });
    expect(result).toMatchObject({ ok: false, needsFile: true });
    expect(deserializeWorkbookFromFile(await fs.readFile(filePath, 'utf8')).workbook.id).toBe(
      'original'
    );
    expect(book(await store.load()).id).toBe('new-book');
    const library = await handlers.get('cavalry-files:list-recent')(null);
    expect(library.workbooks[0].folderName).toBe('Saved on this Mac');
  });

  it('opens a damaged linked file backup as a separate recovered workbook without overwriting its original or backup', async () => {
    const { directory, store } = await setup();
    const filePath = path.join(directory, 'original.html');
    await fs.writeFile(filePath, 'unreadable primary', 'utf8');
    const backup = html({ id: 'cloud-original' });
    await fs.writeFile(`${filePath}.bak`, backup, 'utf8');
    const handlers = new Map();
    const controller = createWorkbookFileController({
      app: { getPath: () => directory },
      recoveryStore: store,
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      getWorkbookPersistenceService: async () => persistence,
      assertTrustedSender: () => {},
      shell: {},
      dialog: {}
    });
    controller.registerFileHandlers();
    controller.setActiveWorkbookPath(filePath);
    const loaded = await handlers.get('cavalry-files:get-active')(null);
    expect(book(loaded).id).toMatch(/^workbook-recovered-/);
    expect(controller.getActiveWorkbookPath()).toBe('');
    expect(book(await store.load()).id).toBe(book(loaded).id);
    expect(await fs.readFile(filePath, 'utf8')).toBe('unreadable primary');
    expect(await fs.readFile(`${filePath}.bak`, 'utf8')).toBe(backup);
  });
});
