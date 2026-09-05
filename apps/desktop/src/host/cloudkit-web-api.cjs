'use strict';

const CONTAINER = 'iCloud.com.juanmbuilder.cavalry';
const ENVIRONMENT = 'Production';
const ORIGIN = 'http://127.0.0.1:47639';
const BASE = `https://api.apple-cloudkit.com/database/1/${CONTAINER}/production/private/`;
const AUTH_ERRORS = new Set([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_FAILED',
  'NOT_AUTHENTICATED'
]);

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
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(60000)
      });
    } catch (_error) {
      throw webError('cloud_network_unavailable', 'Saved locally. iCloud could not be reached.');
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
    } catch (_error) {
      throw webError('invalid_cloudkit_response', 'iCloud returned an unreadable response.');
    }
    const code = String(result.serverErrorCode || (!response.ok ? `HTTP_${response.status}` : ''));
    if (code) {
      const error = webError(
        code,
        AUTH_ERRORS.has(code)
          ? 'Sign in again to resume iCloud syncing. Your local workbooks are saved.'
          : 'iCloud could not complete this operation. Your local copy was kept.'
      );
      if (AUTH_ERRORS.has(code)) error.redirectURL = appleAuthenticationUrl(result.redirectURL);
      throw error;
    }
    return result;
  }
  return function api(operation, body) {
    const pending = serial.then(() => perform(operation, body));
    serial = pending.catch(() => undefined);
    return pending;
  };
}

module.exports = {
  CONTAINER,
  ENVIRONMENT,
  ORIGIN,
  AUTH_ERRORS,
  appleAuthenticationUrl,
  validSessionToken,
  createCloudKitWebApi
};
