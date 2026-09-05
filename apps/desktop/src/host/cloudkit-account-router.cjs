'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCloudKitWebStorage } = require('./cloudkit-web-storage.cjs');
const {
  createCloudKitWebApi,
  CONTAINER,
  ENVIRONMENT,
  AUTH_ERRORS,
  validSessionToken
} = require('./cloudkit-web-api.cjs');
const { authenticateInBrowser } = require('./cloudkit-browser-auth.cjs');
const { createCloudKitWebLibrary } = require('./cloudkit-web-library.cjs');

const MUTATIONS = new Set(['save', 'delete', 'publish_conflict', 'clear_conflict']);
const ACCOUNT_OPERATIONS = new Set(['status', 'sync', 'set_connection']);
const failure = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
const validOwner = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\u0000-\u0020\u007f]/.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

async function readCloudKitWebConfig(userDataDir) {
  // This is a public container API token, not an Apple password or server key.
  // A release can embed it; a local setup can supply the same public value.
  const bundledToken = process.env.CAVALRY_CLOUDKIT_WEB_API_TOKEN || '';
  let apiToken = bundledToken;
  if (!apiToken) {
    try {
      const data = await fs.readFile(path.join(userDataDir, 'CloudKit Web', 'config.json'), 'utf8');
      if (data.length > 8192) return { apiToken: '' };
      apiToken = JSON.parse(data).apiToken;
    } catch (_error) {
      /* Missing or malformed setup never disables device iCloud. */
    }
  }
  return {
    apiToken:
      typeof apiToken === 'string' && /^[A-Za-z0-9._-]{16,2048}$/.test(apiToken) ? apiToken : ''
  };
}

