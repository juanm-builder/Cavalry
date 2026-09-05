import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deserializeWorkbookFromFile,
  serializeWorkbookForSave
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
import { makeIncomeAndExpenseWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import {
  createWorkbookRecoveryStore,
  nativeCloudKitRecoverySources
} from '../../src/host/workbook-recovery-store.mjs';
import { readCloudWorkbookAutoSyncPreference } from '../../src/renderer/app/cloud-workbook-sync-state.js';

const directories = [];
const digest = (text) => createHash('sha256').update(text).digest('hex');
const workbookHtml = (name) =>
  serializeWorkbookForSave({ ...makeIncomeAndExpenseWorkbook(), name }, { rejectInvalid: true })
    .html;
const workbook = (result) =>
  deserializeWorkbookFromFile(result.text, { rejectInvalid: true }).workbook;

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cavalry-owner-recovery-'));
  directories.push(directory);
  const home = path.join(directory, 'home');
  const userDataDir = path.join(home, 'Library', 'Application Support', 'Cavalry for Mac');
  const sources = nativeCloudKitRecoverySources(userDataDir, home);
  const options = { rootDir: path.join(userDataDir, 'Workbook Recovery'), ...sources };
  return { directory, home, userDataDir, sources, options };
}

async function writePayload(directory, text, filename = 'remote-record.html') {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, filename);
  await fs.writeFile(file, text);
  return file;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('local recovery from native account libraries', () => {
  it('discovers Production owners without adopting their work and preserves divergent copies of the same workbook', async () => {
    const { options, sources } = await setup();
    const store = createWorkbookRecoveryStore(options);
    const first = workbookHtml('Owner A edits');
    const second = workbookHtml('Owner B edits');
    const accounts = sources.ownerCacheRoots[0];
    const firstPath = await writePayload(path.join(accounts, digest('A'), 'payloads'), first);
    const secondPath = await writePayload(path.join(accounts, digest('B'), 'payloads'), second);
    // Even a future timestamp cannot hide another owner's earlier content.
    await fs.utimes(firstPath, new Date('2035-01-01'), new Date('2035-01-01'));
    await fs.utimes(secondPath, new Date('2020-01-01'), new Date('2020-01-01'));
    expect(await store.load()).toMatchObject({ empty: true });
    const library = await store.list();
    expect(library.map((entry) => entry.fileName)).toEqual([
      'Owner A edits (iCloud recovery)',
      'Owner B edits (iCloud recovery)'
    ]);
    expect(await store.load()).toMatchObject({ empty: true });
    const recoveredIds = new Set();
    for (const entry of library) {
      const opened = await createWorkbookRecoveryStore(options).open(entry.id);
      const recovered = workbook(opened);
      expect(recovered.id).toMatch(/^workbook-recovered-/);
      expect(recovered.name).toBe(entry.fileName.replace(' (iCloud recovery)', ' (Recovered)'));
      expect(opened).toMatchObject({ recovery: true, recoveredFromHistory: true, durable: true });
      expect(opened.warning).toContain('iCloud autosave is off');
      expect(readCloudWorkbookAutoSyncPreference(null, 'A', recovered.id)).toBe(false);
      expect(readCloudWorkbookAutoSyncPreference(null, 'B', recovered.id)).toBe(false);
      expect(workbook(await createWorkbookRecoveryStore(options).load()).id).toBe(recovered.id);
      recoveredIds.add(recovered.id);
    }
    expect(recoveredIds.size).toBe(2);
    expect(await fs.readFile(firstPath, 'utf8')).toBe(first);
    expect(await fs.readFile(secondPath, 'utf8')).toBe(second);
  });

  it('deduplicates identical contents across owners and migration caches without hiding a different local or cloud version', async () => {
    const { options, sources } = await setup();
    const current = workbookHtml('Current local work');
    const earlier = workbookHtml('Earlier cloud work');
    const store = createWorkbookRecoveryStore(options);
    await store.save(current);
    const accounts = sources.ownerCacheRoots[0];
    await writePayload(path.join(accounts, digest('A'), 'payloads'), earlier);
    await writePayload(path.join(accounts, digest('B'), 'payloads'), earlier);
    await writePayload(sources.legacyPayloadDirs[0], earlier);
    await writePayload(sources.legacyPayloadDirs[1], current);
    const library = await store.list();
    expect(library.map((entry) => entry.fileName)).toEqual([
      'Current local work.html',
      'Earlier cloud work (iCloud recovery)'
    ]);
    expect((await store.load()).text).toBe(current);
    // Removing one identical source does not invalidate the remaining copy.
    await fs.rm(path.join(sources.legacyPayloadDirs[0], 'remote-record.html'));
    const recovered = await store.open(library[1].id);
    expect(workbook(recovered).name).toBe('Earlier cloud work (Recovered)');
  });

  it('limits account traversal to real hashed owner directories and direct payload files', async () => {
    const { directory, options, sources } = await setup();
    const accounts = sources.ownerCacheRoots[0];
    const valid = path.join(accounts, digest('valid'), 'payloads');
    await writePayload(valid, workbookHtml('Allowed copy'));
    await writePayload(valid, 'corrupt', 'damaged.html');
    await writePayload(path.join(valid, 'nested'), workbookHtml('Nested file'));
    await writePayload(
      path.join(accounts, 'not-an-owner', 'payloads'),
      workbookHtml('Invalid owner')
    );
    await writePayload(
      path.join(accounts, 'nested', digest('hidden'), 'payloads'),
      workbookHtml('Nested owner')
    );

    const outsideOwner = path.join(directory, 'outside-owner');
    await writePayload(path.join(outsideOwner, 'payloads'), workbookHtml('Linked owner'));
    await fs.symlink(outsideOwner, path.join(accounts, digest('linked-owner')));
    const outsidePayloads = path.join(directory, 'outside-payloads');
    const outsideFile = await writePayload(outsidePayloads, workbookHtml('Linked payload'));
    const linkedPayloadOwner = path.join(accounts, digest('linked-payload'));
    await fs.mkdir(linkedPayloadOwner);
    await fs.symlink(outsidePayloads, path.join(linkedPayloadOwner, 'payloads'));
    await fs.symlink(outsideFile, path.join(valid, 'linked-file.html'));
    const linkedRoot = path.join(directory, 'linked-accounts');
    await fs.symlink(accounts, linkedRoot);
    const linkedLegacy = path.join(directory, 'linked-legacy');
    await fs.symlink(outsidePayloads, linkedLegacy);
    const store = createWorkbookRecoveryStore({
      ...options,
      ownerCacheRoots: [accounts, linkedRoot],
      legacyPayloadDirs: [linkedLegacy]
    });
    expect(await store.list()).toMatchObject([{ fileName: 'Allowed copy (iCloud recovery)' }]);
    expect(await store.list()).toHaveLength(1);
    expect(await fs.readFile(outsideFile, 'utf8')).toBe(workbookHtml('Linked payload'));
    expect(await fs.readFile(path.join(valid, 'damaged.html'), 'utf8')).toBe('corrupt');
  });

  it('does not follow a replaced owner symlink or open changed content using a stale library reference', async () => {
    const { directory, options, sources } = await setup();
    const accounts = sources.ownerCacheRoots[0];
    const owner = path.join(accounts, digest('A'));
    const original = workbookHtml('Original candidate');
    const target = await writePayload(path.join(owner, 'payloads'), original);
    const store = createWorkbookRecoveryStore(options);
    const [entry] = await store.list();
    await fs.writeFile(target, workbookHtml('Changed candidate'));
    await expect(store.open(entry.id)).rejects.toThrow('Choose an available iCloud recovery copy');
    expect(await store.load()).toMatchObject({ empty: true });
    await fs.writeFile(target, original);
    const movedOwner = path.join(directory, 'moved-owner');
    await fs.rename(owner, movedOwner);
    await fs.symlink(movedOwner, owner);
    await expect(store.open(entry.id)).rejects.toThrow('Choose an available iCloud recovery copy');
    expect(await store.list()).toEqual([]);
    expect(await fs.readFile(path.join(movedOwner, 'payloads', 'remote-record.html'), 'utf8')).toBe(
      original
    );
  });

  it('never enables real cloud discovery for an isolated host data directory or scans Development owners', async () => {
    const { directory, home, options, sources } = await setup();
    await writePayload(
      path.join(sources.ownerCacheRoots[0], digest('A'), 'payloads'),
      workbookHtml('Production copy')
    );
    const cloudKit = path.dirname(sources.legacyPayloadDirs[1]);
    await writePayload(
      path.join(cloudKit, 'accounts', digest('dev'), 'payloads'),
      workbookHtml('Development account')
    );
    const isolatedSources = nativeCloudKitRecoverySources(
      path.join(directory, 'isolated-data'),
      home
    );
    expect(isolatedSources).toEqual({ legacyPayloadDirs: [], ownerCacheRoots: [] });
    const isolated = createWorkbookRecoveryStore({
      rootDir: path.join(directory, 'isolated-recovery'),
      ...isolatedSources
    });
    expect(await isolated.list()).toEqual([]);
    expect(await createWorkbookRecoveryStore(options).list()).toMatchObject([
      { fileName: 'Production copy (iCloud recovery)' }
    ]);
    expect(await createWorkbookRecoveryStore(options).list()).toHaveLength(1);
  });
});
