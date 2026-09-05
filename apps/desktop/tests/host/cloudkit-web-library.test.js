import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCloudKitWebLibrary } = require('../../src/host/cloudkit-web-library.cjs');
const { createAssetTransport } = require('../../src/host/cloudkit-web-assets.cjs');
const {
  MAX_PAYLOAD_BYTES,
  recordName,
  sha256
} = require('../../src/host/cloudkit-web-records.cjs');

const ID = 'workbook-personal-1';
const HTML = '<html>Private workbook contents</html>';
const ZONE = { zoneName: 'CavalryWorkbooksV1' };
const TIME = '2026-09-05T08:00:00.000Z';
const asset = (html = HTML, suffix = 'workbook') => ({
  size: Buffer.byteLength(html),
  downloadURL: `https://p1.icloud-content.com/${suffix}`
});
const encrypted = (value) => ({ value, isEncrypted: true });
const read = (record, name) => record.fields[name]?.value;
const fixture = (overrides = {}) => ({
  recordName: recordName(ID),
  recordType: 'CavalryWorkbook',
  recordChangeTag: 'native-tag-7',
  fields: {
    schemaVersion: { value: 1 },
    workbookId: encrypted(ID),
    name: encrypted('Personal'),
    currency: encrypted('PHP'),
    year: encrypted(2026),
    revision: encrypted(7),
    sourceUpdatedAt: encrypted(TIME),
    payloadHash: encrypted(sha256(HTML)),
    payloadAsset: { value: asset(), type: 'ASSET' },
    ...overrides
  }
});
const save = (overrides = {}) => ({
  operation: 'save',
  workbookId: ID,
  name: 'Personal',
  year: 2026,
  currency: 'PHP',
  updatedAt: TIME,
  portableHtml: HTML,
  expectedRevision: 7,
  ...overrides
});
const conflict = () => ({
  id: 'conflict-1',
  sourceDevice: 'Mac',
  detectedAt: TIME,
  baseRevision: 6,
  remoteRevision: 7,
  summary: '1 change needs review',
  report: JSON.stringify({
    version: 1,
    workbookId: ID,
    conflictCount: 1,
    entries: []
  })
});

function harness(initial = fixture()) {
  let remote = initial;
  let sequence = 0;
  const uploaded = [];
  const api = vi.fn(async (path, body) => {
    if (path === 'records/lookup')
      return { records: [remote || { recordName: recordName(ID), serverErrorCode: 'NOT_FOUND' }] };
    if (path === 'zones/modify') return { zones: [{ zoneID: ZONE }] };
    if (path === 'assets/upload')
      return {
        tokens: body.tokens.map((token) => ({
          ...token,
          url: `https://p1-content.icloud.com/upload-${++sequence}`
        }))
      };
    if (path === 'records/modify') {
      const operation = body.operations[0];
      if (operation.operationType === 'delete') {
        remote = null;
        return { records: [{ recordName: recordName(ID), deleted: true }] };
      }
      remote = {
        ...operation.record,
        recordChangeTag: `web-tag-${++sequence}`,
        fields: { ...remote?.fields, ...operation.record.fields }
      };
      return { records: [remote] };
    }
    if (path === 'changes/zone')
      return { zones: [{ zoneID: ZONE, records: remote ? [remote] : [], moreComing: false }] };
    throw new Error(`Unexpected endpoint ${path}`);
  });
  const fetch = vi.fn(async (_url, options) => {
    if (options.method === 'POST') {
      uploaded.push(options.body);
      return new Response(
        JSON.stringify({
          singleFile: {
            fileChecksum: 'apple-checksum',
            referenceChecksum: 'apple-reference',
            wrappingKey: 'apple-wrapping-key',
            receipt: 'apple-receipt',
            size: options.body.length
          }
        })
      );
    }
    return new Response(HTML);
  });
  const library = createCloudKitWebLibrary({ api, fetch, now: () => TIME });
  return {
    api,
    fetch,
    library,
    uploaded,
    get remote() {
      return remote;
    },
    set remote(value) {
      remote = value;
    }
  };
}

