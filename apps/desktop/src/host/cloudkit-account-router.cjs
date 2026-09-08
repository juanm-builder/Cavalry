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
const { createCloudKitWebLibrary, cloudKitFailure } = require('./cloudkit-web-library.cjs');

const MUTATIONS = new Set(['save', 'delete', 'publish_conflict', 'clear_conflict']);
const ACCOUNT_OPERATIONS = new Set(['status', 'sync', 'set_connection']);
const MAX_SAVE_RECEIPTS = 256;
const failure = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
const validOwner = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\u0000-\u0020\u007f]/.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const boundedText = (value, maximum) =>
  typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : '';

function failureFields(result, payload) {
  const scope = cloudKitFailure({ code: result.code }, payload || {});
  const errorOperation =
    scope.errorOperation ||
    (['upload', 'delete', 'open', 'conflict', 'refresh'].includes(result.errorOperation)
      ? result.errorOperation
      : '');
  const errorWorkbookId =
    scope.errorWorkbookId ||
    (typeof result.errorWorkbookId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(result.errorWorkbookId)
      ? result.errorWorkbookId
      : '');
  return {
    error: boundedText(result.error, 512) || scope.error,
    code: boundedText(result.code, 96) || scope.code,
    errorDetails: boundedText(result.errorDetails, 1024),
    retryable: result.retryable === true,
    ...(errorOperation ? { errorOperation } : {}),
    ...(errorWorkbookId ? { errorWorkbookId } : {})
  };
}

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
  const acknowledgedSaves = new Map();

  function savedFor(owner) {
    return [...acknowledgedSaves.values()].filter((entry) => entry.userId === owner);
  }

  function rememberSaved(receipt) {
    const key = JSON.stringify([receipt.userId, receipt.workbookId]);
    acknowledgedSaves.delete(key);
    acknowledgedSaves.set(key, { ...receipt });
    if (acknowledgedSaves.size > MAX_SAVE_RECEIPTS)
      acknowledgedSaves.delete(acknowledgedSaves.keys().next().value);
  }

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
      throw Object.assign(
        new Error('The iCloud account changed. Choose the account again before syncing.'),
        { code: 'icloud_account_changed' }
      );
    await restoreSaved(session.userId);
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

  function receiptsKey(owner) {
    return `save-receipts:${CONTAINER}:${ENVIRONMENT}:${owner}`;
  }

  function validReceipt(receipt, owner) {
    return (
      receipt &&
      receipt.userId === owner &&
      validOwner(owner) &&
      typeof receipt.id === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt.id) &&
      typeof receipt.workbookId === 'string' &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(receipt.workbookId) &&
      Number.isSafeInteger(receipt.revision) &&
      receipt.revision > 0
    );
  }

  async function receiptsFor(owner) {
    const stored = await storage.read(receiptsKey(owner));
    if (stored == null) return [];
    if (
      stored.version !== 1 ||
      stored.container !== CONTAINER ||
      stored.environment !== ENVIRONMENT ||
      stored.userId !== owner ||
      !Array.isArray(stored.receipts) ||
      stored.receipts.length > MAX_SAVE_RECEIPTS ||
      stored.receipts.some((receipt) => !validReceipt(receipt, owner)) ||
      new Set(stored.receipts.map((receipt) => receipt.workbookId)).size !==
        stored.receipts.length ||
      new Set(stored.receipts.map((receipt) => receipt.id)).size !== stored.receipts.length
    )
      throw new Error('Saved iCloud acknowledgments are unreadable. Existing copies were kept.');
    // Reconstruct the metadata allowlist; no token or workbook payload belongs here.
    return stored.receipts.map(({ id, userId, workbookId, revision }) => ({
      id,
      userId,
      workbookId,
      revision
    }));
  }

  async function restoreSaved(owner) {
    const receipts = await receiptsFor(owner);
    const pending = new Map((await pendingFor(owner)).map((item) => [item.id, item]));
    for (const receipt of receipts) {
      const item = pending.get(receipt.id);
      if (item && (item.operation !== 'save' || item.workbookId !== receipt.workbookId))
        throw new Error(
          'A saved iCloud acknowledgment does not match its pending workbook. Existing copies were kept.'
        );
    }
    for (const [key, receipt] of acknowledgedSaves)
      if (receipt.userId === owner) acknowledgedSaves.delete(key);
    for (const receipt of receipts) if (!pending.has(receipt.id)) rememberSaved(receipt);
  }

  async function receiptHistoryForSave(owner, item) {
    const receipts = (await receiptsFor(owner)).filter(
      (receipt) => receipt.workbookId !== item.workbookId
    );
    const pendingIds = new Set((await pendingFor(owner)).map((entry) => entry.id));
    while (receipts.length >= MAX_SAVE_RECEIPTS) {
      // A persisted receipt may be the only proof of a completed remote save
      // whose local pointer removal was interrupted. Never evict that proof.
      const oldest = receipts.findIndex((receipt) => !pendingIds.has(receipt.id));
      if (oldest < 0)
        throw new Error('Finish pending iCloud acknowledgments before saving more workbooks.');
      receipts.splice(oldest, 1);
    }
    return receipts;
  }

  async function commitMutation(owner, item, result, history) {
    let receipt;
    if (item.operation === 'save') {
      receipt = {
        id: item.id,
        userId: owner,
        workbookId: result.metadata?.id,
        revision: result.metadata?.revision
      };
      if (
        result.pending === true ||
        !validReceipt(receipt, owner) ||
        receipt.workbookId !== item.workbookId
      )
        throw new Error(
          'The saved iCloud workbook could not be verified. Existing copies were kept.'
        );
      // The existing encrypted storage fsyncs this receipt before the outbox
      // pointer is removed. A restart can finish that local acknowledgment
      // without issuing the already committed remote save a second time.
      await storage.write(receiptsKey(owner), {
        version: 1,
        container: CONTAINER,
        environment: ENVIRONMENT,
        userId: owner,
        receipts: [...history, receipt]
      });
    }
    await acknowledge(owner, item.id);
    if (receipt) rememberSaved(receipt);
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
      const receipt =
        item.operation === 'save'
          ? (await receiptsFor(owner)).find(
              (entry) => entry.id === item.id && entry.workbookId === item.workbookId
            )
          : null;
      if (receipt) {
        await acknowledge(owner, item.id);
        rememberSaved(receipt);
        continue;
      }
      const history = item.operation === 'save' ? await receiptHistoryForSave(owner, item) : null;
      const result = await context.library.request(stored.payload);
      if (!result.ok) {
        firstFailure ||= { ...result, ...failureFields(result, stored.payload) };
        blockedWorkbooks.add(item.workbookId);
        if (['icloud_authentication_required', 'cloud_session_save_failed'].includes(result.code))
          break;
      } else {
        await commitMutation(owner, item, result, history);
      }
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
      workbookSaveAcknowledgements: savedFor(selection.userId),
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
      const failed = cloudKitFailure(error, payload);
      return {
        ...browserStatus(),
        ...failed,
        ...(staged?.operation === 'save' ? { saveOperationId: staged.id } : {}),
        ok: payload.operation === 'status',
        account: {
          status:
            failed.code === 'icloud_authentication_required' ? 'no_account' : 'could_not_determine',
          userId: null
        },
        pendingCount: (await pendingFor(selection.userId)).length
      };
    }
    if (MUTATIONS.has(payload.operation)) {
      const history =
        payload.operation === 'save' ? await receiptHistoryForSave(selection.userId, staged) : null;
      const result = await context.library.request(payload);
      if (result.ok) {
        await commitMutation(selection.userId, staged, result, history);
      }
      return {
        ...result,
        ...(!result.ok ? failureFields(result, payload) : {}),
        ...(payload.operation === 'save' ? { saveOperationId: staged.id } : {}),
        pendingCount: (await pendingFor(selection.userId)).length
      };
    }
    if (['status', 'sync', 'list'].includes(payload.operation)) {
      const flushed = await flush(context);
      const pendingCount = (await pendingFor(selection.userId)).length;
      if (payload.operation === 'status')
        return browserStatus({
          pendingCount,
          ...(!flushed.ok ? failureFields(flushed) : {})
        });
      const result = await context.library.request(
        payload.operation === 'sync' ? { operation: 'list' } : payload
      );
      return {
        ...result,
        workbookSaveAcknowledgements: savedFor(selection.userId),
        pendingCount,
        ...(result.ok && !flushed.ok ? failureFields(flushed) : {})
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
