import { createHash } from 'node:crypto';

import {
  CAVALRY_API_SCOPES,
  CAVALRY_API_CHECKPOINT_SCOPES,
  CAVALRY_API_STABLE_SCOPES
} from '../../application/api/cavalry-api-authz.js';
import {
  createBetaGptActionCallerContext,
  createLocalDevCallerContext
} from '../../application/api/external-caller-context.js';
import { hasCompanionBetaTokenConfig, verifyCompanionBetaToken } from './beta-token.js';
import { getCompanionApiRuntimeConfig } from './runtime.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function hashRequestIp(value) {
  const raw = asString(value);
  return raw ? createHash('sha256').update(raw).digest('hex').slice(0, 24) : '';
}

export function getBearerToken(req) {
  const authorization = asString(req && req.headers && req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match && match[1] ? match[1].trim() : '';
}

export function authenticateCavalryApiRequest(req, options = {}) {
  const runtime =
    options.runtimeConfig ||
    getCompanionApiRuntimeConfig({
      enabled: options.runtimeEnabled,
      mode: options.runtimeMode,
      publicBaseUrl: options.publicBaseUrl,
      allowPrivateBaseUrl: true,
      authRequired: options.authRequired
    });
  const betaAuthEnabled = options.betaAuthEnabled === true || runtime.mode === 'beta_tunnel';
  const devAuthEnabled =
    options.devAuthEnabled === true ||
    process.env.CAVALRY_API_DEV_AUTH === '1' ||
    process.env.CAVALRY_COMPANION_API_MODE === 'local_dev';
  const token = getBearerToken(req);
  const allowedWorkbookIds = Array.isArray(options.allowedWorkbookIds)
    ? options.allowedWorkbookIds
    : asString(
        process.env.CAVALRY_API_DEV_WORKBOOK_IDS || process.env.CAVALRY_COMPANION_WORKBOOK_IDS
      )
        .split(',')
        .map(asString)
        .filter(Boolean);

  if (betaAuthEnabled) {
    const hasTokenConfig = hasCompanionBetaTokenConfig({
      raw: options.betaApiKey,
      hash: options.betaApiKeyHash
    });
    if (
      !hasTokenConfig ||
      !verifyCompanionBetaToken(token, {
        raw: options.betaApiKey,
        hash: options.betaApiKeyHash
      })
    ) {
      return null;
    }
    const baseScopes =
      Array.isArray(options.scopes) && options.scopes.length
        ? options.scopes.filter((scope) => scope !== CAVALRY_API_SCOPES.DRAFT_APPLY)
        : CAVALRY_API_STABLE_SCOPES.filter((scope) => scope !== CAVALRY_API_SCOPES.DRAFT_APPLY);
    const checkpointScopesEnabled =
      options.checkpointScopesEnabled === true ||
      process.env.CAVALRY_COMPANION_BETA_ENABLE_CHECKPOINTED_SCOPE === '1';
    const scopes = checkpointScopesEnabled
      ? Array.from(new Set(baseScopes.concat(CAVALRY_API_CHECKPOINT_SCOPES)))
      : baseScopes;
    return createBetaGptActionCallerContext({
      userId: asString(
        options.userId || process.env.CAVALRY_COMPANION_BETA_USER_ID || 'beta-gpt-user'
      ),
      oauth_client_id: 'beta-gpt-action',
      scopes,
      allowedWorkbookIds
    });
  }

  if (!devAuthEnabled) {
    return null;
  }
  const expectedToken = asString(
    options.devToken || process.env.CAVALRY_API_DEV_TOKEN || process.env.CAVALRY_COMPANION_DEV_TOKEN
  );
  const allowMissingDevToken =
    options.allowMissingDevToken === true || process.env.NODE_ENV === 'test';
  if (!expectedToken && !allowMissingDevToken) {
    return null;
  }
  if (expectedToken && token !== expectedToken) {
    return null;
  }
  const scopes =
    Array.isArray(options.scopes) && options.scopes.length
      ? options.scopes
      : CAVALRY_API_STABLE_SCOPES.filter((scope) => scope !== CAVALRY_API_SCOPES.DRAFT_APPLY);
  return createLocalDevCallerContext({
    userId: asString(options.userId || process.env.CAVALRY_API_DEV_USER_ID || 'dev-user'),
    oauth_client_id: 'local-dev',
    scopes,
    allowedWorkbookIds
  });
}
