import { fingerprintEntity } from './entity-fingerprint.js';

export function detectRollbackConflict(change, current) {
  if (!change) {
    return {
      reason: 'unsupported_rollback',
      safe_options: ['manual_review']
    };
  }
  if (change.status === 'rolled_back') {
    return {
      reason: 'already_rolled_back',
      safe_options: ['keep_current', 'manual_review']
    };
  }
  if (!change.inverse_patch || change.inverse_patch.type === 'unsupported_rollback') {
    return {
      reason: 'unsupported_rollback',
      safe_options: ['manual_review']
    };
  }
  if (current == null) {
    if (change.operation === 'create') {
      return null;
    }
    return {
      reason: 'entity_missing',
      safe_options: ['manual_review']
    };
  }
  if (change.after_fingerprint && fingerprintEntity(current) !== change.after_fingerprint) {
    return {
      reason: 'entity_changed_after_checkpoint',
      safe_options: ['keep_current', 'restore_checkpoint_before', 'manual_review']
    };
  }
  return null;
}

export function createRollbackConflict(change, current, reason) {
  return {
    change_id: change.change_id,
    entity_type: change.entity_type,
    entity_id: change.entity_id,
    reason: reason.reason,
    before: change.before || null,
    checkpoint_after: change.after || null,
    current: current || null,
    safe_options: reason.safe_options || ['manual_review']
  };
}
