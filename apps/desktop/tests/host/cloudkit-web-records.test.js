import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  workbookFields,
  conflictFields,
  metadata
} = require('../../src/host/cloudkit-web-records.cjs');
const { createCloudKitWebLibrary } = require('../../src/host/cloudkit-web-library.cjs');

const ID = 'native-contract-workbook';
const RECORD_NAME = 'workbook_f672dffe029c75ed302418c34a27a05c090ac020622ce15cc83eb8e20abb07dd';
const HTML = '<html><body>Contract fixture ₱123.45</body></html>';
const HASH = '6af2b907e8840df35e32955f840b960a0bca3c3d458522480c43cb62756692a7';
const TIME = '2026-09-06T04:00:00.000Z';
const RECEIPT = Object.freeze({
  fileChecksum: 'synthetic-file-checksum',
  referenceChecksum: 'synthetic-reference-checksum',
  wrappingKey: 'synthetic-wrapping-key',
  receipt: 'synthetic-upload-receipt',
  size: 52
});
const DOWNLOADED_ASSET = Object.freeze({
  fileChecksum: 'synthetic-file-checksum',
  referenceChecksum: 'synthetic-reference-checksum',
  wrappingKey: 'synthetic-wrapping-key',
  size: 52,
  downloadURL: 'https://p1.icloud-content.com/synthetic-contract-workbook'
});
const REQUEST = Object.freeze({
  operation: 'save',
  workbookId: ID,
  name: 'Contract fixture',
  year: 2026,
  currency: 'PHP',
  updatedAt: TIME,
  portableHtml: HTML,
  expectedRevision: 7
});
const NOTICE = Object.freeze({
  id: 'conflict-contract-1',
  sourceDevice: 'iPhone',
  detectedAt: TIME,
  baseRevision: 6,
  remoteRevision: 7,
  summary: '1 change needs review',
  report: '{"version":1,"workbookId":"native-contract-workbook","entries":[]}'
});

// Keep these fixtures independent of the production encoders and request body.
// The 2026-09-06 Production synthetic roundtrip accepted ASSETID; the previous
// ASSET request tag failed with HTTP 400 before Apple could save the workbook.
// Changing only that asset tag still failed with "byte values must be base64
// encoded"; explicit STRING/INT64 encrypted values completed the roundtrip.
const EXPECTED_WORKBOOK_FIELDS = {
  schemaVersion: { value: 1, type: 'INT64' },
  workbookId: { value: ID, type: 'STRING', isEncrypted: true },
  name: { value: 'Contract fixture', type: 'STRING', isEncrypted: true },
  year: { value: 2026, type: 'INT64', isEncrypted: true },
  currency: { value: 'PHP', type: 'STRING', isEncrypted: true },
  revision: { value: 8, type: 'INT64', isEncrypted: true },
  sourceUpdatedAt: { value: TIME, type: 'STRING', isEncrypted: true },
  payloadHash: { value: HASH, type: 'STRING', isEncrypted: true },
  payloadAsset: { value: RECEIPT, type: 'ASSETID' }
};
const EXPECTED_CONFLICT_FIELDS = {
  conflictId: { value: NOTICE.id, type: 'STRING', isEncrypted: true },
  conflictSourceDevice: { value: 'iPhone', type: 'STRING', isEncrypted: true },
  conflictDetectedAt: { value: TIME, type: 'STRING', isEncrypted: true },
  conflictBaseRevision: { value: 6, type: 'INT64', isEncrypted: true },
  conflictRemoteRevision: { value: 7, type: 'INT64', isEncrypted: true },
  conflictSummary: { value: '1 change needs review', type: 'STRING', isEncrypted: true },
  conflictReport: { value: NOTICE.report, type: 'STRING', isEncrypted: true },
  conflictPackageNoticeId: { value: NOTICE.id, type: 'STRING', isEncrypted: true },
  conflictPayloadHash: { value: HASH, type: 'STRING', isEncrypted: true },
  conflictPayloadAsset: { value: RECEIPT, type: 'ASSETID' },
  conflictBasePayloadHash: { value: HASH, type: 'STRING', isEncrypted: true },
  conflictBasePayloadAsset: { value: RECEIPT, type: 'ASSETID' }
};
const EXPECTED_CLEARED_FIELDS = {
  conflictId: { value: null, type: 'STRING', isEncrypted: true },
  conflictSourceDevice: { value: null, type: 'STRING', isEncrypted: true },
  conflictDetectedAt: { value: null, type: 'STRING', isEncrypted: true },
  conflictBaseRevision: { value: null, type: 'INT64', isEncrypted: true },
  conflictRemoteRevision: { value: null, type: 'INT64', isEncrypted: true },
  conflictSummary: { value: null, type: 'STRING', isEncrypted: true },
  conflictReport: { value: null, type: 'STRING', isEncrypted: true },
  conflictPackageNoticeId: { value: null, type: 'STRING', isEncrypted: true },
  conflictPayloadHash: { value: null, type: 'STRING', isEncrypted: true },
  conflictPayloadAsset: { value: null, type: 'ASSETID' },
  conflictBasePayloadHash: { value: null, type: 'STRING', isEncrypted: true },
  conflictBasePayloadAsset: { value: null, type: 'ASSETID' }
};

