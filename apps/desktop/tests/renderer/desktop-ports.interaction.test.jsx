import { createWorkbook, serializeWorkbookForSave } from '@cavalry/finance-core';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopRendererPorts } from '../../src/renderer/platform/desktop-ports.js';

function workbookFixture() {
  let sequence = 0;
  return createWorkbook(
    { id: 'wb-port-test', name: 'Port Test' },
    {
      now: () => '2026-07-10T04:00:00.000Z',
      createId: (prefix) => `${prefix}_${++sequence}`
    }
  );
}

function portableWorkbook() {
  return serializeWorkbookForSave(workbookFixture()).html;
}

describe('desktop renderer ports', () => {
  it('decodes recovered native workbooks and preserves the recovery warning', async () => {
    const ports = createDesktopRendererPorts({
      cavalryFiles: {
        async getActiveWorkbookFile() {
          return {
            ok: true,
            text: portableWorkbook(),
            fileName: 'plan.html',
            savedAt: '2026-07-10T04:00:00.000Z',
            recoveredFromBackup: true,
            backupFileName: 'plan.html.bak',
            warning: 'Recovered from backup.'
          };
        }
      }
    });

    await expect(ports.workbookStorage.load()).resolves.toMatchObject({
      status: 'loaded',
      workbook: { id: 'wb-port-test' },
      file: {
        recoveredFromBackup: true,
        backupFileName: 'plan.html.bak'
      },
      warnings: [expect.objectContaining({ code: 'workbook.backup_recovered' })]
    });
  });

  it('keeps a canceled native picker distinct from an empty workbook state', async () => {
    const ports = createDesktopRendererPorts({
      cavalryFiles: {
        openWorkbookFile: async () => ({ ok: false, canceled: true })
      }
    });

    await expect(ports.workbookStorage.open()).resolves.toMatchObject({
      status: 'canceled',
      source: 'native'
    });
  });

  it('treats no selected native workbook as startup state rather than a load failure', async () => {
    const ports = createDesktopRendererPorts({
      cavalryFiles: {
        getActiveWorkbookFile: async () => ({ ok: false, empty: true, fileName: '' })
      }
    });

    await expect(ports.workbookStorage.load()).resolves.toEqual({
      status: 'empty',
      source: 'native',
      error: ''
    });
  });

  it('skips repeated native serialization after needsFile and retries after file changes', async () => {
    const activeSaves = [];
    const saveAs = vi.fn(async () => ({ ok: true, savedAt: '2026-07-10T04:00:00.000Z' }));
    const forget = vi.fn(async () => ({ ok: true }));
    const ports = createDesktopRendererPorts({
      cavalryFiles: {
        getActiveWorkbookFile: async () => ({ ok: false, empty: true }),
        saveActiveWorkbook: async (payload) => {
          activeSaves.push(payload);
          if (activeSaves.length === 1) {
            return { ok: false, needsFile: true, error: 'No workbook file selected.' };
          }
          return { ok: true, savedAt: '2026-07-10T04:01:00.000Z' };
        },
        saveWorkbookAs: saveAs,
        forgetActiveWorkbookFile: forget
      }
    });
    const workbook = workbookFixture();

    await expect(ports.workbookStorage.save(workbook)).resolves.toMatchObject({
      ok: false,
      needsFile: true
    });
    await expect(ports.workbookStorage.save(workbook)).resolves.toMatchObject({
      ok: false,
      needsFile: true
    });
    expect(activeSaves).toHaveLength(1);

    await expect(ports.workbookStorage.saveAs(workbook, 'plan.html')).resolves.toMatchObject({
      ok: true
    });
    await expect(ports.workbookStorage.save(workbook)).resolves.toMatchObject({ ok: true });
    expect(activeSaves).toHaveLength(2);

    await ports.workbookStorage.forget();
    await expect(ports.workbookStorage.save(workbook)).resolves.toMatchObject({
      ok: false,
      needsFile: true
    });
    expect(activeSaves).toHaveLength(2);
  });

  it('lists renderer-safe recent files and opens one through its opaque identifier', async () => {
    const calls = [];
    const ports = createDesktopRendererPorts({
      cavalryFiles: {
        async listRecentWorkbooks() {
          return {
            ok: true,
            workbooks: [
              {
                id: 'recent-1',
                fileName: 'plan.html',
                folderName: 'Finances',
                lastUsedAt: '2026-07-10T05:00:00.000Z',
                savedAt: '2026-07-10T04:00:00.000Z',
                filePath: '/private/Finances/plan.html'
              }
            ]
          };
        },
        async openRecentWorkbook(payload) {
          calls.push(payload);
          return {
            ok: true,
            text: portableWorkbook(),
            fileName: 'plan.html',
            savedAt: '2026-07-10T04:00:00.000Z'
          };
        }
      }
    });

    await expect(ports.workbookStorage.listRecent()).resolves.toEqual({
      ok: true,
      error: '',
      workbooks: [
        {
          id: 'recent-1',
          fileName: 'plan.html',
          folderName: 'Finances',
          lastUsedAt: '2026-07-10T05:00:00.000Z',
          savedAt: '2026-07-10T04:00:00.000Z'
        }
      ]
    });
    await expect(ports.workbookStorage.openRecent('recent-1')).resolves.toMatchObject({
      status: 'loaded',
      workbook: { id: 'wb-port-test' },
      file: { fileName: 'plan.html' }
    });
    expect(calls).toEqual([{ id: 'recent-1' }]);
  });

  it('distinguishes missing recent files from temporary read failures', async () => {
    let attempt = 0;
    const ports = createDesktopRendererPorts({
      cavalryFiles: {
        async openRecentWorkbook() {
          attempt += 1;
          return attempt === 1
            ? { ok: false, missing: true, error: 'The workbook was moved.' }
            : { ok: false, missing: false, error: 'Permission denied.' };
        }
      }
    });

    await expect(ports.workbookStorage.openRecent('recent-1')).resolves.toMatchObject({
      status: 'missing',
      error: 'The workbook was moved.'
    });
    await expect(ports.workbookStorage.openRecent('recent-1')).resolves.toMatchObject({
      status: 'error',
      error: 'Permission denied.'
    });
  });

  it('serializes uploads and validates downloaded cloud workbooks', async () => {
    const uploadCalls = [];
    const profileCalls = [];
    const ports = createDesktopRendererPorts({
      cavalryCloud: {
        async uploadWorkbook(payload) {
          uploadCalls.push(payload);
          return { ok: true };
        },
        async updateProfile(payload) {
          profileCalls.push(payload);
          return { ok: true, profile: { name: payload.name } };
        },
        async downloadWorkbook() {
          return {
            ok: true,
            portableHtml: portableWorkbook(),
            metadata: { id: 'wb-port-test', revision: 3 }
          };
        }
      }
    });
    const downloaded = await ports.cloud.invoke('downloadWorkbook', {
      workbookId: 'wb-port-test'
    });
    expect(downloaded).toMatchObject({
      ok: true,
      workbook: { id: 'wb-port-test', name: 'Port Test' },
      metadata: { revision: 3 }
    });
    expect(downloaded.portableHtml).toBeUndefined();

    await expect(
      ports.cloud.invoke('uploadWorkbook', {
        workbook: downloaded.workbook,
        expectedRevision: 3
      })
    ).resolves.toEqual({ ok: true });
    expect(uploadCalls[0]).toMatchObject({
      localWorkbookId: 'wb-port-test',
      name: 'Port Test',
      schemaVersion: 2,
      expectedRevision: 3
    });
    expect(uploadCalls[0].portableHtml).toContain('ledger-grove-export');
    expect(uploadCalls[0]).not.toHaveProperty('workbook');

    await expect(ports.cloud.invoke('updateProfile', { name: 'Alex Example' })).resolves.toEqual({
      ok: true,
      profile: { name: 'Alex Example' }
    });
    expect(profileCalls).toEqual([{ name: 'Alex Example' }]);
  });

  it('keeps cloud bridge failures behind a stable renderer port', async () => {
    const ports = createDesktopRendererPorts({
      cavalryCloud: {
        getState: async () => {
          throw new Error('offline');
        }
      }
    });

    await expect(ports.cloud.invoke('getState')).resolves.toEqual({
      ok: false,
      error: 'offline'
    });
    await expect(ports.cloud.invoke('deleteWorkbook')).resolves.toMatchObject({
      ok: false,
      unavailable: true
    });
  });

  it('adapts the narrow cloud feedback bridge without exposing Cloud auth state', async () => {
    const calls = [];
    const ports = createDesktopRendererPorts({
      cavalryCloud: {
        listFeedbackReports: async () => ({ ok: true, reports: [{ id: 'report-1' }] }),
        submitFeedbackReport: async (payload) => {
          calls.push(['submit', payload]);
          return { ok: true, report: { id: 'report-2', ...payload } };
        },
        getFeedbackAttachment: async (payload) => {
          calls.push(['download', payload]);
          return {
            ok: true,
            attachment: {
              id: payload.attachmentId,
              mimeType: 'image/png',
              dataUrl: 'data:image/png;base64,AA=='
            }
          };
        }
      }
    });

    await expect(ports.feedback.invoke('list')).resolves.toMatchObject({
      ok: true,
      reports: [{ id: 'report-1' }]
    });
    await expect(
      ports.feedback.invoke('submit', {
        kind: 'bug',
        description: 'Something broke.',
        source: 'assistant'
      })
    ).resolves.toMatchObject({ ok: true, report: { id: 'report-2', kind: 'bug' } });
    await expect(
      ports.feedback.invoke('download', { attachmentId: 'attachment-1' })
    ).resolves.toMatchObject({
      ok: true,
      attachment: { id: 'attachment-1', dataUrl: expect.stringContaining('data:image/png') }
    });
    expect(calls).toEqual([
      ['submit', { kind: 'bug', description: 'Something broke.', source: 'assistant' }],
      ['download', { attachmentId: 'attachment-1' }]
    ]);
    await expect(ports.feedback.invoke('unknown')).resolves.toMatchObject({
      ok: false,
      unavailable: true
    });
  });

  it('does not publish or retain a workbook over IPC when Companion is disabled', async () => {
    const getStatus = vi.fn(async () => ({ ok: true, status: { enabled: false } }));
    const publishWorkbook = vi.fn(async () => ({ ok: true }));
    const ports = createDesktopRendererPorts({
      cavalryCompanion: { getStatus, publishWorkbook }
    });

    await expect(
      ports.companion.publish({ workbook: { id: 'private-workbook' } })
    ).resolves.toEqual({ ok: false, disabled: true });
    await ports.companion.publish({ workbook: { id: 'newer-private-workbook' } });

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(publishWorkbook).not.toHaveBeenCalled();
  });

  it('adapts the narrow updater bridge and disposes state subscriptions', async () => {
    const calls = [];
    let stateListener;
    let disposed = false;
    const ports = createDesktopRendererPorts({
      cavalryUpdates: {
        getState: async () => ({ enabled: true, status: 'available', version: '1.0.19' }),
        checkForUpdates: async () => {
          calls.push('checkForUpdates');
          return { ok: true };
        },
        downloadUpdate: async () => {
          calls.push('downloadUpdate');
          return { ok: true };
        },
        restartAndInstall: async () => {
          calls.push('restartAndInstall');
          return { ok: true };
        },
        onStateChanged(callback) {
          stateListener = callback;
          return () => {
            disposed = true;
          };
        }
      }
    });

    await expect(ports.updates.invoke('getState')).resolves.toMatchObject({
      status: 'available',
      version: '1.0.19'
    });
    await ports.updates.invoke('checkForUpdates');
    await ports.updates.invoke('downloadUpdate');
    await ports.updates.invoke('restartAndInstall');
    expect(calls).toEqual(['checkForUpdates', 'downloadUpdate', 'restartAndInstall']);

    const received = [];
    const dispose = ports.updates.subscribe((state) => received.push(state));
    stateListener({ status: 'downloading', percent: 38 });
    expect(received).toEqual([{ status: 'downloading', percent: 38 }]);
    dispose();
    expect(disposed).toBe(true);
  });

  it('keeps updates safely disabled without a desktop bridge', async () => {
    const ports = createDesktopRendererPorts({});

    await expect(ports.updates.invoke('getState')).resolves.toMatchObject({
      ok: false,
      unavailable: true,
      state: { enabled: false, status: 'disabled' }
    });
  });
});
