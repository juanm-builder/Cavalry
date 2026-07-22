import { CAVALRY_API_STABLE_SCOPES } from './cavalry-api-authz.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map(asString).filter((value) => {
    if (!value || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function normalizeScopes(value) {
  return uniqueStrings(value).filter(
    (scope) => CAVALRY_API_STABLE_SCOPES.includes(scope) || /^cavalry\./.test(scope)
  );
}

export function createExternalCallerContext(input = {}) {
  const source = input.caller && typeof input.caller === 'object' ? input.caller : {};
  const scopes = normalizeScopes(input.scopes || source.scopes);
  const allowedWorkbookIds = uniqueStrings(
    input.allowedWorkbookIds || input.allowed_workbook_ids || source.allowed_workbook_ids
  );
  const userId = asString(input.userId || input.user_id || source.userId || source.user_id);
  const callerType =
    asString(
      input.callerType ||
        input.caller_type ||
        source.callerType ||
        source.caller_type ||
        source.subject_type ||
        'unknown'
    ) || 'unknown';
  const workbookId = asString(
    input.workbookId || input.workbook_id || source.workbookId || source.workbook_id
  );
  const origin = asString(input.origin || source.origin || 'local_dev_api') || 'local_dev_api';
  const requestId = asString(
    input.requestId || input.request_id || source.requestId || source.request_id
  );
  const idempotencyKey = asString(
    input.idempotencyKey || input.idempotency_key || source.idempotencyKey || source.idempotency_key
  );
  const authMethod =
    asString(
      input.authMethod || input.auth_method || source.authMethod || source.auth_method || 'unknown'
    ) || 'unknown';
  const createdAt =
    asString(input.createdAt || input.created_at || source.createdAt || source.created_at) ||
    new Date().toISOString();
  const oauthClientId = asString(
    input.oauthClientId || input.oauth_client_id || source.oauthClientId || source.oauth_client_id
  );

  return {
    callerType,
    userId,
    workbookId,
    scopes,
    origin,
    requestId,
    idempotencyKey,
    authMethod,
    createdAt,
    allowedWorkbookIds,
    oauthClientId,

    caller_type: callerType,
    user_id: userId,
    workbook_id: workbookId,
    request_id: requestId,
    idempotency_key: idempotencyKey,
    auth_method: authMethod,
    created_at: createdAt,
    allowed_workbook_ids: allowedWorkbookIds,
    oauth_client_id: oauthClientId,
    subject_type: callerType
  };
}

export function createLocalDevCallerContext(input = {}) {
  return createExternalCallerContext(
    Object.assign(
      {
        callerType: 'local_dev_api',
        authMethod: 'dev_token',
        origin: 'local_dev_api'
      },
      input
    )
  );
}

export function createBetaGptActionCallerContext(input = {}) {
  return createExternalCallerContext(
    Object.assign(
      {
        callerType: 'beta_gpt_action',
        authMethod: 'beta_api_key',
        origin: 'chatgpt_action'
      },
      input
    )
  );
}
