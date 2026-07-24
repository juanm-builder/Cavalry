import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  FEEDBACK_ATTACHMENT_BUCKET,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_DESCRIPTION_CHARACTERS,
  createCloudFeedbackController,
  detectImageMimeType,
  validateAttachment
} = require('../../src/main/cloud-feedback-controller.cjs');
const {
  CLOUD_IPC_CHANNELS,
  createCloudController
} = require('../../src/main/cloud-controller.cjs');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '22222222-2222-4222-8222-222222222222';
const ATTACHMENT_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CREATED_AT = '2026-07-24T12:00:00.000Z';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const DECODING_NATIVE_IMAGE = {
  createFromBuffer: () => ({
    getSize: () => ({ width: 1, height: 1 }),
    isEmpty: () => false
  })
};

function expectedPayload(payload = {}) {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    expectedSessionGeneration: 0,
    expectedUserId: USER_ID,
    ...payload
  };
}

function createSignedInAuth(client) {
  return {
    getClient: vi.fn(() => client),
    getState: vi.fn(() => ({
      configured: true,
      status: 'signed_in',
      user: { id: USER_ID, email: 'owner@example.com' }
    })),
    isSignedIn: vi.fn(() => true)
  };
}

function createFeedbackController(client, overrides = {}) {
  const cloudClient = {
    rpc: vi.fn(async (name) => {
      if (name === 'recover_feedback_attachments') return { data: [], error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    }),
    ...client
  };
  return createCloudFeedbackController({
    app: { getVersion: () => '1.8.4' },
    auth: createSignedInAuth(cloudClient),
    nativeImage: DECODING_NATIVE_IMAGE,
    platform: 'Darwin',
    ...overrides
  });
}

function rendererPngAttachment(overrides = {}) {
  return {
    dataUrl: PNG_DATA_URL,
    filename: String.raw`C:\fakepath\cash-flow.png`,
    height: 1,
    mimeType: 'image/png',
    size: PNG_BYTES.length,
    width: 1,
    ...overrides
  };
}

describe('Cavalry Cloud feedback main-process boundary', () => {
  it('validates report fields and image bytes before any Cloud write', async () => {
    const rpc = vi.fn();
    const controller = createFeedbackController({ rpc });

    const invalidReports = [
      {
        payload: { kind: 'question', description: 'What happened?', source: 'settings' },
        code: 'invalid_feedback_kind'
      },
      {
        payload: { kind: 'bug', description: ' \r\n ', source: 'settings' },
        code: 'invalid_feedback_description'
      },
      {
        payload: {
          kind: 'bug',
          description: 'x'.repeat(MAX_FEEDBACK_DESCRIPTION_CHARACTERS + 1),
          source: 'settings'
        },
        code: 'invalid_feedback_description'
      },
      {
        payload: { kind: 'feedback', description: 'Useful thought', source: 'dashboard' },
        code: 'invalid_feedback_source'
      },
      {
        payload: {
          kind: 'bug',
          description: 'The chart vanished.',
          source: 'settings',
          attachment: {
            bytes: PNG_BYTES,
            mimeType: 'image/jpeg',
            size: PNG_BYTES.length
          }
        },
        code: 'invalid_feedback_attachment_type'
      },
      {
        payload: {
          kind: 'bug',
          description: 'The chart vanished.',
          source: 'settings',
          attachment: {
            bytes: PNG_BYTES,
            mimeType: 'image/png',
            size: PNG_BYTES.length + 1
          }
        },
        code: 'invalid_feedback_attachment_size'
      }
    ];

    for (const { payload, code } of invalidReports) {
      await expect(controller.submitReport(expectedPayload(payload))).resolves.toMatchObject({
        ok: false,
        code
      });
    }

    expect(
      validateAttachment(
        {
          bytes: Buffer.alloc(MAX_FEEDBACK_ATTACHMENT_BYTES + 1),
          mimeType: 'image/png'
        },
        { nativeImage: DECODING_NATIVE_IMAGE }
      )
    ).toMatchObject({ ok: false, code: 'invalid_feedback_attachment_size' });
    expect(
      validateAttachment(
        {
          bytes: [1n, 2n, 3n],
          mimeType: 'image/png'
        },
        { nativeImage: DECODING_NATIVE_IMAGE }
      )
    ).toMatchObject({ ok: false, code: 'invalid_feedback_attachment_size' });
    expect(detectImageMimeType(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe('');
    expect(detectImageMimeType(Buffer.from('ffd8ffd9', 'hex'))).toBe('');
    expect(detectImageMimeType(Buffer.from('524946460400000057454250', 'hex'))).toBe('');
    const forgedPng = Buffer.alloc(45);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(forgedPng);
    forgedPng.writeUInt32BE(13, 8);
    forgedPng.write('IHDR', 12, 'ascii');
    forgedPng.writeUInt32BE(1, 16);
    forgedPng.writeUInt32BE(1, 20);
    forgedPng.write('IEND', 37, 'ascii');
    expect(detectImageMimeType(forgedPng)).toBe('image/png');
    expect(
      validateAttachment(
        { bytes: forgedPng, mimeType: 'image/png' },
        {
          nativeImage: {
            createFromBuffer: () => ({
              getSize: () => ({ width: 0, height: 0 }),
              isEmpty: () => true
            })
          }
        }
      )
    ).toMatchObject({ ok: false, code: 'invalid_feedback_attachment_type' });
    expect(
      validateAttachment(rendererPngAttachment(), { nativeImage: DECODING_NATIVE_IMAGE })
    ).toMatchObject({
      ok: true,
      attachment: {
        bytes: PNG_BYTES,
        fileName: 'cash-flow.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.length
      }
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('honestly refuses signed-out and unavailable submissions without queueing them', async () => {
    const getSignedOutClient = vi.fn(() => null);
    const signedOut = createCloudFeedbackController({
      auth: {
        getClient: getSignedOutClient,
        getState: () => ({ configured: true, status: 'signed_out', user: null }),
        isSignedIn: () => false
      }
    });
    const unavailable = createCloudFeedbackController({
      auth: {
        getClient: vi.fn(),
        getState: () => ({ configured: false, status: 'unconfigured', user: null }),
        isSignedIn: () => false
      }
    });

    await expect(
      signedOut.submitReport(
        expectedPayload({
          kind: 'feedback',
          description: 'Please add more keyboard shortcuts.',
          source: 'settings'
        })
      )
    ).resolves.toMatchObject({
      ok: false,
      code: 'not_signed_in',
      error: expect.stringMatching(/sign in.+sync.+across devices/i)
    });
    await expect(
      unavailable.submitReport(
        expectedPayload({
          kind: 'bug',
          description: 'A report that must not be queued locally.',
          source: 'assistant'
        })
      )
    ).resolves.toMatchObject({
      ok: false,
      code: 'cloud_unavailable',
      error: expect.stringMatching(/not sent or queued/i)
    });
    expect(getSignedOutClient).toHaveBeenCalledOnce();
  });

  it('creates a normalized report without touching attachment storage', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          attachment_id: null,
          created_at: CREATED_AT,
          report_id: REPORT_ID,
          storage_path: null
        }
      ],
      error: null
    }));
    const storageFrom = vi.fn();
    const controller = createFeedbackController({ rpc, storage: { from: storageFrom } });

    const result = await controller.submitReport(
      expectedPayload({
        context: { routeId: 'Net_Worth', secret: 'drop-me' },
        description: '  The balance changed.\r\nPlease explain why.  ',
        kind: 'feedback',
        source: 'assistant'
      })
    );

    expect(rpc).toHaveBeenCalledWith('create_feedback_report', {
      p_app_version: '1.8.4',
      p_attachment_file_name: null,
      p_attachment_mime_type: null,
      p_attachment_size_bytes: null,
      p_context: { routeId: 'net_worth' },
      p_description: 'The balance changed.\nPlease explain why.',
      p_client_request_id: CLIENT_REQUEST_ID,
      p_expected_owner_id: USER_ID,
      p_kind: 'feedback',
      p_platform: 'darwin',
      p_source: 'assistant'
    });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      sessionGeneration: 0,
      userId: USER_ID,
      report: {
        attachment: null,
        context: { routeId: 'net_worth' },
        createdAt: CREATED_AT,
        description: 'The balance changed.\nPlease explain why.',
        id: REPORT_ID,
        kind: 'feedback',
        source: 'assistant',
        status: 'received',
        updatedAt: CREATED_AT
      }
    });
  });

  it('uploads and finalizes a valid renderer PNG without exposing its storage path', async () => {
    const storagePath = `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`;
    const rpc = vi.fn(async (name) => {
      if (name === 'create_feedback_report') {
        return {
          data: [
            {
              attachment_id: ATTACHMENT_ID,
              created_at: CREATED_AT,
              report_id: REPORT_ID,
              storage_path: storagePath
            }
          ],
          error: null
        };
      }
      if (name === 'finalize_feedback_attachment') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const upload = vi.fn(async () => ({ data: { path: storagePath }, error: null }));
    const remove = vi.fn();
    const storageFrom = vi.fn(() => ({ remove, upload }));
    const controller = createFeedbackController({ rpc, storage: { from: storageFrom } });

    const result = await controller.submitReport(
      expectedPayload({
        attachment: rendererPngAttachment(),
        context: { routeId: 'cash_flow' },
        description: 'Cash flow totals overlap the chart.',
        kind: 'bug',
        source: 'settings'
      })
    );

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'create_feedback_report',
      expect.objectContaining({
        p_attachment_file_name: 'cash-flow.png',
        p_attachment_mime_type: 'image/png',
        p_attachment_size_bytes: PNG_BYTES.length,
        p_client_request_id: CLIENT_REQUEST_ID,
        p_expected_owner_id: USER_ID
      })
    );
    expect(storageFrom).toHaveBeenCalledWith(FEEDBACK_ATTACHMENT_BUCKET);
    expect(upload).toHaveBeenCalledWith(storagePath, PNG_BYTES, {
      cacheControl: '3600',
      contentType: 'image/png',
      upsert: false
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_feedback_attachment', {
      p_attachment_id: ATTACHMENT_ID,
      p_report_id: REPORT_ID
    });
    expect(remove).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      report: {
        attachment: {
          createdAt: CREATED_AT,
          fileName: 'cash-flow.png',
          id: ATTACHMENT_ID,
          mimeType: 'image/png',
          sizeBytes: PNG_BYTES.length
        },
        id: REPORT_ID
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/storage_path|feedback-attachments|base64/i);
  });

  it('keeps a saved report successful and warns when its image upload fails', async () => {
    const storagePath = `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`;
    const rpc = vi.fn(async (name) => {
      if (name === 'create_feedback_report') {
        return {
          data: [
            {
              attachment_id: ATTACHMENT_ID,
              created_at: CREATED_AT,
              report_id: REPORT_ID,
              storage_path: storagePath
            }
          ],
          error: null
        };
      }
      if (name === 'discard_feedback_attachment') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const upload = vi.fn(async () => ({ data: null, error: new Error('network unavailable') }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const controller = createFeedbackController({
      rpc,
      storage: { from: () => ({ remove, upload }) }
    });

    const result = await controller.submitReport(
      expectedPayload({
        attachment: rendererPngAttachment(),
        description: 'The report itself should still be durable.',
        kind: 'bug',
        source: 'settings'
      })
    );

    expect(result).toMatchObject({
      ok: true,
      report: { id: REPORT_ID, attachment: null },
      warning: expect.stringMatching(/report was saved.+image could not be uploaded/i)
    });
    expect(remove).toHaveBeenCalledWith([storagePath]);
    expect(rpc).toHaveBeenLastCalledWith('discard_feedback_attachment', {
      p_attachment_id: ATTACHMENT_ID,
      p_report_id: REPORT_ID
    });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('finalize_feedback_attachment');
  });

  it('requires an exact retry when failed finalization cannot remove the stored image', async () => {
    const storagePath = `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`;
    const rpc = vi.fn(async (name) => {
      if (name === 'create_feedback_report') {
        return {
          data: [
            {
              attachment_id: ATTACHMENT_ID,
              created_at: CREATED_AT,
              report_id: REPORT_ID,
              storage_path: storagePath
            }
          ],
          error: null
        };
      }
      if (name === 'finalize_feedback_attachment') {
        return { data: false, error: new Error('database unavailable') };
      }
      if (name === 'discard_feedback_attachment') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const upload = vi.fn(async () => ({ data: { path: storagePath }, error: null }));
    const remove = vi.fn(async () => ({ data: null, error: new Error('storage unavailable') }));
    const controller = createFeedbackController({
      rpc,
      storage: { from: () => ({ remove, upload }) }
    });

    const result = await controller.submitReport(
      expectedPayload({
        attachment: rendererPngAttachment(),
        description: 'Preserve cleanup metadata if removing bytes fails.',
        kind: 'bug',
        source: 'settings'
      })
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'feedback_attachment_retry_required',
      error: expect.stringMatching(/report was saved.+send it again/i),
      reportSaved: true
    });
    expect(remove).toHaveBeenCalledWith([storagePath]);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'create_feedback_report',
      'finalize_feedback_attachment'
    ]);
  });

  it('lists only renderer-safe report metadata without paths, owners, or tokens', async () => {
    const limit = vi.fn(async () => ({
      data: [
        {
          access_token: 'report-token-secret',
          context: { routeId: 'dashboard', secret: 'drop-me' },
          created_at: CREATED_AT,
          description: 'The projection should be narrow.',
          feedback_attachments: [
            {
              access_token: 'attachment-token-secret',
              created_at: CREATED_AT,
              file_name: 'private.png',
              id: ATTACHMENT_ID,
              mime_type: 'image/png',
              owner_id: USER_ID,
              size_bytes: PNG_BYTES.length,
              storage_path: `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`,
              uploaded_at: CREATED_AT
            }
          ],
          id: REPORT_ID,
          kind: 'bug',
          owner_id: USER_ID,
          source: 'settings',
          status: 'reviewing',
          updated_at: CREATED_AT
        }
      ],
      error: null
    }));
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const controller = createFeedbackController({ from: () => ({ select }) });

    const result = await controller.listReports(expectedPayload());

    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0][0]).not.toMatch(/storage_path|owner_id|token/i);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(100);
    expect(result).toEqual({
      ok: true,
      sessionGeneration: 0,
      userId: USER_ID,
      reports: [
        {
          attachment: {
            createdAt: CREATED_AT,
            fileName: 'private.png',
            id: ATTACHMENT_ID,
            mimeType: 'image/png',
            sizeBytes: PNG_BYTES.length
          },
          context: { routeId: 'dashboard' },
          createdAt: CREATED_AT,
          description: 'The projection should be narrow.',
          id: REPORT_ID,
          kind: 'bug',
          source: 'settings',
          status: 'reviewing',
          updatedAt: CREATED_AT
        }
      ]
    });
    expect(JSON.stringify(result)).not.toMatch(
      /report-token-secret|attachment-token-secret|storage_path|owner_id/i
    );
  });

  it('reconciles stale invalid pending objects through owner-scoped Storage cleanup', async () => {
    const storagePath = `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`;
    const rpc = vi.fn(async (name) => {
      if (name === 'recover_feedback_attachments') {
        return {
          data: [
            {
              attachment_id: ATTACHMENT_ID,
              mime_type: 'image/png',
              report_id: REPORT_ID,
              storage_path: storagePath
            }
          ],
          error: null
        };
      }
      if (name === 'discard_feedback_attachment') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const limit = vi.fn(async () => ({ data: [], error: null }));
    const remove = vi.fn(async () => ({ data: [{ name: storagePath }], error: null }));
    const controller = createFeedbackController({
      from: () => ({
        select: () => ({
          order: () => ({ limit })
        })
      }),
      rpc,
      storage: { from: () => ({ remove }) }
    });

    await expect(controller.listReports(expectedPayload())).resolves.toMatchObject({
      ok: true,
      reports: []
    });
    expect(remove).toHaveBeenCalledWith([storagePath]);
    expect(rpc).toHaveBeenLastCalledWith('discard_feedback_attachment', {
      p_attachment_id: ATTACHMENT_ID,
      p_report_id: REPORT_ID
    });
  });

  it('drops in-flight private results when the main-process Cloud session changes', async () => {
    let resolveList;
    let authState = {
      configured: true,
      status: 'signed_in',
      user: { id: USER_ID }
    };
    let sessionBinding = { userId: USER_ID, generation: 1 };
    const limit = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        })
    );
    const client = {
      rpc: async (name) => {
        if (name === 'recover_feedback_attachments') return { data: [], error: null };
        throw new Error(`Unexpected RPC: ${name}`);
      },
      from: () => ({
        select: () => ({
          order: () => ({ limit })
        })
      })
    };
    const controller = createCloudFeedbackController({
      auth: {
        getClient: () => client,
        getState: () => authState,
        isSignedIn: () => authState.status === 'signed_in'
      },
      getSessionBinding: () => sessionBinding,
      nativeImage: DECODING_NATIVE_IMAGE
    });

    const pending = controller.listReports(expectedPayload({ expectedSessionGeneration: 1 }));
    await vi.waitFor(() => expect(resolveList).toBeTypeOf('function'));
    const nextUserId = '44444444-4444-4444-8444-444444444444';
    authState = {
      configured: true,
      status: 'signed_in',
      user: { id: nextUserId }
    };
    sessionBinding = { userId: nextUserId, generation: 2 };
    resolveList({ data: [{ id: REPORT_ID }], error: null });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'cloud_session_changed'
    });
  });

  it('finishes an owner-bound attachment transaction before hiding a result after account change', async () => {
    let resolveCreate;
    let authState = {
      configured: true,
      status: 'signed_in',
      user: { id: USER_ID }
    };
    let sessionBinding = { userId: USER_ID, generation: 1 };
    const storagePath = `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`;
    const rpc = vi.fn((name) => {
      if (name === 'create_feedback_report') {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      if (name === 'finalize_feedback_attachment') {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const upload = vi.fn(async () => ({ data: { path: storagePath }, error: null }));
    const boundClient = { rpc, storage: { from: () => ({ upload }) } };
    const controller = createCloudFeedbackController({
      app: { getVersion: () => '1.8.4' },
      auth: {
        createSessionBoundClient: vi.fn(async () => boundClient),
        getClient: () => ({ live: true }),
        getState: () => authState,
        isSignedIn: () => authState.status === 'signed_in'
      },
      getSessionBinding: () => sessionBinding,
      nativeImage: DECODING_NATIVE_IMAGE,
      platform: 'darwin'
    });

    const pending = controller.submitReport(
      expectedPayload({
        attachment: rendererPngAttachment(),
        description: 'Finish this private upload for the original owner.',
        expectedSessionGeneration: 1,
        kind: 'bug',
        source: 'settings'
      })
    );
    await vi.waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('create_feedback_report', expect.anything())
    );
    const nextUserId = '44444444-4444-4444-8444-444444444444';
    authState = {
      configured: true,
      status: 'signed_in',
      user: { id: nextUserId }
    };
    sessionBinding = { userId: nextUserId, generation: 2 };
    resolveCreate({
      data: [
        {
          attachment_id: ATTACHMENT_ID,
          attachment_uploaded_at: null,
          created_at: CREATED_AT,
          report_id: REPORT_ID,
          request_replayed: false,
          storage_path: storagePath
        }
      ],
      error: null
    });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'cloud_session_changed'
    });
    expect(upload).toHaveBeenCalledWith(storagePath, PNG_BYTES, expect.anything());
    expect(rpc).toHaveBeenCalledWith('finalize_feedback_attachment', {
      p_attachment_id: ATTACHMENT_ID,
      p_report_id: REPORT_ID
    });
  });

  it('recovers an already-finalized idempotent attachment without uploading it twice', async () => {
    const storagePath = `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`;
    const rpc = vi.fn(async () => ({
      data: [
        {
          attachment_id: ATTACHMENT_ID,
          attachment_uploaded_at: CREATED_AT,
          created_at: CREATED_AT,
          report_id: REPORT_ID,
          request_replayed: true,
          storage_path: storagePath
        }
      ],
      error: null
    }));
    const storageFrom = vi.fn();
    const controller = createFeedbackController({ rpc, storage: { from: storageFrom } });

    await expect(
      controller.submitReport(
        expectedPayload({
          attachment: rendererPngAttachment(),
          description: 'Recover the original committed result.',
          kind: 'bug',
          source: 'settings'
        })
      )
    ).resolves.toMatchObject({
      ok: true,
      report: {
        id: REPORT_ID,
        attachment: { id: ATTACHMENT_ID, mimeType: 'image/png' }
      }
    });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('loads a private image by metadata id and revalidates its downloaded bytes', async () => {
    const storagePath = `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`;
    const maybeSingle = vi.fn(async () => ({
      data: {
        access_token: 'do-not-project',
        file_name: String.raw`folder\private.png`,
        id: ATTACHMENT_ID,
        mime_type: 'image/png',
        size_bytes: PNG_BYTES.length,
        storage_path: storagePath,
        uploaded_at: CREATED_AT
      },
      error: null
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const download = vi.fn(async () => ({
      data: {
        arrayBuffer: async () => Uint8Array.from(PNG_BYTES).buffer
      },
      error: null
    }));
    const storageFrom = vi.fn(() => ({ download }));
    const controller = createFeedbackController({
      from: () => ({ select }),
      storage: { from: storageFrom }
    });

    const result = await controller.getAttachment(expectedPayload({ attachmentId: ATTACHMENT_ID }));

    expect(eq).toHaveBeenCalledWith('id', ATTACHMENT_ID);
    expect(storageFrom).toHaveBeenCalledWith(FEEDBACK_ATTACHMENT_BUCKET);
    expect(download).toHaveBeenCalledWith(storagePath);
    expect(result).toEqual({
      ok: true,
      sessionGeneration: 0,
      userId: USER_ID,
      attachment: {
        dataUrl: PNG_DATA_URL,
        fileName: 'private.png',
        id: ATTACHMENT_ID,
        mimeType: 'image/png'
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/do-not-project|storage_path|feedback-attachments/i);
  });

  it('rejects corrupt downloaded bytes even when private metadata claims a valid PNG', async () => {
    const select = vi.fn(() => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            file_name: 'private.png',
            id: ATTACHMENT_ID,
            mime_type: 'image/png',
            size_bytes: PNG_BYTES.length,
            storage_path: `${USER_ID}/${REPORT_ID}/${ATTACHMENT_ID}.png`,
            uploaded_at: CREATED_AT
          },
          error: null
        })
      })
    }));
    const controller = createFeedbackController({
      from: () => ({ select }),
      storage: {
        from: () => ({
          download: async () => ({
            data: Buffer.alloc(PNG_BYTES.length),
            error: null
          })
        })
      }
    });

    await expect(
      controller.getAttachment(expectedPayload({ attachmentId: ATTACHMENT_ID }))
    ).resolves.toMatchObject({
      ok: false,
      code: 'feedback_attachment_load_failed',
      error: expect.stringMatching(/private report image could not be loaded/i)
    });
  });

  it('rejects a delayed renderer command from an earlier session generation', async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    const controller = createFeedbackController(
      { from, rpc },
      { getSessionBinding: () => ({ userId: USER_ID, generation: 3 }) }
    );

    await expect(
      controller.submitReport(
        expectedPayload({
          description: 'This command belonged to an earlier sign-in.',
          expectedSessionGeneration: 1,
          kind: 'bug',
          source: 'settings'
        })
      )
    ).resolves.toMatchObject({
      ok: false,
      code: 'cloud_session_changed'
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces the database owner-binding guard as a changed Cloud session', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '42501', message: 'cloud_session_changed' }
    }));
    const controller = createFeedbackController({ rpc });

    await expect(
      controller.submitReport(
        expectedPayload({
          description: 'The live token changed while this request was dispatched.',
          kind: 'bug',
          source: 'settings'
        })
      )
    ).resolves.toMatchObject({
      ok: false,
      code: 'cloud_session_changed'
    });
    expect(rpc).toHaveBeenCalledWith(
      'create_feedback_report',
      expect.objectContaining({ p_expected_owner_id: USER_ID })
    );
  });

  it('registers feedback IPC on the trusted Cloud boundary and rejects untrusted senders', async () => {
    const handlers = new Map();
    const trustedEvent = { senderFrame: { url: 'file:///Applications/Cavalry/index.html' } };
    const assertTrustedSender = vi.fn((event) => {
      if (event !== trustedEvent) throw new Error('untrusted feedback sender');
      return true;
    });
    const controller = createCloudController({
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/secure' },
      assertTrustedSender,
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      publishableKey: '',
      safeStorage: null,
      shell: { openExternal: vi.fn() },
      supabaseUrl: ''
    });

    controller.registerHandlers();
    controller.registerHandlers();

    expect(CLOUD_IPC_CHANNELS).toMatchObject({
      getFeedbackAttachment: 'cavalry-cloud:get-feedback-attachment',
      listFeedbackReports: 'cavalry-cloud:list-feedback-reports',
      submitFeedbackReport: 'cavalry-cloud:submit-feedback-report'
    });
    for (const channel of [
      CLOUD_IPC_CHANNELS.listFeedbackReports,
      CLOUD_IPC_CHANNELS.submitFeedbackReport,
      CLOUD_IPC_CHANNELS.getFeedbackAttachment
    ]) {
      expect(handlers.has(channel)).toBe(true);
      await expect(handlers.get(channel)(trustedEvent, {})).resolves.toMatchObject({
        ok: false,
        code: 'cloud_unavailable'
      });
    }
    expect(assertTrustedSender).toHaveBeenCalledTimes(3);
    await expect(
      handlers.get(CLOUD_IPC_CHANNELS.submitFeedbackReport)({ senderFrame: {} }, {})
    ).rejects.toThrow('untrusted feedback sender');
    expect(assertTrustedSender).toHaveBeenCalledTimes(4);
  });
});
