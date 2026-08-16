// Owns Supabase PKCE authentication and keeps every credential in the Electron main process.
'use strict';

const nodeFs = require('node:fs/promises');
const nodePath = require('node:path');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
const { asString, isPublishableSupabaseKey, normalizeCloudConfig } = require('./cloud-config.cjs');
const { createCloudSessionStorage } = require('./cloud-session-storage.cjs');

const CALLBACK_URL = 'cavalry://auth/callback';
const CLOUD_SESSION_FILE = 'cavalry-cloud-auth.json';
const OAUTH_ATTEMPT_TTL_MS = 5 * 60 * 1000;
const OAUTH_PENDING_STORAGE_KEY = 'cavalry-cloud-oauth-pending-until';
const IDENTITY_AUTHORIZATION_TARGETS = Object.freeze({
  apple: Object.freeze([
    Object.freeze({ origin: 'https://appleid.apple.com', pathname: '/auth/authorize' })
  ])
});
const OAUTH_PROVIDERS = Object.freeze({
  apple: Object.freeze({ id: 'apple', label: 'Apple' }),
  google: Object.freeze({
    id: 'google',
    label: 'Google',
    queryParams: Object.freeze({ prompt: 'select_account' })
  })
});

function oauthProvider(value) {
  return OAUTH_PROVIDERS[asString(value, 32).toLowerCase()] || null;
}

function hasOAuthProvider(user, providerId) {
  const provider = asString(providerId, 32).toLowerCase();
  return !!(provider && user && Array.isArray(user.providers) && user.providers.includes(provider));
}

function parsePendingOAuthAttempt(value) {
  const raw = asString(value, 1024);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const provider = oauthProvider(parsed.provider);
      const expiresAt = Number(parsed.expiresAt);
      const operation = parsed.operation === 'link_identity' ? 'link_identity' : 'sign_in';
      const expectedUserId = asString(parsed.expectedUserId, 128);
      return provider &&
        Number.isSafeInteger(expiresAt) &&
        (operation !== 'link_identity' || expectedUserId)
        ? { expiresAt, expectedUserId, operation, provider }
        : null;
    }
  } catch (_error) {
    // Versions before Apple sign-in stored only the expiry. Preserve that Google attempt.
  }
  const expiresAt = Number(raw);
  return Number.isSafeInteger(expiresAt)
    ? {
        expiresAt,
        expectedUserId: '',
        operation: 'sign_in',
        provider: OAUTH_PROVIDERS.google
      }
    : null;
}

function safeHttpsUrl(value, maximum = 2048) {
  try {
    const parsed = new URL(asString(value, maximum));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
  } catch (_error) {
    return '';
  }
}

function projectCloudUser(user) {
  if (!(user && typeof user === 'object' && user.id)) return null;
  const metadata =
    user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const appMetadata =
    user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {};
  const firstIdentity = Array.isArray(user.identities) ? user.identities[0] : null;
  const providers = Array.from(
    new Set(
      [
        appMetadata.provider,
        ...(Array.isArray(appMetadata.providers) ? appMetadata.providers : []),
        ...(Array.isArray(user.identities)
          ? user.identities.map((identity) => identity && identity.provider)
          : [])
      ]
        .map((provider) => asString(provider, 32).toLowerCase())
        .filter(Boolean)
    )
  );
  const email = asString(user.email, 320);
  return {
    id: asString(user.id, 128),
    email,
    name:
      asString(metadata.full_name || metadata.name, 160) ||
      asString(email.split('@')[0], 160) ||
      'Cavalry user',
    avatarUrl: safeHttpsUrl(metadata.avatar_url || metadata.picture),
    provider: asString(
      appMetadata.provider || (firstIdentity && firstIdentity.provider) || 'google',
      32
    ),
    providers
  };
}

function isAllowedAuthorizationUrl(value, config, expectedPath = '/auth/v1/authorize') {
  try {
    const parsed = new URL(asString(value, 4096));
    return (
      config.configured &&
      parsed.protocol === 'https:' &&
      parsed.origin === config.origin &&
      parsed.pathname === expectedPath &&
      !parsed.username &&
      !parsed.password
    );
  } catch (_error) {
    return false;
  }
}

