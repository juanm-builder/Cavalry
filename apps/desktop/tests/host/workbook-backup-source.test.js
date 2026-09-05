import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloneFixture,
  makeMinimalWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import {
  deserializeWorkbookFromFile,
  serializeWorkbookForSave
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
import { createWorkbookRecoveryStore } from '../../src/host/workbook-recovery-store.mjs';

const { createWorkbookFileController } = createRequire(import.meta.url)(
  '../../src/host/workbook-file-controller.cjs'
);
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cavalry-backup-source-'));
  directories.push(root);
  const primary = path.join(root, 'plan.html');
  const current = {
    ...cloneFixture(makeMinimalWorkbook()),
    id: 'same-cloud-workbook',
    name: 'Current acknowledged work'
  };
  const earlier = { ...current, name: 'Earlier export' };
  await fs.writeFile(primary, 'damaged workbook');
  await fs.writeFile(
    `${primary}.bak`,
    serializeWorkbookForSave(earlier, { rejectInvalid: true }).html
  );
  const recovery = createWorkbookRecoveryStore({ rootDir: path.join(root, 'recovery') });
  const recover = vi.spyOn(recovery, 'recover');
  const handlers = new Map();
  const controller = createWorkbookFileController({
    app: { getPath: () => root },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertTrustedSender: () => {},
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [primary] }) },
    recoveryStore: recovery
  });
  controller.setActiveWorkbookPath(primary);
  controller.registerFileHandlers();
  return { primary, current, earlier, recovery, recover, controller, handlers };
}

describe('linked backup selection during startup', () => {
  it('uses the current durable workbook before an older linked backup can change selection', async () => {
    const state = await fixture();
    await state.recovery.save(
      serializeWorkbookForSave(state.current, { rejectInvalid: true }).html
    );
    const loaded = await state.controller.getActiveWorkbookFile();
    expect(deserializeWorkbookFromFile(loaded.text).workbook).toMatchObject(state.current);
    expect(state.recover).not.toHaveBeenCalled();
    expect(state.controller.getActiveWorkbookPath()).toBe('');
    expect(await state.recovery.list()).toHaveLength(1);
    expect(await fs.readFile(state.primary, 'utf8')).toBe('damaged workbook');
    expect(
      deserializeWorkbookFromFile(await fs.readFile(`${state.primary}.bak`, 'utf8')).workbook.name
    ).toBe(state.earlier.name);
  });

  it('forks the backup only when no durable workbook exists', async () => {
    const state = await fixture();
    const loaded = await state.controller.getActiveWorkbookFile();
    expect(deserializeWorkbookFromFile(loaded.text).workbook.id).toMatch(/^workbook-recovered-/);
    expect(state.recover).toHaveBeenCalledOnce();
    expect(state.controller.getActiveWorkbookPath()).toBe('');
  });

  it('preserves selection when recovery cannot be read instead of falling through to the backup', async () => {
    const state = await fixture();
    vi.spyOn(state.recovery, 'load').mockRejectedValueOnce(new Error('Recovery access failed'));
    await expect(state.controller.getActiveWorkbookFile()).rejects.toThrow(
      'Recovery access failed'
    );
    expect(state.recover).not.toHaveBeenCalled();
    expect(state.controller.getActiveWorkbookPath()).toBe(state.primary);
  });

  it('honors an intentionally cleared selection without resurrecting its linked backup', async () => {
    const state = await fixture();
    await state.recovery.clear();
    expect(await state.controller.getActiveWorkbookFile()).toMatchObject({
      empty: true,
      cleared: true
    });
    expect(state.recover).not.toHaveBeenCalled();
    expect(state.controller.getActiveWorkbookPath()).toBe('');
  });

  it('still forks a backup when the user explicitly opens that file', async () => {
    const state = await fixture();
    await state.recovery.save(
      serializeWorkbookForSave(state.current, { rejectInvalid: true }).html
    );
    const opened = await state.handlers.get('cavalry-files:open')(null);
    expect(deserializeWorkbookFromFile(opened.text).workbook.id).toMatch(/^workbook-recovered-/);
    expect(state.recover).toHaveBeenCalledOnce();
    expect(await state.recovery.list()).toHaveLength(2);
  });
});