function createCloudKitAccountRouter(options) {
  const { native, userDataDir, safeStorage, openExternal } = options;
  const storage =
    options.storage ||
    createCloudKitWebStorage({
      rootDir: path.join(userDataDir, 'CloudKit Web', 'private'),
      safeStorage
    });
  const authenticate = options.authenticate || authenticateInBrowser;
  const makeApi = options.createApi || createCloudKitWebApi;
  const makeLibrary = options.createLibrary || createCloudKitWebLibrary;
  let config = options.config || null;
  let selection;
  let nativeOwner = '';
  let serial = Promise.resolve();
  let disposed = false;
  let initialization;
  let authenticationController;
  let authenticationCommitting = false;

  async function initialize() {
    if (!initialization)
      initialization = (async () => {
        config ||= await readCloudKitWebConfig(userDataDir);
        const stored = await storage.read('selection');
        if (
          stored &&
          (stored.version !== 1 ||
            !['system', 'browser'].includes(stored.source) ||
            typeof stored.paused !== 'boolean' ||
            typeof stored.signedOut !== 'boolean' ||
            (stored.source === 'browser' &&
              (!validOwner(stored.userId) || stored.environment !== ENVIRONMENT)))
        )
          throw new Error(
            'The saved iCloud account choice is unreadable. Existing workbooks were kept.'
          );
        selection = stored || {
          version: 1,
          source: 'system',
          paused: false,
          signedOut: false,
          userId: ''
        };
        if (selection.source === 'browser' || selection.signedOut || selection.paused) {
          const stopped = await native.request({ operation: 'set_connection', enabled: false });
          if (!stopped.ok)
            throw new Error(
              'Cavalry could not pause device iCloud before restoring the selected library.'
            );
        }
      })();
    await initialization;
  }

  function details() {
    return {
      accountSource: selection?.source || 'system',
      syncPaused: selection?.paused === true,
      accountSignedOut: selection?.signedOut === true,
      browserSignInAvailable: Boolean(config?.apiToken),
      browserSignInUnavailableReason: config?.apiToken
        ? ''
        : 'Browser sign-in is not available in this build yet. You can still use this Mac’s iCloud.'
    };
  }

  function serialize(operation) {
    const task = serial.then(async () => {
      if (disposed) return failure('cloud_stopped', 'The iCloud connection has stopped.');
      try {
        await initialize();
        return await operation();
      } catch (error) {
        return failure(
          'cloud_account_unavailable',
          error?.message ||
            'Cavalry could not open the selected iCloud account. Local workbooks are kept.'
        );
      }
    });
    serial = task.catch(() => undefined);
    return task;
  }

  async function saveSelection(next) {
    await storage.write('selection', next);
    selection = next;
  }

  async function browserContext() {
    if (!config.apiToken)
      throw new Error('Browser iCloud sign-in has not been configured for this build.');
    const session = await storage.read(`browser-session:${selection.userId}`);
    if (
      !session ||
      session.container !== CONTAINER ||
      session.environment !== ENVIRONMENT ||
      !validOwner(session.userId) ||
      session.userId !== selection.userId ||
      !validSessionToken(session.token)
    ) {
      throw Object.assign(
        new Error('Sign in again to resume iCloud syncing. Local workbooks are kept.'),
        { code: 'AUTHENTICATION_REQUIRED' }
      );
    }
    const api = makeApi({
      apiToken: config.apiToken,
      session,
      persistSession: (value) => storage.write(`browser-session:${session.userId}`, value),
      fetch: options.fetch
    });
    const identity = await api('users/current');
    if (identity.userRecordName !== session.userId)
      throw new Error('The iCloud account changed. Choose the account again before syncing.');
    const library = makeLibrary({ api, fetch: options.fetch, now: options.now });
    return { session, library };
  }

  function outboxKey(owner) {
    return `outbox:${CONTAINER}:${ENVIRONMENT}:${owner}`;
  }
  function payloadKey(owner, id) {
    return `${outboxKey(owner)}:${id}`;
  }

  async function pendingFor(owner) {
    const state = await storage.read(outboxKey(owner));
    if (state == null) return [];
    if (
      !Array.isArray(state) ||
      state.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          !/^[a-z0-9-]{36}$/.test(item.id) ||
          typeof item.workbookId !== 'string' ||
          !MUTATIONS.has(item.operation)
      )
    )
      throw new Error('Unsent iCloud changes are unreadable. Existing copies were kept.');
    return state;
  }

  async function stage(owner, payload) {
    const pending = await pendingFor(owner);
    const item = {
      id: crypto.randomUUID(),
      workbookId: payload.workbookId,
      operation: payload.operation
    };
    // Payload first, pointer second. Interrupted/unindexed payloads are retained.
    await storage.write(payloadKey(owner, item.id), { owner, payload });
    const supersedes = (entry) =>
      entry.workbookId === item.workbookId &&
      (item.operation === 'delete' ||
        (item.operation === 'save'
          ? ['save', 'delete'].includes(entry.operation)
          : ['publish_conflict', 'clear_conflict'].includes(entry.operation)));
    const retired = pending.filter(supersedes);
    const next = [...pending.filter((entry) => !supersedes(entry)), item];
    await storage.write(outboxKey(owner), next);
    for (const entry of retired)
      await storage.remove?.(payloadKey(owner, entry.id)).catch(() => undefined);
    return item;
  }

  async function acknowledge(owner, id) {
    const pending = await pendingFor(owner);
    await storage.write(
      outboxKey(owner),
      pending.filter((item) => item.id !== id)
    );
    // Local workbook history already retains prior saves. Reclaim only this
    // known, acknowledged entry after the outbox pointer is durably committed.
    await storage.remove?.(payloadKey(owner, id)).catch(() => undefined);
  }

  async function flush(context) {
    const owner = context.session.userId;
    let firstFailure = null;
    const blockedWorkbooks = new Set();
    for (const item of await pendingFor(owner)) {
      if (blockedWorkbooks.has(item.workbookId)) continue;
      const stored = await storage.read(payloadKey(owner, item.id));
      if (
        !stored ||
        stored.owner !== owner ||
        stored.payload?.workbookId !== item.workbookId ||
        stored.payload?.operation !== item.operation
      )
        throw new Error('An unsent workbook could not be verified. Existing copies were kept.');
      const result = await context.library.request(stored.payload);
      if (!result.ok) {
        firstFailure ||= result;
        blockedWorkbooks.add(item.workbookId);
        if (['icloud_authentication_required', 'cloud_session_save_failed'].includes(result.code))
          break;
      } else await acknowledge(owner, item.id);
    }
    return firstFailure || { ok: true };
  }

  function browserStatus(extra = {}) {
    return {
      ok: true,
      cloudEnvironment: ENVIRONMENT,
      account: {
        status: selection.signedOut ? 'no_account' : 'available',
        userId: selection.signedOut ? null : selection.userId
      },
      ...details(),
      ...extra
    };
  }

  async function nativeRequest(payload) {
    if (!ACCOUNT_OPERATIONS.has(payload.operation)) {
      const expected = payload.expectedAccountId || nativeOwner || selection.userId;
      if (!validOwner(expected))
        return failure(
          'icloud_account_unavailable',
          'Check the iCloud account before opening its workbooks.'
        );
      const result = await native.request({ ...payload, expectedAccountId: expected });
      return { ...result, ...details() };
    }
    const result = await native.request(payload);
    if (result.ok && result.account?.status === 'available' && validOwner(result.account.userId))
      nativeOwner = result.account.userId;
    return { ...result, ...details() };
  }

  async function requestInner(payload) {
    if (payload.operation === 'set_connection') {
      if (typeof payload.enabled !== 'boolean')
        return failure('invalid_cloudkit_request', 'Choose whether to pause iCloud syncing.');
      if (selection.signedOut)
        return failure('icloud_signed_out', 'Choose an Apple Account to reconnect Cavalry.');
      if (selection.source === 'system') {
        if (!nativeOwner) await nativeRequest({ operation: 'status' });
        const result = await nativeRequest(payload);
        if (!result.ok) return result;
        await saveSelection({
          ...selection,
          paused: !payload.enabled,
          userId: nativeOwner || selection.userId
        });
        return {
          ...result,
          ...details(),
          ...(!payload.enabled && selection.userId
            ? { account: { status: 'available', userId: selection.userId } }
            : {})
        };
      }
      await saveSelection({ ...selection, paused: !payload.enabled });
      return payload.enabled ? requestInner({ operation: 'status' }) : browserStatus();
    }
    if (selection.signedOut)
      return payload.operation === 'status'
        ? {
            ok: true,
            account: { status: 'no_account', userId: null },
            cloudEnvironment: selection.source === 'browser' ? ENVIRONMENT : '',
            ...details(),
            workbooks: []
          }
        : failure(
            'icloud_signed_out',
            'Choose an Apple Account before opening or changing its iCloud workbooks.'
          );
    if (selection.paused) {
      if (payload.operation === 'status')
        return {
          ok: true,
          account: {
            status: validOwner(selection.userId) ? 'available' : 'disconnected',
            userId: selection.userId || null
          },
          cloudEnvironment: selection.environment || ENVIRONMENT,
          ...details()
        };
      return failure(
        'icloud_sync_paused',
        'iCloud syncing is paused. Your local workbooks remain available.'
      );
    }
    if (selection.source === 'system') return nativeRequest(payload);
    if (payload.expectedAccountId && payload.expectedAccountId !== selection.userId)
      return failure(
        'icloud_account_changed',
        'The selected iCloud account changed. Try again from its library.'
      );
    // Stage the verified owner's intent before reaching the network. Expired
    // authentication/offline work stays with this owner through a later switch.
    const staged = MUTATIONS.has(payload.operation) ? await stage(selection.userId, payload) : null;
    let context;
    try {
      context = await browserContext();
    } catch (error) {
      const code = error.code || 'cloud_account_unavailable';
      return {
        ...browserStatus(),
        ok: payload.operation === 'status',
        account: {
          status: AUTH_ERRORS.has(code) ? 'no_account' : 'could_not_determine',
          userId: null
        },
        code,
        error: error.message,
        pendingCount: (await pendingFor(selection.userId)).length
      };
    }
    if (MUTATIONS.has(payload.operation)) {
      const result = await context.library.request(payload);
      if (result.ok) await acknowledge(selection.userId, staged.id);
      return { ...result, pendingCount: (await pendingFor(selection.userId)).length };
    }
    if (['status', 'sync', 'list'].includes(payload.operation)) {
      const flushed = await flush(context);
      const pendingCount = (await pendingFor(selection.userId)).length;
      if (payload.operation === 'status')
        return browserStatus({
          pendingCount,
          ...(!flushed.ok ? { error: flushed.error, code: flushed.code } : {})
        });
      const result = await context.library.request(
        payload.operation === 'sync' ? { operation: 'list' } : payload
      );
      return {
        ...result,
        pendingCount,
        ...(!flushed.ok ? { error: flushed.error, code: flushed.code } : {})
      };
    }
    return context.library.request(payload);
  }

  async function choose(source) {
    if (!['system', 'browser'].includes(source))
      return failure('invalid_account_source', 'Choose an Apple Account connection.');
    if (source === 'system') {
      const result = await native.request({ operation: 'set_connection', enabled: true });
      if (
        !result.ok ||
        result.account?.status !== 'available' ||
        !validOwner(result.account.userId)
      ) {
        if (selection.source === 'browser' || selection.signedOut || selection.paused)
          await native.request({ operation: 'set_connection', enabled: false });
        return failure(
          'icloud_account_unavailable',
          'This Mac’s iCloud account is unavailable. The previous library was kept.'
        );
      }
      try {
        await saveSelection({
          version: 1,
          source,
          paused: false,
          signedOut: false,
          userId: result.account.userId,
          environment: result.cloudEnvironment
        });
      } catch (error) {
        await native.request({ operation: 'set_connection', enabled: false });
        throw error;
      }
      nativeOwner = result.account.userId;
      return { ...result, ...details() };
    }
    if (!config.apiToken)
      return failure('browser_icloud_unconfigured', details().browserSignInUnavailableReason);
    authenticationController = new AbortController();
    const signal = authenticationController.signal;
    const candidate = { token: '', container: CONTAINER, environment: ENVIRONMENT, userId: '' };
    const candidateApi = makeApi({
      apiToken: config.apiToken,
      session: candidate,
      persistSession: (value) => storage.write('browser-candidate', value),
      fetch: options.fetch
    });
    let redirectURL = '';
    try {
      await candidateApi('users/current');
    } catch (error) {
      if (!AUTH_ERRORS.has(error.code)) throw error;
      redirectURL = error.redirectURL;
    }
    if (!redirectURL) throw new Error('Apple did not provide an account sign-in page.');
    if (signal.aborted) return { ok: false, canceled: true };
    const token = await authenticate({ redirectURL, openExternal, signal });
    if (!token) return { ok: false, canceled: true };
    if (!validSessionToken(token)) throw new Error('Apple returned an invalid sign-in response.');
    candidate.token = token;
    const identity = await candidateApi('users/current');
    if (signal.aborted) return { ok: false, canceled: true };
    if (!validOwner(identity.userRecordName))
      throw new Error('Apple did not confirm the selected iCloud account.');
    candidate.userId = identity.userRecordName;
    const previous = clone(selection);
    const stopped = await native.request({ operation: 'set_connection', enabled: false });
    if (!stopped.ok) throw new Error('Cavalry could not pause the previous iCloud connection.');
    if (signal.aborted) {
      if (previous.source === 'system' && !previous.paused && !previous.signedOut)
        await native.request({ operation: 'set_connection', enabled: true });
      return { ok: false, canceled: true };
    }
    try {
      await storage.write(`browser-session:${candidate.userId}`, candidate);
      if (signal.aborted) {
        if (previous.source === 'system' && !previous.paused && !previous.signedOut)
          await native.request({ operation: 'set_connection', enabled: true });
        return { ok: false, canceled: true };
      }
      authenticationCommitting = true;
      await saveSelection({
        version: 1,
        source,
        paused: false,
        signedOut: false,
        userId: candidate.userId,
        environment: ENVIRONMENT
      });
    } catch (error) {
      // A rename followed by directory-fsync failure has an uncertain outcome.
      // Leave native sync stopped; restarting re-reads the durable choice.
      selection = { ...previous, paused: true };
      throw error;
    }
    return browserStatus();
  }

  return {
    request: (payload) => serialize(() => requestInner(payload)),
    selectAccount: ({ source }) =>
      serialize(async () => {
        try {
          return await choose(source);
        } finally {
          // Scratch authentication is never a resumable account. Only the
          // verified owner's committed session may survive this attempt.
          await storage.remove?.('browser-candidate').catch(() => undefined);
          authenticationController = null;
          authenticationCommitting = false;
        }
      }),
    cancelAccountSignIn: () => {
      if (authenticationCommitting)
        return failure(
          'cloud_account_commit_in_progress',
          'The account change is finishing. Please wait.'
        );
      authenticationController?.abort();
      return { ok: true, canceled: true };
    },
    signOut: () =>
      serialize(async () => {
        const result = await native.request({ operation: 'set_connection', enabled: false });
        if (!result.ok) return result;
        await saveSelection({ ...selection, signedOut: true, paused: false });
        if (selection.source === 'browser' && selection.userId)
          await storage.write(`browser-session:${selection.userId}`, null);
        await storage.remove?.('browser-candidate');
        return {
          ok: true,
          account: { status: 'no_account', userId: null },
          cloudEnvironment: '',
          ...details()
        };
      }),
    details,
    usesNativeEvents: () =>
      selection?.source !== 'browser' && !selection?.signedOut && !selection?.paused,
    dispose: () => {
      disposed = true;
      authenticationController?.abort();
    }
  };
}

module.exports = { readCloudKitWebConfig, createCloudKitAccountRouter };