function isAllowedIdentityAuthorizationUrl(value, config, providerId) {
  if (isAllowedAuthorizationUrl(value, config, '/auth/v1/user/identities/authorize')) return true;
  const targets = IDENTITY_AUTHORIZATION_TARGETS[asString(providerId, 32).toLowerCase()] || [];
  try {
    const parsed = new URL(asString(value, 4096));
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      targets.some(
        (target) => parsed.origin === target.origin && parsed.pathname === target.pathname
      )
    );
  } catch (_error) {
    return false;
  }
}

function publicError(code, message) {
  return { code: asString(code, 64) || 'cloud_error', message: asString(message, 240) };
}

async function hasEncryptedCloudState(readFile, filePath) {
  try {
    const document = JSON.parse(String(await readFile(filePath, 'utf8')));
    const values =
      document && document.values && typeof document.values === 'object' ? document.values : null;
    return !!(
      document &&
      document.version === 1 &&
      document.encryption === 'electron-safe-storage' &&
      values &&
      !Array.isArray(values) &&
      Object.values(values).some((value) => typeof value === 'string' && value.length > 0)
    );
  } catch (_error) {
    return false;
  }
}

function createCloudAuthController(dependencies = {}) {
  const app = dependencies.app;
  const safeStorage = dependencies.safeStorage;
  const shell = dependencies.shell;
  const path = dependencies.path || nodePath;
  const readFile = dependencies.readFile || nodeFs.readFile;
  const createClient = dependencies.createClient || createSupabaseClient;
  const createStorage = dependencies.createStorage || createCloudSessionStorage;
  const now = typeof dependencies.now === 'function' ? dependencies.now : Date.now;
  const scheduleTimeout = dependencies.setTimeout || setTimeout;
  const cancelTimeout = dependencies.clearTimeout || clearTimeout;
  const onStateChange =
    typeof dependencies.onStateChange === 'function' ? dependencies.onStateChange : () => {};
  const config = normalizeCloudConfig({
    supabaseUrl: dependencies.supabaseUrl,
    publishableKey: dependencies.publishableKey
  });

  let client = null;
  let storage = null;
  let authSubscription = null;
  let initializePromise = null;
  let restoreExistingSessionPromise = null;
  let restoreExistingSessionStarted = false;
  let pendingCallback = null;
  let oauthAttemptTimeout = null;
  let authOperationQueue = Promise.resolve();
  let state = {
    configured: config.configured,
    status: config.configured ? 'initializing' : 'unconfigured',
    sessionPersistence: config.configured ? 'pending' : 'none',
    pendingOAuthOperation: '',
    pendingOAuthProvider: '',
    user: null,
    error: config.configured
      ? null
      : publicError('cloud_unconfigured', 'Cavalry Cloud is not configured.')
  };

  function getState() {
    return {
      configured: state.configured === true,
      status: asString(state.status, 32),
      sessionPersistence: asString(state.sessionPersistence, 32),
      pendingOAuthOperation: asString(state.pendingOAuthOperation, 32),
      pendingOAuthProvider: asString(state.pendingOAuthProvider, 32),
      user: state.user ? { ...state.user } : null,
      error: state.error ? { ...state.error } : null
    };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    onStateChange(getState());
    return getState();
  }

  function clearOAuthAttemptTimer() {
    if (oauthAttemptTimeout) cancelTimeout(oauthAttemptTimeout);
    oauthAttemptTimeout = null;
  }

  async function clearPendingOAuthAttempt() {
    if (storage) await storage.removeItem(OAUTH_PENDING_STORAGE_KEY);
    clearOAuthAttemptTimer();
    if (state.pendingOAuthOperation || state.pendingOAuthProvider) {
      setState({ pendingOAuthOperation: '', pendingOAuthProvider: '' });
    }
  }

  async function clearInvalidSession() {
    try {
      if (client) await client.auth.signOut({ scope: 'local' });
    } catch (_error) {
      // The encrypted local record is still cleared below.
    }
    try {
      if (storage) await storage.clear();
      clearOAuthAttemptTimer();
      setState({ pendingOAuthOperation: '', pendingOAuthProvider: '' });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function expirePendingOAuthAttempt(expectedAttempt) {
    let cleared = false;
    try {
      const storedAttempt = parsePendingOAuthAttempt(
        await storage.getItem(OAUTH_PENDING_STORAGE_KEY)
      );
      if (
        !storedAttempt ||
        storedAttempt.expiresAt !== expectedAttempt.expiresAt ||
        storedAttempt.provider.id !== expectedAttempt.provider.id ||
        storedAttempt.operation !== expectedAttempt.operation ||
        storedAttempt.expectedUserId !== expectedAttempt.expectedUserId
      ) {
        return;
      }
      if (expectedAttempt.operation === 'link_identity') {
        await clearPendingOAuthAttempt();
        cleared = true;
      } else {
        cleared = await clearInvalidSession();
      }
    } catch (_error) {
      cleared = false;
    }
    if (expectedAttempt.operation === 'link_identity') {
      if (
        state.status === 'signed_in' &&
        state.user &&
        state.user.id === expectedAttempt.expectedUserId
      ) {
        setState({
          error: publicError(
            cleared ? 'identity_link_timeout' : 'secure_storage_clear_failed',
            cleared
              ? `${expectedAttempt.provider.label} connection expired. You can try again.`
              : 'Cavalry could not securely clear the expired connection attempt.'
          )
        });
      }
      return;
    }
    if (state.status !== 'signing_in') return;
    setState({
      status: cleared ? 'signed_out' : 'error',
      user: null,
      error: publicError(
        cleared ? 'oauth_timeout' : 'secure_storage_clear_failed',
        cleared
          ? `${expectedAttempt.provider.label} sign-in expired. You can try again.`
          : 'Cavalry could not securely clear the expired sign-in attempt.'
      )
    });
  }

  function scheduleOAuthAttemptExpiry(attempt) {
    clearOAuthAttemptTimer();
    const delay = Math.max(0, attempt.expiresAt - now());
    oauthAttemptTimeout = scheduleTimeout(() => {
      void expirePendingOAuthAttempt(attempt);
    }, delay);
    if (oauthAttemptTimeout && typeof oauthAttemptTimeout.unref === 'function') {
      oauthAttemptTimeout.unref();
    }
  }

  async function readPendingOAuthAttempt() {
    if (!storage) return null;
    const stored = await storage.getItem(OAUTH_PENDING_STORAGE_KEY);
    const attempt = parsePendingOAuthAttempt(stored);
    const currentTime = now();
    if (
      attempt &&
      attempt.expiresAt > currentTime &&
      attempt.expiresAt <= currentTime + OAUTH_ATTEMPT_TTL_MS
    ) {
      return attempt;
    }
    if (stored) await storage.removeItem(OAUTH_PENDING_STORAGE_KEY);
    return null;
  }

  async function startPendingOAuthAttempt(provider, operation = 'sign_in', expectedUserId = '') {
    const attempt = {
      expiresAt: now() + OAUTH_ATTEMPT_TTL_MS,
      expectedUserId: asString(expectedUserId, 128),
      operation,
      provider
    };
    await storage.setItem(
      OAUTH_PENDING_STORAGE_KEY,
      JSON.stringify({
        expiresAt: attempt.expiresAt,
        expectedUserId: attempt.expectedUserId,
        operation: attempt.operation,
        provider: provider.id
      })
    );
    scheduleOAuthAttemptExpiry(attempt);
    setState({
      pendingOAuthOperation: attempt.operation,
      pendingOAuthProvider: provider.id
    });
    return attempt;
  }

  function serializeAuthOperation(operation) {
    const result = authOperationQueue.then(operation, operation);
    authOperationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  function getClient() {
    return client;
  }

  async function createSessionBoundClient(expectedUserId) {
    if (!client || !isSignedIn() || typeof client.auth.getSession !== 'function') return null;
    const expectedId = asString(expectedUserId, 128);
    try {
      const result = await client.auth.getSession();
      const session = result && result.data && result.data.session;
      const accessToken = String((session && session.access_token) || '').trim();
      if (
        (result && result.error) ||
        !session ||
        !session.user ||
        asString(session.user.id, 128) !== expectedId ||
        !accessToken
      ) {
        return null;
      }
      return createClient(config.url, config.publishableKey, {
        accessToken: async () => accessToken
      });
    } catch (_error) {
      return null;
    }
  }

  function isSignedIn() {
    return state.status === 'signed_in' && !!state.user && !!client;
  }

  function isInvalidSessionError(error) {
    const status = Number(error && error.status);
    const name = asString(error && error.name, 80);
    return [400, 401, 403].includes(status) || /sessionmissing|invalidcredentials/i.test(name);
  }

  function getSessionFilePath() {
    return path.join(app.getPath('userData'), CLOUD_SESSION_FILE);
  }

  async function recoverSession() {
    const result = await client.auth.getSession();
    if (result.error || !(result.data && result.data.session)) {
      if (result.error && isInvalidSessionError(result.error) && !(await clearInvalidSession())) {
        return setState({
          status: 'error',
          user: null,
          error: publicError(
            'secure_storage_clear_failed',
            'Cavalry could not securely clear an invalid Cloud session.'
          )
        });
      }
      return setState({ status: 'signed_out', user: null, error: null });
    }
    const sessionUser = result.data.session.user;
    const verified = await client.auth.getUser();
    if (verified.error && isInvalidSessionError(verified.error)) {
      if (!(await clearInvalidSession())) {
        return setState({
          status: 'error',
          user: null,
          error: publicError(
            'secure_storage_clear_failed',
            'Cavalry could not securely clear an invalid Cloud session.'
          )
        });
      }
      return setState({ status: 'signed_out', user: null, error: null });
    }
    return setState({
      status: 'signed_in',
      user: projectCloudUser((verified.data && verified.data.user) || sessionUser),
      error: verified.error
        ? publicError('cloud_offline', 'Signed in. Cloud verification is temporarily unavailable.')
        : null
    });
  }

  async function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      if (!config.configured) return getState();
      const filePath = getSessionFilePath();
      storage = createStorage({ filePath, safeStorage });
      if (!(storage && typeof storage.isPersistent === 'function' && storage.isPersistent())) {
        return setState({
          status: 'unavailable',
          sessionPersistence: 'unavailable',
          user: null,
          error: publicError(
            'secure_storage_unavailable',
            'Cavalry Cloud requires secure operating-system credential storage.'
          )
        });
      }
      client = createClient(config.url, config.publishableKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
          persistSession: true,
          storage
        }
      });
      setState({ sessionPersistence: 'secure' });
      const subscription = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          setState({ status: 'signed_out', user: null, error: null });
        } else if (
          session &&
          session.user &&
          ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)
        ) {
          setState({ status: 'signed_in', user: projectCloudUser(session.user), error: null });
        }
      });
      authSubscription = subscription && subscription.data && subscription.data.subscription;
      await recoverSession();
      if (pendingCallback) {
        const callback = pendingCallback;
        pendingCallback = null;
        await processAuthCallback(callback);
      } else {
        const pendingAttempt = await readPendingOAuthAttempt();
        if (pendingAttempt) {
          const validSignIn = pendingAttempt.operation === 'sign_in' && !isSignedIn();
          const validLink =
            pendingAttempt.operation === 'link_identity' &&
            isSignedIn() &&
            state.user.id === pendingAttempt.expectedUserId;
          if (validSignIn || validLink) {
            scheduleOAuthAttemptExpiry(pendingAttempt);
            setState({
              ...(validSignIn ? { status: 'signing_in', user: null, error: null } : {}),
              pendingOAuthOperation: pendingAttempt.operation,
              pendingOAuthProvider: pendingAttempt.provider.id
            });
          } else {
            await clearPendingOAuthAttempt();
          }
        }
      }
      return getState();
    })().catch(async () => {
      if (storage) await storage.clear().catch(() => undefined);
      return setState({
        status: 'error',
        sessionPersistence: storage ? 'secure' : 'unavailable',
        user: null,
        error: publicError('cloud_initialization_failed', 'Cavalry Cloud could not start securely.')
      });
    });
    return initializePromise;
  }

  async function restoreExistingSession() {
    if (initializePromise) return initializePromise;
    if (restoreExistingSessionPromise) return restoreExistingSessionPromise;
    restoreExistingSessionStarted = true;
    restoreExistingSessionPromise = (async () => {
      if (!config.configured) return getState();
      const hasEncryptedState = await hasEncryptedCloudState(readFile, getSessionFilePath());
      if (initializePromise) return initialize();
      if (hasEncryptedState) return initialize();
      if (pendingCallback) {
        pendingCallback = null;
        return rejectUnexpectedOAuthCallback().state;
      }
      return setState({
        status: 'signed_out',
        sessionPersistence: 'pending',
        user: null,
        error: null
      });
    })().catch(() =>
      setState({
        status: 'error',
        sessionPersistence: 'pending',
        user: null,
        error: publicError('cloud_initialization_failed', 'Cavalry Cloud could not start securely.')
      })
    );
    return restoreExistingSessionPromise;
  }

  async function signInWithProvider(providerId) {
    const provider = oauthProvider(providerId);
    if (!provider) return { ok: false, state: getState() };
    await initialize();
    if (!client || state.status === 'unavailable' || state.status === 'unconfigured') {
      return { ok: false, state: getState() };
    }
    if (isSignedIn() || state.user) {
      return {
        ok: false,
        error: `Sign out before choosing a different ${provider.label} account.`,
        state: getState()
      };
    }
    const pendingAttempt = await readPendingOAuthAttempt();
    if (pendingAttempt) {
      scheduleOAuthAttemptExpiry(pendingAttempt);
      setState({
        pendingOAuthOperation: pendingAttempt.operation,
        pendingOAuthProvider: pendingAttempt.provider.id
      });
      return {
        ok: false,
        error: `${pendingAttempt.provider.label} authentication is already in progress.`,
        state: getState()
      };
    }
    setState({ status: 'signing_in', user: null, error: null });
    let attemptStarted = false;
    try {
      const result = await client.auth.signInWithOAuth({
        provider: provider.id,
        options: {
          redirectTo: CALLBACK_URL,
          skipBrowserRedirect: true,
          ...(provider.queryParams ? { queryParams: provider.queryParams } : {})
        }
      });
      const authorizationUrl = result && result.data && result.data.url;
      if (result.error || !isAllowedAuthorizationUrl(authorizationUrl, config)) {
        throw new Error('authorization_failed');
      }
      await startPendingOAuthAttempt(provider);
      attemptStarted = true;
      await shell.openExternal(authorizationUrl);
      return { ok: true, state: getState() };
    } catch (_error) {
      if (attemptStarted) await clearPendingOAuthAttempt().catch(() => undefined);
      setState({
        status: 'signed_out',
        user: null,
        error: publicError(
          `${provider.id}_sign_in_failed`,
          `${provider.label} sign-in could not be started.`
        )
      });
      return { ok: false, state: getState() };
    }
  }

  function signInWithApple() {
    return serializeAuthOperation(() => signInWithProvider('apple'));
  }

  function signInWithGoogle() {
    return serializeAuthOperation(() => signInWithProvider('google'));
  }

  async function linkIdentityWithProvider(providerId) {
    const provider = oauthProvider(providerId);
    if (!provider) return { ok: false, state: getState() };
    await initialize();
    if (!client || !isSignedIn() || !state.user) {
      return {
        ok: false,
        error: `Sign in before connecting ${provider.label}.`,
        state: getState()
      };
    }
    if (hasOAuthProvider(state.user, provider.id)) {
      return { ok: true, alreadyLinked: true, state: getState() };
    }
    const pendingAttempt = await readPendingOAuthAttempt();
    if (pendingAttempt) {
      scheduleOAuthAttemptExpiry(pendingAttempt);
      setState({
        pendingOAuthOperation: pendingAttempt.operation,
        pendingOAuthProvider: pendingAttempt.provider.id
      });
      return {
        ok: false,
        error: `${pendingAttempt.provider.label} authentication is already in progress.`,
        state: getState()
      };
    }
    const expectedUserId = state.user.id;
    let attemptStarted = false;
    try {
      const result = await client.auth.linkIdentity({
        provider: provider.id,
        options: {
          redirectTo: CALLBACK_URL,
          skipBrowserRedirect: true
        }
      });
      const authorizationUrl = result && result.data && result.data.url;
      if (
        result.error ||
        !isAllowedIdentityAuthorizationUrl(authorizationUrl, config, provider.id)
      ) {
        throw new Error('authorization_failed');
      }
      await startPendingOAuthAttempt(provider, 'link_identity', expectedUserId);
      attemptStarted = true;
      await shell.openExternal(authorizationUrl);
      setState({ error: null });
      return { ok: true, state: getState() };
    } catch (_error) {
      if (attemptStarted) await clearPendingOAuthAttempt().catch(() => undefined);
      setState({
        error: publicError(
          `${provider.id}_link_failed`,
          `${provider.label} could not be connected to this Cavalry Cloud account.`
        )
      });
      return { ok: false, state: getState() };
    }
  }

  function linkAppleIdentity() {
    return serializeAuthOperation(() => linkIdentityWithProvider('apple'));
  }

  function rejectUnexpectedOAuthCallback() {
    const rejectedState = setState({
      status:
        state.user || ['unavailable', 'unconfigured'].includes(state.status)
          ? state.status
          : 'signed_out',
      error: publicError(
        'oauth_callback_unexpected',
        'Cavalry ignored a sign-in callback that did not match a pending request.'
      )
    });
    return { ok: false, error: rejectedState.error.message, state: rejectedState };
  }

  async function processAuthCallback(callback) {
    if (!client) return { ok: false, state: getState() };
    let pendingAttempt = null;
    try {
      pendingAttempt = await readPendingOAuthAttempt();
    } catch (_error) {
      setState({
        status: isSignedIn() ? 'signed_in' : 'error',
        error: publicError(
          'secure_storage_unavailable',
          'Cavalry could not verify the pending sign-in securely.'
        )
      });
      return { ok: false, error: state.error.message, state: getState() };
    }
    if (!pendingAttempt) {
      return rejectUnexpectedOAuthCallback();
    }
    const linkingIdentity = pendingAttempt.operation === 'link_identity';
    if (!(callback && callback.ok && callback.code)) {
      if (linkingIdentity) {
        let cleared = false;
        try {
          await clearPendingOAuthAttempt();
          cleared = true;
        } catch (_error) {
          cleared = false;
        }
        const sameUser =
          state.status === 'signed_in' &&
          state.user &&
          state.user.id === pendingAttempt.expectedUserId;
        setState({
          status: sameUser ? 'signed_in' : 'error',
          user: sameUser ? state.user : null,
          error: publicError(
            cleared ? 'identity_link_cancelled' : 'secure_storage_clear_failed',
            cleared
              ? `${pendingAttempt.provider.label} was not connected.`
              : 'Cavalry could not securely clear the cancelled connection attempt.'
          )
        });
        return { ok: false, error: state.error.message, state: getState() };
      }
      const cleared = await clearInvalidSession();
      setState({
        status: cleared ? 'signed_out' : 'error',
        user: null,
        error: publicError(
          cleared
            ? /^[a-z0-9_]{1,64}$/i.test(String(callback && callback.errorCode))
              ? callback.errorCode
              : 'oauth_cancelled'
            : 'secure_storage_clear_failed',
          cleared
            ? `${pendingAttempt.provider.label} sign-in was cancelled or denied.`
            : 'Cavalry could not securely clear the cancelled sign-in attempt.'
        )
      });
      return { ok: false, error: state.error.message, state: getState() };
    }
    if (linkingIdentity) setState({ error: null });
    else setState({ status: 'signing_in', user: null, error: null });
    try {
      const exchanged = await client.auth.exchangeCodeForSession(callback.code);
      if (exchanged.error || !(exchanged.data && exchanged.data.session))
        throw new Error('exchange');
      const verified = await client.auth.getUser();
      if (verified.error || !(verified.data && verified.data.user)) throw new Error('verify');
      const projectedUser = projectCloudUser(verified.data.user);
      if (
        !projectedUser ||
        !hasOAuthProvider(projectedUser, pendingAttempt.provider.id) ||
        (linkingIdentity && projectedUser.id !== pendingAttempt.expectedUserId)
      ) {
        throw new Error(linkingIdentity ? 'identity_link_mismatch' : 'oauth_provider_mismatch');
      }
      await clearPendingOAuthAttempt();
      setState({ status: 'signed_in', user: projectedUser, error: null });
      return { ok: true, state: getState() };
    } catch (_error) {
      if (linkingIdentity) {
        const sameUser =
          state.status === 'signed_in' &&
          state.user &&
          state.user.id === pendingAttempt.expectedUserId;
        let cleared = false;
        try {
          await clearPendingOAuthAttempt();
          cleared = true;
        } catch (_clearError) {
          cleared = false;
        }
        if (sameUser) {
          setState({
            status: 'signed_in',
            user: state.user,
            error: publicError(
              cleared ? 'identity_link_failed' : 'secure_storage_clear_failed',
              cleared
                ? `${pendingAttempt.provider.label} could not be connected. Try again.`
                : 'Cavalry could not securely clear the failed connection attempt.'
            )
          });
          return { ok: false, error: state.error.message, state: getState() };
        }
      }
      const cleared = await clearInvalidSession();
      setState({
        status: cleared ? 'signed_out' : 'error',
        user: null,
        error: publicError(
          cleared ? 'oauth_exchange_failed' : 'secure_storage_clear_failed',
          cleared
            ? `${pendingAttempt.provider.label} sign-in could not be completed. Try again.`
            : 'Cavalry could not securely clear the failed sign-in attempt.'
        )
      });
      return { ok: false, error: state.error.message, state: getState() };
    }
  }

  async function handleAuthCallbackInternal(callback) {
    if (!initializePromise && !restoreExistingSessionStarted) {
      pendingCallback = callback;
      return { ok: true, pending: true, state: getState() };
    }
    if (!initializePromise) {
      await restoreExistingSession();
      if (!initializePromise) return rejectUnexpectedOAuthCallback();
    }
    await initialize();
    return processAuthCallback(callback);
  }

  function handleAuthCallback(callback) {
    return serializeAuthOperation(() => handleAuthCallbackInternal(callback));
  }

  async function signOutInternal() {
    await initialize();
    const previousUser = state.user;
    try {
      if (client) await client.auth.signOut({ scope: 'local' });
    } catch (_error) {
      // Local secure-state removal is authoritative for this device.
    }
    try {
      if (storage) await storage.clear();
      clearOAuthAttemptTimer();
    } catch (_error) {
      setState({
        status: 'error',
        user: previousUser,
        error: publicError(
          'secure_sign_out_failed',
          'Cavalry could not securely remove this device session. Quit and try again.'
        )
      });
      return { ok: false, error: state.error.message, state: getState() };
    }
    setState({
      status: 'signed_out',
      pendingOAuthOperation: '',
      pendingOAuthProvider: '',
      user: null,
      error: null
    });
    return { ok: true, state: getState() };
  }

  function signOut() {
    return serializeAuthOperation(signOutInternal);
  }

  function dispose() {
    clearOAuthAttemptTimer();
    if (authSubscription && typeof authSubscription.unsubscribe === 'function') {
      authSubscription.unsubscribe();
    }
    authSubscription = null;
    if (client && client.auth && typeof client.auth.stopAutoRefresh === 'function') {
      client.auth.stopAutoRefresh();
    }
  }

  return {
    createSessionBoundClient,
    dispose,
    getClient,
    getState,
    handleAuthCallback,
    initialize,
    isSignedIn,
    linkAppleIdentity,
    restoreExistingSession,
    signInWithApple,
    signInWithGoogle,
    signOut
  };
}

module.exports = {
  CALLBACK_URL,
  OAUTH_ATTEMPT_TTL_MS,
  OAUTH_PENDING_STORAGE_KEY,
  createCloudAuthController,
  isPublishableSupabaseKey,
  isAllowedAuthorizationUrl,
  isAllowedIdentityAuthorizationUrl,
  normalizeCloudConfig,
  parsePendingOAuthAttempt,
  projectCloudUser
};
