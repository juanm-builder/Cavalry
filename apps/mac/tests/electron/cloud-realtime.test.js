import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CLOUD_IPC_CHANNELS,
  createCloudController
} = require('../../src/main/cloud-controller.cjs');

const USER_A = {
  id: 'user-realtime-a',
  email: 'realtime-a@example.com',
  user_metadata: {},
  app_metadata: { provider: 'google' }
};
const USER_B = {
  id: 'user-realtime-b',
  email: 'realtime-b@example.com',
  user_metadata: {},
  app_metadata: { provider: 'google' }
};

function createSecureStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').slice('sealed:'.length)
  };
}

function workbookRow(id, revision, name = 'Realtime plan') {
  return {
    local_workbook_id: id,
    name,
    year: 2026,
    currency: 'PHP',
    latest_revision: revision,
    updated_at: `2026-08-16T00:00:${String(revision).padStart(2, '0')}.000Z`
  };
}

function createDeferredList() {
  let resolve;
  let markStarted;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  const started = new Promise((complete) => {
    markStarted = complete;
  });
  return { markStarted, promise, resolve, started };
}

function createRealtimeHarness() {
  let currentUser = USER_A;
  let authStateCallback = () => {};
  let listCallCount = 0;
  let listFailuresRemaining = 0;
  const deferredLists = [];
  const deferredProfileLoads = [];
  const deferredProfileUpdates = [];
  const deferredRpcs = new Map();
  const rowsByOwner = new Map([[USER_A.id, [workbookRow('workbook-1', 1)]]]);
  const profileNamesByOwner = new Map([[USER_A.id, 'Owner A']]);
  const channels = [];
  const handlers = new Map();
  const removeChannel = vi.fn(async () => {});
  const send = vi.fn();

  function takeDeferred(queue) {
    const deferred = queue.shift();
    if (deferred) deferred.markStarted();
    return deferred;
  }

  function createChannel(name) {
    const bindings = [];
    let subscriptionStatusCallback = () => {};
    const channel = {
      on: vi.fn((type, filter, callback) => {
        bindings.push({ callback, filter, type });
        return channel;
      }),
      subscribe: vi.fn((callback) => {
        subscriptionStatusCallback = callback;
        return channel;
      }),
      unsubscribe: vi.fn(async () => {})
    };
    const entry = {
      bindings,
      channel,
      name,
      status: (status) => subscriptionStatusCallback(status),
      trigger: (event, payload) => {
        const binding = bindings.find((candidate) => candidate.filter.event === event);
        if (!binding) throw new Error(`Missing ${event} Realtime binding.`);
        binding.callback(payload);
      }
    };
    channels.push(entry);
    return channel;
  }

  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: currentUser ? { access_token: 'access-token', user: currentUser } : null
        },
        error: null
      })),
      getUser: vi.fn(async () => ({ data: { user: currentUser }, error: null })),
      onAuthStateChange: vi.fn((callback) => {
        authStateCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(async () => ({ error: null }))
    },
    channel: vi.fn((name) => createChannel(name)),
    removeChannel,
    rpc: vi.fn(async (name) => {
      const deferred = takeDeferred(deferredRpcs.get(name) || []);
      return deferred ? deferred.promise : { data: null, error: { message: 'Unexpected RPC' } };
    }),
    from(table) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_column, userId) => ({
              maybeSingle: async () => {
                const deferred = takeDeferred(deferredProfileLoads);
                return deferred
                  ? deferred.promise
                  : {
                      data: { display_name: profileNamesByOwner.get(userId) || '' },
                      error: null
                    };
              }
            })
          }),
          upsert: ({ display_name: displayName, user_id: userId }) => ({
            select: () => ({
              single: async () => {
                const deferred = takeDeferred(deferredProfileUpdates);
                if (deferred) return deferred.promise;
                profileNamesByOwner.set(userId, displayName);
                return { data: { display_name: displayName }, error: null };
              }
            })
          })
        };
      }
      return {
        select: () => ({
          is: () => ({
            order: async () => {
              const requestedOwnerId = currentUser?.id || '';
              listCallCount += 1;
              const deferred = deferredLists.shift();
              if (deferred) {
                deferred.markStarted();
                return deferred.promise;
              }
              if (listFailuresRemaining > 0) {
                listFailuresRemaining -= 1;
                return { data: null, error: { message: 'temporary list failure' } };
              }
              return {
                data: rowsByOwner.get(requestedOwnerId) || [],
                error: null
              };
            }
          })
        })
      };
    }
  };
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send }
  };
  const controller = createCloudController({
    app: { getPath: () => '/secure' },
    BrowserWindow: { getAllWindows: () => [window] },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    safeStorage: createSecureStorage(),
    shell: { openExternal: vi.fn() },
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test-key',
    createClient: () => client,
    createStorage: () => ({
      isPersistent: () => true,
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
      clear: async () => {}
    }),
    getPersistenceService: () => ({
      deserializeWorkbookFromFile: () => ({
        workbook: {
          id: 'workbook-a',
          name: 'Owner A private workbook',
          year: 2026,
          currency: 'PHP',
          version: 2,
          updatedAt: '2026-08-16T00:00:00.000Z'
        }
      })
    }),
    assertTrustedSender: () => true
  });

  return {
    channelFor(userId) {
      return channels.findLast((entry) => entry.name === `cavalry-workbooks-${userId}`);
    },
    client,
    controller,
    deferNextList() {
      const deferred = createDeferredList();
      deferredLists.push(deferred);
      return deferred;
    },
    deferNextProfileLoad() {
      const deferred = createDeferredList();
      deferredProfileLoads.push(deferred);
      return deferred;
    },
    deferNextProfileUpdate() {
      const deferred = createDeferredList();
      deferredProfileUpdates.push(deferred);
      return deferred;
    },
    deferNextRpc(name) {
      const deferred = createDeferredList();
      const queue = deferredRpcs.get(name) || [];
      queue.push(deferred);
      deferredRpcs.set(name, queue);
      return deferred;
    },
    emitAuth(event, user) {
      currentUser = user;
      authStateCallback(event, user ? { access_token: 'access-token', user } : null);
    },
    failNextLists(count = 1) {
      listFailuresRemaining = count;
    },
    get listCallCount() {
      return listCallCount;
    },
    handlers,
    removeChannel,
    rowsFor(userId, rows) {
      rowsByOwner.set(userId, rows);
    },
    send
  };
}

