import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createCloudSyncStateStorage } = require('../../src/host/cloud-sync-state-storage.cjs');

const temporaryDirectories = [];

async function temporaryRoot() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cavalry-cloud-sync-state-'));
  temporaryDirectories.push(directory);
  return directory;
}

function scope(overrides = {}) {
  return {
    cloudEnvironment: 'Production',
    accountId: '_icloud-account-1',
    workbookId: 'workbook-1',
    ...overrides
  };
}

function syncState(name = 'Confirmed copy', revision = 4) {
  return {
    version: 1,
    revision,
    conflict: false,
    baseRevision: revision,
    baseWorkbook: {
      id: 'workbook-1',
      name,
      transactions: []
    }
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true }))
  );
});

describe('durable cloud sync state storage', () => {
  it('durably disables autosave for a newly encountered owner without exposing the other library', async () => {
    const rootDir = await temporaryRoot();
    const first = createCloudSyncStateStorage({ rootDir });
    await first.save({
      ...scope(),
      syncState: syncState('Private account one workbook'),
      autoSyncEnabled: true
    });
    const original = await first.load(scope());
    const otherScope = scope({ accountId: '_icloud-account-2' });
    const second = createCloudSyncStateStorage({ rootDir });
    const incoming = await second.load(otherScope);
    expect(incoming).toMatchObject({
      ok: true,
      status: 'loaded',
      envelope: { accountId: '_icloud-account-2', autoSyncEnabled: false, syncState: null }
    });
    expect(JSON.stringify(incoming)).not.toContain('_icloud-account-1');
    expect(JSON.stringify(incoming)).not.toContain('Private account one workbook');
    expect(await second.load(scope())).toEqual(original);
    expect(await createCloudSyncStateStorage({ rootDir }).load(otherScope)).toEqual(incoming);
    await second.save({ ...otherScope, syncState: null, autoSyncEnabled: true });
    expect(await createCloudSyncStateStorage({ rootDir }).load(otherScope)).toMatchObject({
      envelope: { autoSyncEnabled: true }
    });
  });

  it('does not reuse a different workbook or environment as an account boundary', async () => {
    const rootDir = await temporaryRoot();
    const storage = createCloudSyncStateStorage({ rootDir });
    await storage.save({ ...scope(), syncState: syncState(), autoSyncEnabled: true });
    expect(
      await storage.load(scope({ accountId: '_icloud-account-2', workbookId: 'workbook-2' }))
    ).toEqual({ ok: true, status: 'missing', envelope: null });
    expect(
      await storage.load(scope({ accountId: '_icloud-account-2', cloudEnvironment: 'Development' }))
    ).toEqual({ ok: true, status: 'missing', envelope: null });
  });

  it('fails closed when another saved account envelope cannot be verified', async () => {
    const rootDir = await temporaryRoot();
    const storage = createCloudSyncStateStorage({ rootDir });
    await storage.save({ ...scope(), syncState: syncState(), autoSyncEnabled: true });
    const directory = path.join(rootDir, 'production', 'anchors');
    const [file] = await fs.readdir(directory);
    await fs.writeFile(path.join(directory, file), '{damaged');
    await expect(storage.load(scope({ accountId: '_icloud-account-2' }))).rejects.toMatchObject({
      code: 'cloud_sync_state_corrupt'
    });
    expect(await fs.readdir(directory)).toEqual([file]);
  });

  it('uses an opaque SHA-256 filename and private Application Support permissions', async () => {
    const rootDir = await temporaryRoot();
    const storage = createCloudSyncStateStorage({
      rootDir,
      now: () => '2026-08-31T12:00:00.000Z',
      createTempId: () => 'write-1'
    });

    await storage.save({
      ...scope(),
      syncState: syncState(),
      autoSyncEnabled: false
    });

    const directory = path.join(rootDir, 'production', 'anchors');
    const files = await fs.readdir(directory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(files[0]).not.toContain('workbook');
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(directory, files[0]))).mode & 0o777).toBe(0o600);

    const loaded = await storage.load(scope());
    expect(loaded).toMatchObject({
      ok: true,
      status: 'loaded',
      envelope: {
        version: 1,
        cloudEnvironment: 'Production',
        accountId: '_icloud-account-1',
        workbookId: 'workbook-1',
        autoSyncEnabled: false,
        syncState: { revision: 4, baseWorkbook: { name: 'Confirmed copy' } }
      }
    });
  });

  it('isolates development, production, account, and workbook scopes', async () => {
    const rootDir = await temporaryRoot();
    const storage = createCloudSyncStateStorage({ rootDir });
    const variants = [
      scope(),
      scope({ cloudEnvironment: 'Development' }),
      scope({ accountId: '_icloud-account-2' }),
      scope({ workbookId: 'workbook-2' })
    ];

    for (let index = 0; index < variants.length; index += 1) {
      const target = variants[index];
      await storage.save({
        ...target,
        syncState: {
          version: 1,
          revision: index + 1,
          conflict: false
        },
        autoSyncEnabled: true
      });
    }

    await expect(Promise.all(variants.map((target) => storage.load(target)))).resolves.toEqual(
      variants.map((_target, index) =>
        expect.objectContaining({
          ok: true,
          envelope: expect.objectContaining({
            syncState: expect.objectContaining({ revision: index + 1 })
          })
        })
      )
    );
  });

  it('keeps the previous atomic file when a replacement rename fails', async () => {
    const rootDir = await temporaryRoot();
    let rejectRename = false;
    const fileSystem = {
      ...fs,
      async rename(from, to) {
        if (rejectRename) {
          const error = new Error('disk unavailable');
          error.code = 'EIO';
          throw error;
        }
        return fs.rename(from, to);
      }
    };
    let sequence = 0;
    const storage = createCloudSyncStateStorage({
      rootDir,
      fs: fileSystem,
      createTempId: () => `write-${++sequence}`
    });
    await storage.save({ ...scope(), syncState: syncState('First'), autoSyncEnabled: true });
    rejectRename = true;

    await expect(
      storage.save({ ...scope(), syncState: syncState('Second'), autoSyncEnabled: true })
    ).rejects.toMatchObject({ code: 'EIO' });
    rejectRename = false;

    await expect(storage.load(scope())).resolves.toMatchObject({
      ok: true,
      envelope: { syncState: { baseWorkbook: { name: 'First' } } }
    });
    const files = await fs.readdir(path.join(rootDir, 'production', 'anchors'));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('.tmp');
  });

  it('rejects traversal, malformed envelopes, and oversize state', async () => {
    const rootDir = await temporaryRoot();
    const storage = createCloudSyncStateStorage({ rootDir, maximumBytes: 1024 });

    await expect(
      storage.save({
        ...scope({ workbookId: '../outside' }),
        syncState: null,
        autoSyncEnabled: true
      })
    ).rejects.toMatchObject({ code: 'cloud_sync_state_scope_invalid' });
    await expect(
      storage.save({
        ...scope(),
        syncState: { version: 1, revision: 'bad', conflict: false },
        autoSyncEnabled: true
      })
    ).rejects.toMatchObject({ code: 'cloud_sync_state_invalid' });
    await expect(
      storage.save({
        ...scope(),
        syncState: {
          version: 1,
          revision: 2,
          conflict: true,
          conflictRemoteRevision: 3
        },
        autoSyncEnabled: true
      })
    ).rejects.toMatchObject({ code: 'cloud_sync_state_invalid' });
    await expect(
      storage.save({
        ...scope(),
        syncState: null,
        autoSyncEnabled: 'yes'
      })
    ).rejects.toMatchObject({ code: 'cloud_sync_state_invalid' });
    await expect(
      storage.save({
        ...scope(),
        syncState: {
          ...syncState(),
          baseWorkbook: {
            ...syncState().baseWorkbook,
            notes: 'x'.repeat(2_000)
          }
        },
        autoSyncEnabled: true
      })
    ).rejects.toMatchObject({ code: 'cloud_sync_state_oversize' });
  });

  it('survives a new storage instance and removes only the hashed target', async () => {
    const rootDir = await temporaryRoot();
    const largeState = syncState('Large confirmed copy');
    largeState.baseWorkbook.notes = 'safe-data-'.repeat(600_000);
    const first = createCloudSyncStateStorage({ rootDir });
    await first.save({ ...scope(), syncState: largeState, autoSyncEnabled: true });

    const restarted = createCloudSyncStateStorage({ rootDir });
    await expect(restarted.load(scope())).resolves.toMatchObject({
      ok: true,
      envelope: {
        syncState: { baseWorkbook: { name: 'Large confirmed copy' } }
      }
    });
    await restarted.remove(scope());
    await expect(restarted.load(scope())).resolves.toEqual({
      ok: true,
      status: 'missing',
      envelope: null
    });
  });

  it('keeps headroom for a valid merge base larger than the 25 MiB CloudKit asset limit', async () => {
    const rootDir = await temporaryRoot();
    const nearBoundaryState = syncState('Near transport boundary');
    nearBoundaryState.baseWorkbook.notes = 'x'.repeat(25 * 1024 * 1024 + 1024);
    const storage = createCloudSyncStateStorage({ rootDir });

    await expect(
      storage.save({ ...scope(), syncState: nearBoundaryState, autoSyncEnabled: true })
    ).resolves.toMatchObject({ ok: true, status: 'saved' });
    await expect(storage.load(scope())).resolves.toMatchObject({
      ok: true,
      status: 'loaded',
      envelope: { syncState: { baseWorkbook: { name: 'Near transport boundary' } } }
    });
  });
});
