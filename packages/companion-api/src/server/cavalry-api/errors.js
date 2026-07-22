import { toSafeApiError } from '../../application/api/cavalry-api-errors.js';

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body == null ? {} : body);
  res.writeHead(
    status,
    Object.assign(
      {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload)
      },
      headers
    )
  );
  res.end(payload);
}

export function sendApiError(res, error, requestId) {
  const safe = toSafeApiError(error, requestId);
  sendJson(res, safe.status, safe.body);
}
