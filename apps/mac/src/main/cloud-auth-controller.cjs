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
    )
  };
}

function isAllowedAuthorizationUrl(value, config) {
  try {
    const parsed = new URL(asString(value, 4096));
    return (
      config.configured &&
      parsed.protocol === 'https:' &&
      parsed.origin === config.origin &&
      parsed.pathname === '/auth/v1/authorize' &&
      !parsed.username &&
      !parsed.password
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
  let state = {
    configured: config.configured,
    status: config.configured ? 'initializing' : 'unconfigured',
    sessionPersistence: config.configured ? 'pending' : 'none',
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
    clearOAuthAttemptTimer();
    if (storage) await storage.removeItem(OAUTH_PENDING_STORAGE_KEY);
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
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function expirePendingOAuthAttempt(expectedExpiry) {
    let cleared = false;
    try {
      const storedExpiry = Number(await storage.getItem(OAUTH_PENDING_STORAGE_KEY));
      if (storedExpiry !== expectedExpiry) return;
      cleared = await clearInvalidSession();
    } catch (_error) {
      cleared = false;
    }
    if (state.status !== 'signing_in') return;
    setState({
      status: cleared ? 'signed_out' : 'error',
      user: null,
      error: publicError(
        cleared ? 'oauth_timeout' : 'secure_storage_clear_failed',
        cleared
          ? 'Google sign-in expired. You can try again.'
          : 'Cavalry could not securely clear the expired sign-in attempt.'
      )
    });
  }

  function scheduleOAuthAttemptExpiry(expiresAt) {
    clearOAuthAttemptTimer();
    const delay = Math.max(0, expiresAt - now());
    oauthAttemptTimeout = scheduleTimeout(() => {
      void expirePendingOAuthAttempt(expiresAt);
    }, delay);
    if (oauthAttemptTimeout && typeof oauthAttemptTimeout.unref === 'function') {
      oauthAttemptTimeout.unref();
    }
  }

  async function readPendingOAuthAttempt() {
    if (!storage) return 0;
    const expiresAt = Number(await storage.getItem(OAUTH_PENDING_STORAGE_KEY));
    if (
      Number.isSafeInteger(expiresAt) &&
      expiresAt > now() &&
      expiresAt <= now() + OAUTH_ATTEMPT_TTL_MS
    ) {
      return expiresAt;
    }
    if (expiresAt) await storage.removeItem(OAUTH_PENDING_STORAGE_KEY);
    return 0;
  }

  async function startPendingOAuthAttempt() {
    const expiresAt = now() + OAUTH_ATTEMPT_TTL_MS;
    await storage.setItem(OAUTH_PENDING_STORAGE_KEY, String(expiresAt));
    scheduleOAuthAttemptExpiry(expiresAt);
    return expiresAt;
  }

  function getClient() {
    return client;
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
      } else if (!isSignedIn()) {
        const pendingExpiry = await readPendingOAuthAttempt();
        if (pendingExpiry) {
          scheduleOAuthAttemptExpiry(pendingExpiry);
          setState({ status: 'signing_in', user: null, error: null });
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

  async function signInWithGoogle() {
    await initialize();
    if (!client || state.status === 'unavailable' || state.status === 'unconfigured') {
      return { ok: false, state: getState() };
    }
    if (isSignedIn() || state.user) {
      return {
        ok: false,
        error: 'Sign out before choosing a different Google account.',
        state: getState()
      };
    }
    setState({ status: 'signing_in', user: null, error: null });
    let attemptStarted = false;
    try {
      const result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: CALLBACK_URL,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' }
        }
      });
      const authorizationUrl = result && result.data && result.data.url;
      if (result.error || !isAllowedAuthorizationUrl(authorizationUrl, config)) {
        throw new Error('authorization_failed');
      }
      await startPendingOAuthAttempt();
      attemptStarted = true;
      await shell.openExternal(authorizationUrl);
      return { ok: true, state: getState() };
    } catch (_error) {
      if (attemptStarted) await clearPendingOAuthAttempt().catch(() => undefined);
      setState({
        status: 'signed_out',
        user: null,
        error: publicError('google_sign_in_failed', 'Google sign-in could not be started.')
      });
      return { ok: false, state: getState() };
    }
  }

  function rejectUnexpectedOAuthCallback() {
    const rejectedState = setState({
      status:
        state.user || ['unavailable', 'unconfigured'].includes(state.status)
          ? state.status
          : 'signed_out',
      error: publicError(
        'oauth_callback_unexpected',
        'Cavalry ignored a Google callback that did not match a pending sign-in.'
      )
    });
    return { ok: false, error: rejectedState.error.message, state: rejectedState };
  }

  async function processAuthCallback(callback) {
    if (!client) return { ok: false, state: getState() };
    let pendingExpiry = 0;
    try {
      pendingExpiry = await readPendingOAuthAttempt();
    } catch (_error) {
      setState({
        status: 'error',
        error: publicError(
          'secure_storage_unavailable',
          'Cavalry could not verify the pending Google sign-in securely.'
        )
      });
      return { ok: false, error: state.error.message, state: getState() };
    }
    if (!pendingExpiry) {
      return rejectUnexpectedOAuthCallback();
    }
    if (!(callback && callback.ok && callback.code)) {
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
            ? 'Google sign-in was cancelled or denied.'
            : 'Cavalry could not securely clear the cancelled sign-in attempt.'
        )
      });
      return { ok: false, error: state.error.message, state: getState() };
    }
    setState({ status: 'signing_in', user: null, error: null });
    try {
      const exchanged = await client.auth.exchangeCodeForSession(callback.code);
      if (exchanged.error || !(exchanged.data && exchanged.data.session))
        throw new Error('exchange');
      const verified = await client.auth.getUser();
      if (verified.error || !(verified.data && verified.data.user)) throw new Error('verify');
      await clearPendingOAuthAttempt();
      setState({ status: 'signed_in', user: projectCloudUser(verified.data.user), error: null });
      return { ok: true, state: getState() };
    } catch (_error) {
      const cleared = await clearInvalidSession();
      setState({
        status: cleared ? 'signed_out' : 'error',
        user: null,
        error: publicError(
          cleared ? 'oauth_exchange_failed' : 'secure_storage_clear_failed',
          cleared
            ? 'Google sign-in could not be completed. Try again.'
            : 'Cavalry could not securely clear the failed sign-in attempt.'
        )
      });
      return { ok: false, error: state.error.message, state: getState() };
    }
  }

  async function handleAuthCallback(callback) {
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

  async function signOut() {
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
    setState({ status: 'signed_out', user: null, error: null });
    return { ok: true, state: getState() };
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
    dispose,
    getClient,
    getState,
    handleAuthCallback,
    initialize,
    isSignedIn,
    restoreExistingSession,
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
  normalizeCloudConfig,
  projectCloudUser
};
