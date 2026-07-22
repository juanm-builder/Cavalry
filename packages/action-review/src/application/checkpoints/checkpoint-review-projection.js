import { getCheckpointReviewUrl } from '../../domain/checkpoints/checkpoint-id.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function groupByType(changes = []) {
  return changes.reduce((groups, change) => {
    const key = asString(change.entity_type || 'other');
    groups[key] = groups[key] || [];
    groups[key].push({
      change_id: change.change_id,
      operation: change.operation,
      entity_type: change.entity_type,
      entity_id: change.entity_id,
      human_summary: change.human_summary,
      before: change.before,
      after: change.after,
      validation_issues: change.validation_issues || [],
      warnings: change.warnings || [],
      rollback_status: change.status,
      conflict_status: change.status === 'rollback_conflict' ? 'conflict' : 'none'
    });
    return groups;
  }, {});
}

export function projectCheckpointForReview(checkpoint) {
  if (!checkpoint) {
    return null;
  }
  const reviewUrl =
    checkpoint.checkpoint_review_url || getCheckpointReviewUrl(checkpoint.checkpoint_id);
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    header:
      'ChatGPT applied reversible changes in Cavalry. Nothing was permanently deleted. Review the checkpoint and undo anything that does not look right.',
    actor: checkpoint.actor,
    origin: checkpoint.origin,
    created_at: checkpoint.created_at,
    source_prompt: checkpoint.source_prompt || '',
    status: checkpoint.status,
    rollback_available: (checkpoint.changes || []).some(
      (change) =>
        change.status === 'applied' &&
        change.inverse_patch &&
        change.inverse_patch.type !== 'unsupported_rollback'
    ),
    conflicts_exist: (checkpoint.changes || []).some(
      (change) => change.status === 'rollback_conflict'
    ),
    summary: checkpoint.summary,
    review_url: reviewUrl,
    audit_event_ids: checkpoint.audit_event_ids || [],
    before_workbook_fingerprint: checkpoint.before_workbook_fingerprint,
    after_workbook_fingerprint: checkpoint.after_workbook_fingerprint,
    groups: groupByType(checkpoint.changes || []),
    blocked_actions: (checkpoint.changes || []).filter((change) => change.status === 'blocked'),
    warnings: checkpoint.warnings || [],
    validation_issues: checkpoint.validation_issues || []
  };
}
