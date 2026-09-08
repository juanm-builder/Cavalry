import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createCloudKitAccountRouter } = require('../../src/host/cloudkit-account-router.cjs');
const { CONTAINER, ENVIRONMENT } = require('../../src/host/cloudkit-web-api.cjs');
const pendingKey = (owner = 'owner-b') => `outbox:${CONTAINER}:${ENVIRONMENT}:${owner}`;
const receiptsKey = (owner = 'owner-b') => `save-receipts:${CONTAINER}:${ENVIRONMENT}:${owner}`;

function harness() {
  const disk = new Map();
  const cloud = [];
  const settings = {
    loginOwner: 'owner-b',
    offline: false,
    failOperation: '',
    failureResult: null,
    failSelection: false,
    stopHook: null
  };
  const storage = {
    read: vi.fn(async (key) => (disk.has(key) ? structuredClone(disk.get(key)) : null)),
    write: vi.fn(async (key, value) => {
      if (key === 'selection' && settings.failSelection) throw new Error('Disk save failed');
      disk.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (key) => {
      disk.delete(key);
    })
  };
  const native = {
    request: vi.fn(async (payload) => {
      if (payload.operation === 'set_connection' && payload.enabled === false && settings.stopHook)
        await settings.stopHook();
      return {
        ok: true,
        account: { status: 'available', userId: 'owner-a' },
        cloudEnvironment: 'Production',
        workbooks: []
      };
    })
  };
  const createApi =
    ({ session }) =>
    async () => {
      if (!session.token)
        throw Object.assign(new Error('Sign in'), {
          code: 'AUTHENTICATION_REQUIRED',
          redirectURL: 'https://idmsa.apple.com/signin'
        });
      if (settings.offline && session.userId)
        throw Object.assign(new Error('Offline'), { code: 'cloud_network_unavailable' });
      return { userRecordName: session.token };
    };
  const createLibrary = ({ api }) => ({
    request: async (payload) => {
      const identity = await api('users/current');
      cloud.push({ owner: identity.userRecordName, ...payload });
      if (payload.operation === settings.failOperation)
        return (
          settings.failureResult || {
            ok: false,
            code: 'workbook_revision_conflict',
            error: 'Review this workbook',
            conflict: true
          }
        );
      return {
        ok: true,
        metadata: { id: payload.workbookId, revision: 1 },
        id: payload.workbookId,
        workbooks: [],
        pending: false
      };
    }
  });
  const options = {
    userDataDir: '/unused',
    storage,
    native,
    config: { apiToken: 'public-test-token' },
    authenticate: async () => settings.loginOwner,
    createApi,
    createLibrary
  };
  return {
    disk,
    cloud,
    settings,
    storage,
    native,
    options,
    router: createCloudKitAccountRouter(options)
  };
}

describe('CloudKit selected-account routing', () => {
  it('leaves device iCloud selected when browser setup is unavailable or cancelled', async () => {
    const h = harness();
    const unavailable = createCloudKitAccountRouter({ ...h.options, config: { apiToken: '' } });
    expect((await unavailable.selectAccount({ source: 'browser' })).code).toBe(
      'browser_icloud_unconfigured'
    );
    expect(h.native.request).not.toHaveBeenCalled();
    h.settings.loginOwner = null;
    expect(await h.router.selectAccount({ source: 'browser' })).toMatchObject({
      ok: false,
      canceled: true
    });
    expect((await h.router.request({ operation: 'status' })).account.userId).toBe('owner-a');
    expect(h.disk.has('selection')).toBe(false);
  });

  it('uses the verified browser owner and rejects requests from the previous owner', async () => {
    const h = harness();
    expect(await h.router.selectAccount({ source: 'browser' })).toMatchObject({
      ok: true,
      accountSource: 'browser',
      account: { userId: 'owner-b' }
    });
    expect(
      await h.router.request({
        operation: 'save',
        workbookId: 'book',
        expectedAccountId: 'owner-a',
        portableHtml: 'private-a'
      })
    ).toMatchObject({ ok: false, code: 'icloud_account_changed' });
    expect(h.cloud).toEqual([]);
    expect(
      await h.router.request({
        operation: 'save',
        workbookId: 'book',
        expectedAccountId: 'owner-b',
        portableHtml: 'private-b'
      })
    ).toMatchObject({ ok: true });
    expect(h.cloud.at(-1)).toMatchObject({ owner: 'owner-b', portableHtml: 'private-b' });
  });

  it('keeps offline writes under B when C is selected, and resumes only after B returns', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    h.settings.offline = true;
    expect(
      (await h.router.request({ operation: 'save', workbookId: 'book', portableHtml: 'only-b' })).ok
    ).toBe(false);
    h.settings.loginOwner = 'owner-c';
    await h.router.selectAccount({ source: 'browser' });
    h.settings.offline = false;
    await h.router.request({ operation: 'status' });
    expect(h.cloud).toEqual([]);
    h.settings.loginOwner = 'owner-b';
    await h.router.selectAccount({ source: 'browser' });
    await h.router.request({ operation: 'status' });
    expect(h.cloud).toEqual([
      expect.objectContaining({ owner: 'owner-b', operation: 'save', portableHtml: 'only-b' })
    ]);
  });

  it('pauses without discarding identity and sign-out never acknowledges a cloud deletion', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    expect(await h.router.request({ operation: 'set_connection', enabled: false })).toMatchObject({
      ok: true,
      syncPaused: true,
      account: { userId: 'owner-b' }
    });
    expect((await h.router.request({ operation: 'save', workbookId: 'book' })).ok).toBe(false);
    await h.router.signOut();
    expect(await h.router.request({ operation: 'delete', workbookId: 'book' })).toMatchObject({
      ok: false,
      code: 'icloud_signed_out'
    });
    expect(h.cloud).toEqual([]);
    expect(h.disk.get('browser-session:owner-b')).toBe(null);
  });

  it('removes temporary authentication credentials after selection, cancellation and sign-out', async () => {
    for (const owner of ['owner-b', null]) {
      const h = harness();
      const router = createCloudKitAccountRouter({
        ...h.options,
        authenticate: async () => {
          h.disk.set('browser-candidate', { token: 'temporary-test-session' });
          return owner;
        }
      });
      await router.selectAccount({ source: 'browser' });
      expect(h.disk.has('browser-candidate')).toBe(false);
      if (owner) {
        expect(h.disk.get('browser-session:owner-b').token).toBe('owner-b');
        // An interrupted older sign-in may have left its scratch session.
        h.disk.set('browser-candidate', { token: 'interrupted-test-session' });
        expect((await router.signOut()).ok).toBe(true);
        expect(h.disk.has('browser-candidate')).toBe(false);
        expect(h.disk.get('browser-session:owner-b')).toBe(null);
      }
    }
  });

  it('preserves the previous browser session if selecting a new owner fails to persist', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    h.settings.loginOwner = 'owner-c';
    h.settings.failSelection = true;
    expect((await h.router.selectAccount({ source: 'browser' })).ok).toBe(false);
    expect(h.disk.get('selection').userId).toBe('owner-b');
    expect(h.disk.get('browser-session:owner-b')).toMatchObject({
      userId: 'owner-b',
      token: 'owner-b'
    });
    h.settings.failSelection = false;
    const restarted = createCloudKitAccountRouter(h.options);
    expect((await restarted.request({ operation: 'status' })).account.userId).toBe('owner-b');
  });

  it('honors cancellation while waiting for the previous native engine to stop', async () => {
    const h = harness();
    h.settings.stopHook = async () => {
      h.router.cancelAccountSignIn();
    };
    expect(await h.router.selectAccount({ source: 'browser' })).toMatchObject({
      ok: false,
      canceled: true
    });
    expect(h.disk.has('selection')).toBe(false);
    expect(h.native.request).toHaveBeenLastCalledWith({
      operation: 'set_connection',
      enabled: true
    });
  });

  it('reports that selection is finishing if cancellation arrives during its durable commit', async () => {
    const h = harness();
    let cancellation;
    h.storage.write.mockImplementation(async (key, value) => {
      if (key === 'selection') cancellation = h.router.cancelAccountSignIn();
      h.disk.set(key, structuredClone(value));
    });
    expect(await h.router.selectAccount({ source: 'browser' })).toMatchObject({
      ok: true,
      account: { userId: 'owner-b' }
    });
    expect(cancellation).toMatchObject({ ok: false, code: 'cloud_account_commit_in_progress' });
    expect(h.disk.get('selection').userId).toBe('owner-b');
  });

  it('retains a conflicted workbook without stopping queued changes to other workbooks', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    h.settings.offline = true;
    await h.router.request({
      operation: 'save',
      workbookId: 'book-with-conflict',
      portableHtml: 'retained-copy'
    });
    await h.router.request({ operation: 'delete', workbookId: 'other-book' });
    h.settings.offline = false;
    h.settings.failOperation = 'save';
    const result = await h.router.request({ operation: 'status' });
    expect(result).toMatchObject({ ok: true, pendingCount: 1, code: 'workbook_revision_conflict' });
    expect(h.cloud).toEqual([
      expect.objectContaining({
        operation: 'save',
        workbookId: 'book-with-conflict',
        owner: 'owner-b'
      }),
      expect.objectContaining({ operation: 'delete', workbookId: 'other-book', owner: 'owner-b' })
    ]);
  });

  it('retains rejected uploads with their diagnostic scope across restart, status, list and sync', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    h.settings.failOperation = 'save';
    h.settings.failureResult = {
      ok: false,
      code: 'cloudkit_request_rejected',
      error: 'iCloud could not accept this sync request.',
      errorDetails: 'Apple code: BAD_REQUEST. Request: records/modify. HTTP status: 400.',
      retryable: false
    };
    const expected = {
      code: 'cloudkit_request_rejected',
      errorOperation: 'upload',
      errorWorkbookId: 'failed-book',
      errorDetails: h.settings.failureResult.errorDetails,
      retryable: false,
      pendingCount: 1
    };
    expect(
      await h.router.request({
        operation: 'save',
        workbookId: 'failed-book',
        portableHtml: 'kept-local-copy'
      })
    ).toMatchObject({ ok: false, ...expected });
    const restarted = createCloudKitAccountRouter(h.options);
    for (const operation of ['status', 'list', 'sync'])
      expect(await restarted.request({ operation })).toMatchObject({ ok: true, ...expected });
    const pendingKey = `outbox:${CONTAINER}:${ENVIRONMENT}:owner-b`;
    expect(h.disk.get(pendingKey)).toHaveLength(1);
    const entry = h.disk.get(pendingKey)[0];
    expect(h.disk.get(`${pendingKey}:${entry.id}`).payload.portableHtml).toBe('kept-local-copy');
    h.settings.failOperation = '';
    const retried = await restarted.request({ operation: 'sync' });
    expect(retried).toMatchObject({ ok: true, pendingCount: 0 });
    expect(retried).not.toHaveProperty('errorDetails');
    expect(h.disk.get(pendingKey)).toEqual([]);
  });

  it('sanitizes identity failure details and retains a staged workbook while offline', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    const createApi = h.options.createApi;
    const restarted = createCloudKitAccountRouter({
      ...h.options,
      createApi: (options) => {
        const api = createApi(options);
        return async (...args) => {
          if (!h.settings.offline) return api(...args);
          throw Object.assign(new Error('private-reason-and-token'), {
            code: 'BAD_REQUEST',
            serverErrorCode: 'BAD_REQUEST',
            cloudkitOperation: 'users/current',
            httpStatus: 400
          });
        };
      }
    });
    h.settings.offline = true;
    const result = await restarted.request({
      operation: 'save',
      workbookId: 'offline-book',
      portableHtml: 'retained'
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'cloudkit_request_rejected',
      retryable: false,
      errorDetails: 'Apple code: BAD_REQUEST. Request: users/current. HTTP status: 400.',
      errorOperation: 'upload',
      errorWorkbookId: 'offline-book',
      pendingCount: 1
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(h.cloud).toEqual([]);
  });

  it('persists metadata-only save receipts before pointer removal and restores them without uploading', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    const writes = [];
    h.storage.write.mockImplementation(async (key, value) => {
      writes.push({ key, value: structuredClone(value) });
      if (key === receiptsKey()) expect(h.disk.get(pendingKey())).toHaveLength(1);
      if (key === pendingKey() && value.length === 0)
        expect(h.disk.get(receiptsKey()).receipts).toHaveLength(1);
      h.disk.set(key, structuredClone(value));
    });
    const result = await h.router.request({
      operation: 'save',
      workbookId: 'receipt-book',
      portableHtml: 'private-workbook-payload'
    });
    const receipt = {
      id: result.saveOperationId,
      userId: 'owner-b',
      workbookId: 'receipt-book',
      revision: 1
    };
    expect(result).toMatchObject({ ok: true, pendingCount: 0 });
    expect(h.disk.get(receiptsKey())).toEqual({
      version: 1,
      container: CONTAINER,
      environment: ENVIRONMENT,
      userId: 'owner-b',
      receipts: [receipt]
    });
    expect(JSON.stringify(h.disk.get(receiptsKey()))).not.toContain('private-workbook-payload');
    expect(writes.map(({ key }) => key)).toEqual([
      `${pendingKey()}:${result.saveOperationId}`,
      pendingKey(),
      receiptsKey(),
      pendingKey()
    ]);
    const restarted = createCloudKitAccountRouter(h.options);
    expect(await restarted.request({ operation: 'status' })).toMatchObject({
      ok: true,
      pendingCount: 0,
      workbookSaveAcknowledgements: [receipt]
    });
    expect(h.cloud.filter(({ operation }) => operation === 'save')).toHaveLength(1);
  });

  it('finishes an interrupted pointer acknowledgment from its durable receipt without resaving', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    let failPointerRemoval = true;
    h.storage.write.mockImplementation(async (key, value) => {
      if (key === pendingKey() && value.length === 0 && failPointerRemoval)
        throw new Error('Interrupted pointer removal');
      h.disk.set(key, structuredClone(value));
    });
    expect(
      await h.router.request({
        operation: 'save',
        workbookId: 'interrupted-book',
        portableHtml: 'kept'
      })
    ).toMatchObject({ ok: false });
    const receipt = h.disk.get(receiptsKey()).receipts[0];
    expect(h.disk.get(pendingKey())).toEqual([
      { id: receipt.id, workbookId: receipt.workbookId, operation: 'save' }
    ]);
    expect(h.disk.get(`${pendingKey()}:${receipt.id}`).payload.portableHtml).toBe('kept');
    const restarted = createCloudKitAccountRouter(h.options);
    expect(await restarted.request({ operation: 'status' })).not.toHaveProperty(
      'workbookSaveAcknowledgements'
    );
    expect(h.cloud.filter(({ operation }) => operation === 'save')).toHaveLength(1);
    failPointerRemoval = false;
    expect(await restarted.request({ operation: 'status' })).toMatchObject({
      ok: true,
      pendingCount: 0,
      workbookSaveAcknowledgements: [receipt]
    });
    expect(h.disk.get(pendingKey())).toEqual([]);
    expect(h.disk.has(`${pendingKey()}:${receipt.id}`)).toBe(false);
    expect(h.cloud.filter(({ operation }) => operation === 'save')).toHaveLength(1);
  });

  it('keeps the pointer and payload when a successful save receipt cannot be persisted', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    h.storage.write.mockImplementation(async (key, value) => {
      if (key === receiptsKey()) throw new Error('Receipt disk write failed');
      h.disk.set(key, structuredClone(value));
    });
    expect(
      await h.router.request({ operation: 'save', workbookId: 'kept-book', portableHtml: 'kept' })
    ).toMatchObject({ ok: false });
    const item = h.disk.get(pendingKey())[0];
    expect(h.disk.get(`${pendingKey()}:${item.id}`).payload.portableHtml).toBe('kept');
    expect(h.disk.has(receiptsKey())).toBe(false);
    expect(h.storage.remove).not.toHaveBeenCalledWith(`${pendingKey()}:${item.id}`);
  });

  it('restores receipts only under their verified owner after an account switch and restart', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    await h.router.request({ operation: 'save', workbookId: 'owner-book', portableHtml: 'only-b' });
    const receipt = h.disk.get(receiptsKey()).receipts[0];
    h.settings.loginOwner = 'owner-c';
    await h.router.selectAccount({ source: 'browser' });
    const restarted = createCloudKitAccountRouter(h.options);
    expect(await restarted.request({ operation: 'status' })).toMatchObject({
      account: { userId: 'owner-c' },
      workbookSaveAcknowledgements: []
    });
    h.settings.loginOwner = 'owner-b';
    await restarted.selectAccount({ source: 'browser' });
    expect(await restarted.request({ operation: 'status' })).toMatchObject({
      account: { userId: 'owner-b' },
      workbookSaveAcknowledgements: [receipt]
    });
    expect(h.cloud.filter(({ operation }) => operation === 'save')).toHaveLength(1);
  });

  it.each([
    ['container', (value) => ({ ...value, container: 'another-container' })],
    ['environment', (value) => ({ ...value, environment: 'Development' })],
    ['owner', (value) => ({ ...value, userId: 'owner-c' })],
    [
      'entry owner',
      (value) => ({ ...value, receipts: [{ ...value.receipts[0], userId: 'owner-c' }] })
    ],
    ['entry id', (value) => ({ ...value, receipts: [{ ...value.receipts[0], id: 'not-a-uuid' }] })],
    ['revision', (value) => ({ ...value, receipts: [{ ...value.receipts[0], revision: 0 }] })],
    ['duplicate entry', (value) => ({ ...value, receipts: [...value.receipts, ...value.receipts] })]
  ])(
    'rejects a corrupt receipt %s without discarding pending data or replaying it',
    async (_label, corrupt) => {
      const h = harness();
      await h.router.selectAccount({ source: 'browser' });
      await h.router.request({
        operation: 'save',
        workbookId: 'prior-book',
        portableHtml: 'prior'
      });
      h.settings.offline = true;
      await h.router.request({
        operation: 'save',
        workbookId: 'pending-book',
        portableHtml: 'kept'
      });
      const pending = structuredClone(h.disk.get(pendingKey()));
      h.disk.set(receiptsKey(), corrupt(h.disk.get(receiptsKey())));
      h.settings.offline = false;
      const restarted = createCloudKitAccountRouter(h.options);
      const result = await restarted.request({ operation: 'status' });
      expect(result.account.status).not.toBe('available');
      expect(result.workbookSaveAcknowledgements).toEqual([]);
      expect(h.disk.get(pendingKey())).toEqual(pending);
      expect(h.cloud.filter(({ operation }) => operation === 'save')).toHaveLength(1);
    }
  );

  it('bounds receipt history and retains interrupted acknowledgments ahead of old completed receipts', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    const receipts = Array.from({ length: 256 }, (_, index) => ({
      id: randomUUID(),
      userId: 'owner-b',
      workbookId: `book-${index}`,
      revision: 1
    }));
    h.disk.set(receiptsKey(), {
      version: 1,
      container: CONTAINER,
      environment: ENVIRONMENT,
      userId: 'owner-b',
      receipts
    });
    h.disk.set(pendingKey(), [
      { id: receipts[0].id, workbookId: receipts[0].workbookId, operation: 'save' }
    ]);
    h.disk.set(`${pendingKey()}:${receipts[0].id}`, {
      owner: 'owner-b',
      payload: { operation: 'save', workbookId: receipts[0].workbookId, portableHtml: 'kept' }
    });
    const result = await h.router.request({
      operation: 'save',
      workbookId: 'new-book',
      portableHtml: 'new'
    });
    expect(result.ok).toBe(true);
    const saved = h.disk.get(receiptsKey()).receipts;
    expect(saved).toHaveLength(256);
    expect(saved[0]).toEqual(receipts[0]);
    expect(saved.some(({ id }) => id === receipts[1].id)).toBe(false);
    expect(saved.at(-1)).toMatchObject({ id: result.saveOperationId, workbookId: 'new-book' });
    const recovered = await createCloudKitAccountRouter(h.options).request({ operation: 'status' });
    expect(recovered.workbookSaveAcknowledgements).toHaveLength(256);
    expect(h.cloud.filter(({ operation }) => operation === 'save')).toHaveLength(1);
  });

  it('never treats a receipt for another pending workbook as proof that this save completed', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    h.settings.offline = true;
    await h.router.request({ operation: 'save', workbookId: 'pending-book', portableHtml: 'kept' });
    const item = h.disk.get(pendingKey())[0];
    h.disk.set(receiptsKey(), {
      version: 1,
      container: CONTAINER,
      environment: ENVIRONMENT,
      userId: 'owner-b',
      receipts: [{ id: item.id, userId: 'owner-b', workbookId: 'another-book', revision: 1 }]
    });
    h.settings.offline = false;
    const result = await createCloudKitAccountRouter(h.options).request({ operation: 'status' });
    expect(result.account.status).not.toBe('available');
    expect(result.workbookSaveAcknowledgements).toEqual([]);
    expect(h.disk.get(pendingKey())).toEqual([item]);
    expect(h.disk.get(`${pendingKey()}:${item.id}`).payload.portableHtml).toBe('kept');
    expect(h.cloud).toEqual([]);
  });

  it('keeps all interrupted receipts at the cap and refuses another remote save before losing proof', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    const receipts = Array.from({ length: 256 }, (_, index) => ({
      id: randomUUID(),
      userId: 'owner-b',
      workbookId: `book-${index}`,
      revision: 1
    }));
    h.disk.set(receiptsKey(), {
      version: 1,
      container: CONTAINER,
      environment: ENVIRONMENT,
      userId: 'owner-b',
      receipts
    });
    h.disk.set(
      pendingKey(),
      receipts.map(({ id, workbookId }) => ({ id, workbookId, operation: 'save' }))
    );
    const result = await h.router.request({
      operation: 'save',
      workbookId: 'new-book',
      portableHtml: 'retained-new'
    });
    expect(result.ok).toBe(false);
    expect(h.disk.get(receiptsKey()).receipts).toEqual(receipts);
    expect(h.disk.get(pendingKey())).toHaveLength(257);
    const staged = h.disk.get(pendingKey()).at(-1);
    expect(h.disk.get(`${pendingKey()}:${staged.id}`).payload.portableHtml).toBe('retained-new');
    expect(h.cloud).toEqual([]);
  });

  it.each([
    { metadata: { id: 'other-book', revision: 1 } },
    { metadata: { id: 'pending-book', revision: 0 } },
    { metadata: { id: 'pending-book', revision: '1' } },
    { metadata: { id: 'pending-book', revision: 1 }, pending: true }
  ])('does not acknowledge an unverified successful save response %j', async (response) => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    const restarted = createCloudKitAccountRouter({
      ...h.options,
      createLibrary: () => ({ request: async () => ({ ok: true, ...response }) })
    });
    const result = await restarted.request({
      operation: 'save',
      workbookId: 'pending-book',
      portableHtml: 'kept'
    });
    expect(result.ok).toBe(false);
    expect(h.disk.get(pendingKey())).toHaveLength(1);
    expect(h.disk.has(receiptsKey())).toBe(false);
  });

  it('keeps a bounded outbox and does not replay a superseded conflict notice or deleted save', async () => {
    const h = harness();
    await h.router.selectAccount({ source: 'browser' });
    for (let i = 0; i < 40; i += 1)
      await h.router.request({ operation: 'save', workbookId: 'book', portableHtml: `save-${i}` });
    const payloadKeys = () =>
      [...h.disk.keys()].filter((key) =>
        key.startsWith(`outbox:${CONTAINER}:${ENVIRONMENT}:owner-b:`)
      );
    expect(payloadKeys()).toHaveLength(0);
    h.settings.failOperation = 'publish_conflict';
    await h.router.request({ operation: 'publish_conflict', workbookId: 'book' });
    await h.router.request({ operation: 'clear_conflict', workbookId: 'book' });
    h.settings.failOperation = 'save';
    await h.router.request({
      operation: 'save',
      workbookId: 'book',
      portableHtml: 'not-to-resurrect'
    });
    await h.router.request({ operation: 'delete', workbookId: 'book' });
    const count = h.cloud.length;
    h.settings.failOperation = '';
    await h.router.request({ operation: 'status' });
    expect(h.cloud).toHaveLength(count);
    expect(payloadKeys()).toHaveLength(0);
  });

  it('does not make unreadable saved account selection fall back to the system account', async () => {
    const h = harness();
    h.disk.set('selection', { version: 999, source: 'browser' });
    expect((await h.router.request({ operation: 'status' })).ok).toBe(false);
    expect(h.native.request).not.toHaveBeenCalled();
  });

  it('pins system workbook operations to the last verified owner', async () => {
    const h = harness();
    await h.router.request({ operation: 'status' });
    await h.router.request({ operation: 'download', workbookId: 'book' });
    expect(h.native.request).toHaveBeenLastCalledWith({
      operation: 'download',
      workbookId: 'book',
      expectedAccountId: 'owner-a'
    });
  });
});
