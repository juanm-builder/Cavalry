import { ensureExternalDraftCollections } from '@cavalry/action-review/application/drafts/draft-group-model.js';

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

function createFallbackId(prefix) {
  return String(prefix || 'audit') + '_' + Math.random().toString(36).slice(2, 10);
}

export function appendCompanionApiAuditEvent(workbook, input = {}) {
  ensureExternalDraftCollections(workbook);
  const now = input.timestamp || input.occurred_at || new Date().toISOString();
  const createId = typeof input.createId === 'function' ? input.createId : createFallbackId;
  const event = {
    audit_event_id: asString(input.audit_event_id) || createId('audit'),
    occurred_at: now,
    timestamp: now,
    request_id: asString(input.request_id || input.requestId),
    caller_type: asString(input.caller_type || input.callerType || 'unknown'),
    user_id: asString(input.user_id || input.userId || 'unknown'),
    workbook_id: asString(input.workbook_id || input.workbookId || (workbook && workbook.id)),
    origin: asString(input.origin || 'local_dev_api'),
    auth_method: asString(input.auth_method || input.authMethod || 'unknown'),
    operation: asString(input.operation || input.operation_id),
    operation_id: asString(input.operation_id || input.operation),
    scopes: Array.isArray(input.scopes) ? input.scopes.map(asString).filter(Boolean) : [],
    action_count: Math.max(0, Number(input.action_count) || 0),
    idempotency_result: asString(input.idempotency_result || 'none'),
    outcome: asString(input.outcome || input.result_status || 'success'),
    result_status: asString(input.result_status || input.outcome || 'success'),
    draft_group_id: asString(input.draft_group_id || input.draftGroupId) || undefined,
    ready_count: Math.max(0, Number(input.ready_count) || 0),
    needs_review_count: Math.max(0, Number(input.needs_review_count) || 0),
    validation_issue_count: Math.max(0, Number(input.validation_issue_count) || 0),
    duplicate_warning_count: Math.max(0, Number(input.duplicate_warning_count) || 0),
    elapsed_ms: Number.isFinite(Number(input.elapsed_ms)) ? Number(input.elapsed_ms) : undefined,
    public_origin: asString(input.public_origin || input.publicOrigin),
    local_origin: asString(input.local_origin || input.localOrigin)
  };
  workbook.externalApiAuditEvents.push(event);
  return event;
}

export function exportCompanionApiAuditEvents(workbook, options = {}) {
  ensureExternalDraftCollections(workbook);
  const includeFingerprints = options.includeFingerprints === true;
  return workbook.externalApiAuditEvents.map((event) => {
    const exported = clonePlain(event);
    delete exported.token;
    delete exported.access_token;
    delete exported.raw_action_plan;
    delete exported.raw_request_body;
    if (!includeFingerprints) {
      delete exported.request_fingerprint;
    }
    return exported;
  });
}

export function summarizeCompanionApiAuditEvents(workbook) {
  const events = exportCompanionApiAuditEvents(workbook, { includeFingerprints: false });
  return events.reduce(
    (summary, event) => {
      const outcome = asString(event && event.outcome) || 'unknown';
      const operation = asString(event && event.operation_id) || 'unknown';
      summary.total += 1;
      summary.outcomes[outcome] = (summary.outcomes[outcome] || 0) + 1;
      summary.operations[operation] = (summary.operations[operation] || 0) + 1;
      summary.draft_groups = Array.from(
        new Set(
          summary.draft_groups.concat(asString(event && event.draft_group_id)).filter(Boolean)
        )
      );
      return summary;
    },
    {
      total: 0,
      outcomes: {},
      operations: {},
      draft_groups: []
    }
  );
}
