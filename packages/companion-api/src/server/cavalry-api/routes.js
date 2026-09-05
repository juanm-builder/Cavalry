import { readCavalryOpenApiSpec } from './openapi.js';
import { authenticateCavalryApiRequest, hashRequestIp } from './auth.js';
import { sendApiError, sendJson } from './errors.js';
import { toPublicCavalryApiErrorCode } from '../../application/api/cavalry-api-errors.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function parseJsonBody(req, options = {}) {
  const maxBodyBytes = Number(options.maxBodyBytes || 1024 * 256);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bodyBytes = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bodyBytes += bytes.length;
      if (bodyBytes > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else {
        chunks.push(bytes);
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(
          Object.assign(new Error('Request body is too large.'), {
            status: 413,
            code: 'payload_too_large'
          })
        );
        return;
      }
      // Decode once so multibyte characters split between HTTP chunks stay intact.
      const body = Buffer.concat(chunks, bodyBytes).toString('utf8');
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(
          Object.assign(new Error('Request body must be valid JSON.'), {
            status: 400,
            code: 'invalid_json',
            cause: error
          })
        );
      }
    });
    req.on('error', reject);
  });
}

function getPathParts(pathname) {
  return asString(pathname).split('/').filter(Boolean).map(decodeURIComponent);
}

