import { describe, expect, it, vi } from 'vitest';

import { createTauriLifecycleBridge } from '../../src/renderer/platform/tauri-lifecycle.js';
import { createTauriUpdateBridge } from '../../src/renderer/platform/tauri-updates.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nativeFixture(update = null) {
  const events = new Map();
  const native = {
    core: { invoke: vi.fn(async () => {}) },
    dialog: { message: vi.fn(async () => {}) },
    event: {
      listen: vi.fn(async (name, callback) => {
        events.set(name, callback);
        return () => events.delete(name);
      })
    },
    updater: { check: vi.fn(async () => update) }
  };
  return { native, events, getTauri: () => native };
}

describe('durable workbook lifecycle', () => {
  it('waits for the latest save before acknowledging a native quit', async () => {
    const fixture = nativeFixture();
    const save = deferred();
    const lifecycle = createTauriLifecycleBridge(fixture);
    const guard = vi.fn(() => save.promise);
    lifecycle.onBeforeExit(guard);
    await lifecycle.start();
    fixture.events.get('cavalry-before-exit')();
    expect(guard).toHaveBeenCalledWith({ reason: 'quit' });
    expect(fixture.native.core.invoke).not.toHaveBeenCalledWith('complete_exit', { allow: true });
    save.resolve({ ok: true });
    await vi.waitFor(() =>
      expect(fixture.native.core.invoke).toHaveBeenCalledWith('complete_exit', { allow: true })
    );
  });

  it('keeps the workbook open and explains a failed quit save', async () => {
    const fixture = nativeFixture();
    const lifecycle = createTauriLifecycleBridge(fixture);
    lifecycle.onBeforeExit(async () => ({ ok: false, error: 'The disk is full.' }));
    await lifecycle.start();
    fixture.events.get('cavalry-before-exit')();
    await vi.waitFor(() =>
      expect(fixture.native.core.invoke).toHaveBeenCalledWith('complete_exit', { allow: false })
    );
    expect(fixture.native.core.invoke).not.toHaveBeenCalledWith('complete_exit', { allow: true });
    expect(fixture.native.dialog.message).toHaveBeenCalledWith(
      expect.stringContaining('The disk is full.'),
      expect.objectContaining({ kind: 'error' })
    );
  });

  it('blocks update and reload while workbook hydration has no save guard', async () => {
    const fixture = nativeFixture();
    const lifecycle = createTauriLifecycleBridge(fixture);
    await expect(lifecycle.prepareToExit('update')).rejects.toThrow('still opening');
    const dispose = lifecycle.onBeforeExit(async () => ({ ok: true }));
    await lifecycle.start();
    await expect(lifecycle.prepareToExit('reload')).resolves.toEqual({ ok: true });
    dispose();
    await expect(lifecycle.prepareToExit('reload')).rejects.toThrow('still opening');
  });
});

describe('update installation save barrier', () => {
  it('waits before installation and saves again before relaunch', async () => {
    const firstSave = deferred();
    const finalSave = deferred();
    const update = { version: '2.2.8', install: vi.fn(async () => {}) };
    const fixture = nativeFixture(update);
    const beforeExit = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => finalSave.promise);
    const bridge = createTauriUpdateBridge({ ...fixture, enabled: true, beforeExit });
    await bridge.checkForUpdates();
    const restarting = bridge.restartAndInstall();
    const repeated = bridge.restartAndInstall();
    expect(repeated).toBe(restarting);
    expect(update.install).not.toHaveBeenCalled();
    firstSave.resolve({ ok: true });
    await vi.waitFor(() => expect(beforeExit).toHaveBeenCalledTimes(2));
    expect(update.install).toHaveBeenCalledOnce();
    expect(fixture.native.core.invoke).not.toHaveBeenCalled();
    finalSave.resolve({ ok: true });
    await expect(restarting).resolves.toMatchObject({ ok: true });
    expect(fixture.native.core.invoke).toHaveBeenCalledWith('relaunch_app');
  });

  it('does not install or relaunch on a save failure and leaves restart available', async () => {
    const update = { version: '2.2.8', install: vi.fn(async () => {}) };
    const fixture = nativeFixture(update);
    const beforeExit = vi.fn(async () => {
      throw new Error('The disk is full.');
    });
    const bridge = createTauriUpdateBridge({ ...fixture, enabled: true, beforeExit });
    await bridge.checkForUpdates();
    await expect(bridge.restartAndInstall()).resolves.toMatchObject({
      ok: false,
      error: 'The disk is full.',
      state: { status: 'ready' }
    });
    expect(update.install).not.toHaveBeenCalled();
    expect(fixture.native.core.invoke).not.toHaveBeenCalled();
  });

  it('retries saving without reinstalling when the final save failed', async () => {
    const update = { version: '2.2.8', install: vi.fn(async () => {}) };
    const fixture = nativeFixture(update);
    const beforeExit = vi
      .fn()
      .mockResolvedValue({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('Save interrupted.'));
    const bridge = createTauriUpdateBridge({ ...fixture, enabled: true, beforeExit });
    await bridge.checkForUpdates();
    await expect(bridge.restartAndInstall()).resolves.toMatchObject({ ok: false });
    expect(fixture.native.core.invoke).not.toHaveBeenCalled();
    await expect(bridge.restartAndInstall()).resolves.toMatchObject({ ok: true });
    expect(update.install).toHaveBeenCalledOnce();
    expect(fixture.native.core.invoke).toHaveBeenCalledOnce();
  });

  it('also protects updater implementations that install during download', async () => {
    const update = { version: '2.2.8', downloadAndInstall: vi.fn(async () => {}) };
    const fixture = nativeFixture(update);
    const bridge = createTauriUpdateBridge({ ...fixture, enabled: true });
    await bridge.checkForUpdates();
    await expect(bridge.downloadUpdate()).resolves.toMatchObject({ ok: false });
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });
});
