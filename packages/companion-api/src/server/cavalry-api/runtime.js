import { CavalryApiError } from '../../application/api/cavalry-api-errors.js';
import { hasCompanionBetaTokenConfig } from './beta-token.js';

export const COMPANION_API_MODES = Object.freeze([
  'disabled',
  'local_dev',
  'beta_tunnel',
  'cloud_stub'
]);

export const COMPANION_AI_ACTION_MODES = Object.freeze([
  'draft_only',
  'checkpointed_apply',
  'blocked'
]);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function envFlag(name, fallbackName) {
  const raw = asString(process.env[name] || (fallbackName ? process.env[fallbackName] : ''));
  return raw === '1' || /^true$/i.test(raw);
}

function isLoopbackHostname(hostname) {
  const host = asString(hostname).toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isPrivateHostname(hostname) {
  const host = asString(hostname).toLowerCase();
  return (
    isLoopbackHostname(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  );
}

function containsTokenLikeSecret(value) {
  const raw = asString(value);
  return (
    /(token|secret|apikey|api_key|access_key|bearer|password)=/i.test(raw) ||
    /(?:sk-|pat_|ghp_|xox[baprs]-|ya29\.|eyJ)[A-Za-z0-9_.-]{8,}/.test(raw)
  );
}

export function validateCompanionPublicBaseUrl(value, options = {}) {
  const raw = asString(value);
  if (!raw) {
    throw new CavalryApiError(
      'server_not_enabled',
      'CAVALRY_COMPANION_PUBLIC_BASE_URL is required for beta_tunnel mode.',
      {
        status: 400
      }
    );
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw new CavalryApiError(
      'server_not_enabled',
      'CAVALRY_COMPANION_PUBLIC_BASE_URL must be a valid URL.',
      { status: 400 }
    );
  }
  const allowInsecure =
    options.allowInsecureTunnel === true || envFlag('CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL');
  const allowPrivate =
    options.allowPrivateBaseUrl === true ||
    (options.allowPrivateBaseUrl !== false && process.env.NODE_ENV === 'test');
  if (parsed.protocol !== 'https:' && !(allowInsecure && parsed.protocol === 'http:')) {
    throw new CavalryApiError(
      'server_not_enabled',
      'Beta public base URL must use HTTPS unless CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL=1.',
      {
        status: 400
      }
    );
  }
  if (!allowPrivate && isPrivateHostname(parsed.hostname)) {
    throw new CavalryApiError(
      'server_not_enabled',
      'Beta public base URL must not be localhost or a private/LAN address.',
      { status: 400 }
    );
  }
  if (parsed.username || parsed.password) {
    throw new CavalryApiError(
      'server_not_enabled',
      'Beta public base URL must not include username or password.',
      { status: 400 }
    );
  }
  if (parsed.search || parsed.hash || containsTokenLikeSecret(raw)) {
    throw new CavalryApiError(
      'server_not_enabled',
      'Beta public base URL must not include query strings, fragments, tokens, or secrets.',
      { status: 400 }
    );
  }
  const path = parsed.pathname.replace(/\/+$/g, '');
  if (path && path !== '') {
    throw new CavalryApiError(
      'server_not_enabled',
      'Beta public base URL must be the API origin only, with no path suffix.',
      { status: 400 }
    );
  }
  return parsed.origin;
}

export function getCompanionApiRuntimeConfig(options = {}) {
  const enabled =
    options.enabled != null
      ? options.enabled === true
      : envFlag('CAVALRY_COMPANION_API_ENABLED', 'CAVALRY_API_ENABLED') ||
        process.env.NODE_ENV === 'test';
  const requestedMode =
    asString(
      options.mode || process.env.CAVALRY_COMPANION_API_MODE || (enabled ? 'local_dev' : 'disabled')
    ) || 'disabled';
  const mode = enabled
    ? COMPANION_API_MODES.includes(requestedMode) && requestedMode !== 'disabled'
      ? requestedMode
      : 'local_dev'
    : 'disabled';
  const bindHost =
    asString(
      options.host ||
        process.env.CAVALRY_COMPANION_BIND_HOST ||
        process.env.CAVALRY_API_HOST ||
        '127.0.0.1'
    ) || '127.0.0.1';
  const bindPort = Number(
    options.port || process.env.CAVALRY_COMPANION_BIND_PORT || process.env.CAVALRY_API_PORT || 8787
  );
  const allowPublicBind =
    options.allowPublicBind === true ||
    envFlag('CAVALRY_COMPANION_ALLOW_PUBLIC_BIND', 'CAVALRY_API_ALLOW_DANGEROUS_PUBLIC_BIND');
  const allowInsecureTunnel =
    options.allowInsecureTunnel === true || envFlag('CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL');
  const requestedAiActionMode =
    asString(
      options.aiActionMode || process.env.CAVALRY_COMPANION_AI_ACTION_MODE || 'draft_only'
    ) || 'draft_only';
  const checkpointedApplyExplicit =
    options.checkpointedApplyEnabled === true ||
    envFlag('CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED');
  const aiActionMode =
    checkpointedApplyExplicit && requestedAiActionMode === 'checkpointed_apply'
      ? 'checkpointed_apply'
      : COMPANION_AI_ACTION_MODES.includes(requestedAiActionMode)
        ? requestedAiActionMode
        : 'draft_only';
  const maxCheckpointActions = Math.max(
    1,
    Math.min(
      100,
      Number(
        options.maxCheckpointActions || process.env.CAVALRY_COMPANION_MAX_CHECKPOINT_ACTIONS || 25
      )
    )
  );
  const requireCheckpoints =
    options.requireCheckpoints !== false &&
    (envFlag('CAVALRY_COMPANION_REQUIRE_CHECKPOINTS') || aiActionMode === 'checkpointed_apply');
  const rawPublicBaseUrl = asString(
    options.publicBaseUrl || process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL
  );
  const publicBaseUrl = rawPublicBaseUrl
    ? validateCompanionPublicBaseUrl(rawPublicBaseUrl, {
        allowInsecureTunnel,
        allowPrivateBaseUrl: options.allowPrivateBaseUrl
      })
    : '';
  const authRequired = options.authRequired !== false && process.env.NODE_ENV !== 'test';
  return {
    enabled,
    mode,
    bindHost,
    bindPort,
    publicBaseUrl,
    publicBaseUrlConfigured: !!publicBaseUrl,
    allowPublicBind,
    allowInsecureTunnel,
    authRequired,
    draftOnly: true,
    aiActionMode,
    checkpointedApplyEnabled: aiActionMode === 'checkpointed_apply' && checkpointedApplyExplicit,
    draftOnlyAvailable: aiActionMode !== 'blocked',
    rollbackAvailable: true,
    irreversibleActionsAllowed: false,
    maxCheckpointActions,
    requireCheckpoints,
    productionCloudReady: false,
    manualImportAvailable: true,
    reviewUrlScheme: 'cavalry://draft-groups/{id}',
    directMutationEndpointsExposed: false
  };
}

export function assertCompanionRuntimeCanStart(config) {
  const runtime = config || getCompanionApiRuntimeConfig();
  if (!runtime.enabled || runtime.mode === 'disabled') {
    throw new CavalryApiError(
      'server_not_enabled',
      'Cavalry Companion API is disabled. Set CAVALRY_COMPANION_API_ENABLED=1.',
      { status: 403 }
    );
  }
  if (runtime.mode === 'cloud_stub') {
    throw new CavalryApiError(
      'server_not_enabled',
      'Cavalry Companion API cloud_stub mode documents future cloud hosting only; production cloud is not implemented.',
      { status: 403 }
    );
  }
  if ((runtime.bindHost === '0.0.0.0' || runtime.bindHost === '::') && !runtime.allowPublicBind) {
    throw new CavalryApiError(
      'server_not_enabled',
      'Public bind requires CAVALRY_COMPANION_ALLOW_PUBLIC_BIND=1.',
      { status: 403 }
    );
  }
  if (runtime.mode === 'beta_tunnel') {
    if (!runtime.publicBaseUrl) {
      throw new CavalryApiError(
        'server_not_enabled',
        'beta_tunnel mode requires CAVALRY_COMPANION_PUBLIC_BASE_URL.',
        { status: 400 }
      );
    }
    if (!hasCompanionBetaTokenConfig()) {
      throw new CavalryApiError(
        'server_not_enabled',
        'beta_tunnel mode requires CAVALRY_COMPANION_BETA_API_KEY or CAVALRY_COMPANION_BETA_API_KEY_HASH.',
        { status: 400 }
      );
    }
    if (runtime.authRequired === false && process.env.NODE_ENV !== 'test') {
      throw new CavalryApiError('server_not_enabled', 'beta_tunnel mode requires auth.', {
        status: 403
      });
    }
  }
  if (runtime.aiActionMode === 'checkpointed_apply' && runtime.checkpointedApplyEnabled !== true) {
    throw new CavalryApiError(
      'server_not_enabled',
      'checkpointed_apply mode requires CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1.',
      { status: 400 }
    );
  }
  return runtime;
}

export function getCompanionRuntimeStatus(config) {
  const runtime = config || getCompanionApiRuntimeConfig();
  return {
    api_enabled: runtime.enabled,
    api_mode: runtime.mode,
    bind_host: runtime.bindHost,
    bind_port: runtime.bindPort,
    public_base_url_configured: runtime.publicBaseUrlConfigured,
    auth_required: runtime.authRequired !== false,
    ai_action_mode: runtime.aiActionMode,
    checkpointed_apply_enabled: runtime.checkpointedApplyEnabled === true,
    draft_only_available: runtime.draftOnlyAvailable !== false,
    rollback_available: runtime.rollbackAvailable === true,
    irreversible_actions_allowed: false,
    max_checkpoint_actions: runtime.maxCheckpointActions,
    draft_only: true,
    production_cloud_ready: false,
    manual_import_available: true,
    review_url_scheme: runtime.reviewUrlScheme,
    direct_mutation_endpoints_exposed: false
  };
}