// Native-origin metadata uses encrypted fields, an independent change tag and
// an asset download descriptor. Optional fields are absent after server clears.
function nativeRecord(revision = 7) {
  return {
    recordName: RECORD_NAME,
    recordType: 'CavalryWorkbook',
    recordChangeTag: revision === 7 ? 'native-change-tag-7' : 'server-change-tag-8',
    fields: {
      schemaVersion: { value: 1, type: 'INT64' },
      workbookId: { value: ID, type: 'STRING', isEncrypted: true },
      name: { value: 'Contract fixture', type: 'STRING', isEncrypted: true },
      currency: { value: 'PHP', type: 'STRING', isEncrypted: true },
      revision: { value: revision, type: 'INT64', isEncrypted: true },
      sourceUpdatedAt: { value: TIME, type: 'STRING', isEncrypted: true },
      payloadHash: { value: HASH, type: 'STRING', isEncrypted: true },
      payloadAsset: { value: DOWNLOADED_ASSET, type: 'ASSETID' }
    }
  };
}

describe('CloudKit Web Services field encoding contract', () => {
  it('writes typed encrypted native metadata and the verified asset request tag', () => {
    expect(workbookFields(REQUEST, 8, RECEIPT)).toEqual(EXPECTED_WORKBOOK_FIELDS);
  });

  it.each([
    ['2026-10-09', '2026-10-09T00:00:00.000Z'],
    ['2026-10-09T21:00:00+08:00', '2026-10-09T13:00:00.000Z'],
    ['Fri, 09 Oct 2026 13:00:00 GMT', '2026-10-09T13:00:00.000Z']
  ])('canonicalizes legacy workbook date %s for native CloudKit readers', (input, expected) => {
    const fields = workbookFields({ ...REQUEST, updatedAt: input }, 8, RECEIPT);
    expect(fields.sourceUpdatedAt.value).toBe(expected);
    expect(metadata({ ...nativeRecord(), fields }).updatedAt).toBe(expected);
  });

  it('rejects invalid dates before writing a workbook record', () => {
    expect(() => workbookFields({ ...REQUEST, updatedAt: 'not a date' }, 8, RECEIPT)).toThrow();
  });

  it.each([null, undefined])('keeps the optional year INT64 when its value is %s', (year) => {
    expect(workbookFields({ ...REQUEST, year }, 8, RECEIPT)).toEqual({
      ...EXPECTED_WORKBOOK_FIELDS,
      year: { value: null, type: 'INT64', isEncrypted: true }
    });
  });

  it('uses explicit types for every conflict field and both conflict assets', () => {
    const uploaded = { asset: RECEIPT, hash: HASH };
    expect(conflictFields(NOTICE, uploaded, uploaded)).toEqual(EXPECTED_CONFLICT_FIELDS);
  });

  it('clears an absent conflict base without losing the field types', () => {
    expect(
      conflictFields({ ...NOTICE, baseRevision: null }, { asset: RECEIPT, hash: HASH }, null)
    ).toEqual({
      ...EXPECTED_CONFLICT_FIELDS,
      conflictBaseRevision: { value: null, type: 'INT64', isEncrypted: true },
      conflictBasePayloadHash: { value: null, type: 'STRING', isEncrypted: true },
      conflictBasePayloadAsset: { value: null, type: 'ASSETID' }
    });
  });

  it('clears exactly the 12 conflict fields without changing workbook fields', () => {
    expect(conflictFields(null, null, null)).toEqual(EXPECTED_CLEARED_FIELDS);
  });

  it('reads independent native metadata with absent optional fields', () => {
    expect(metadata(nativeRecord())).toEqual({
      id: ID,
      name: 'Contract fixture',
      year: null,
      currency: 'PHP',
      revision: 7,
      updatedAt: TIME,
      inCloud: true
    });
  });

  it('accepts a server save response independently of the outbound field objects', async () => {
    const api = vi.fn(async (operation, body) => {
      if (operation === 'records/lookup') return { records: [nativeRecord()] };
      if (operation === 'assets/upload') {
        return {
          tokens: [
            {
              recordName: RECORD_NAME,
              fieldName: 'payloadAsset',
              url: 'https://p1-content.icloud.com/synthetic-upload'
            }
          ]
        };
      }
      if (operation === 'records/modify') {
        expect(body).toEqual({
          zoneID: { zoneName: 'CavalryWorkbooksV1' },
          atomic: true,
          operations: [
            {
              operationType: 'update',
              record: {
                recordName: RECORD_NAME,
                recordType: 'CavalryWorkbook',
                recordChangeTag: 'native-change-tag-7',
                fields: EXPECTED_WORKBOOK_FIELDS
              }
            }
          ]
        });
        const record = nativeRecord(8);
        record.fields.year = { value: 2026, type: 'INT64', isEncrypted: true };
        return { records: [record] };
      }
      throw new Error(`Unexpected fixture operation: ${operation}`);
    });
    const fetch = vi.fn(async (_url, options) => {
      expect(options.method).toBe('POST');
      expect(options.body.equals(Buffer.from(HTML))).toBe(true);
      return new Response(JSON.stringify({ singleFile: RECEIPT }));
    });
    const library = createCloudKitWebLibrary({ api, fetch });
    expect(await library.request(REQUEST)).toMatchObject({
      ok: true,
      pending: false,
      metadata: { id: ID, revision: 8, year: 2026 }
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('accepts server-omitted cleared fields while preserving the workbook revision', async () => {
    const api = vi.fn(async (operation, body) => {
      if (operation === 'records/lookup') {
        const record = nativeRecord();
        record.fields = {
          ...record.fields,
          ...EXPECTED_CONFLICT_FIELDS,
          conflictPayloadAsset: { value: DOWNLOADED_ASSET, type: 'ASSETID' },
          conflictBasePayloadAsset: { value: DOWNLOADED_ASSET, type: 'ASSETID' }
        };
        return { records: [record] };
      }
      if (operation === 'records/modify') {
        expect(body.operations).toEqual([
          {
            operationType: 'update',
            record: {
              recordName: RECORD_NAME,
              recordType: 'CavalryWorkbook',
              recordChangeTag: 'native-change-tag-7',
              fields: EXPECTED_CLEARED_FIELDS
            }
          }
        ]);
        const record = nativeRecord();
        record.recordChangeTag = 'server-clear-change-tag';
        return { records: [record] };
      }
      throw new Error(`Unexpected fixture operation: ${operation}`);
    });
    const fetch = vi.fn();
    const result = await createCloudKitWebLibrary({ api, fetch }).request({
      operation: 'clear_conflict',
      workbookId: ID
    });
    expect(result).toMatchObject({ ok: true, pending: false, metadata: { id: ID, revision: 7 } });
    expect(result.metadata).not.toHaveProperty('conflictNotice');
    expect(fetch).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(2);
  });
});
