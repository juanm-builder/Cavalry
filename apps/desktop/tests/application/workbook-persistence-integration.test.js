import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deserializeWorkbookFromFile } from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
import {
  readWorkbookFileWithRecovery,
  safeWriteWorkbook,
  safeWriteWorkbookFile
} from '../../src/host/workbook-file-persistence.mjs';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cavalry-workbook-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('workbook persistence integration', () => {
  it('serializes overlapping saves to one workbook while preserving its rolling backup', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'overlapping.html');
    await writeFile(filePath, 'original', 'utf8');
    let releaseFirst;
    const firstBlocked = new Promise((resolve) => (releaseFirst = resolve));
    let firstReady;
    const firstStarted = new Promise((resolve) => (firstReady = resolve));
    const first = safeWriteWorkbookFile(filePath, 'first', {
      beforeRename: async () => {
        firstReady();
        await firstBlocked;
      }
    });
    await firstStarted;
    const second = safeWriteWorkbookFile(filePath, 'second');
    const third = safeWriteWorkbookFile(filePath, 'third');
    try {
      // Saving another workbook must not wait for the blocked save.
      await safeWriteWorkbookFile(path.join(dir, 'independent.html'), 'independent');
      expect(await readFile(filePath, 'utf8')).toBe('original');
    } finally {
      releaseFirst();
    }

    await Promise.all([first, second, third]);
    expect(await readFile(filePath, 'utf8')).toBe('third');
    expect(await readFile(`${filePath}.bak`, 'utf8')).toBe('second');
    await expect(readFile(`${filePath}.tmp`, 'utf8')).rejects.toThrow();
  });

  it('continues queued saves after a previous write fails', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'queued-after-failure.html');
    await writeFile(filePath, 'original', 'utf8');
    const failed = safeWriteWorkbookFile(filePath, 'failed', {
      beforeRename: () => {
        throw new Error('simulated disk failure');
      }
    });
    const succeeded = safeWriteWorkbookFile(filePath, 'saved');

    await expect(failed).rejects.toThrow('simulated disk failure');
    await expect(succeeded).resolves.toMatchObject({ ok: true });
    expect(await readFile(filePath, 'utf8')).toBe('saved');
    expect(await readFile(`${filePath}.bak`, 'utf8')).toBe('original');
  });

  it('safe-writes workbook files and creates a deterministic rolling backup before overwrite', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'family.html');
    const firstWorkbook = makeMinimalWorkbook();
    const secondWorkbook = Object.assign(cloneFixture(firstWorkbook), {
      name: 'Renamed Family Workbook'
    });

    const firstWrite = await safeWriteWorkbook(filePath, firstWorkbook);
    const secondWrite = await safeWriteWorkbook(filePath, secondWorkbook);
    const currentText = await readFile(filePath, 'utf8');
    const backupText = await readFile(`${filePath}.bak`, 'utf8');

    expect(firstWrite.backupPath).toBe('');
    expect(secondWrite.backupPath).toBe(`${filePath}.bak`);
    expect(currentText).toContain('Renamed Family Workbook');
    expect(backupText).toContain('Minimal Workbook');
    expect(deserializeWorkbookFromFile(backupText).workbook.name).toBe('Minimal Workbook');
    expect(deserializeWorkbookFromFile(currentText).workbook.name).toBe('Renamed Family Workbook');
  });

  it('does not corrupt an existing workbook when a write fails before rename', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'safe.html');
    const original = '<!doctype html><title>Original Workbook</title>';
    await writeFile(filePath, original, 'utf8');

    await expect(
      safeWriteWorkbookFile(filePath, '<!doctype html><title>Broken Write</title>', {
        beforeRename: () => {
          throw new Error('simulated disk failure');
        }
      })
    ).rejects.toThrow('simulated disk failure');

    await expect(readFile(`${filePath}.tmp`, 'utf8')).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(original);
    expect(await readFile(`${filePath}.bak`, 'utf8')).toBe(original);
  });

  it('can recover by loading the backup left by the previous successful version', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'recovery.html');
    const before = makeIncomeAndExpenseWorkbook();
    const after = Object.assign(cloneFixture(before), {
      id: 'wb-after-save',
      name: 'After Save Workbook'
    });

    await safeWriteWorkbook(filePath, before);
    await safeWriteWorkbook(filePath, after);

    const recovered = deserializeWorkbookFromFile(await readFile(`${filePath}.bak`, 'utf8'));
    const current = deserializeWorkbookFromFile(await readFile(filePath, 'utf8'));

    expect(recovered.workbook.id).toBe(before.id);
    expect(recovered.workbook.transactions.map((transaction) => transaction.id)).toEqual(
      before.transactions.map((transaction) => transaction.id)
    );
    expect(current.workbook.id).toBe('wb-after-save');
  });

  it('loads a valid rolling backup and preserves it during the recovery save', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'corrupt-primary.html');
    const before = makeIncomeAndExpenseWorkbook();
    const after = Object.assign(cloneFixture(before), {
      id: 'wb-after-save',
      name: 'After Save Workbook'
    });
    await safeWriteWorkbook(filePath, before);
    await safeWriteWorkbook(filePath, after);
    await writeFile(filePath, '<html><body>corrupt active workbook</body></html>', 'utf8');

    const recovered = await readWorkbookFileWithRecovery(filePath);
    expect(recovered.recoveredFromBackup).toBe(true);
    expect(recovered.decoded.workbook.id).toBe(before.id);

    await safeWriteWorkbookFile(filePath, recovered.text, { skipBackup: true });
    expect(deserializeWorkbookFromFile(await readFile(filePath, 'utf8')).workbook.id).toBe(
      before.id
    );
    expect(deserializeWorkbookFromFile(await readFile(`${filePath}.bak`, 'utf8')).workbook.id).toBe(
      before.id
    );
  });

  it('rejects corrupt workbook text before any normalization step', () => {
    expect(() => deserializeWorkbookFromFile('<html><body>No payload</body></html>')).toThrow(
      'Cavalry workbook payload'
    );
    expect(() => deserializeWorkbookFromFile('')).toThrow('The selected file is empty.');
  });
});