describe('Cavalry Cloud realtime workbook metadata', () => {
  it('uses filtered writes and an opaque unfiltered DELETE invalidation', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    const realtime = harness.channelFor(USER_A.id);

    expect(realtime.channel.on).toHaveBeenNthCalledWith(
      1,
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'workbooks',
        filter: `owner_id=eq.${USER_A.id}`
      },
      expect.any(Function)
    );
    expect(realtime.channel.on).toHaveBeenNthCalledWith(
      2,
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'workbooks',
        filter: `owner_id=eq.${USER_A.id}`
      },
      expect.any(Function)
    );
    expect(realtime.channel.on).toHaveBeenNthCalledWith(
      3,
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'workbooks' },
      expect.any(Function)
    );
    expect(realtime.channel.subscribe).toHaveBeenCalledOnce();

    harness.send.mockClear();
    realtime.status('SUBSCRIBED');
    await vi.waitFor(() =>
      expect(harness.send).toHaveBeenCalledWith(
        CLOUD_IPC_CHANNELS.stateChanged,
        expect.objectContaining({
          workbooks: [expect.objectContaining({ id: 'workbook-1', revision: 1 })],
          workbookChange: expect.objectContaining({ workbookId: '' })
        })
      )
    );

    harness.send.mockClear();
    harness.rowsFor(USER_A.id, [workbookRow('workbook-1', 2)]);
    realtime.trigger('UPDATE', {
      eventType: 'UPDATE',
      new: {
        owner_id: USER_A.id,
        local_workbook_id: 'workbook-1',
        latest_revision: 2,
        updated_at: '2026-08-16T00:00:02.000Z',
        latest_content_hash: 'must-not-cross-ipc'
      }
    });
    await vi.waitFor(() =>
      expect(harness.send).toHaveBeenCalledWith(
        CLOUD_IPC_CHANNELS.stateChanged,
        expect.objectContaining({
          workbooks: [expect.objectContaining({ id: 'workbook-1', revision: 2 })],
          workbookChange: {
            sequence: 2,
            eventType: 'UPDATE',
            workbookId: 'workbook-1',
            revision: 2,
            updatedAt: '2026-08-16T00:00:02.000Z'
          }
        })
      )
    );
    expect(JSON.stringify(harness.send.mock.calls)).not.toContain('must-not-cross-ipc');

    harness.send.mockClear();
    harness.rowsFor(USER_A.id, []);
    realtime.trigger('DELETE', {
      eventType: 'DELETE',
      old: {
        id: 'database-primary-key-must-not-cross-ipc',
        owner_id: 'other-owner-must-not-cross-ipc',
        local_workbook_id: 'other-workbook-must-not-cross-ipc',
        latest_revision: 99,
        updated_at: 'private-timestamp-must-not-cross-ipc',
        latest_content_hash: 'private-hash-must-not-cross-ipc'
      }
    });
    await vi.waitFor(() =>
      expect(harness.send).toHaveBeenCalledWith(
        CLOUD_IPC_CHANNELS.stateChanged,
        expect.objectContaining({
          workbooks: [],
          workbookChange: {
            sequence: 3,
            eventType: 'DELETE',
            workbookId: '',
            revision: 0,
            updatedAt: ''
          }
        })
      )
    );
    const rendererPayloads = JSON.stringify(harness.send.mock.calls);
    expect(rendererPayloads).not.toContain('database-primary-key-must-not-cross-ipc');
    expect(rendererPayloads).not.toContain('other-owner-must-not-cross-ipc');
    expect(rendererPayloads).not.toContain('other-workbook-must-not-cross-ipc');
    expect(rendererPayloads).not.toContain('private-timestamp-must-not-cross-ipc');
    expect(rendererPayloads).not.toContain('private-hash-must-not-cross-ipc');

    harness.controller.dispose();
    expect(harness.removeChannel).toHaveBeenCalledWith(realtime.channel);
  });

  it('reconciles metadata again whenever the channel resubscribes', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    const realtime = harness.channelFor(USER_A.id);

    realtime.status('SUBSCRIBED');
    await vi.waitFor(() =>
      expect(harness.controller.getState().workbooks).toEqual([
        expect.objectContaining({ id: 'workbook-1', revision: 1 })
      ])
    );

    harness.send.mockClear();
    harness.rowsFor(USER_A.id, [workbookRow('workbook-1', 7, 'Missed while offline')]);
    realtime.status('SUBSCRIBED');

    await vi.waitFor(() =>
      expect(harness.send).toHaveBeenCalledWith(
        CLOUD_IPC_CHANNELS.stateChanged,
        expect.objectContaining({
          workbooks: [
            expect.objectContaining({
              id: 'workbook-1',
              name: 'Missed while offline',
              revision: 7
            })
          ]
        })
      )
    );
    harness.controller.dispose();
  });

  it('retries a failed reconnect reconciliation with bounded backoff', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    const realtime = harness.channelFor(USER_A.id);
    realtime.status('SUBSCRIBED');
    await vi.waitFor(() => expect(harness.controller.getState().workbooks[0]?.revision).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    harness.rowsFor(USER_A.id, [workbookRow('workbook-1', 8, 'Recovered revision')]);
    harness.failNextLists(1);
    const listCallsBeforeReconnect = harness.listCallCount;
    harness.send.mockClear();
    vi.useFakeTimers();
    try {
      realtime.status('SUBSCRIBED');
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.listCallCount).toBe(listCallsBeforeReconnect + 1);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.listCallCount).toBe(listCallsBeforeReconnect + 2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() =>
      expect(harness.controller.getState().workbooks).toEqual([
        expect.objectContaining({ id: 'workbook-1', name: 'Recovered revision', revision: 8 })
      ])
    );
    harness.controller.dispose();
  });

  it('drops a deferred old-owner list and drains the current owner reconciliation', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    const ownerARealtime = harness.channelFor(USER_A.id);
    ownerARealtime.status('SUBSCRIBED');
    await vi.waitFor(() => expect(harness.controller.getState().workbooks[0]?.revision).toBe(1));

    harness.send.mockClear();
    const staleList = harness.deferNextList();
    ownerARealtime.trigger('UPDATE', {
      eventType: 'UPDATE',
      new: {
        owner_id: USER_A.id,
        local_workbook_id: 'workbook-1',
        latest_revision: 2,
        updated_at: '2026-08-16T00:00:02.000Z'
      }
    });
    await staleList.started;

    harness.emitAuth('SIGNED_OUT', null);
    harness.rowsFor(USER_B.id, [workbookRow('workbook-b', 4, 'Owner B workbook')]);
    harness.emitAuth('SIGNED_IN', USER_B);
    const ownerBRealtime = harness.channelFor(USER_B.id);
    const ownerBList = harness.deferNextList();
    ownerBRealtime.status('SUBSCRIBED');

    staleList.resolve({
      data: [workbookRow('workbook-1', 2, 'Owner A private stale result')],
      error: null
    });
    await ownerBList.started;
    expect(harness.controller.getState().workbooks).toEqual([]);
    ownerBList.resolve({
      data: [workbookRow('workbook-b', 4, 'Owner B workbook')],
      error: null
    });

    await vi.waitFor(() =>
      expect(harness.controller.getState()).toEqual(
        expect.objectContaining({
          user: expect.objectContaining({ id: USER_B.id }),
          workbooks: [
            expect.objectContaining({
              id: 'workbook-b',
              name: 'Owner B workbook',
              revision: 4
            })
          ]
        })
      )
    );
    expect(JSON.stringify(harness.send.mock.calls)).not.toContain('Owner A private stale result');
    harness.controller.dispose();
  });

  it('clears owner A state synchronously and discards deferred list and profile results', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    harness.controller.registerHandlers();
    expect(harness.controller.getState()).toMatchObject({
      user: { id: USER_A.id, name: 'Owner A' },
      workbooks: [{ id: 'workbook-1' }]
    });

    const staleList = harness.deferNextList();
    const staleProfile = harness.deferNextProfileLoad();
    const operation = harness.handlers.get(CLOUD_IPC_CHANNELS.listWorkbooks)(
      { senderFrame: {} },
      {}
    );
    await Promise.all([staleList.started, staleProfile.started]);

    harness.emitAuth('SIGNED_IN', USER_B);
    expect(harness.controller.getState()).toMatchObject({
      user: { id: USER_B.id },
      workbooks: []
    });
    expect(harness.controller.getState().user.name).not.toBe('Owner A');
    harness.send.mockClear();

    staleList.resolve({
      data: [workbookRow('workbook-a-private', 9, 'Owner A private stale result')],
      error: null
    });
    staleProfile.resolve({ data: { display_name: 'Owner A private profile' }, error: null });
    const result = await operation;

    expect(result).toEqual({
      ok: false,
      code: 'cloud_session_changed',
      error: 'The Cavalry Cloud account changed before the operation finished.',
      state: expect.objectContaining({
        user: expect.objectContaining({ id: USER_B.id }),
        workbooks: []
      })
    });
    expect(JSON.stringify(result)).not.toContain('Owner A private');
    expect(harness.send).not.toHaveBeenCalled();
    harness.controller.dispose();
  });

  it('discards a deferred owner A profile update after switching directly to owner B', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    harness.controller.registerHandlers();

    const staleUpdate = harness.deferNextProfileUpdate();
    const operation = harness.handlers.get(CLOUD_IPC_CHANNELS.updateProfile)(
      { senderFrame: {} },
      { name: 'Owner A private updated profile' }
    );
    await staleUpdate.started;
    harness.emitAuth('SIGNED_IN', USER_B);
    harness.send.mockClear();

    staleUpdate.resolve({
      data: { display_name: 'Owner A private updated profile' },
      error: null
    });
    const result = await operation;

    expect(result).toMatchObject({
      ok: false,
      code: 'cloud_session_changed',
      state: { user: { id: USER_B.id }, workbooks: [] }
    });
    expect(result).not.toHaveProperty('profile');
    expect(JSON.stringify(result)).not.toContain('Owner A private');
    expect(harness.send).not.toHaveBeenCalled();
    harness.controller.dispose();
  });

  it.each([
    {
      channel: CLOUD_IPC_CHANNELS.uploadWorkbook,
      label: 'upload',
      payload: { expectedRevision: null, portableHtml: 'owner-a-private-portable' },
      rpc: 'save_workbook_snapshot',
      rpcResult: { data: [workbookRow('workbook-a', 2, 'Owner A uploaded')], error: null }
    },
    {
      channel: CLOUD_IPC_CHANNELS.deleteWorkbook,
      label: 'delete',
      payload: { workbookId: 'workbook-a' },
      rpc: 'delete_workbook',
      rpcResult: { data: true, error: null }
    }
  ])('discards a deferred owner A $label result after switching to owner B', async (scenario) => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    harness.controller.registerHandlers();
    const listCallsBeforeMutation = harness.listCallCount;

    const staleRpc = harness.deferNextRpc(scenario.rpc);
    const operation = harness.handlers.get(scenario.channel)({ senderFrame: {} }, scenario.payload);
    await staleRpc.started;
    harness.emitAuth('SIGNED_IN', USER_B);
    harness.send.mockClear();

    staleRpc.resolve(scenario.rpcResult);
    const result = await operation;

    expect(result).toMatchObject({
      ok: false,
      code: 'cloud_session_changed',
      state: { user: { id: USER_B.id }, workbooks: [] }
    });
    expect(result).not.toHaveProperty('metadata');
    expect(result).not.toHaveProperty('id');
    expect(JSON.stringify(result)).not.toContain('Owner A');
    expect(harness.listCallCount).toBe(listCallsBeforeMutation);
    expect(harness.send).not.toHaveBeenCalled();
    harness.controller.dispose();
  });

  it('discards an owner A mutation when its follow-up refresh finishes after an owner switch', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    harness.controller.registerHandlers();

    const uploadRpc = harness.deferNextRpc('save_workbook_snapshot');
    const staleFollowUpList = harness.deferNextList();
    const operation = harness.handlers.get(CLOUD_IPC_CHANNELS.uploadWorkbook)(
      { senderFrame: {} },
      { expectedRevision: null, portableHtml: 'owner-a-private-portable' }
    );
    await uploadRpc.started;
    uploadRpc.resolve({
      data: [workbookRow('workbook-a', 3, 'Owner A uploaded')],
      error: null
    });
    await staleFollowUpList.started;

    harness.emitAuth('SIGNED_IN', USER_B);
    harness.send.mockClear();
    staleFollowUpList.resolve({ data: null, error: { message: 'Owner A list failed' } });
    const result = await operation;

    expect(result).toMatchObject({
      ok: false,
      code: 'cloud_session_changed',
      state: { user: { id: USER_B.id }, workbooks: [] }
    });
    expect(result).not.toHaveProperty('metadata');
    expect(JSON.stringify(result)).not.toContain('Owner A');
    expect(harness.controller.getState().workbooks).toEqual([]);
    expect(harness.send).not.toHaveBeenCalled();
    harness.controller.dispose();
  });

  it('discards a deferred owner A download payload after switching to owner B', async () => {
    const harness = createRealtimeHarness();
    await harness.controller.initialize();
    harness.controller.registerHandlers();

    const staleDownload = harness.deferNextRpc('download_workbook_snapshot');
    const operation = harness.handlers.get(CLOUD_IPC_CHANNELS.downloadWorkbook)(
      { senderFrame: {} },
      { workbookId: 'workbook-a' }
    );
    await staleDownload.started;
    harness.emitAuth('SIGNED_IN', USER_B);
    harness.send.mockClear();

    staleDownload.resolve({
      data: [
        {
          ...workbookRow('workbook-a', 4, 'Owner A downloaded'),
          portable_html: 'owner-a-private-portable'
        }
      ],
      error: null
    });
    const result = await operation;

    expect(result).toMatchObject({
      ok: false,
      code: 'cloud_session_changed',
      state: { user: { id: USER_B.id }, workbooks: [] }
    });
    expect(result).not.toHaveProperty('workbook');
    expect(result).not.toHaveProperty('metadata');
    expect(JSON.stringify(result)).not.toContain('Owner A');
    expect(harness.send).not.toHaveBeenCalled();
    harness.controller.dispose();
  });
});
