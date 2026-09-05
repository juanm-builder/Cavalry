import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  serializeWorkbookForSave,
  deserializeWorkbookFromFile
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
import { makeIncomeAndExpenseWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { createWorkbookRecoveryStore } from '../../src/host/workbook-recovery-store.mjs';

const directories = [];
const id = 'workbook-clock-ordering';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const html = (name) =>
  serializeWorkbookForSave({ ...makeIncomeAndExpenseWorkbook(), id, name }, { rejectInvalid: true })
    .html;
const book = (result) => deserializeWorkbookFromFile(result.text, { rejectInvalid: true }).workbook;
async function setup() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cavalry-recovery-ordering-'));
  directories.push(rootDir);
  const folder = path.join(rootDir, hash(id));
  const options = { rootDir };
  return {
    options,
    folder,
    store: createWorkbookRecoveryStore(options),
    snapshot: (text) => path.join(folder, `${hash(text)}.html`),
    ordering: path.join(folder, 'history.json')
  };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('durable workbook save ordering', () => {
  it('keeps the last acknowledged save after clock rollback with a full retention window', async () => {
    const { store, options, folder, snapshot } = await setup();
    for (let index = 0; index < 30; index += 1) await store.save(html(`Earlier ${index}`));
    const future = new Date(Date.now() + 60_000);
    for (const file of (await fs.readdir(folder)).filter((entry) => entry.endsWith('.html')))
      await fs.utimes(path.join(folder, file), future, future);
    const latest = html('Latest acknowledged edit');
    await expect(store.save(latest)).resolves.toMatchObject({ durable: true });
    expect(await fs.readFile(snapshot(latest), 'utf8')).toBe(latest);
    const restarted = createWorkbookRecoveryStore(options);
    expect(await restarted.load()).toMatchObject({ text: latest, recoveredFromHistory: false });
    const library = await restarted.list();
    expect(library[0].fileName).toBe('Latest acknowledged edit.html');
    expect((await restarted.open(library[0].id)).text).toBe(latest);
    expect((await fs.readdir(folder)).filter((file) => file.endsWith('.html'))).toHaveLength(30);
  });

  it('uses commit order when timestamps tie or an older distinct snapshot is saved again', async () => {
    const { store, options, snapshot } = await setup();
    const first = html('First content');
    const second = html('Second content');
    await store.save(first);
    await store.save(second);
    const tied = new Date('2026-01-01T00:00:00Z');
    await fs.utimes(snapshot(first), tied, tied);
    await fs.utimes(snapshot(second), tied, tied);
    expect((await createWorkbookRecoveryStore(options).load()).text).toBe(second);
    await store.save(first);
    await fs.utimes(snapshot(first), new Date(0), new Date(0));
    expect((await createWorkbookRecoveryStore(options).load()).text).toBe(first);
  });

  it.each(['missing', 'damaged'])(
    'opens %s ordering as a separate recovered copy and preserves originals',
    async (condition) => {
      const { store, options, ordering, snapshot } = await setup();
      const first = html('Original earlier');
      const second = html('Original later');
      await store.save(first);
      await store.save(second);
      if (condition === 'missing') await fs.rm(ordering);
      else await fs.writeFile(ordering, '{broken ordering');
      const restarted = createWorkbookRecoveryStore(options);
      const recovered = await restarted.load();
      expect(book(recovered).id).toMatch(/^workbook-recovered-/);
      expect(recovered).toMatchObject({ recoveredFromHistory: true });
      expect(recovered.warning).toContain('iCloud autosave is off');
      expect(await fs.readFile(snapshot(first), 'utf8')).toBe(first);
      expect(await fs.readFile(snapshot(second), 'utf8')).toBe(second);
      if (condition === 'damaged')
        expect(await fs.readFile(ordering, 'utf8')).toBe('{broken ordering');
      expect(book(await createWorkbookRecoveryStore(options).load()).id).toBe(book(recovered).id);
    }
  );

  it('keeps the acknowledged head when the next history commit fails and preserves the orphan', async () => {
    const { store, options, folder, snapshot } = await setup();
    const acknowledged = html('Acknowledged');
    const interrupted = html('Interrupted before history commit');
    await store.save(acknowledged);
    const failing = createWorkbookRecoveryStore({
      ...options,
      fileSystem: {
        ...fs,
        rename: async (...args) => {
          if (String(args[1]).endsWith('history.json')) throw new Error('history commit failed');
          return fs.rename(...args);
        }
      }
    });
    await expect(failing.save(interrupted)).rejects.toThrow('history commit failed');
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(snapshot(interrupted), future, future);
    expect((await createWorkbookRecoveryStore(options).load()).text).toBe(acknowledged);
    for (let index = 0; index < 35; index += 1) await store.save(html(`Subsequent ${index}`));
    expect((await createWorkbookRecoveryStore(options).load()).text).toBe(html('Subsequent 34'));
    expect(await fs.readFile(snapshot(interrupted), 'utf8')).toBe(interrupted);
    expect((await fs.readdir(folder)).filter((file) => file.endsWith('.html'))).toHaveLength(31);
  });

  it('recovers history separately when the explicitly committed current payload is missing', async () => {
    const { store, options, snapshot, ordering } = await setup();
    const earlier = html('Earlier acknowledged');
    const latest = html('Latest acknowledged');
    await store.save(earlier);
    await store.save(latest);
    const originalOrdering = await fs.readFile(ordering, 'utf8');
    await fs.rm(snapshot(latest));
    const recovered = await createWorkbookRecoveryStore(options).load();
    expect(book(recovered).id).toMatch(/^workbook-recovered-/);
    expect(book(recovered).name).toBe('Earlier acknowledged (Recovered)');
    expect(await fs.readFile(ordering, 'utf8')).toBe(originalOrdering);
    expect(await fs.readFile(snapshot(earlier), 'utf8')).toBe(earlier);
  });

  it('does not replace damaged ordering during an ordinary save', async () => {
    const { store, ordering, snapshot } = await setup();
    const acknowledged = html('Acknowledged before damage');
    await store.save(acknowledged);
    await fs.writeFile(ordering, '{broken ordering');
    await expect(store.save(html('Must not replace history'))).rejects.toThrow();
    expect(await fs.readFile(ordering, 'utf8')).toBe('{broken ordering');
    expect(await fs.readFile(snapshot(acknowledged), 'utf8')).toBe(acknowledged);
  });
});
