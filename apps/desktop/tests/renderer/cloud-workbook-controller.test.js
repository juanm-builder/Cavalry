import { describe, expect, it } from 'vitest';

import {
  buildCloudSettingsModel,
  normalizeCloudState
} from '../../src/renderer/app/use-cloud-workbook-controller.js';

describe('cloud workbook controller model', () => {
  it('normalizes only renderer-safe account and workbook metadata', () => {
    const state = normalizeCloudState({
      configured: true,
      status: 'signed_in',
      access_token: 'must-not-cross-the-bridge',
      user: {
        id: 'user-1',
        email: 'alex@example.com',
        name: 'Alex Example',
        avatar_url: 'ignored-alias'
      },
      workbooks: [
        {
          local_workbook_id: 'workbook-1',
          name: 'Home',
          year: 2026,
          currency: 'php',
          latest_revision: 4,
          updated_at: '2026-07-20T04:00:00.000Z',
          portable_html: '<secret>'
        }
      ]
    });

    expect(state).toEqual({
      configured: true,
      status: 'signed_in',
      user: {
        id: 'user-1',
        email: 'alex@example.com',
        name: 'Alex Example',
        avatarUrl: '',
        provider: 'icloud',
        providers: []
      },
      workbooks: [
        {
          id: 'workbook-1',
          name: 'Home',
          year: 2026,
          currency: 'PHP',
          revision: 4,
          updatedAt: '2026-07-20T04:00:00.000Z',
          conflict: false,
          pending: false
        }
      ],
      sessionGeneration: 0,
      sessionPersistence: false,
      pendingCount: 0,
      lastSyncAt: '',
      error: ''
    });
    expect(JSON.stringify(state)).not.toContain('must-not-cross');
    expect(JSON.stringify(state)).not.toContain('<secret>');
  });

  it('marks only an explicitly uploaded current workbook as linked', () => {
    const localOnly = buildCloudSettingsModel(
      { configured: true, status: 'signed_in', workbooks: [] },
      { id: 'workbook-1', name: 'Home' }
    );
    expect(localOnly.current).toMatchObject({
      workbookId: 'workbook-1',
      linked: false,
      status: 'local_only'
    });

    const linked = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [
          {
            id: 'workbook-1',
            name: 'Home',
            revision: 2,
            updatedAt: '2026-07-20T04:00:00.000Z'
          }
        ]
      },
      { id: 'workbook-1', name: 'Home' },
      { pendingOperation: 'upload' }
    );
    expect(linked.current).toMatchObject({
      linked: true,
      revision: 2,
      status: 'uploading',
      cloudUpdatedAt: '2026-07-20T04:00:00.000Z'
    });
  });

  it('preserves a compact conflict notice for the current workbook without latching this Mac', () => {
    const notice = {
      id: 'conflict-1',
      sourceDevice: 'iPhone',
      resolutionAvailable: true,
      detectedAt: '2026-08-30T01:00:00.000Z',
      baseRevision: 3,
      remoteRevision: 4,
      summary: '1 change needs review',
      report: {
        version: 1,
        workbookId: 'workbook-1',
        workbookName: 'Home',
        conflictCount: 1,
        omittedCount: 0,
        entries: [
          {
            key: 'tx-1',
            path: 'transactions["tx-1"]',
            kind: 'same_record_changed',
            section: 'Transactions',
            title: 'Groceries',
            message: 'Both copies changed this item differently.',
            local: {
              label: 'This iPhone',
              action: 'edited',
              details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 650' }]
            },
            remote: {
              label: 'iCloud copy',
              action: 'edited',
              details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 700' }]
            }
          }
        ]
      }
    };
    const model = buildCloudSettingsModel(
      {
        configured: true,
        status: 'signed_in',
        workbooks: [{ id: 'workbook-1', name: 'Home', revision: 4, conflictNotice: notice }]
      },
      { id: 'workbook-1', name: 'Home' }
    );

    expect(model.current).toMatchObject({
      conflict: false,
      status: 'synced',
      conflictNotice: {
        sourceDevice: 'iPhone',
        report: { entries: [{ title: 'Groceries' }] }
      }
    });
  });
});
