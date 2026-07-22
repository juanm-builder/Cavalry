import { cloneEntity } from './entity-fingerprint.js';

export function buildInversePatch({ operation, entityType, entityId, before, after } = {}) {
  const op = String(operation || '').trim();
  if (op === 'create') {
    return {
      type: 'remove_created_entity',
      entity_type: entityType,
      entity_id: entityId,
      expected_after: cloneEntity(after)
    };
  }
  if (op === 'update' || op === 'archive' || op === 'restore' || op === 'mark_paid') {
    return {
      type: 'restore_before_snapshot',
      entity_type: entityType,
      entity_id: entityId,
      before: cloneEntity(before),
      expected_after: cloneEntity(after)
    };
  }
  return {
    type: 'unsupported_rollback',
    entity_type: entityType,
    entity_id: entityId
  };
}
