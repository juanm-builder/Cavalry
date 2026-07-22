import { ensureCheckpointCollections } from './checkpoint-store.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function fallbackId(prefix) {
  return String(prefix || 'audit') + '_' + Math.random().toString(36).slice(2, 10);
}

export function appendCheckpointAuditEvent(workbook, input = {}) {
  ensureCheckpointCollections(workbook);
  const createId = typeof input.createId === 'function' ? input.createId : fallbackId;
  const timestamp = asString(input.timestamp || input.occurred_at) || new Date().toISOString();
  const event = {
    audit_event_id: asString(input.audit_event_id) || createId('checkpoint_audit'),
    event_type: asString(input.event_type || input.type || 'checkpoint_event'),
    request_id: asString(input.request_id || input.requestId),
    workbook_id: asString(input.workbook_id || workbook.id),
    checkpoint_id: asString(input.checkpoint_id || input.checkpointId),
    caller_type: asString(input.caller_type || input.callerType || 'unknown'),
    origin: asString(input.origin || 'companion_api'),
    auth_method: asString(input.auth_method || input.authMethod || 'unknown'),
    scopes: Array.isArray(input.scopes) ? input.scopes.map(asString).filter(Boolean) : [],
    operation_id: asString(input.operation_id || input.operationId),
    action_count: Math.max(0, Number(input.action_count) || 0),
    applied_count: Math.max(0, Number(input.applied_count) || 0),
    blocked_count: Math.max(0, Number(input.blocked_count) || 0),
    warning_count: Math.max(0, Number(input.warning_count) || 0),
    conflict_count: Math.max(0, Number(input.conflict_count) || 0),
    idempotency_key_status: asString(
      input.idempotency_key_status || input.idempotencyKeyStatus || 'none'
    ),
    timestamp,
    outcome: asString(input.outcome || 'success')
  };
  workbook.checkpointAuditEvents.push(event);
  return event;
}

export function exportCheckpointAuditEvents(workbook) {
  ensureCheckpointCollections(workbook);
  return workbook.checkpointAuditEvents.map((event) => {
    const exported = clonePlain(event);
    delete exported.token;
    delete exported.access_token;
    delete exported.authorization;
    delete exported.raw_action_plan;
    delete exported.raw_request_body;
    return exported;
  });
}
