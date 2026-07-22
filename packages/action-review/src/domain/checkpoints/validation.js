import {
  CHECKPOINT_ACTOR_TYPES,
  CHECKPOINT_CHANGE_OPERATIONS,
  CHECKPOINT_CHANGE_STATUSES,
  CHECKPOINT_ENTITY_TYPES,
  CHECKPOINT_ORIGINS,
  CHECKPOINT_STATUSES,
  CHECKPOINT_VERSION
} from './schema.js';
import { isSafeCheckpointId } from './checkpoint-id.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function issue(code, message, field) {
  return { code, message, field, severity: 'blocked' };
}

export function validateCheckpointChange(change) {
  const source = change && typeof change === 'object' ? change : {};
  const issues = [];
  if (!asString(source.change_id))
    issues.push(
      issue('missing_required_field', 'Checkpoint change requires change_id.', 'change_id')
    );
  if (!CHECKPOINT_ENTITY_TYPES.includes(asString(source.entity_type)))
    issues.push(
      issue('invalid_schema', 'Checkpoint change entity_type is invalid.', 'entity_type')
    );
  if (!asString(source.entity_id))
    issues.push(
      issue('missing_required_field', 'Checkpoint change requires entity_id.', 'entity_id')
    );
  if (!CHECKPOINT_CHANGE_OPERATIONS.includes(asString(source.operation)))
    issues.push(issue('invalid_schema', 'Checkpoint change operation is invalid.', 'operation'));
  if (!CHECKPOINT_CHANGE_STATUSES.includes(asString(source.status)))
    issues.push(issue('invalid_schema', 'Checkpoint change status is invalid.', 'status'));
  if (source.status === 'applied' && !source.inverse_patch)
    issues.push(
      issue(
        'checkpoint_change_not_reversible',
        'Applied checkpoint change requires an inverse patch.',
        'inverse_patch'
      )
    );
  return { ok: issues.length === 0, issues };
}

export function validateCheckpoint(checkpoint) {
  const source = checkpoint && typeof checkpoint === 'object' ? checkpoint : {};
  const issues = [];
  if (!isSafeCheckpointId(source.checkpoint_id))
    issues.push(issue('invalid_schema', 'Checkpoint ID is missing or unsafe.', 'checkpoint_id'));
  if (asString(source.checkpoint_version) !== CHECKPOINT_VERSION)
    issues.push(
      issue('invalid_schema', 'Checkpoint version is unsupported.', 'checkpoint_version')
    );
  if (!asString(source.workbook_id))
    issues.push(issue('missing_required_field', 'Checkpoint requires workbook_id.', 'workbook_id'));
  if (!CHECKPOINT_ORIGINS.includes(asString(source.origin)))
    issues.push(issue('invalid_schema', 'Checkpoint origin is invalid.', 'origin'));
  if (!CHECKPOINT_STATUSES.includes(asString(source.status)))
    issues.push(issue('invalid_schema', 'Checkpoint status is invalid.', 'status'));
  if (!(source.actor && CHECKPOINT_ACTOR_TYPES.includes(asString(source.actor.type))))
    issues.push(issue('invalid_schema', 'Checkpoint actor is invalid.', 'actor.type'));
  if (!asString(source.created_at))
    issues.push(issue('missing_required_field', 'Checkpoint requires created_at.', 'created_at'));
  if (!Array.isArray(source.changes))
    issues.push(issue('missing_required_field', 'Checkpoint requires changes array.', 'changes'));
  (source.changes || []).forEach((change) => {
    const result = validateCheckpointChange(change);
    issues.push(...result.issues);
  });
  return { ok: issues.length === 0, issues };
}
