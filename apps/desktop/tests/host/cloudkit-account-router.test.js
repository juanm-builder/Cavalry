import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCloudKitAccountRouter } = require('../../src/host/cloudkit-account-router.cjs');
const { CONTAINER, ENVIRONMENT } = require('../../src/host/cloudkit-web-api.cjs');

function harness() {
  const disk = new Map();
  const cloud = [];
  const settings = {
    loginOwner: 'owner-b',
    offline: false,
    failOperation: '',
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
        return {
          ok: false,
          code: 'workbook_revision_conflict',
          error: 'Review this workbook',
          conflict: true
        };
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