describe('browser CloudKit transport shares the native private record contract', () => {
  it('reads native encrypted fields and verifies the downloaded byte hash', async () => {
    const h = harness();
    const result = await h.library.request({ operation: 'download', workbookId: ID });
    expect(result).toMatchObject({
      ok: true,
      workbook: { portableHtml: HTML, metadata: { id: ID, revision: 7, currency: 'PHP' } }
    });
    expect(h.api).toHaveBeenCalledWith('records/lookup', {
      zoneID: ZONE,
      records: [{ recordName: `workbook_${sha256(ID)}` }]
    });
    expect(h.fetch.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      redirect: 'manual',
      headers: {}
    });
  });

  it('uploads identical bytes, encrypted metadata, and the existing native tag atomically', async () => {
    const h = harness();
    expect(await h.library.request(save())).toMatchObject({
      ok: true,
      metadata: { revision: 8 },
      pending: false
    });
    expect(h.uploaded[0].toString()).toBe(HTML);
    const change = h.api.mock.calls.find(([path]) => path === 'records/modify')[1];
    expect(change).toMatchObject({
      zoneID: ZONE,
      atomic: true,
      operations: [
        {
          operationType: 'update',
          record: { recordChangeTag: 'native-tag-7', recordType: 'CavalryWorkbook' }
        }
      ]
    });
    for (const key of [
      'workbookId',
      'name',
      'currency',
      'year',
      'revision',
      'sourceUpdatedAt',
      'payloadHash'
    ]) {
      expect(change.operations[0].record.fields[key].isEncrypted).toBe(true);
    }
    expect(change.operations[0].record.fields.payloadAsset.value.receipt).toBe('apple-receipt');
    expect(change.operations[0].record.fields.schemaVersion).toEqual({ value: 1 });
  });

  it('creates a missing custom zone only for an explicit new workbook save', async () => {
    const h = harness(null);
    const result = await h.library.request(save({ expectedRevision: null }));
    expect(result).toMatchObject({ ok: true, metadata: { revision: 1 } });
    expect(
      h.api.mock.calls.find(([path]) => path === 'records/modify')[1].operations[0].operationType
    ).toBe('create');
    expect(h.api.mock.calls.some(([path]) => path === 'zones/modify')).toBe(true);
  });

  it('reports per-asset quota errors before attempting the file transfer', async () => {
    const h = harness();
    h.api.mockResolvedValueOnce({ records: [fixture()] });
    h.api.mockResolvedValueOnce({ tokens: [{ serverErrorCode: 'QUOTA_EXCEEDED' }] });
    expect(await h.library.request(save())).toMatchObject({
      ok: false,
      code: 'cloud_quota_exceeded',
      retryable: false
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([null, 6, 8])(
    'rejects a stale or unanchored expected revision %s before uploading',
    async (expectedRevision) => {
      const h = harness();
      expect(await h.library.request(save({ expectedRevision }))).toMatchObject({
        ok: false,
        code: 'workbook_revision_conflict',
        conflict: true
      });
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.api.mock.calls.some(([path]) => path === 'records/modify')).toBe(false);
    }
  );

  it('never recreates a remotely deleted workbook with an existing revision anchor', async () => {
    const h = harness(null);
    expect(await h.library.request(save())).toMatchObject({ code: 'workbook_revision_conflict' });
    expect(h.api).toHaveBeenCalledTimes(1);
  });

  it('retries only a tag-only race once and preserves concurrent conflict fields', async () => {
    const h = harness();
    const original = h.api.getMockImplementation();
    let raced = false;
    h.api.mockImplementation(async (path, body) => {
      if (path === 'records/modify' && !raced) {
        raced = true;
        const notice = conflict();
        h.remote = {
          ...h.remote,
          recordChangeTag: 'native-tag-8',
          fields: {
            ...h.remote.fields,
            conflictId: encrypted(notice.id),
            conflictSourceDevice: encrypted(notice.sourceDevice),
            conflictDetectedAt: encrypted(notice.detectedAt),
            conflictBaseRevision: encrypted(notice.baseRevision),
            conflictRemoteRevision: encrypted(notice.remoteRevision),
            conflictSummary: encrypted(notice.summary),
            conflictReport: encrypted(notice.report)
          }
        };
        return { records: [{ serverErrorCode: 'CONFLICT' }] };
      }
      return original(path, body);
    });
    expect(await h.library.request(save())).toMatchObject({ ok: true, metadata: { revision: 8 } });
    const writes = h.api.mock.calls.filter(([path]) => path === 'records/modify');
    expect(writes).toHaveLength(2);
    expect(writes[1][1].operations[0].record.recordChangeTag).toBe('native-tag-8');
    expect(h.uploaded).toHaveLength(1);
    expect(read(h.remote, 'conflictId')).toBe('conflict-1');
  });

  it('does not retry through a concurrent workbook edit', async () => {
    const h = harness();
    const original = h.api.getMockImplementation();
    h.api.mockImplementation(async (path, body) => {
      if (path === 'records/modify') {
        h.remote = fixture({ revision: encrypted(8) });
        return { records: [{ serverErrorCode: 'CONFLICT' }] };
      }
      return original(path, body);
    });
    expect(await h.library.request(save())).toMatchObject({
      ok: false,
      code: 'workbook_revision_conflict'
    });
    expect(h.api.mock.calls.filter(([path]) => path === 'records/modify')).toHaveLength(1);
  });

  it('paginates all zone changes, applies tombstones, and refuses incomplete later pages', async () => {
    const h = harness();
    h.api.mockResolvedValueOnce({
      zones: [{ zoneID: ZONE, records: [fixture()], moreComing: true, syncToken: 'page-two' }]
    });
    h.api.mockResolvedValueOnce({
      zones: [
        {
          zoneID: ZONE,
          records: [{ recordName: recordName(ID), deleted: true }],
          moreComing: false
        }
      ]
    });
    expect(await h.library.request({ operation: 'list' })).toMatchObject({
      ok: true,
      workbooks: []
    });
    expect(h.api.mock.calls[1][1].zones[0].syncToken).toBe('page-two');
    h.api.mockResolvedValueOnce({
      zones: [{ zoneID: ZONE, records: [fixture()], moreComing: true, syncToken: 'page-two' }]
    });
    h.api.mockResolvedValueOnce({ zones: [{ serverErrorCode: 'ZONE_NOT_FOUND' }] });
    expect(await h.library.request({ operation: 'list' })).toMatchObject({
      ok: false,
      code: 'cloud_zone_unavailable'
    });
  });

  it('rejects repeated pagination tokens instead of presenting a partial library', async () => {
    const h = harness();
    h.api.mockResolvedValue({
      zones: [{ zoneID: ZONE, records: [fixture()], moreComing: true, syncToken: 'same' }]
    });
    expect(await h.library.request({ operation: 'list' })).toMatchObject({
      ok: false,
      code: 'cloudkit_invalid_response'
    });
    expect(h.api).toHaveBeenCalledTimes(2);
  });

  it('fails closed on a mismatched hashed record identity', async () => {
    const h = harness(fixture({ workbookId: encrypted('different-workbook') }));
    expect(await h.library.request({ operation: 'list' })).toMatchObject({
      ok: false,
      code: 'cloud_workbook_identity_mismatch'
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid metadata and oversized payloads before any API access', async () => {
    const h = harness();
    expect(await h.library.request(save({ currency: 'invalid' }))).toMatchObject({ ok: false });
    expect(
      await h.library.request(save({ portableHtml: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) }))
    ).toMatchObject({ code: 'cloud_quota_exceeded' });
    expect(h.api).not.toHaveBeenCalled();
  });

  it('publishes and clears native conflict packages without changing workbook data or revision', async () => {
    const h = harness();
    const before = read(h.remote, 'payloadHash');
    expect(
      await h.library.request({
        operation: 'publish_conflict',
        workbookId: ID,
        conflictNotice: conflict(),
        conflictPortableHtml: HTML,
        conflictBasePortableHtml: HTML
      })
    ).toMatchObject({
      ok: true,
      metadata: { revision: 7, conflictNotice: { id: 'conflict-1', resolutionAvailable: true } }
    });
    expect(read(h.remote, 'payloadHash')).toBe(before);
    expect(h.uploaded).toHaveLength(2);
    h.remote.fields.conflictPayloadAsset.value = asset();
    h.remote.fields.conflictBasePayloadAsset.value = asset();
    expect(
      await h.library.request({
        operation: 'download_conflict',
        workbookId: ID,
        conflictNoticeId: 'conflict-1'
      })
    ).toMatchObject({
      ok: true,
      conflictPackage: { noticeId: 'conflict-1', sourcePortableHtml: HTML, basePortableHtml: HTML }
    });
    expect(await h.library.request({ operation: 'clear_conflict', workbookId: ID })).toMatchObject({
      ok: true,
      metadata: { revision: 7 }
    });
    expect(read(h.remote, 'conflictId')).toBeNull();
    expect(read(h.remote, 'conflictPayloadAsset')).toBeNull();
    expect(read(h.remote, 'payloadHash')).toBe(before);
  });

  it('refuses stale conflict-package requests and preserves the current package', async () => {
    const h = harness();
    await h.library.request({
      operation: 'publish_conflict',
      workbookId: ID,
      conflictNotice: conflict(),
      conflictPortableHtml: HTML
    });
    h.fetch.mockClear();
    expect(
      await h.library.request({
        operation: 'download_conflict',
        workbookId: ID,
        conflictNoticeId: 'older'
      })
    ).toMatchObject({ ok: false, code: 'cloud_conflict_package_unavailable' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('uses conditional deletion and treats an already missing record as success', async () => {
    const h = harness();
    expect(await h.library.request({ operation: 'delete', workbookId: ID })).toMatchObject({
      ok: true,
      id: ID,
      pending: false
    });
    const write = h.api.mock.calls.find(([path]) => path === 'records/modify')[1].operations[0];
    expect(write.operationType).toBe('delete');
    expect(write.record.recordChangeTag).toBe('native-tag-7');
    expect(await h.library.request({ operation: 'delete', workbookId: ID })).toMatchObject({
      ok: true
    });
  });

  it('sanitizes remote errors and leaves account/session ownership with its caller', async () => {
    const h = harness();
    const error = new Error('https://example.com/?ckWebAuthToken=secret');
    error.code = 'AUTHENTICATION_REQUIRED';
    h.api.mockRejectedValue(error);
    const response = await h.library.request({ operation: 'list' });
    expect(response).toMatchObject({
      ok: false,
      code: 'icloud_authentication_required',
      retryable: false
    });
    expect(JSON.stringify(response)).not.toContain('secret');
  });

  it('keeps secure-session persistence failures terminal instead of repeatedly retrying writes', async () => {
    const h = harness();
    h.api.mockRejectedValue(
      Object.assign(new Error('private details'), { code: 'cloud_session_save_failed' })
    );
    expect(await h.library.request(save())).toMatchObject({
      ok: false,
      code: 'cloud_session_save_failed',
      retryable: false
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('treats deletion from an absent zone as complete without recreating the zone', async () => {
    const h = harness();
    h.api.mockRejectedValue(Object.assign(new Error('zone'), { code: 'ZONE_NOT_FOUND' }));
    expect(await h.library.request({ operation: 'delete', workbookId: ID })).toMatchObject({
      ok: true,
      id: ID
    });
    expect(h.api).toHaveBeenCalledTimes(1);
  });
});

describe('CloudKit asset transfer boundary', () => {
  it.each([
    'http://p1.icloud.com/a',
    'https://icloud.com.evil.test/a',
    'https://127.0.0.1/a',
    'https://user:password@icloud.com/a',
    'https://p1.icloud.com:999/a'
  ])('rejects untrusted asset URL %s before fetching', async (downloadURL) => {
    const fetch = vi.fn();
    await expect(
      createAssetTransport(fetch).download({ ...asset(), downloadURL }, sha256(HTML))
    ).rejects.toMatchObject({ code: 'cloud_asset_url_invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects redirects out of Apple-owned hosts without following them', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.test/steal' } })
    );
    await expect(createAssetTransport(fetch).download(asset(), sha256(HTML))).rejects.toMatchObject(
      { code: 'cloud_asset_url_invalid' }
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects corrupted downloads and invalid UTF-8 even when hash-valid', async () => {
    let data = Buffer.from('corrupt');
    const transport = createAssetTransport(async () => new Response(data));
    await expect(transport.download(asset(), sha256(HTML))).rejects.toMatchObject({
      code: 'cloud_snapshot_invalid'
    });
    data = Buffer.from([0xff]);
    await expect(transport.download({ ...asset(), size: 1 }, sha256(data))).rejects.toMatchObject({
      code: 'cloud_snapshot_invalid'
    });
  });

  it('cancels an oversized streaming response without buffering the remainder', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PAYLOAD_BYTES + 1));
      },
      cancel
    });
    await expect(
      createAssetTransport(async () => new Response(body)).download(asset(), sha256(HTML))
    ).rejects.toMatchObject({ code: 'cloud_quota_exceeded' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects incomplete private upload receipts', async () => {
    const transport = createAssetTransport(
      async () =>
        new Response(
          JSON.stringify({
            singleFile: { size: Buffer.byteLength(HTML), receipt: 'only-a-receipt' }
          })
        )
    );
    await expect(
      transport.upload('https://p1-content.icloud.com/upload', HTML)
    ).rejects.toMatchObject({ code: 'cloud_snapshot_invalid' });
  });
});