function getQuery(url) {
  const query = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function getIdempotencyKey(req) {
  return asString(req.headers['idempotency-key'] || req.headers['x-idempotency-key']);
}

function getOriginMetadata(req, authOptions = {}, caller = null) {
  return {
    origin:
      authOptions.origin || (caller && (caller.origin || caller.origin_type)) || 'local_dev_api',
    provider: 'chatgpt',
    userAgent: req.headers['user-agent'] || '',
    requestIpHash: hashRequestIp(req.socket && req.socket.remoteAddress)
  };
}

function wrapBodyError(error) {
  return {
    status: Number(error && error.status) || 400,
    code: asString(error && error.code) || 'invalid_json',
    message: error && error.message ? error.message : 'Request body could not be read.'
  };
}

export function createCavalryApiRequestHandler({
  controller,
  authOptions = {},
  routeOptions = {}
} = {}) {
  if (!controller) {
    throw new Error('Cavalry API controller is required.');
  }
  return async function handleCavalryApiRequest(req, res) {
    const requestId =
      typeof controller.makeRequestId === 'function'
        ? controller.makeRequestId()
        : 'req_' + Math.random().toString(36).slice(2, 10);
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const parts = getPathParts(url.pathname);
      const caller = authenticateCavalryApiRequest(req, authOptions);
      const common = {
        caller,
        query: getQuery(url),
        userAgent: req.headers['user-agent'] || '',
        requestIpHash: hashRequestIp(req.socket && req.socket.remoteAddress),
        originMetadata: getOriginMetadata(req, authOptions, caller),
        idempotencyKey: getIdempotencyKey(req),
        requestId,
        authMethod: caller && (caller.authMethod || caller.auth_method)
      };

      if (req.method === 'GET' && url.pathname === '/openapi/cavalry-gpt-actions.openapi.yaml') {
        const spec = await readCavalryOpenApiSpec();
        res.writeHead(200, { 'content-type': 'application/yaml; charset=utf-8' });
        res.end(spec);
        return;
      }

      if (req.method === 'GET' && parts.join('/') === 'v1/capabilities') {
        sendJson(res, 200, controller.getCapabilities(common), { 'x-request-id': requestId });
        return;
      }

      if (req.method === 'GET' && parts.join('/') === 'v1/workbooks') {
        sendJson(res, 200, controller.listWorkbooks(common), { 'x-request-id': requestId });
        return;
      }

      if (parts[0] === 'v1' && parts[1] === 'workbooks' && parts[2]) {
        const workbookId = parts[2];
        if (req.method === 'GET' && parts[3] === 'summary') {
          sendJson(
            res,
            200,
            controller.getWorkbookSummary(Object.assign({}, common, { workbookId })),
            { 'x-request-id': requestId }
          );
          return;
        }
        if (req.method === 'GET' && parts[3] === 'accounts') {
          sendJson(res, 200, controller.listAccounts(Object.assign({}, common, { workbookId })), {
            'x-request-id': requestId
          });
          return;
        }
        if (req.method === 'GET' && parts[3] === 'categories') {
          sendJson(res, 200, controller.listCategories(Object.assign({}, common, { workbookId })), {
            'x-request-id': requestId
          });
          return;
        }
        if (req.method === 'GET' && parts[3] === 'transactions' && parts[4] === 'recent') {
          sendJson(
            res,
            200,
            controller.listRecentTransactions(Object.assign({}, common, { workbookId })),
            { 'x-request-id': requestId }
          );
          return;
        }
        if (req.method === 'GET' && parts[3] === 'draft-groups' && parts[4]) {
          sendJson(
            res,
            200,
            controller.getDraftGroup(
              Object.assign({}, common, { workbookId, draftGroupId: parts[4] })
            ),
            { 'x-request-id': requestId }
          );
          return;
        }
        if (req.method === 'GET' && parts[3] === 'checkpoints' && !parts[4]) {
          sendJson(
            res,
            200,
            controller.listCheckpoints(Object.assign({}, common, { workbookId })),
            { 'x-request-id': requestId }
          );
          return;
        }
        if (req.method === 'GET' && parts[3] === 'checkpoints' && parts[4]) {
          sendJson(
            res,
            200,
            controller.getCheckpoint(
              Object.assign({}, common, { workbookId, checkpointId: parts[4] })
            ),
            { 'x-request-id': requestId }
          );
          return;
        }
        if (req.method === 'POST') {
          let body;
          try {
            body = await parseJsonBody(req, routeOptions);
          } catch (bodyError) {
            const wrapped = wrapBodyError(bodyError);
            sendJson(res, wrapped.status, {
              error: {
                code: toPublicCavalryApiErrorCode(wrapped.code, wrapped.status, wrapped.message),
                message: wrapped.message,
                request_id: requestId
              }
            });
            return;
          }
          if (parts[3] === 'draft-groups' && parts[4] === 'from-action-plan') {
            sendJson(
              res,
              200,
              controller.createDraftGroupFromActionPlan(
                Object.assign({}, common, { workbookId, body })
              ),
              { 'x-request-id': requestId }
            );
            return;
          }
          if (parts[3] === 'drafts' && parts[4] === 'transaction-batch') {
            sendJson(
              res,
              200,
              controller.createTransactionDraftBatch(
                Object.assign({}, common, { workbookId, body })
              ),
              { 'x-request-id': requestId }
            );
            return;
          }
          if (parts[3] === 'drafts' && parts[4] === 'recurring-items') {
            sendJson(
              res,
              200,
              controller.createRecurringItemDrafts(Object.assign({}, common, { workbookId, body })),
              { 'x-request-id': requestId }
            );
            return;
          }
          if (parts[3] === 'drafts' && parts[4] === 'category-changes') {
            sendJson(
              res,
              200,
              controller.createCategoryChangeDrafts(
                Object.assign({}, common, { workbookId, body })
              ),
              { 'x-request-id': requestId }
            );
            return;
          }
          if (parts[3] === 'checkpointed-action-plans' && parts[4] === 'execute') {
            sendJson(
              res,
              200,
              controller.executeCheckpointedActionPlan(
                Object.assign({}, common, { workbookId, body })
              ),
              { 'x-request-id': requestId }
            );
            return;
          }
          if (parts[3] === 'checkpoints' && parts[4] && parts[5] === 'rollback-preview') {
            sendJson(
              res,
              200,
              controller.previewCheckpointRollback(
                Object.assign({}, common, { workbookId, checkpointId: parts[4], body })
              ),
              { 'x-request-id': requestId }
            );
            return;
          }
          if (parts[3] === 'checkpoints' && parts[4] && parts[5] === 'rollback') {
            sendJson(
              res,
              200,
              controller.rollbackCheckpoint(
                Object.assign({}, common, { workbookId, checkpointId: parts[4], body })
              ),
              { 'x-request-id': requestId }
            );
            return;
          }
        }
      }

      sendJson(res, 404, {
        error: {
          code: 'not_found',
          message: 'Route was not found.',
          request_id: requestId
        }
      });
    } catch (error) {
      sendApiError(res, error, requestId);
    }
  };
}
