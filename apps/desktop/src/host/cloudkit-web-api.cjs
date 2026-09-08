'use strict';

const CONTAINER = 'iCloud.com.juanmbuilder.cavalry';
const ENVIRONMENT = 'Production';
const LOOPBACK_ORIGIN = 'http://127.0.0.1:47639';
const CLOUDKIT_WEB_ORIGIN = 'https://juanm-builder.github.io';
const CLOUDKIT_SIGN_IN_URL = `${CLOUDKIT_WEB_ORIGIN}/Cavalry/icloud-sign-in/`;
const BASE = `https://api.apple-cloudkit.com/database/1/${CONTAINER}/production/private/`;
const AUTH_ERRORS = new Set([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_FAILED',
  'NOT_AUTHENTICATED'
]);
const APPLE_ERRORS = new Set([
  ...AUTH_ERRORS,
  'ACCESS_DENIED',
  'ATOMIC_ERROR',
  'BAD_REQUEST',
  'CONFLICT',
  'EXISTS',
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'UNKNOWN_ITEM',
  'QUOTA_EXCEEDED',
  'THROTTLED',
  'TRY_AGAIN_LATER',
  'VALIDATING_REFERENCE_ERROR',
  'ZONE_NOT_FOUND',
  'SCHEMA_ERROR',
  'INVALID_ARGUMENTS',
  'INVALID_FIELD_TYPE',
  'INVALID_FIELD_VALUE',
  'INVALID_RECORD_TYPE',
  'UNKNOWN_FIELD'
]);
const ERROR_OPERATIONS = new Set([
  'users/current',
  'records/lookup',
  'records/modify',
  'changes/zone',
  'zones/modify',
  'assets/upload',
  'assets/download'
]);

// Deliberately exclude Apple's reason, record identifiers, URLs and response
// bodies. They may contain workbook data or session credentials.
function cloudKitErrorMetadata(error, operation, httpStatus) {
  const code = error?.serverErrorCode || error?.code;
  const stage = ERROR_OPERATIONS.has(operation) ? operation : error?.cloudkitOperation;
  const status = httpStatus ?? error?.httpStatus;
  const retryAfter = error?.retryAfter;
  return {
    ...(APPLE_ERRORS.has(code) ? { serverErrorCode: code } : {}),
    ...(ERROR_OPERATIONS.has(stage) ? { cloudkitOperation: stage } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
    ...(typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0
      ? { retryAfter: Math.min(Math.ceil(retryAfter), 86400) }
      : {})
  };
}

function cloudKitServerError(value, operation, httpStatus) {
  const metadata = cloudKitErrorMetadata(value, operation, httpStatus);
  const code =
    metadata.serverErrorCode ||
    (!value?.serverErrorCode && metadata.httpStatus >= 400
      ? `HTTP_${metadata.httpStatus}`
      : 'cloudkit_unknown_error');
  const error = webError(
    code,
    AUTH_ERRORS.has(code)
      ? 'Sign in again to resume iCloud syncing. Your local workbooks are saved.'
      : 'iCloud could not complete this operation. Your local copy was kept.'
  );
  Object.assign(error, metadata);
  if (AUTH_ERRORS.has(code)) error.redirectURL = appleAuthenticationUrl(value?.redirectURL);
  return error;
}

function webError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validSessionToken(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 16384 &&
    !/[\r\n\0]/.test(value)
  );
}

function appleAuthenticationUrl(raw) {
  try {
    const url = new URL(raw);
    const allowed = [
      'idmsa.apple.com',
      'appleid.apple.com',
      'account.apple.com',
      'www.icloud.com',
      'icloud.com'
    ];
    return url.protocol === 'https:' &&
      allowed.includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password
      ? url.href
      : '';
  } catch (_error) {
    return '';
  }
}

function createCloudKitWebApi({
  apiToken,
  session,
  persistSession,
  fetch: fetchImpl = globalThis.fetch
}) {
  let serial = Promise.resolve();
  async function perform(operation, body) {
    if (!/^[a-z]+\/[a-z]+$/.test(operation))
      throw webError('invalid_cloudkit_operation', 'Invalid iCloud operation.');
    const url = new URL(operation, BASE);
    url.searchParams.set('ckAPIToken', apiToken);
    if (session.token) url.searchParams.set('ckWebAuthToken', session.token);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Origin: CLOUDKIT_WEB_ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(60000)
      });
    } catch (_error) {
      throw Object.assign(
        webError('cloud_network_unavailable', 'Saved locally. iCloud could not be reached.'),
        cloudKitErrorMetadata(null, operation)
      );
    }
    // Apple rotates tokens in response headers, including some error responses.
    // Persist the successor before another request can consume it.
    const replacement =
      response.headers.get('x-apple-cloudkit-web-auth-token') ||
      response.headers.get('x-apple-cloudkit-session');
    if (replacement) {
      if (!validSessionToken(replacement))
        throw webError('invalid_cloudkit_session', 'Apple returned an invalid iCloud session.');
      session.token = replacement;
      try {
        await persistSession(session);
      } catch (_error) {
        session.token = '';
        throw webError(
          'cloud_session_save_failed',
          'Cavalry could not securely save the iCloud session. Sign in again.'
        );
      }
    }
    let result;
    try {
      if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('size');
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > 8 * 1024 * 1024) throw new Error('size');
        chunks.push(Buffer.from(chunk));
      }
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('shape');
    } catch (_error) {
      throw Object.assign(
        webError('invalid_cloudkit_response', 'iCloud returned an unreadable response.'),
        cloudKitErrorMetadata(null, operation, response.status)
      );
    }
    if (result.serverErrorCode || !response.ok)
      throw cloudKitServerError(result, operation, response.status);
    Object.defineProperty(result, 'cloudkitHttpStatus', { value: response.status });
    return result;
  }
  return function api(operation, body) {
    const pending = serial
      .then(() => perform(operation, body))
      .catch((error) => {
        Object.assign(error, cloudKitErrorMetadata(error, operation));
        throw error;
      });
    serial = pending.catch(() => undefined);
    return pending;
  };
}

module.exports = {
  CONTAINER,
  ENVIRONMENT,
  LOOPBACK_ORIGIN,
  CLOUDKIT_WEB_ORIGIN,
  CLOUDKIT_SIGN_IN_URL,
  AUTH_ERRORS,
  cloudKitErrorMetadata,
  cloudKitServerError,
  appleAuthenticationUrl,
  validSessionToken,
  createCloudKitWebApi
};
