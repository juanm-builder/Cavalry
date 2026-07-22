import {
  createCheckpointId,
  getCheckpointReviewUrl
} from '../../domain/checkpoints/checkpoint-id.js';
import { CHECKPOINT_VERSION, summarizeCheckpointChanges } from '../../domain/checkpoints/schema.js';
import { fingerprintWorkbookCore } from '../../domain/checkpoints/entity-fingerprint.js';
import { createWorkbookCheckpointStore } from './checkpoint-store.js';
import { appendCheckpointAuditEvent } from './checkpoint-audit.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function getNow(now) {
  return typeof now === 'function' ? now() : new Date().toISOString();
}

export function createCheckpoint({
  workbook,
  actor,
  origin = 'companion_api',
  requestId,
  sessionId,
  idempotencyKey,
  sourcePrompt,
  actionPlanId,
  changes,
  validationIssues,
  warnings,
  beforeWorkbookFingerprint,
  afterWorkbookFingerprint,
  status,
  createId,
  now
} = {}) {
  const createdAt = getNow(now);
  const appliedChanges = (changes || []).filter((change) => change.status === 'applied');
  const blockedChanges = (changes || []).filter((change) => change.status === 'blocked');
  const checkpoint = {
    checkpoint_id: createCheckpointId({ now, createId }),
    checkpoint_version: CHECKPOINT_VERSION,
    workbook_id: asString(workbook && workbook.id),
    actor: actor || {
      type: 'external_ai',
      display_name: 'ChatGPT Companion'
    },
    origin,
    request_id: asString(requestId),
    session_id: asString(sessionId) || undefined,
    idempotency_key: asString(idempotencyKey) || undefined,
    source_prompt: asString(sourcePrompt) || undefined,
    action_plan_id: asString(actionPlanId) || undefined,
    status:
      status ||
      (appliedChanges.length && blockedChanges.length
        ? 'partially_applied'
        : appliedChanges.length
          ? 'applied'
          : 'failed'),
    created_at: createdAt,
    applied_at: appliedChanges.length ? createdAt : undefined,
    summary: summarizeCheckpointChanges(changes || [], validationIssues || [], warnings || []),
    changes: changes || [],
    validation_issues: validationIssues || [],
    warnings: warnings || [],
    audit_event_ids: [],
    before_workbook_fingerprint: beforeWorkbookFingerprint || fingerprintWorkbookCore(workbook),
    after_workbook_fingerprint: afterWorkbookFingerprint || fingerprintWorkbookCore(workbook),
    checkpoint_review_url: ''
  };
  checkpoint.checkpoint_review_url = getCheckpointReviewUrl(checkpoint.checkpoint_id);
  const store = createWorkbookCheckpointStore(workbook);
  store.createCheckpoint(checkpoint);
  const audit = appendCheckpointAuditEvent(workbook, {
    createId,
    event_type: 'checkpoint_created',
    request_id: checkpoint.request_id,
    workbook_id: checkpoint.workbook_id,
    checkpoint_id: checkpoint.checkpoint_id,
    caller_type: actor && actor.caller_type,
    origin,
    auth_method: actor && actor.auth_method,
    operation_id: 'executeCavalryCheckpointedActionPlan',
    action_count: checkpoint.summary.total_actions,
    applied_count: checkpoint.summary.applied,
    blocked_count: checkpoint.summary.blocked,
    warning_count: checkpoint.summary.warnings,
    idempotency_key_status: checkpoint.idempotency_key ? 'created' : 'none',
    outcome: checkpoint.status
  });
  checkpoint.audit_event_ids.push(audit.audit_event_id);
  return checkpoint;
}

export function getCheckpoint(workbook, checkpointId) {
  return createWorkbookCheckpointStore(workbook).getCheckpoint(
    workbook && workbook.id,
    checkpointId
  );
}

export function listCheckpoints(workbook, options = {}) {
  return createWorkbookCheckpointStore(workbook).listCheckpoints(workbook && workbook.id, options);
}
